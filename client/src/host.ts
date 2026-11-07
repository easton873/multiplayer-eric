import QRCode from 'qrcode';
import './styles-common.css';
import './host.css';
import { CATEGORY_META, type ClientState, type PlayerInfo, type RevealEntry, type Timers } from '../../shared/types';
import { $, esc, GAME_NAME, rankPlayers, socket, syncState, timerHTML } from './common';

const STORE = 'multiplayereric.host';
const stage = $('#stage')!;
const strip = $('#strip')!;
const hudTimer = $('#hudTimer')!;
const skipBtn = $<HTMLButtonElement>('#skip')!;
hudTimer.innerHTML = timerHTML();

let state: ClientState | null = null;
let viewKey = '';
let roomCode = '';
let joinBase = location.origin;
let qrDataUrl = '';

// ------------------------------------------------------------------ connection

function load(): { code: string; hostToken: string } | null {
  try {
    return JSON.parse(localStorage.getItem(STORE) || 'null');
  } catch {
    return null;
  }
}

function createRoom() {
  socket.emit('host:create', (res) => {
    if (!res.ok) return;
    roomCode = res.code;
    try {
      localStorage.setItem(STORE, JSON.stringify({ code: res.code, hostToken: res.hostToken }));
    } catch {
      /* ignore */
    }
    prepareJoinInfo();
  });
}

socket.on('connect', () => {
  $('#conn')!.hidden = true;
  const saved = load();
  if (saved) {
    socket.emit('host:resume', saved, (res) => {
      if (res.ok) {
        roomCode = saved.code;
        prepareJoinInfo();
      } else createRoom();
    });
  } else createRoom();
});
socket.on('disconnect', () => ($('#conn')!.hidden = false));
socket.on('state', (s) => {
  state = s;
  syncState(s);
  render();
});
socket.on('closed', () => {
  try {
    localStorage.removeItem(STORE);
  } catch {
    /* ignore */
  }
  location.reload();
});

async function prepareJoinInfo() {
  const { hostname, port, protocol, origin } = location;
  joinBase = origin;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    // phones can't reach "localhost" - advertise this computer's LAN address instead
    try {
      const { ips } = (await (await fetch('/api/info')).json()) as { ips: string[] };
      if (ips[0]) joinBase = `${protocol}//${ips[0]}${port ? ':' + port : ''}`;
    } catch {
      /* fall back to origin */
    }
  }
  qrDataUrl = await QRCode.toDataURL(`${joinBase}/play.html?room=${roomCode}`, { margin: 1, width: 520, color: { dark: '#1b1033', light: '#ffffff' } });
  viewKey = '';
  render();
}

// ------------------------------------------------------------------ helpers

const byId = (s: ClientState, id: string | null) => s.players.find((p) => p.id === id);

function avatar(p: PlayerInfo | undefined, cls = 'av') {
  return `<span class="${cls}" style="--pc:${p?.color ?? '#888'}">${p?.emoji ?? '❔'}</span>`;
}

function confetti(count = 140) {
  const colors = ['#ffd23f', '#ff4d6d', '#2ec4ff', '#3ddc97', '#c77dff', '#ff9f1c', '#ffffff'];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('i');
    el.className = 'cf';
    el.style.left = Math.random() * 100 + 'vw';
    el.style.background = colors[i % colors.length];
    el.style.setProperty('--dx', (Math.random() * 30 - 15).toFixed(1) + 'vw');
    el.style.setProperty('--rot', Math.round(Math.random() * 900 - 450) + 'deg');
    el.style.animationDuration = 2.4 + Math.random() * 2.4 + 's';
    el.style.animationDelay = Math.random() * 0.8 + 's';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 6500);
  }
}

function syncChildren<T>(host: HTMLElement, items: T[], id: (t: T) => string, make: (t: T) => HTMLElement, update: (el: HTMLElement, t: T) => void) {
  const existing = new Map<string, HTMLElement>();
  host.querySelectorAll<HTMLElement>(':scope > [data-id]').forEach((e) => existing.set(e.dataset.id!, e));
  const keep = new Set<string>();
  items.forEach((t, i) => {
    const k = id(t);
    keep.add(k);
    let el = existing.get(k);
    if (!el) {
      el = make(t);
      el.dataset.id = k;
    }
    update(el, t);
    const at = host.children[i] as HTMLElement | undefined;
    if (at !== el) host.insertBefore(el, at ?? null);
  });
  existing.forEach((el, k) => !keep.has(k) && el.remove());
}

const catOf = (s: ClientState) => (s.chosen != null ? s.options[s.chosen] : null);

function counts(s: ClientState) {
  const live = s.players.filter((p) => p.participating && p.connected);
  return { done: live.filter((p) => p.done).length, total: live.length };
}

// ------------------------------------------------------------------ views

function lobbyView(s: ClientState): string {
  const t = s.settings.timers;
  const sel = (key: keyof Timers, label: string) => {
    const presets = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300];
    const vals = [...new Set([...presets, t[key]].filter((v) => v > 0))].sort((a, b) => a - b);
    return `<label>${label}<select data-tkey="${key}">${vals.map((v) => `<option value="${v}" ${v === t[key] ? 'selected' : ''}>${v} seconds</option>`).join('')}<option value="0" ${t[key] === 0 ? 'selected' : ''}>Unlimited</option></select></label>`;
  };
  return `<section class="lobby">
    <div class="lobby-left">
      <div class="logo">${esc(GAME_NAME).replace(' ', '<br>')}</div>
      <div class="join-card">
        ${qrDataUrl ? `<img class="qr" src="${qrDataUrl}" alt="QR code to join" />` : '<div class="qr"></div>'}
        <div class="t">Scan the code or go to<br /><b>${esc(joinBase.replace(/^https?:\/\//, ''))}</b><br />and enter room code<div class="roomcode">${esc(s.code)}</div></div>
      </div>
    </div>
    <div class="lobby-right">
      <div class="bubbles" id="bubbles"></div>
      <div class="settings">
        <h3>Game settings</h3>
        <label>Game ends when<select id="endMode"><option value="points">First to X points</option><option value="rounds">Play X rounds</option></select></label>
        <label><span id="targetLabel">Points to win</span><input id="target" type="number" min="1" max="999" /></label>
        <label>Max answer length<input id="maxLen" type="number" min="20" max="1000" step="10" /></label>
        ${sel('preview', 'Prompt preview (each)')}
        ${sel('categoryVote', 'Prompt vote')}
        ${sel('writing', 'Writing')}
        ${sel('read', 'Reading (each answer)')}
        ${sel('voting', 'Answer vote')}
      </div>
      <button class="startbtn" id="start" disabled>Start game</button>
    </div>
  </section>`;
}

function lobbyLive(s: ClientState) {
  const b = $('#bubbles')!;
  if (!s.players.length) {
    if (!b.querySelector('.empty')) b.innerHTML = '<div class="empty">Waiting for players to join… 📱</div>';
  } else {
    b.querySelector('.empty')?.remove();
    syncChildren(
      b,
      s.players,
      (p) => p.id,
      (p) => {
        const el = document.createElement('div');
        el.className = 'bubble';
        el.style.setProperty('--pc', p.color);
        el.innerHTML = `<span class="av">${p.emoji}</span><span class="nm">${esc(p.name)}</span><button class="x" data-kick="${p.id}" title="Remove">✕</button>`;
        return el;
      },
      (el, p) => el.classList.toggle('off', !p.connected),
    );
  }
  const live = s.players.filter((p) => p.connected).length;
  const start = $<HTMLButtonElement>('#start')!;
  start.disabled = live < 2;
  start.textContent = live < 2 ? 'Need at least 2 players' : `Start game (${live} players)`;
  const setIfIdle = (el: HTMLInputElement | HTMLSelectElement, v: string) => {
    if (document.activeElement !== el && el.value !== v) el.value = v;
  };
  setIfIdle($<HTMLSelectElement>('#endMode')!, s.settings.endMode);
  setIfIdle($<HTMLInputElement>('#target')!, String(s.settings.target));
  setIfIdle($<HTMLInputElement>('#maxLen')!, String(s.settings.maxAnswerLength));
  $('#targetLabel')!.textContent = s.settings.endMode === 'points' ? 'Points to win' : 'Number of rounds';
  stage.querySelectorAll<HTMLSelectElement>('select[data-tkey]').forEach((sel) => setIfIdle(sel, String(s.settings.timers[sel.dataset.tkey as keyof Timers])));
}

function cardHTML(o: { category: keyof typeof CATEGORY_META; prompt: string }, cls: string, extra = '', i = 0) {
  const m = CATEGORY_META[o.category];
  return `<div class="${cls} cat-${o.category}" style="--i:${i};--rot:${i % 2 ? -9 : 9}deg">${extra}<div class="ic">${m.icon}</div><div class="lb">${m.label}</div><div class="pr">${esc(o.prompt)}</div></div>`;
}

function previewView(s: ClientState): string {
  const o = s.options[s.previewIndex];
  const m = CATEGORY_META[o.category];
  return `<section>
    <div class="eyebrow">Round ${s.round} · Option ${s.previewIndex + 1} of 5</div>
    <div class="pcard cat-${o.category}"><div class="ic">${m.icon}</div><div class="lb">${m.label}</div><div class="pr">${esc(o.prompt)}</div><div class="in">${m.short}</div></div>
    <div class="pdots">${[0, 1, 2, 3, 4].map((i) => `<i class="${i <= s.previewIndex ? 'on' : ''}"></i>`).join('')}</div>
    <div class="sub">Read them all — you'll vote on which to play</div>
  </section>`;
}

function categoryVoteView(s: ClientState): string {
  return `<section>
    <h1>Vote for a prompt!</h1>
    <div class="sub">Use your phone · <b data-done></b> voted</div>
    <div class="cgrid">${s.options.map((o, i) => cardHTML(o, 'ccard', '', i)).join('')}</div>
  </section>`;
}

function categoryResultView(s: ClientState): string {
  const m = CATEGORY_META[s.options[s.chosen!].category];
  return `<section class="cresult">
    <h1>${m.icon} ${m.label} it is!</h1>
    <div class="cgrid">${s.options
      .map((o, i) => cardHTML(o, 'ccard ' + (i === s.chosen ? 'win' : 'dim'), `<div class="tl" style="--i:${i}">${s.tally![i]}</div>`, i))
      .join('')}</div>
  </section>`;
}

function writingView(s: ClientState): string {
  const o = catOf(s)!;
  const m = CATEGORY_META[o.category];
  const emojis = ['✏️', '📝', '🤥', '💭', '🕵️', '🤔', '📖', '🎭'];
  const floaters = Array.from({ length: 14 }, (_, i) => `<span style="left:${(i * 7.3 + 3) % 96}%;animation-duration:${7 + (i % 5) * 2}s;animation-delay:${-(i * 1.3)}s">${emojis[i % emojis.length]}</span>`).join('');
  return `<section>
    <div class="confetti-emoji">${floaters}</div>
    <div class="eyebrow">${m.icon} ${m.label}</div>
    <div class="wcard cat-${o.category}"><div class="pr">${esc(o.prompt)}</div><div class="in">${m.instruction}</div></div>
    <div class="status"><b data-done></b> bluffs written</div>
    <div class="sub">Don't let the others know what you wrote 🤫</div>
  </section>`;
}

function readView(s: ClientState): string {
  const o = catOf(s)!;
  const m = CATEGORY_META[o.category];
  const a = s.answers[0];
  const size = a.text.length > 140 ? 'l' : a.text.length > 80 ? 'm' : '';
  return `<section>
    <div class="eyebrow">${m.icon} ${esc(o.prompt)}</div>
    <div class="rcount">Answer ${s.readIndex + 1} of ${s.answerTotal}</div>
    <div class="rcard"><p class="${size}">${esc(a.text)}</p></div>
    <div class="status"><b data-done></b> have read it</div>
    <div class="sub">Tick "I've read it" on your phone</div>
  </section>`;
}

function votingView(s: ClientState): string {
  const o = catOf(s)!;
  const m = CATEGORY_META[o.category];
  return `<section>
    <div class="eyebrow">${m.icon} ${esc(o.prompt)}</div>
    <h1>Which one is the real answer?</h1>
    <div class="vgrid">${s.answers.map((a, i) => `<div class="vtile" style="--i:${i}"><span class="n">${i + 1}</span><span class="t">${esc(a.text)}</span></div>`).join('')}</div>
    <div class="status"><b data-done></b> voted</div>
  </section>`;
}

function revealView(s: ClientState): string {
  const e: RevealEntry = s.reveal[s.reveal.length - 1];
  const n = e.voterIds.length;
  // Each reveal card is only on screen for ~3s, so everything is staged inside that window.
  const t0 = 0.8;
  const step = Math.min(0.3, 1.1 / Math.max(1, n));
  const authorDelay = t0 + n * step + 0.2;
  const size = e.text.length > 130 ? 'l' : '';
  const voters = e.voterIds
    .map((id, i) => {
      const p = byId(s, id);
      return `<div class="rv-chip" style="--pc:${p?.color};--d:${(t0 + i * step).toFixed(2)}s">${avatar(p)}${esc(p?.name ?? '?')}${e.isReal ? ' <span class="plus">+1</span>' : ''}</div>`;
    })
    .join('');
  let tail: string;
  if (e.isReal) {
    tail = n === 0 ? `<div class="rv-none" style="--d:${t0}s">Nobody found the truth! 😬</div>` : `<div class="rv-author" style="--d:${authorDelay.toFixed(2)}s">Sharp eyes! Everyone who found it earns a point.</div>`;
  } else {
    const author = byId(s, e.authorId);
    tail = `<div class="rv-author" style="--d:${authorDelay.toFixed(2)}s">Written by <div class="rv-chip" style="--pc:${author?.color}">${avatar(author)}${esc(author?.name ?? 'someone')}</div><span class="pts">+${n} ${n === 1 ? 'point' : 'points'}</span></div>`;
  }
  return `<section class="reveal ${e.isReal ? 'real' : ''}">
    <div class="rv-progress">${s.revealIndex + 1} / ${s.revealTotal}</div>
    ${e.isReal ? '<div class="rv-banner">✨ THE REAL ANSWER ✨</div>' : ''}
    <div class="rv-card"><p class="${size}">${esc(e.text)}</p></div>
    <div class="rv-voters">
      ${n ? `<div class="rv-label" style="--d:${(t0 - 0.3).toFixed(2)}s">${e.isReal ? 'Found it' : 'Fooled'}</div><div class="rv-chips">${voters}</div>` : e.isReal ? '' : ''}
    </div>
    ${tail}
  </section>`;
}

function summaryView(s: ClientState): string {
  const o = catOf(s)!;
  const real = s.summary!.find((e) => e.isReal)!;
  const ranked = rankPlayers(s.players);
  const max = Math.max(1, ...ranked.map((p) => p.score));
  const top = Math.max(...s.players.map((p) => p.score));
  const final = s.settings.endMode === 'points' ? top >= s.settings.target : s.round >= s.settings.target;
  const rows = ranked
    .map((p, i) => {
      const d = s.roundDeltas?.[p.id] ?? 0;
      return `<div class="row" style="--i:${i};--pc:${p.color};--from:${(((p.score - d) / max) * 100).toFixed(1)}%;--to:${((p.score / max) * 100).toFixed(1)}%">
        <span class="rk">${p.rank}</span>${avatar(p)}<span class="nm">${esc(p.name)}</span>
        <div class="trk"><div class="fill"></div></div><span class="tot">${p.score}</span><span class="dl ${d ? '' : 'z'}">+${d}</span></div>`;
    })
    .join('');
  return `<section>
    <div class="eyebrow">Round ${s.round} scores</div>
    <div class="sum-answer cat-${o.category}"><b>${esc(o.prompt)}</b> — ${esc(real.text)}</div>
    <div class="board">${rows}</div>
    ${final ? '<div class="final-note">🏁 That was the final round!</div>' : ''}
    <div class="sum-bar"><i data-timer-bar></i></div>
  </section>`;
}

function gameOverView(s: ClientState): string {
  const ranked = rankPlayers(s.players);
  const winners = ranked.filter((p) => s.winnerIds.includes(p.id));
  const title = winners.length > 1 ? `It's a tie! ${winners.map((w) => esc(w.name)).join(' & ')}` : `${esc(winners[0].name)} wins!`;
  const top3 = ranked.slice(0, 3);
  const order = top3.length === 3 ? [top3[1], top3[0], top3[2]] : top3.length === 2 ? [top3[1], top3[0]] : top3;
  const heights: Record<number, number> = { 0: 100, 1: 72, 2: 52 };
  const pod = order
    .map((p) => {
      const idx = top3.indexOf(p);
      return `<div class="pod" style="--pc:${p.color}">${s.winnerIds.includes(p.id) ? '<div style="font-size:2.4rem;line-height:1">👑</div>' : ''}${avatar(p)}<div class="nm">${esc(p.name)}</div><div class="blk" style="--h:${heights[idx] * 0.12}rem;--d:${0.4 + (2 - idx) * 0.5}s">${p.score}</div></div>`;
    })
    .join('');
  const others = ranked.slice(3).map((p) => `<div class="pchip" style="--pc:${p.color}">${avatar(p)}${esc(p.name)} <span class="sc">${p.score}</span></div>`).join('');
  return `<section>
    <div class="trophy">🏆</div>
    <h1>${title}</h1>
    <div class="podium">${pod}</div>
    ${others ? `<div class="others">${others}</div>` : ''}
    <button class="again" id="again">Play again</button>
  </section>`;
}

// ------------------------------------------------------------------ render loop

function keyFor(s: ClientState): string {
  switch (s.phase) {
    case 'preview':
      return `preview|${s.round}|${s.previewIndex}`;
    case 'readAnswers':
      return `read|${s.round}|${s.readIndex}`;
    case 'reveal':
      return `reveal|${s.round}|${s.revealIndex}`;
    default:
      return `${s.phase}|${s.round}`;
  }
}

function stripLive(s: ClientState) {
  const show = ['categoryVote', 'writing', 'readAnswers', 'voting'].includes(s.phase);
  strip.hidden = !show;
  if (!show) return;
  syncChildren(
    strip,
    s.players.filter((p) => p.participating || !p.connected === false),
    (p) => p.id,
    (p) => {
      const el = document.createElement('div');
      el.className = 'pchip';
      el.style.setProperty('--pc', p.color);
      el.innerHTML = `<span class="av">${p.emoji}</span><span>${esc(p.name)}</span><span class="tick">✓</span>`;
      return el;
    },
    (el, p) => {
      el.classList.toggle('done', p.done);
      el.classList.toggle('off', !p.connected);
      el.classList.toggle('spec', !p.participating);
    },
  );
}

function liveUpdate(s: ClientState) {
  if (s.phase === 'lobby') lobbyLive(s);
  const { done, total } = counts(s);
  stage.querySelectorAll('[data-done]').forEach((el) => (el.textContent = `${done}/${total}`));
}

const VIEWS: Record<string, (s: ClientState) => string> = {
  lobby: lobbyView,
  preview: previewView,
  categoryVote: categoryVoteView,
  categoryResult: categoryResultView,
  writing: writingView,
  readAnswers: readView,
  voting: votingView,
  reveal: revealView,
  summary: summaryView,
  gameOver: gameOverView,
};

function render() {
  const s = state;
  if (!s) return;
  $('#hudCode')!.innerHTML = s.phase === 'lobby' ? '' : `ROOM <b>${esc(s.code)}</b>`;
  hudTimer.hidden = s.phase === 'lobby' || s.phase === 'gameOver';
  skipBtn.hidden = hudTimer.hidden;

  const key = keyFor(s);
  if (key !== viewKey) {
    viewKey = key;
    stage.innerHTML = VIEWS[s.phase](s);
    if (s.phase === 'reveal' && s.reveal[s.reveal.length - 1].isReal) setTimeout(() => state?.phase === 'reveal' && confetti(160), 500);
    if (s.phase === 'gameOver') {
      confetti(220);
      setTimeout(() => state?.phase === 'gameOver' && confetti(160), 2500);
    }
    if (s.phase === 'categoryResult') confetti(50);
  }
  liveUpdate(s);
  stripLive(s);
}

// ------------------------------------------------------------------ input

function pushSettings() {
  const num = (id: string) => Number($<HTMLInputElement>(id)!.value);
  const timers: Partial<Timers> = {};
  stage.querySelectorAll<HTMLSelectElement>('select[data-tkey]').forEach((sel) => (timers[sel.dataset.tkey as keyof Timers] = Number(sel.value)));
  socket.emit('host:settings', {
    endMode: $<HTMLSelectElement>('#endMode')!.value as 'points' | 'rounds',
    target: num('#target'),
    maxAnswerLength: num('#maxLen'),
    timers,
  });
}

stage.addEventListener('change', (e) => {
  if ((e.target as HTMLElement).closest('.settings')) pushSettings();
});
stage.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('#start')) socket.emit('host:start');
  else if (t.closest('#again')) socket.emit('host:playAgain');
  else {
    const k = t.closest<HTMLElement>('[data-kick]');
    if (k && confirm('Remove this player from the game?')) socket.emit('host:kick', { playerId: k.dataset.kick! });
  }
});
skipBtn.addEventListener('click', () => socket.emit('host:skip'));
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && state && !['lobby', 'gameOver'].includes(state.phase) && !(e.target as HTMLElement).matches('input, select, textarea, button')) {
    e.preventDefault();
    socket.emit('host:skip');
  }
});
