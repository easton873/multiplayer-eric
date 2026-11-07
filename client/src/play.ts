import './styles-common.css';
import './play.css';
import { CATEGORY_META, type ClientState } from '../../shared/types';
import { $, esc, ordinal, rankPlayers, socket, syncState, timerHTML } from './common';

interface View {
  header?: string;
  main: string;
  footer?: string;
  after?: () => void;
}

const app = $('#app')!;
const STORE = 'bluffnight.player';

let state: ClientState | null = null;
let me: { code: string; token: string; name: string; id: string } | null = null;
let joinError = '';
let viewKey = '';
let draft = '';
let selectedAnswer: string | null = null;
let pendingCat: number | null = null;
let closedMsg = '';

const params = new URLSearchParams(location.search);

function loadStored(): { code: string; token: string; name: string } | null {
  try {
    return JSON.parse(localStorage.getItem(STORE) || 'null');
  } catch {
    return null;
  }
}
const saveStored = (v: unknown) => {
  try {
    if (v) localStorage.setItem(STORE, JSON.stringify(v));
    else localStorage.removeItem(STORE);
  } catch {
    /* private mode: rejoin just won't survive a refresh */
  }
};

// ------------------------------------------------------------------ joining

function join(code: string, name: string, token?: string) {
  socket.emit('player:join', { code, name, token }, (res) => {
    if (res.ok) {
      me = { code: code.toUpperCase(), name, token: res.token, id: res.playerId };
      saveStored({ code: me.code, token: me.token, name });
      joinError = '';
      closedMsg = '';
    } else {
      joinError = res.error;
      if (token) saveStored(null);
      me = null;
    }
    viewKey = '';
    render();
  });
}

socket.on('connect', () => {
  document.querySelector('.conn')?.remove();
  const stored = loadStored();
  const want = (params.get('room') || '').toUpperCase();
  if (me) join(me.code, me.name, me.token); // reconnect after a drop
  else if (stored && (!want || want === stored.code)) join(stored.code, stored.name, stored.token);
  else render();
});
socket.on('disconnect', () => {
  if (!document.querySelector('.conn')) document.body.insertAdjacentHTML('beforeend', '<div class="conn">Reconnecting…</div>');
});
socket.on('closed', (reason) => {
  closedMsg = reason;
  me = null;
  state = null;
  saveStored(null);
  viewKey = '';
  render();
});
socket.on('state', (s) => {
  state = s;
  syncState(s);
  render();
});

// ------------------------------------------------------------------ rendering

function snippet(text: string) {
  const words = text.trim().split(/\s+/);
  return words.slice(0, 5).join(' ') + '…';
}

function header(kicker: string, title: string, opts: { cat?: string; sub?: string; timer?: boolean } = {}): string {
  return `<div class="htxt"><div class="kicker">${esc(kicker)}</div><div class="title ${opts.cat ? 'cat ' + opts.cat : ''}">${title}</div>${opts.sub ? `<div class="sub">${esc(opts.sub)}</div>` : ''}</div>${opts.timer ? timerHTML() : ''}`;
}

const centerView = (emoji: string, title: string, text = '', extra = ''): string =>
  `<div class="center"><div class="big-emoji">${emoji}</div><h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}${extra}</div>`;

function chipsHTML(s: ClientState) {
  return `<div class="chips">${s.players.map((p) => `<span class="chip ${p.connected ? '' : 'off'}" style="--pc:${p.color}"><i>${p.emoji}</i>${esc(p.name)}</span>`).join('')}</div>`;
}

function joinView(): View {
  const code = esc(params.get('room') || '');
  return {
    header: header('Welcome', 'Join the game'),
    main: `<form id="jf" style="display:flex;flex-direction:column;gap:16px;margin-top:8px">
      <div class="field"><label for="code">Room code</label><input id="code" maxlength="4" value="${code}" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" /></div>
      <div class="field"><label for="name">Your name</label><input id="name" maxlength="14" value="${esc(loadStored()?.name ?? '')}" autocomplete="off" /></div>
      <div class="error">${esc(closedMsg || joinError)}</div>
      <button class="btn green" type="submit">Join</button>
    </form>`,
    after: () => {
      $<HTMLFormElement>('#jf')!.addEventListener('submit', (e) => {
        e.preventDefault();
        const c = $<HTMLInputElement>('#code')!.value.trim().toUpperCase();
        const n = $<HTMLInputElement>('#name')!.value.trim();
        if (c.length !== 4) joinError = 'Room codes are 4 letters.';
        else if (!n) joinError = 'Please enter a name.';
        else return join(c, n);
        $('.error')!.textContent = joinError;
      });
      (params.get('room') ? $('#name') : $('#code'))?.focus();
    },
  };
}

function buildView(s: ClientState): View {
  const you = s.you!;
  const mePlayer = s.players.find((p) => p.id === you.id)!;
  const chosen = s.chosen != null ? s.options[s.chosen] : null;
  const meta = chosen ? CATEGORY_META[chosen.category] : null;
  const catClass = chosen ? `cat-${chosen.category}` : '';
  const roundKicker = `Round ${s.round}`;

  // Spectators in a round already past the point where they can join in.
  const playPhases = ['preview', 'categoryVote', 'categoryResult', 'writing', 'readAnswers', 'voting', 'reveal'];
  if (playPhases.includes(s.phase) && !you.participating) {
    return {
      header: header(roundKicker, 'Round in progress'),
      main: centerView('🍿', "You're in!", "You'll join in at the start of the next round. Watch the big screen until then."),
    };
  }

  switch (s.phase) {
    case 'lobby':
      return {
        header: header(`Room ${s.code}`, `You're in, ${esc(mePlayer.name)}!`),
        main: centerView(mePlayer.emoji, 'Waiting for the host…', 'The game will start soon. Look at the big screen.', chipsHTML(s)),
      };

    case 'preview':
      return {
        header: header(roundKicker, 'Read the options', { sub: 'Look at the big screen' }),
        main: s.options
          .map((o) => `<div class="opt-btn cat-${o.category}"><span class="ic">${CATEGORY_META[o.category].icon}</span><div><div class="lbl">${CATEGORY_META[o.category].label}</div><div class="pr">${esc(o.prompt)}</div></div></div>`)
          .join(''),
      };

    case 'categoryVote':
      return {
        header: header(roundKicker, 'Vote for a prompt', { sub: 'Which one should we play?', timer: true }),
        main: s.options
          .map((o, i) => {
            const sel = (pendingCat ?? you.categoryVote) === i;
            return `<button class="opt-btn cat-${o.category} ${sel ? 'sel' : ''}" data-cat="${i}"><span class="ic">${CATEGORY_META[o.category].icon}</span><div><div class="lbl">${CATEGORY_META[o.category].label}</div><div class="pr">${esc(o.prompt)}</div></div></button>`;
          })
          .join(''),
        footer: `<div class="counter" style="text-align:center">${you.categoryVote != null ? 'Vote saved — tap another to change it' : 'Tap one to vote'}</div>`,
        after: () =>
          app.querySelectorAll<HTMLElement>('[data-cat]').forEach((b) =>
            b.addEventListener('click', () => {
              pendingCat = Number(b.dataset.cat);
              socket.emit('player:categoryVote', { index: pendingCat });
              render(true);
            }),
          ),
      };

    case 'categoryResult':
      return {
        header: header(roundKicker, 'The people have spoken!'),
        main: chosen
          ? `<div class="center cat-${chosen.category}"><div class="big-emoji">${meta!.icon}</div><h2 style="color:var(--c)">${meta!.label}</h2><p style="color:var(--ink);font-weight:800;font-size:22px">${esc(chosen.prompt)}</p></div>`
          : '',
      };

    case 'writing': {
      if (you.submitted) {
        return {
          header: header(roundKicker, 'Answer locked in ✓', { timer: true }),
          main: centerView('🤫', 'Nice bluff!', 'Waiting for everyone else to finish writing…', `<div class="readbox" style="flex:none;font-size:18px;margin-top:10px;max-width:100%">${esc(you.submittedText ?? '')}</div>`),
        };
      }
      const max = s.settings.maxAnswerLength;
      return {
        header: header(`${meta!.label} · ${meta!.short}`, esc(chosen!.prompt), { cat: catClass, sub: meta!.instruction, timer: true }),
        main: `<textarea id="ans" maxlength="${max}" placeholder="Make it sound real…" autocomplete="off"></textarea><div class="counter" id="cnt"></div><div class="error" id="err"></div>`,
        footer: `<button class="btn green" id="submit" disabled>Submit answer</button>`,
        after: () => {
          const ta = $<HTMLTextAreaElement>('#ans')!;
          const cnt = $('#cnt')!;
          const btn = $<HTMLButtonElement>('#submit')!;
          const upd = () => {
            draft = ta.value;
            const n = ta.value.length;
            cnt.textContent = `${n} / ${max}`;
            cnt.className = 'counter' + (n >= max ? ' full' : n > max * 0.85 ? ' near' : '');
            btn.disabled = ta.value.trim().length === 0;
          };
          ta.value = draft;
          ta.addEventListener('input', upd);
          upd();
          btn.addEventListener('click', () => {
            btn.disabled = true;
            socket.emit('player:answer', { text: ta.value }, (res) => {
              if (!res.ok) {
                $('#err')!.textContent = res.error;
                btn.disabled = false;
              } else draft = '';
            });
          });
        },
      };
    }

    case 'readAnswers': {
      const a = s.answers[0];
      return {
        header: header(`${meta!.label} · ${chosen!.prompt}`, `Answer ${s.readIndex + 1} of ${s.answerTotal}`, { cat: catClass, timer: true }),
        main: `<div class="readbox ${a.text.length > 110 ? 'long' : ''}">${esc(a.text)}</div>`,
        footer: `<button class="btn check-btn ${you.hasRead ? 'ghost' : 'green'}" id="read"><span class="box">${you.hasRead ? '✓' : ''}</span>${you.hasRead ? 'Read — waiting on others' : "I've read it"}</button>`,
        after: () => {
          const own = s.you!.ownAnswerId === a.id;
          const b = $<HTMLButtonElement>('#read')!;
          if (own) {
            b.disabled = true;
            b.innerHTML = '<span class="box">✓</span>This one is yours!';
          }
          b.addEventListener('click', () => socket.emit('player:read', { read: !you.hasRead }));
        },
      };
    }

    case 'voting': {
      const locked = you.votedFor != null;
      const sel = locked ? you.votedFor : selectedAnswer;
      return {
        header: header(`${meta!.label} · ${chosen!.prompt}`, locked ? 'Vote locked in ✓' : 'Which one is the real answer?', { cat: catClass, sub: locked ? 'Waiting for everyone else…' : 'Tap an answer to select it, then press Submit', timer: true }),
        main: s.answers
          .map((a, i) => {
            const own = a.id === you.ownAnswerId;
            return `<div class="vote-item ${a.id === sel ? 'sel' : ''} ${own ? 'own' : ''} ${locked ? 'locked' : ''}" data-id="${a.id}" data-own="${own ? 1 : 0}"><span class="n">${i + 1}</span><span class="snip">${esc(snippet(a.text))}</span><button class="view" data-view="${a.id}">View</button></div>`;
          })
          .join(''),
        footer: `<button class="btn" id="vote" ${locked || !sel ? 'disabled' : ''}>${locked ? 'Vote submitted' : 'Submit vote'}</button>`,
        after: () => {
          app.querySelectorAll<HTMLElement>('.vote-item').forEach((el) =>
            el.addEventListener('click', (ev) => {
              const id = el.dataset.id!;
              if ((ev.target as HTMLElement).closest('.view')) {
                const a = s.answers.find((x) => x.id === id)!;
                openModal(a.text);
                return;
              }
              if (locked || el.dataset.own === '1') return;
              selectedAnswer = id;
              render(true);
            }),
          );
          $('#vote')?.addEventListener('click', () => {
            if (!selectedAnswer) return;
            socket.emit('player:vote', { answerId: selectedAnswer }, (res) => {
              if (!res.ok) toast(res.error);
            });
          });
        },
      };
    }

    case 'reveal':
      return { header: header(roundKicker, 'The big reveal'), main: centerView('📺', 'Eyes on the big screen!', 'See who fooled who…') };

    case 'summary': {
      const ranked = rankPlayers(s.players);
      const mine = ranked.find((p) => p.id === you.id)!;
      const d = s.roundDeltas?.[you.id] ?? 0;
      return {
        header: header(roundKicker, 'Scores'),
        main: `<div class="center"><div class="delta ${d ? '' : 'zero'}">${d ? '+' + d + (d === 1 ? ' point' : ' points') : 'No points this round'}</div><div class="rank">${ordinal(mine.rank)}</div><h2>${mine.score} ${mine.score === 1 ? 'point' : 'points'}</h2><p>Next round starts in a moment.</p></div>`,
      };
    }

    case 'gameOver': {
      const ranked = rankPlayers(s.players);
      const mine = ranked.find((p) => p.id === you.id)!;
      const won = s.winnerIds.includes(you.id);
      return {
        header: header('Game over', won ? 'You win! 🏆' : `You placed ${ordinal(mine.rank)}`),
        main: centerView(won ? '🏆' : '🎉', `${mine.score} ${mine.score === 1 ? 'point' : 'points'}`, 'Thanks for playing! Look at the big screen for the final standings.'),
      };
    }
  }
  return { main: '' };
}

function viewKeyFor(s: ClientState): string {
  const y = s.you!;
  const base = `${s.phase}|${s.round}|${y.participating}`;
  switch (s.phase) {
    case 'lobby':
      return `${base}|${s.players.length}|${s.players.map((p) => p.connected).join('')}`;
    case 'preview':
      return `${base}|${s.previewIndex}`;
    case 'categoryVote':
      return `${base}|${y.categoryVote}`;
    case 'writing':
      return `${base}|${y.submitted}`;
    case 'readAnswers':
      return `${base}|${s.readIndex}|${y.hasRead}`;
    case 'voting':
      return `${base}|${y.votedFor}|${y.ownAnswerId}`;
    default:
      return base;
  }
}

function render(force = false) {
  if (!me || !state || !state.you) {
    const key = 'join|' + closedMsg + joinError;
    if (!force && key === viewKey) return;
    viewKey = key;
    paint(joinView(), false);
    return;
  }
  const s = state;
  const key = viewKeyFor(s);
  if (!force && key === viewKey) return;
  if (key.split('|')[0] !== viewKey.split('|')[0] || key.split('|')[1] !== viewKey.split('|')[1]) {
    pendingCat = null;
    selectedAnswer = null;
  }
  viewKey = key;
  paint(buildView(s), force);
}

function paint(v: View, keepScroll: boolean) {
  const scroll = $('main', app)?.scrollTop ?? 0;
  app.innerHTML = `<header>${v.header ?? ''}</header><main>${v.main}</main><footer>${v.footer ?? ''}</footer>`;
  if (keepScroll) $('main', app)!.scrollTop = scroll;
  v.after?.();
  if (state) syncState(state);
}

function openModal(text: string) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="card"><p>${esc(text)}</p><button class="btn ghost">Close</button></div>`;
  m.addEventListener('click', (e) => {
    if (e.target === m || (e.target as HTMLElement).closest('button')) m.remove();
  });
  document.body.appendChild(m);
}

function toast(msg: string) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

render();
