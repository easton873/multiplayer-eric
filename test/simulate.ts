// End-to-end smoke test: boots the server, plays a full game with bot players over real sockets,
// and checks the rules (scoring, no self-voting, no answer leaks, reveal order, rejoin, game end).
import { spawn } from 'node:child_process';
import { io, type Socket } from 'socket.io-client';
import assert from 'node:assert/strict';
import type { ClientState, Ack } from '../shared/types.js';

const PORT = 3111;
const URL = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), TIMING_SCALE: '0.05' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const ready = new Promise<void>((res) => server.stdout!.on('data', (d) => String(d).includes('listening') && res()));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const emitAck = <T,>(s: Socket, ev: string, ...args: unknown[]) =>
  new Promise<T>((res) => (s as any).emit(ev, ...args, res));

interface Bot {
  name: string;
  sock: Socket;
  state: ClientState | null;
  id: string;
  token: string;
}

async function main() {
  await ready;
  const host = io(URL);
  let hostState: ClientState | null = null;
  host.on('state', (s) => (hostState = s));
  const created = await emitAck<{ ok: true; code: string; hostToken: string }>(host, 'host:create');
  assert(created.ok);
  const code = created.code;
  console.log('room', code);

  const bots: Bot[] = [];
  const hostSeen: string[] = [];
  const leaks: string[] = [];
  const names = ['Ann', 'Bo', 'Cy', 'Di'];
  for (const name of names) {
    const sock = io(URL, { forceNew: true });
    const bot: Bot = { name, sock, state: null, id: '', token: '' };
    sock.on('state', (s: ClientState) => {
      bot.state = s;
      const json = JSON.stringify(s);
      // while writing/reading/voting, nobody should be able to tell which answer is real or who wrote what
      if (['writing', 'readAnswers', 'voting'].includes(s.phase)) {
        if (json.includes('authorId') || json.includes('isReal')) leaks.push(`${name} saw authorship in ${s.phase}`);
        if (s.phase === 'writing' && s.chosen != null && json.includes('"answer"')) leaks.push('answer field leaked');
      }
    });
    const res = await emitAck<{ ok: true; token: string; playerId: string }>(sock, 'player:join', { code, name });
    assert(res.ok, 'join ok');
    bot.id = res.playerId;
    bot.token = res.token;
    bots.push(bot);
  }
  const dup = await emitAck<{ ok: boolean }>(io(URL, { forceNew: true }), 'player:join', { code, name: 'ann' });
  assert.equal(dup.ok, false, 'duplicate names rejected');
  const bad = await emitAck<{ ok: boolean }>(io(URL, { forceNew: true }), 'player:join', { code: 'ZZZZ', name: 'x' });
  assert.equal(bad.ok, false, 'bad code rejected');

  // Rounds mode, 2 rounds. Writing is unlimited (0) so it must end when everyone has submitted.
  host.emit('host:settings', { endMode: 'rounds', target: 2, timers: { preview: 1, categoryVote: 0, writing: 0, read: 0, voting: 0 } });
  await sleep(100);
  assert.equal(hostState!.settings.endMode, 'rounds');
  assert.equal(hostState!.settings.timers.writing, 0);
  host.emit('host:start');

  let ownVoteRejected = false;
  let readSeen = 0;
  const phasesSeen = new Set<string>();
  const t0 = Date.now();
  const handled = new Set<string>();
  let rejoined = false;

  while (hostState!.phase !== 'gameOver') {
    assert(Date.now() - t0 < 60000, 'game timed out in phase ' + hostState!.phase);
    const s = hostState!;
    phasesSeen.add(s.phase);
    hostSeen.push(s.phase);
    const key = `${s.round}:${s.phase}:${s.readIndex}`;
    if (!handled.has(key)) {
      handled.add(key);
      if (s.phase === 'categoryVote') {
        assert.equal(s.options.length, 5, '5 options visible');
        assert.equal(new Set(s.options.map((o) => o.category)).size, 5, 'one of each category');
        // everyone votes -> phase should end early (categoryVote timer is unlimited)
        bots.forEach((b, i) => b.sock.emit('player:categoryVote', { index: i % 5 }));
      } else if (s.phase === 'writing') {
        bots.forEach((b, i) => (b.sock as any).emit('player:answer', { text: `Bluff number ${i} ` + 'x'.repeat(300) }, () => {}));
        // double submit must fail
        const again = await emitAck<{ ok: boolean }>(bots[0].sock, 'player:answer', { text: 'again' });
        assert.equal(again.ok, false, 'double submit rejected');
      } else if (s.phase === 'readAnswers') {
        readSeen++;
        assert.equal(s.answers.length, 1, 'one answer at a time');
        assert(s.answers[0].text.length <= 180, 'answer capped at 180');
        bots.forEach((b) => b.sock.emit('player:read', { read: true }));
      } else if (s.phase === 'voting') {
        assert.equal(s.answers.length, 5, 'real + 4 bluffs');
        // reconnect test: Di drops and rejoins with her token mid-vote
        if (!rejoined) {
          rejoined = true;
          bots[3].sock.disconnect();
          await sleep(50);
          const sock = io(URL, { forceNew: true });
          sock.on('state', (st: ClientState) => (bots[3].state = st));
          const r = await emitAck<{ ok: boolean; playerId: string }>(sock, 'player:join', { code, name: 'whatever', token: bots[3].token });
          assert(r.ok && r.playerId === bots[3].id, 'rejoin with token keeps identity');
          bots[3].sock = sock;
          await sleep(50);
        }
        for (const b of bots) {
          const own = b.state!.you!.ownAnswerId;
          if (!ownVoteRejected && own) {
            const r = await emitAck<{ ok: boolean }>(b.sock, 'player:vote', { answerId: own });
            assert.equal(r.ok, false, 'self vote rejected');
            ownVoteRejected = true;
          }
          const choices = b.state!.answers.filter((a) => a.id !== own);
          const pick = choices[Math.floor(Math.random() * choices.length)];
          const r = await emitAck<{ ok: boolean }>(b.sock, 'player:vote', { answerId: pick.id });
          assert(r.ok, 'vote accepted');
        }
      } else if (s.phase === 'summary') {
        // check scoring against the reveal data
        const entries = s.summary!;
        assert(entries[entries.length - 1].isReal, 'real answer revealed last');
        const counts = entries.slice(0, -1).map((e) => e.voterIds.length);
        assert(counts.every((n, i) => n >= 1 && (i === 0 || counts[i - 1] <= n)), 'fake answers ascending by votes, none with zero');
        const exp: Record<string, number> = {};
        for (const e of entries) {
          if (e.isReal) e.voterIds.forEach((v) => (exp[v] = (exp[v] ?? 0) + 1));
          else exp[e.authorId!] = (exp[e.authorId!] ?? 0) + e.voterIds.length;
        }
        for (const p of s.players) assert.equal(s.roundDeltas![p.id], exp[p.id] ?? 0, `delta for ${p.name}`);
      }
    }
    await sleep(25);
  }

  phasesSeen.add('gameOver');
  const final = hostState!;
  assert.equal(final.round, 2, 'two rounds played');
  assert(final.winnerIds.length >= 1);
  for (const ph of ['preview', 'categoryVote', 'categoryResult', 'writing', 'readAnswers', 'voting', 'reveal', 'summary', 'gameOver'])
    assert(phasesSeen.has(ph), `phase ${ph} seen`);
  assert.deepEqual(leaks, [], 'no leaks');
  assert(ownVoteRejected);
  assert(readSeen >= 10, 'read phase stepped through answers');
  console.log('final scores:', final.players.map((p) => `${p.name}=${p.score}`).join(' '), '| winners:', final.winnerIds.length);

  // play again -> lobby with scores reset
  host.emit('host:playAgain');
  await sleep(100);
  assert.equal(hostState!.phase, 'lobby');
  assert(hostState!.players.every((p) => p.score === 0));

  // points mode ends the round someone reaches the target
  host.emit('host:settings', { endMode: 'points', target: 1, timers: { preview: 1, categoryVote: 1, writing: 1, read: 1, voting: 1 } });
  host.emit('host:start');
  const t1 = Date.now();
  while (hostState!.phase !== 'gameOver') {
    assert(Date.now() - t1 < 60000, 'points game timed out');
    // timers expire on their own; nobody submits anything, so scores stay 0 and it'd run forever -> help it along
    const s = hostState!;
    if (s.phase === 'writing' && !handled.has('p' + s.round)) {
      handled.add('p' + s.round);
      bots[0].sock.emit('player:answer', { text: 'my bluff' });
      bots[1].sock.emit('player:answer', { text: 'other bluff' });
    }
    if (s.phase === 'voting' && !handled.has('v' + s.round)) {
      handled.add('v' + s.round);
      const a = bots[2].state!.answers.find((x) => x.text === 'my bluff');
      if (a) bots[2].sock.emit('player:vote', { answerId: a.id }, () => {});
    }
    await sleep(25);
  }
  assert(Math.max(...hostState!.players.map((p) => p.score)) >= 1, 'points target reached');
  console.log('points mode ended after', hostState!.round, 'rounds');
  console.log('\nALL CHECKS PASSED');
}

main()
  .catch((e) => {
    console.error('\nFAILED:', e);
    process.exitCode = 1;
  })
  .finally(() => {
    server.kill();
    setTimeout(() => process.exit(), 100);
  });
