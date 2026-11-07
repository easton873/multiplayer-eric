# Multiplayer Eric

A Jackbox-style bluffing party game. One laptop/TV shows the main screen, everyone else plays on their phone.

**How a round works**

1. **Options** – five prompts appear on the big screen one at a time: a *word*, a *date*, a *movie*, an *acronym* and a *person*.
2. **Vote** – everyone votes (on their phone) for the prompt they want to play. Ties are broken randomly.
3. **Write** – everybody writes a convincing fake answer (180 characters by default). Nobody sees the real one.
4. **Read** – the answers (fakes + the real one) appear on the big screen one at a time; players tick "I've read it" or the timer runs out.
5. **Vote** – each player picks the answer they think is real from a list (no voting for your own).
6. **Reveal** – answers are revealed from fewest to most votes (answers with no votes are skipped), showing who voted for it and who wrote it. The real answer is always last.
7. **Score** – +1 for voting for the real answer, +1 for each vote your answer gets. A 5-second scoreboard, then the next round.

The game ends at the end of the round in which someone reaches **X points**, or after **X rounds** (chosen in the lobby; ties are allowed).

## Run it locally

```bash
npm install
npm run build
npm start          # http://localhost:3000
```

Open `http://localhost:3000/host.html` on the laptop/TV. The lobby shows a QR code and room code; phones on the same Wi‑Fi can scan it (the QR code automatically uses your computer's LAN address, shown in the terminal as "On your network").

For development with hot reload: `npm run dev` (server on :3000, Vite on :5173 – open `http://localhost:5173/host.html`).

Other scripts: `npm run typecheck`, `npm run test:sim` (plays full bot games over real sockets and checks the rules).

## Settings (host lobby)

- Game ends when someone reaches **X points**, or after **X rounds**
- Max answer length (default 180)
- Timers for: each prompt preview, prompt vote, writing, reading (per answer), answer vote. Each can be set to **Unlimited** – the phase then ends when everybody is done, or when the host presses **Skip** (button or space bar).

Phases also end early as soon as every connected player has finished. Players who reconnect (refresh, lock their phone) rejoin automatically and keep their score. If the host screen disconnects the game pauses, and the room is kept for 15 minutes.

## Adding cards

Edit `server/cards.ts`. There is a pool of entries per category – each round draws one from each pool (no repeats until a pool runs out):

```ts
{ prompt: 'Sesquipedalian', answer: 'Given to using long words; also a very long word.' }
```

## Deploy on Render (free tier)

Push this repo to GitHub, then in Render choose **New → Blueprint** and select the repo (it reads `render.yaml`), or create a **Web Service** manually with:

- Build command: `npm install --include=dev && npm run build`
- Start command: `npm start`
- Health check path: `/health`

Notes: the free tier sleeps after inactivity (first visit takes ~30–60s to wake up) and game rooms live in memory, so a restart ends any running game.

## Layout

```
shared/   types + socket event contracts shared by server and clients
server/   Express + socket.io: game state machine (game.ts), cards (cards.ts)
client/   Vite multi-page app: index.html (landing), host.html (big screen), play.html (phones)
test/     bot simulation
```
