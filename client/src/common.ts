import { io, type Socket } from 'socket.io-client';
import type { ClientState, ClientToServerEvents, ServerToClientEvents } from '../../shared/types';

export const GAME_NAME = 'Bluff Night';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({ transports: ['websocket', 'polling'] });

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T | null;

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

// ---- server clock + countdowns ----------------------------------------------------------

let clockOffset = 0;
let deadline: number | null = null;
let paused = false;
let total = 0;
let lastDeadlineSeen: number | null = null;

export function syncState(s: ClientState) {
  clockOffset = s.serverNow - Date.now();
  paused = s.paused;
  deadline = s.deadline;
  if (s.deadline !== lastDeadlineSeen) {
    lastDeadlineSeen = s.deadline;
    total = s.deadline ? Math.max(1000, s.deadline - s.serverNow) : 0;
  }
  tick();
}

/** Fraction of the current phase timer remaining, 0..1 (1 when unlimited). */
function tick() {
  const left = deadline ? Math.max(0, deadline - (Date.now() + clockOffset)) : null;
  const secs = left == null ? null : Math.ceil(left / 1000);
  const frac = left == null || !total ? 1 : Math.min(1, left / total);
  document.querySelectorAll<HTMLElement>('[data-timer]').forEach((el) => {
    const text = paused ? '⏸' : secs == null ? '∞' : String(secs);
    const label = el.querySelector<HTMLElement>('[data-timer-text]') ?? el;
    if (label.textContent !== text) label.textContent = text;
    el.style.setProperty('--frac', String(frac));
    el.classList.toggle('urgent', secs != null && secs <= 5 && !paused);
    el.classList.toggle('unlimited', secs == null);
  });
  document.querySelectorAll<HTMLElement>('[data-timer-bar]').forEach((el) => {
    el.style.transform = `scaleX(${frac})`;
  });
}
setInterval(tick, 200);

export const timerHTML = (cls = '') =>
  `<div class="timer ${cls}" data-timer><svg viewBox="0 0 36 36"><circle class="track" cx="18" cy="18" r="16"/><circle class="arc" cx="18" cy="18" r="16"/></svg><span data-timer-text>∞</span></div>`;

export function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Competition ranking with ties sharing a rank. */
export function rankPlayers<T extends { score: number }>(players: T[]): (T & { rank: number })[] {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  return sorted.map((p, i) => ({ ...p, rank: sorted.findIndex((q) => q.score === p.score) + 1 }));
}
