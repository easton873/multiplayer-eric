import type { Server } from 'socket.io';
import {
  CATEGORY_META,
  DEFAULT_SETTINGS,
  type AnswerPublic,
  type Category,
  type ClientState,
  type ClientToServerEvents,
  type OptionPublic,
  type Phase,
  REVEAL_HOLD_MS,
  revealTiming,
  type PlayerInfo,
  type RevealEntry,
  type ServerToClientEvents,
  type Settings,
  type SettingsPatch,
  type Timers,
} from '../shared/types.js';
import { CARDS, type CardEntry } from './cards.js';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

// Fixed-length beats. TIMING_SCALE lets the test simulation run fast.
const SCALE = Number(process.env.TIMING_SCALE ?? 1);
const CATEGORY_RESULT_MS = 5000 * SCALE;
const SUMMARY_MS = 5000 * SCALE;

export const ROOM_IDLE_MS = 15 * 60 * 1000;

const COLORS = ['#ff4d6d', '#ff9f1c', '#ffd23f', '#3ddc97', '#2ec4ff', '#7b6cff', '#c77dff', '#ff70a6', '#9ef01a', '#00f5d4', '#f15bb5', '#fb8500'];
const EMOJIS = ['🦊', '🐸', '🦄', '🐙', '🦖', '🐼', '🦉', '🐝', '🐳', '🦁', '🐧', '🦋', '🐢', '🦩', '🐨', '🐯'];
const CATEGORY_ORDER = Object.keys(CATEGORY_META) as Category[];

interface Player {
  id: string;
  token: string;
  name: string;
  color: string;
  emoji: string;
  score: number;
  socketId: string | null;
}

interface Answer {
  id: string;
  text: string;
  authorId: string | null; // null = the real answer
}

interface RoundData {
  options: (CardEntry & { category: Category })[];
  previewIndex: number;
  categoryVotes: Map<string, number>;
  chosen: number | null;
  tally: number[] | null;
  participants: Set<string>;
  submissions: Map<string, string>;
  answers: Answer[];
  readIndex: number;
  readChecks: Set<string>;
  votes: Map<string, string>;
  revealEntries: RevealEntry[];
  revealIndex: number;
  deltas: Record<string, number> | null;
}

const rand = (n: number) => Math.floor(Math.random() * n);
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const pickRandom = <T,>(arr: T[]): T => arr[rand(arr.length)];

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export class Room {
  readonly code: string;
  readonly hostToken: string;
  hostSocketId: string | null = null;
  settings: Settings = structuredClone(DEFAULT_SETTINGS);
  players = new Map<string, Player>();
  phase: Phase = 'lobby';
  round = 0;
  cur: RoundData = this.freshRound();
  private used: Record<Category, Set<number>> = { word: new Set(), date: new Set(), movie: new Set(), acronym: new Set(), person: new Set() };

  // timing
  private timer: NodeJS.Timeout | null = null;
  private onExpire: (() => void) | null = null;
  deadline: number | null = null;
  paused = false;
  private remaining: number | null = null;

  // lifecycle
  private idleTimer: NodeJS.Timeout | null = null;
  onDestroy: (() => void) | null = null;

  constructor(private io: IO, code: string, hostToken: string) {
    this.code = code;
    this.hostToken = hostToken;
  }

  // ------------------------------------------------------------------ lifecycle

  attachHost(socketId: string) {
    this.hostSocketId = socketId;
    this.cancelIdle();
    if (this.paused) this.resume();
    this.broadcast();
  }

  detachHost(socketId: string) {
    if (this.hostSocketId !== socketId) return;
    this.hostSocketId = null;
    this.pause();
    this.startIdle();
    this.broadcast();
  }

  private startIdle() {
    this.cancelIdle();
    this.idleTimer = setTimeout(() => this.destroy('The host left and the room timed out.'), ROOM_IDLE_MS);
  }
  private cancelIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  destroy(reason: string) {
    this.cancelIdle();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.io.to(this.roomName).emit('closed', reason);
    this.onDestroy?.();
  }

  get roomName() {
    return `room:${this.code}`;
  }

  // ------------------------------------------------------------------ players

  join(name: string, token: string | undefined, socketId: string): { ok: true; player: Player } | { ok: false; error: string } {
    if (token) {
      const existing = [...this.players.values()].find((p) => p.token === token);
      if (existing) {
        existing.socketId = socketId;
        this.afterPlayerPresenceChange(existing, true);
        return { ok: true, player: existing };
      }
    }
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 14);
    if (!clean) return { ok: false, error: 'Please enter a name.' };
    if ([...this.players.values()].some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
      return { ok: false, error: 'That name is already taken.' };
    }
    const idx = this.players.size;
    const used = new Set([...this.players.values()].map((p) => p.color));
    const color = COLORS.find((c) => !used.has(c)) ?? COLORS[idx % COLORS.length];
    const usedEmoji = new Set([...this.players.values()].map((p) => p.emoji));
    const emoji = EMOJIS.find((e) => !usedEmoji.has(e)) ?? EMOJIS[idx % EMOJIS.length];
    const player: Player = {
      id: Math.random().toString(36).slice(2, 10),
      token: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
      name: clean,
      color,
      emoji,
      score: 0,
      socketId,
    };
    this.players.set(player.id, player);
    this.afterPlayerPresenceChange(player, true);
    return { ok: true, player };
  }

  private afterPlayerPresenceChange(p: Player, joined: boolean) {
    // Anyone arriving before the writing phase ends gets to play the current round.
    const early: Phase[] = ['preview', 'categoryVote', 'categoryResult', 'writing'];
    if (joined && early.includes(this.phase)) this.cur.participants.add(p.id);
    if (!this.maybeAdvance()) this.broadcast();
  }

  disconnectPlayer(socketId: string) {
    const p = [...this.players.values()].find((x) => x.socketId === socketId);
    if (!p) return;
    p.socketId = null;
    if (!this.maybeAdvance()) this.broadcast();
  }

  kick(playerId: string) {
    const p = this.players.get(playerId);
    if (!p) return;
    if (p.socketId) this.io.to(p.socketId).emit('closed', 'You were removed from the game by the host.');
    this.players.delete(playerId);
    this.cur.participants.delete(playerId);
    this.cur.categoryVotes.delete(playerId);
    this.cur.submissions.delete(playerId);
    this.cur.votes.delete(playerId);
    this.cur.readChecks.delete(playerId);
    if (!this.maybeAdvance()) this.broadcast();
  }

  private isConnected(id: string) {
    return !!this.players.get(id)?.socketId;
  }

  // ------------------------------------------------------------------ timing

  private arm(ms: number | null, fn: () => void) {
    if (this.timer) clearTimeout(this.timer);
    this.onExpire = fn;
    this.remaining = null;
    if (ms && ms > 0) {
      this.deadline = Date.now() + ms;
      if (this.paused) {
        this.remaining = ms;
        this.timer = null;
      } else {
        this.timer = setTimeout(() => this.fire(), ms);
      }
    } else {
      this.deadline = null;
      this.timer = null;
    }
  }

  private fire() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const fn = this.onExpire;
    this.onExpire = null;
    this.deadline = null;
    this.remaining = null;
    fn?.();
    this.broadcast();
  }

  private pause() {
    if (this.paused) return;
    this.paused = true;
    if (this.timer && this.deadline) {
      this.remaining = Math.max(0, this.deadline - Date.now());
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private resume() {
    this.paused = false;
    if (this.remaining != null && this.onExpire) {
      this.deadline = Date.now() + this.remaining;
      this.timer = setTimeout(() => this.fire(), this.remaining);
      this.remaining = null;
    }
  }

  /** Host pressed "skip": end the current timed/open phase right now. */
  skip() {
    if (this.paused || !this.onExpire) return;
    this.fire();
  }

  private sec(n: number) {
    return n > 0 ? n * 1000 * SCALE : null;
  }

  // ------------------------------------------------------------------ settings & flow

  updateSettings(patch: SettingsPatch) {
    if (this.phase !== 'lobby') return;
    const s = this.settings;
    if (patch.endMode === 'points' || patch.endMode === 'rounds') s.endMode = patch.endMode;
    if (patch.target !== undefined) s.target = clampInt(patch.target, 1, 999, s.target);
    if (patch.maxAnswerLength !== undefined) s.maxAnswerLength = clampInt(patch.maxAnswerLength, 20, 1000, s.maxAnswerLength);
    if (patch.timers) {
      for (const k of Object.keys(s.timers) as (keyof Timers)[]) {
        if (patch.timers[k] !== undefined) s.timers[k] = clampInt(patch.timers[k], 0, 3600, s.timers[k]);
      }
    }
    this.broadcast();
  }

  start() {
    if (this.phase !== 'lobby' && this.phase !== 'gameOver') return;
    const connected = [...this.players.values()].filter((p) => p.socketId);
    if (connected.length < 2) return;
    this.round = 0;
    for (const p of this.players.values()) p.score = 0;
    this.startRound();
    this.broadcast();
  }

  playAgain() {
    if (this.phase !== 'gameOver') return;
    this.phase = 'lobby';
    this.round = 0;
    this.cur = this.freshRound();
    for (const p of this.players.values()) p.score = 0;
    this.arm(null, () => {});
    this.onExpire = null;
    this.broadcast();
  }

  private freshRound(): RoundData {
    return {
      options: [],
      previewIndex: 0,
      categoryVotes: new Map(),
      chosen: null,
      tally: null,
      participants: new Set(),
      submissions: new Map(),
      answers: [],
      readIndex: 0,
      readChecks: new Set(),
      votes: new Map(),
      revealEntries: [],
      revealIndex: 0,
      deltas: null,
    };
  }

  private drawCard(cat: Category): CardEntry {
    const pool = CARDS[cat];
    let free = pool.map((_, i) => i).filter((i) => !this.used[cat].has(i));
    if (!free.length) {
      this.used[cat].clear();
      free = pool.map((_, i) => i);
    }
    const i = pickRandom(free);
    this.used[cat].add(i);
    return pool[i];
  }

  private startRound() {
    this.round++;
    this.cur = this.freshRound();
    this.cur.options = shuffle(CATEGORY_ORDER).map((category) => ({ category, ...this.drawCard(category) }));
    for (const p of this.players.values()) if (p.socketId) this.cur.participants.add(p.id);
    this.phase = 'preview';
    this.cur.previewIndex = 0;
    this.arm(this.sec(this.settings.timers.preview), () => this.nextPreview());
  }

  private nextPreview() {
    if (this.cur.previewIndex < this.cur.options.length - 1) {
      this.cur.previewIndex++;
      this.arm(this.sec(this.settings.timers.preview), () => this.nextPreview());
    } else {
      this.enterCategoryVote();
    }
  }

  private enterCategoryVote() {
    this.phase = 'categoryVote';
    this.arm(this.sec(this.settings.timers.categoryVote), () => this.resolveCategory());
  }

  private resolveCategory() {
    const tally = this.cur.options.map(() => 0);
    for (const idx of this.cur.categoryVotes.values()) tally[idx]++;
    const max = Math.max(...tally);
    const winners = tally.map((n, i) => (n === max ? i : -1)).filter((i) => i >= 0);
    this.cur.chosen = pickRandom(winners);
    this.cur.tally = tally;
    this.phase = 'categoryResult';
    this.arm(CATEGORY_RESULT_MS, () => this.enterWriting());
  }

  private enterWriting() {
    this.phase = 'writing';
    this.arm(this.sec(this.settings.timers.writing), () => this.enterRead());
  }

  private enterRead() {
    const real = this.cur.options[this.cur.chosen!];
    const list: Omit<Answer, 'id'>[] = [{ text: real.answer, authorId: null }];
    for (const [authorId, text] of this.cur.submissions) list.push({ text, authorId });
    this.cur.answers = shuffle(list).map((a, i) => ({ ...a, id: `a${i}` }));
    this.cur.readIndex = 0;
    this.cur.readChecks = new Set();
    this.phase = 'readAnswers';
    this.arm(this.sec(this.settings.timers.read), () => this.nextRead());
  }

  private nextRead() {
    if (this.cur.readIndex < this.cur.answers.length - 1) {
      this.cur.readIndex++;
      this.cur.readChecks = new Set();
      this.arm(this.sec(this.settings.timers.read), () => this.nextRead());
    } else {
      this.enterVoting();
    }
  }

  private enterVoting() {
    this.phase = 'voting';
    this.cur.votes = new Map();
    this.arm(this.sec(this.settings.timers.voting), () => this.resolveVoting());
  }

  private resolveVoting() {
    const deltas: Record<string, number> = {};
    for (const p of this.players.values()) deltas[p.id] = 0;
    const votersFor = new Map<string, string[]>();
    for (const [voterId, answerId] of this.cur.votes) {
      const ans = this.cur.answers.find((a) => a.id === answerId);
      if (!ans) continue;
      votersFor.set(answerId, [...(votersFor.get(answerId) ?? []), voterId]);
      if (ans.authorId === null) deltas[voterId] = (deltas[voterId] ?? 0) + 1;
      else if (this.players.has(ans.authorId)) deltas[ans.authorId] = (deltas[ans.authorId] ?? 0) + 1;
    }
    for (const [id, d] of Object.entries(deltas)) {
      const p = this.players.get(id);
      if (p) p.score += d;
    }
    this.cur.deltas = deltas;

    const toEntry = (a: Answer): RevealEntry => ({
      answerId: a.id,
      text: a.text,
      isReal: a.authorId === null,
      authorId: a.authorId,
      voterIds: votersFor.get(a.id) ?? [],
    });
    const fakes = shuffle(this.cur.answers.filter((a) => a.authorId !== null && votersFor.has(a.id)))
      .map(toEntry)
      .sort((x, y) => x.voterIds.length - y.voterIds.length); // stable: ties stay in shuffled order
    const real = toEntry(this.cur.answers.find((a) => a.authorId === null)!);
    this.cur.revealEntries = [...fakes, real];
    this.cur.revealIndex = 0;
    this.phase = 'reveal';
    this.arm(this.revealMs(0), () => this.nextReveal());
  }

  /** Each reveal card stays up for exactly as long as its animation takes, plus a short hold. */
  private revealMs(index: number) {
    const e = this.cur.revealEntries[index];
    return (revealTiming(e.voterIds.length).endMs + REVEAL_HOLD_MS) * SCALE;
  }

  private nextReveal() {
    if (this.cur.revealIndex < this.cur.revealEntries.length - 1) {
      this.cur.revealIndex++;
      this.arm(this.revealMs(this.cur.revealIndex), () => this.nextReveal());
    } else {
      this.phase = 'summary';
      this.arm(SUMMARY_MS, () => this.afterSummary());
    }
  }

  private afterSummary() {
    const { endMode, target } = this.settings;
    const top = Math.max(0, ...[...this.players.values()].map((p) => p.score));
    const over = endMode === 'points' ? top >= target : this.round >= target;
    if (over) {
      this.phase = 'gameOver';
      this.onExpire = null;
    } else {
      this.startRound();
    }
  }

  // ------------------------------------------------------------------ player actions

  private isParticipant(id: string) {
    return this.cur.participants.has(id);
  }

  categoryVote(playerId: string, index: number) {
    if (this.phase !== 'categoryVote' || !this.isParticipant(playerId)) return;
    if (!Number.isInteger(index) || index < 0 || index >= this.cur.options.length) return;
    this.cur.categoryVotes.set(playerId, index);
    if (!this.maybeAdvance()) this.broadcast();
  }

  submitAnswer(playerId: string, text: string): string | null {
    if (this.phase !== 'writing') return 'Too late - writing is over.';
    if (!this.isParticipant(playerId)) return 'You are watching this round.';
    if (this.cur.submissions.has(playerId)) return 'Already submitted.';
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, this.settings.maxAnswerLength);
    if (!clean) return 'Write something first!';
    this.cur.submissions.set(playerId, clean);
    if (!this.maybeAdvance()) this.broadcast();
    return null;
  }

  setRead(playerId: string, read: boolean) {
    if (this.phase !== 'readAnswers' || !this.isParticipant(playerId)) return;
    if (read) this.cur.readChecks.add(playerId);
    else this.cur.readChecks.delete(playerId);
    if (!this.maybeAdvance()) this.broadcast();
  }

  vote(playerId: string, answerId: string): string | null {
    if (this.phase !== 'voting') return 'Voting is closed.';
    if (!this.isParticipant(playerId)) return 'You are watching this round.';
    if (this.cur.votes.has(playerId)) return 'You already voted.';
    const ans = this.cur.answers.find((a) => a.id === answerId);
    if (!ans) return 'Unknown answer.';
    if (ans.authorId === playerId) return "You can't vote for your own answer.";
    this.cur.votes.set(playerId, answerId);
    if (!this.maybeAdvance()) this.broadcast();
    return null;
  }

  // ------------------------------------------------------------------ auto-advance

  private livePlayers(): string[] {
    return [...this.cur.participants].filter((id) => this.isConnected(id));
  }

  private allDone(): boolean {
    const live = this.livePlayers();
    if (!live.length) return false;
    switch (this.phase) {
      case 'categoryVote':
        return live.every((id) => this.cur.categoryVotes.has(id));
      case 'writing':
        return live.every((id) => this.cur.submissions.has(id));
      case 'readAnswers': {
        const ans = this.cur.answers[this.cur.readIndex];
        return live.every((id) => this.cur.readChecks.has(id) || ans?.authorId === id);
      }
      case 'voting':
        return live.every((id) => this.cur.votes.has(id));
      default:
        return false;
    }
  }

  /** Ends the phase if everyone has finished. Returns true if it advanced (and broadcast). */
  private maybeAdvance(): boolean {
    if (this.paused || !this.onExpire) return false;
    if (!this.allDone()) return false;
    this.fire();
    return true;
  }

  // ------------------------------------------------------------------ state views

  private playerDone(id: string): boolean {
    if (!this.cur.participants.has(id)) return false;
    switch (this.phase) {
      case 'categoryVote':
        return this.cur.categoryVotes.has(id);
      case 'writing':
        return this.cur.submissions.has(id);
      case 'readAnswers':
        return this.cur.readChecks.has(id) || this.cur.answers[this.cur.readIndex]?.authorId === id;
      case 'voting':
        return this.cur.votes.has(id);
      default:
        return false;
    }
  }

  private baseState(): ClientState {
    const c = this.cur;
    const past = this.phase !== 'lobby' && this.phase !== 'preview';
    const options: OptionPublic[] = c.options
      .slice(0, this.phase === 'preview' ? c.previewIndex + 1 : c.options.length)
      .map((o) => ({ category: o.category, prompt: o.prompt }));
    const players: PlayerInfo[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      emoji: p.emoji,
      score: p.score,
      connected: !!p.socketId,
      participating: c.participants.has(p.id),
      done: this.playerDone(p.id),
    }));
    const inRead = this.phase === 'readAnswers';
    const inVote = this.phase === 'voting';
    const answers: AnswerPublic[] = inRead
      ? [{ id: c.answers[c.readIndex].id, text: c.answers[c.readIndex].text }]
      : inVote
        ? c.answers.map((a) => ({ id: a.id, text: a.text }))
        : [];
    const inReveal = this.phase === 'reveal';
    const top = Math.max(0, ...players.map((p) => p.score));
    return {
      code: this.code,
      phase: this.phase,
      paused: this.paused,
      serverNow: Date.now(),
      deadline: this.paused && this.remaining != null ? Date.now() + this.remaining : this.deadline,
      settings: this.settings,
      players,
      round: this.round,
      options: past || this.phase === 'preview' ? options : [],
      previewIndex: c.previewIndex,
      chosen: ['categoryResult', 'writing', 'readAnswers', 'voting', 'reveal', 'summary', 'gameOver'].includes(this.phase) ? c.chosen : null,
      tally: this.phase === 'categoryResult' ? c.tally : null,
      answers,
      readIndex: c.readIndex,
      answerTotal: c.answers.length,
      reveal: inReveal ? c.revealEntries.slice(0, c.revealIndex + 1) : [],
      revealIndex: c.revealIndex,
      revealTotal: c.revealEntries.length,
      roundDeltas: this.phase === 'summary' || this.phase === 'gameOver' ? c.deltas : null,
      summary: this.phase === 'summary' ? c.revealEntries : null,
      winnerIds: this.phase === 'gameOver' ? players.filter((p) => p.score === top).map((p) => p.id) : [],
      you: null,
    };
  }

  broadcast() {
    const base = this.baseState();
    if (this.hostSocketId) this.io.to(this.hostSocketId).emit('state', base);
    for (const p of this.players.values()) {
      if (!p.socketId) continue;
      const c = this.cur;
      const own = c.answers.find((a) => a.authorId === p.id);
      this.io.to(p.socketId).emit('state', {
        ...base,
        you: {
          id: p.id,
          participating: c.participants.has(p.id),
          categoryVote: c.categoryVotes.get(p.id) ?? null,
          submitted: c.submissions.has(p.id),
          submittedText: c.submissions.get(p.id) ?? null,
          hasRead: c.readChecks.has(p.id) || c.answers[c.readIndex]?.authorId === p.id,
          votedFor: c.votes.get(p.id) ?? null,
          ownAnswerId: own?.id ?? null,
        },
      });
    }
  }
}
