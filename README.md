# CODE-BINGO
Real-time multiplayer 5x5 bingo web app — first to complete 5 lines wins, last caller wins ties. Rooms, random/manual boards, turn-based number elimination, WebRTC voice chat.

# Bingo 5x5 - First to 5 Lines Wins

A real-time multiplayer 5x5 bingo web app. Players arrange (or randomly shuffle) a board of numbers 1-25, then take turns **eliminating** numbers from play. Eliminated numbers are marked on every board automatically, and the first player to complete **5 lines** (rows, columns, or diagonals) hits BINGO. If multiple players finish on the same call, **the last caller wins**.

Includes built-in **voice chat** (WebRTC) so players can talk while they play.

## Features

- **Rooms** - create or join a game with a 4-character room code
- **Two board modes** - manually arrange numbers by tapping, or get a random shuffle
- **Turn-based elimination** - players take turns picking a number to remove from play; it auto-marks every board
- **5-line win condition** - rows, columns, and both diagonals count
- **Last caller wins** - simultaneous wins are resolved by claim order on the same call
- **Server-side rules** - elimination, turn order, line counting, and claims are validated on the server
- **Voice chat** - WebRTC mesh audio between players (mic on/off, mute others)
- **Mobile + desktop** - touch-friendly responsive UI, works in any browser
- **Reconnect support** - players rejoin automatically if the connection drops

## Requirements

- Node.js 18+
- npm

## Install & Run

```
npm install
npm start
```

Open http://localhost:3000 in your browser.

If port 3000 is busy, pick another one:

```
set PORT=3456 && npm start
```

Then open http://localhost:3456.

## How to Play

1. Create a room (or join with a code) and enter your name.
2. Host clicks **Begin setup** - every player either arranges numbers 1-25 by hand (tap a number, then tap a cell) or hits **Shuffle** and then **Ready**.
3. Host clicks **Start game** - players take turns picking a number 1-25 to **eliminate** from play. On your turn, tap one of the green numbers.
4. Eliminated numbers are marked on every player's board automatically.
5. A line is 5 marked cells in a row, column, or diagonal. Complete **5 lines** and hit the **BINGO!** button.
6. An 8-second claim window opens - if anyone else also claims on the same call, **the last caller wins**.
7. Host starts a **New round** to play again (boards are kept, players may re-arrange or shuffle).

## Voice Chat

- Tap **MIC ON** and allow microphone access - audio is only transmitted while the mic is on.
- Only one player needs the mic on: their voice is heard by everyone in the room. Turning the mic on mid-game connects you automatically.
- **SPK** mutes other players' voices on your side.
- Voice uses WebRTC (STUN included); on very restrictive networks audio may not connect, but gameplay is unaffected.

## Playing with Others

- Same PC: open the URL in several browser tabs, each with a different name.
- Same Wi-Fi: open `http://<your-pc-ip>:3000` on phones/laptops (`ipconfig` to find your IP).
- Internet: forward a port or tunnel (e.g. ngrok) to the server port.

## Project Structure

```
server.js          Node/Express/WebSocket server - rooms, elimination, turns, claims
public/index.html  Game UI (landing, room, arrange, play, results)
public/styles.css  Responsive dark theme
public/app.js      Client logic + WebRTC voice chat
```

## Game Rules (Summary)

- Board: 5x5 grid, numbers 1-25, each used exactly once per board.
- Numbers 1-25 are eliminated without replacement, one per turn.
- Win: first player with 5 distinct completed lines (horizontal, vertical, or diagonal).
- Tie on the same call: no tie - the last player to claim BINGO wins.
- Full board (blackout) guarantees the game always ends.

## Tech

Node.js, Express, ws (WebSocket), vanilla JS, WebRTC.

## Auto Deploy (Render)

Every push to `main` auto-deploys to Render via a GitHub Actions workflow (`.github/workflows/deploy.yml`).

Setup (one time):

1. Get a Render API key: Render dashboard → **Account Settings** → **API Keys** → *Create API Key*.
2. Find your service ID: Render dashboard → open your web service → copy the ID from the URL (`https://dashboard.render.com/web/srv-xxxx` → `srv-xxxx`).
3. In GitHub → repo → **Settings → Secrets and variables → Actions → New repository secret**:
   - `RENDER_API_KEY` = the API key from step 1
   - `RENDER_SERVICE_ID` = the `srv-xxxx` from step 2

Push to `main` (or run the workflow manually under **Actions → Deploy to Render → Run workflow**) and Render redeploys automatically.

> Tip: if your Render service is already connected to the GitHub repo, you can instead enable **Auto-Deploy** in the Render service settings and skip the workflow entirely.

