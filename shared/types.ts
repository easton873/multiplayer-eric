// Types and constants shared by the server and both clients (host screen + phones).

export type Category = 'word' | 'date' | 'movie' | 'acronym' | 'person';

export const CATEGORY_META: Record<Category, { label: string; icon: string; instruction: string; short: string }> = {
  word: { label: 'Word', icon: '📖', instruction: 'Write a convincing definition', short: 'Define it' },
  date: { label: 'Date', icon: '📅', instruction: 'Write what happened on this date', short: 'What happened?' },
  movie: { label: 'Movie', icon: '🎬', instruction: 'Write the plot of this movie', short: 'What is the plot?' },
  acronym: { label: 'Acronym', icon: '🔤', instruction: 'Write what the letters stand for', short: 'What does it stand for?' },
  person: { label: 'Person', icon: '🧑', instruction: 'Write who this person is', short: 'Who are they?' },
};

export type Phase =
  | 'lobby'
  | 'preview' // the five prompts are shown one at a time
  | 'categoryVote' // everyone votes on which prompt to play
  | 'categoryResult' // winner announced
  | 'writing' // everyone writes a bluff
  | 'readAnswers' // answers shown one at a time, players tick "read"
  | 'voting' // everyone votes for the answer they think is real
  | 'reveal' // answers revealed fewest votes -> most, real answer last
  | 'summary' // scoreboard for the round
  | 'gameOver';

/** Timer values are seconds. 0 means "unlimited" (host skips manually / phase ends when everyone is done). */
export interface Timers {
  preview: number; // seconds each of the 5 prompts stays on screen
  categoryVote: number;
  writing: number;
  read: number; // per answer
  voting: number;
}

export interface Settings {
  endMode: 'points' | 'rounds';
  target: number; // points to reach, or number of rounds
  maxAnswerLength: number;
  timers: Timers;
}

export type SettingsPatch = Partial<Omit<Settings, 'timers'>> & { timers?: Partial<Timers> };

export const DEFAULT_SETTINGS: Settings = {
  endMode: 'points',
  target: 10,
  maxAnswerLength: 180,
  timers: { preview: 6, categoryVote: 30, writing: 120, read: 30, voting: 60 },
};

export interface PlayerInfo {
  id: string;
  name: string;
  color: string;
  emoji: string;
  score: number;
  connected: boolean;
  /** Playing in the current round (late joiners may be spectators until the next round). */
  participating: boolean;
  /** Has finished whatever the current phase is waiting on. */
  done: boolean;
}

export interface OptionPublic {
  category: Category;
  prompt: string;
}

export interface AnswerPublic {
  id: string;
  text: string;
}

export interface RevealEntry {
  answerId: string;
  text: string;
  isReal: boolean;
  authorId: string | null;
  voterIds: string[];
}

export interface YouInfo {
  id: string;
  participating: boolean;
  categoryVote: number | null;
  submitted: boolean;
  submittedText: string | null;
  hasRead: boolean;
  votedFor: string | null;
  ownAnswerId: string | null;
}

export interface ClientState {
  code: string;
  phase: Phase;
  paused: boolean;
  serverNow: number;
  deadline: number | null;
  settings: Settings;
  players: PlayerInfo[];
  round: number;
  options: OptionPublic[];
  previewIndex: number;
  chosen: number | null;
  tally: number[] | null;
  answers: AnswerPublic[];
  readIndex: number;
  answerTotal: number;
  reveal: RevealEntry[];
  revealIndex: number;
  revealTotal: number;
  roundDeltas: Record<string, number> | null;
  summary: RevealEntry[] | null;
  winnerIds: string[];
  you: YouInfo | null;
}

// ---- socket events -------------------------------------------------------

export type Ack<T = object> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface ClientToServerEvents {
  'host:create': (cb: Ack<{ code: string; hostToken: string }>) => void;
  'host:resume': (p: { code: string; hostToken: string }, cb: Ack) => void;
  'host:settings': (p: SettingsPatch) => void;
  'host:start': () => void;
  'host:skip': () => void;
  'host:playAgain': () => void;
  'host:kick': (p: { playerId: string }) => void;
  'player:join': (p: { code: string; name: string; token?: string }, cb: Ack<{ token: string; playerId: string }>) => void;
  'player:categoryVote': (p: { index: number }) => void;
  'player:answer': (p: { text: string }, cb?: Ack) => void;
  'player:read': (p: { read: boolean }) => void;
  'player:vote': (p: { answerId: string }, cb?: Ack) => void;
}

export interface ServerToClientEvents {
  state: (s: ClientState) => void;
  closed: (reason: string) => void;
}
