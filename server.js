const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const CLAIM_WINDOW_MS = 8000;
const RECONNECT_GRACE_MS = 60000;
const TURN_TIMEOUT_MS = 10000;
const MAX_PLAYERS = 12;
const SHIP_DEFS = [
  { name: 'Carrier', size: 5 },
  { name: 'Battleship', size: 4 },
  { name: 'Cruiser', size: 3 },
  { name: 'Submarine', size: 3 },
  { name: 'Destroyer', size: 2 },
];

const rooms = new Map();

function roomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c;
  do {
    c = '';
    for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(c));
  return c;
}

function freshRoom(c, roomName, game) {
  return {
    code: c,
    name: roomName || null,
    game: game || 'bingo',
    players: new Map(),
    hostId: null,
    phase: 'lobby',
    balls: [],
    lastBall: null,
    claimWindow: false,
    claims: [],
    claimTimer: null,
    turnId: null,
    turnTimer: null,
  };
}

function makePlayer(name, ws) {
  return {
    id: crypto.randomUUID(),
    name,
    ws,
    connected: true,
    board: null,
    marks: new Set(),
    claimed: false,
    rematch: false,
    fleet: null,
    shots: [],
    hitsOnMe: new Set(),
    graceTimer: null,
  };
}

function isReady(p, game) {
  return game === 'battleship' ? !!p.fleet : !!p.board;
}

function cleanName(name) {
  return String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 20);
}

function countLines(marked) {
  let n = 0;
  for (let r = 0; r < 5; r++) {
    let ok = true;
    for (let c = 0; c < 5; c++) ok = ok && marked[r * 5 + c];
    if (ok) n++;
  }
  for (let c = 0; c < 5; c++) {
    let ok = true;
    for (let r = 0; r < 5; r++) ok = ok && marked[r * 5 + c];
    if (ok) n++;
  }
  let ok = true;
  for (let i = 0; i < 5; i++) ok = ok && marked[i * 5 + i];
  if (ok) n++;
  ok = true;
  for (let i = 0; i < 5; i++) ok = ok && marked[i * 5 + (4 - i)];
  if (ok) n++;
  return n;
}

function playerLines(p) {
  if (!p.board) return 0;
  const marked = p.board.map(n => p.marks.has(n));
  return countLines(marked);
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg) {
  for (const p of room.players.values()) if (p.connected) send(p.ws, msg);
}

function roomState(room) {
  return {
    code: room.code,
    name: room.name,
    game: room.game,
    phase: room.phase,
    hostId: room.hostId,
    turnId: room.turnId,
    players: [...room.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      ready: isReady(p, room.game),
      rematch: p.rematch,
      host: p.id === room.hostId,
      connected: p.connected,
    })),
    balls: room.balls,
    lastBall: room.lastBall,
    claimWindow: room.claimWindow,
    claims: room.claims.map(cl => ({ id: cl.id, name: cl.name })),
  };
}

function broadcastState(room) {
  broadcast(room, { type: 'roomState', room: roomState(room) });
}

function youMsg(room, p) {
  if (room.game === 'battleship') {
    return {
      type: 'you',
      id: p.id,
      name: p.name,
      host: p.id === room.hostId,
      phase: room.phase,
      game: room.game,
      fleet: p.fleet,
      shots: p.shots || [],
      hitsOnMe: p.hitsOnMe ? [...p.hitsOnMe] : [],
    };
  }
  return {
    type: 'you',
    id: p.id,
    name: p.name,
    host: p.id === room.hostId,
    phase: room.phase,
    game: room.game,
    board: p.board,
    marks: [...p.marks],
    lines: playerLines(p),
    canClaim: !p.claimed && playerLines(p) >= 5,
    claimed: p.claimed,
  };
}

function isStraight(cells) {
  const rs = cells.map(c => Math.floor(c / 10));
  const cs = cells.map(c => c % 10);
  if (rs.every(r => r === rs[0])) {
    const sorted = cs.slice().sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) if (sorted[i] !== sorted[i - 1] + 1) return false;
    return true;
  }
  if (cs.every(c => c === cs[0])) {
    const sorted = rs.slice().sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) if (sorted[i] !== sorted[i - 1] + 1) return false;
    return true;
  }
  return false;
}

function validateFleet(ships) {
  if (!Array.isArray(ships) || ships.length !== SHIP_DEFS.length) return null;
  const counts = {};
  for (const s of ships) {
    const n = Array.isArray(s.cells) ? s.cells.length : 0;
    counts[n] = (counts[n] || 0) + 1;
  }
  if (counts[5] !== 1 || counts[4] !== 1 || counts[3] !== 2 || counts[2] !== 1) return null;
  const seen = new Set();
  const fleet = [];
  for (const s of ships) {
    const cells = s.cells;
    if (!Array.isArray(cells) || cells.length < 2 || cells.length > 5) return null;
    for (const c of cells) {
      if (!Number.isInteger(c) || c < 0 || c > 99 || seen.has(c)) return null;
      seen.add(c);
    }
    if (!isStraight(cells)) return null;
    const name = SHIP_DEFS.find(d => d.size === cells.length).name;
    fleet.push({ name, cells: cells.slice(), hit: cells.map(() => false) });
  }
  return fleet;
}

function fleetSunk(fleet) {
  return fleet.every(s => s.hit.every(Boolean));
}

function resolveClaims(room) {
  if (room.phase !== 'playing') return;
  if (room.claimTimer) {
    clearTimeout(room.claimTimer);
    room.claimTimer = null;
  }
  const winner = room.claims.length ? room.claims[room.claims.length - 1] : null;
  broadcast(room, {
    type: 'winner',
    id: winner ? winner.id : null,
    name: winner ? winner.name : null,
    claims: room.claims,
  });
  room.phase = 'ended';
  room.claimWindow = false;
  broadcastState(room);
}

function openClaimWindow(room) {
  room.claimWindow = true;
  clearTurnTimer(room);
  broadcast(room, { type: 'claimWindow', open: true });
  room.claimTimer = setTimeout(() => resolveClaims(room), CLAIM_WINDOW_MS);
}

function advanceTurn(room) {
  const ids = [...room.players.values()].filter(p => p.connected).map(p => p.id);
  if (!ids.length) {
    room.turnId = null;
    return;
  }
  const idx = ids.indexOf(room.turnId);
  room.turnId = ids[(idx + 1) % ids.length];
}

function clearTurnTimer(room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
}

function startTurnTimer(room) {
  clearTurnTimer(room);
  if (room.phase !== 'playing' || room.claimWindow) return;
  if (room.game === 'bingo' && room.balls.length >= 25) return;
  room.turnTimer = setTimeout(() => {
    room.turnTimer = null;
    if (room.phase !== 'playing' || room.claimWindow) return;
    if (room.game === 'bingo') {
      const remaining = [];
      for (let i = 1; i <= 25; i++) if (!room.balls.includes(i)) remaining.push(i);
      if (!remaining.length) return;
      applyElimination(room, remaining[Math.floor(Math.random() * remaining.length)], room.turnId);
    } else {
      const skipped = room.players.get(room.turnId);
      advanceTurn(room);
      startTurnTimer(room);
      broadcast(room, { type: 'turnSkipped', by: skipped ? skipped.name : null });
      broadcastState(room);
    }
  }, TURN_TIMEOUT_MS);
}

function applyElimination(room, num, timedOutId) {
  room.balls.push(num);
  room.lastBall = num;
  for (const p of room.players.values()) {
    if (!p.board) continue;
    p.marks.add(num);
    const lines = playerLines(p);
    const canClaim = !p.claimed && lines >= 5;
    send(p.ws, { type: 'marks', num, lines, canClaim });
  }
  advanceTurn(room);
  startTurnTimer(room);
  const timedOut = timedOutId ? (room.players.get(timedOutId) || {}).name : null;
  broadcast(room, { type: 'eliminate', num, remaining: 25 - room.balls.length, turnId: room.turnId, timedOut });
  broadcastState(room);
}

function disconnectedPlayerByName(room, name) {
  return [...room.players.values()].find(p => p.name === name && !p.connected);
}

function reconnectPlayer(ctx, room, player, ws) {
  if (player.graceTimer) {
    clearTimeout(player.graceTimer);
    player.graceTimer = null;
  }
  player.ws = ws;
  player.connected = true;
  ctx.room = room;
  ctx.player = player;
  send(ws, youMsg(room, player));
  broadcastState(room);
}

function removePlayer(room, p) {
  if (p.graceTimer) clearTimeout(p.graceTimer);
  room.players.delete(p.id);
  broadcast(room, { type: 'playerLeft', id: p.id });
  if (p.id === room.hostId) {
    const next = [...room.players.values()].find(x => x.connected) || [...room.players.values()][0];
    if (next) room.hostId = next.id;
  }
  if (room.players.size === 0) {
    clearTurnTimer(room);
    if (room.claimTimer) {
      clearTimeout(room.claimTimer);
      room.claimTimer = null;
    }
    rooms.delete(room.code);
  } else {
    if (room.phase === 'playing' && room.turnId === p.id) {
      advanceTurn(room);
      startTurnTimer(room);
    }
    broadcastState(room);
  }
}

wss.on('connection', (ws) => {
  const ctx = { room: null, player: null };

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const { room, player } = ctx;

    switch (msg.type) {
      case 'createRoom': {
        if (room) return;
        const name = cleanName(msg.name);
        if (!name) return send(ws, { type: 'error', message: 'Enter a name' });
        if (rooms.size > 200) return send(ws, { type: 'error', message: 'Too many active rooms' });
        const code = roomCode();
        const game = msg.game === 'battleship' ? 'battleship' : 'bingo';
        const r = freshRoom(code, cleanName(msg.roomName), game);
        if (!r.name) r.name = 'Room ' + code;
        const p = makePlayer(name, ws);
        r.players.set(p.id, p);
        r.hostId = p.id;
        rooms.set(r.code, r);
        ctx.room = r;
        ctx.player = p;
        send(ws, youMsg(r, p));
        broadcastState(r);
        break;
      }

      case 'joinRoom': {
        if (room) return;
        const name = cleanName(msg.name);
        const code = String(msg.code || '').trim().toUpperCase();
        const r = rooms.get(code);
        if (!name) return send(ws, { type: 'error', message: 'Enter a name' });
        if (!r) return send(ws, { type: 'error', message: 'Room not found' });
        const reconnecting = disconnectedPlayerByName(r, name);
        if (reconnecting) {
          reconnectPlayer(ctx, r, reconnecting, ws);
          break;
        }
        if (r.phase === 'playing' || r.phase === 'ended') {
          return send(ws, { type: 'error', message: 'Game already started' });
        }
        if (r.players.size >= MAX_PLAYERS) return send(ws, { type: 'error', message: 'Room is full' });
        if ([...r.players.values()].some(x => x.name === name && x.connected)) {
          return send(ws, { type: 'error', message: 'Name already taken' });
        }
        const p = makePlayer(name, ws);
        r.players.set(p.id, p);
        ctx.room = r;
        ctx.player = p;
        broadcast(r, { type: 'peerJoined', id: p.id, name: p.name });
        send(ws, youMsg(r, p));
        broadcastState(r);
        break;
      }

      case 'setup': {
        if (!player || !room || player.id !== room.hostId || room.phase !== 'lobby') return;
        room.phase = 'arrange';
        broadcastState(room);
        break;
      }

      case 'setBoard': {
        if (!player || !room || room.phase !== 'arrange' || room.game === 'battleship') {
          return send(ws, { type: 'error', message: 'Not in setup phase' });
        }
        const nums = msg.numbers;
        if (!Array.isArray(nums) || nums.length !== 25) {
          return send(ws, { type: 'error', message: 'Invalid board' });
        }
        const seen = new Set();
        for (const n of nums) {
          if (!Number.isInteger(n) || n < 1 || n > 25 || seen.has(n)) {
            return send(ws, { type: 'error', message: 'Invalid board: numbers 1-25 each once' });
          }
          seen.add(n);
        }
        player.board = nums.slice();
        player.marks = new Set();
        player.claimed = false;
        send(ws, youMsg(room, player));
        broadcastState(room);
        break;
      }

      case 'placeShips': {
        if (!player || !room || room.phase !== 'arrange' || room.game !== 'battleship') {
          return send(ws, { type: 'error', message: 'Not in setup phase' });
        }
        const fleet = validateFleet(msg.ships);
        if (!fleet) {
          return send(ws, { type: 'error', message: 'Invalid ship placement' });
        }
        player.fleet = fleet;
        player.shots = [];
        player.hitsOnMe = new Set();
        send(ws, youMsg(room, player));
        broadcastState(room);
        break;
      }

      case 'startGame': {
        if (!player || !room || player.id !== room.hostId || room.phase !== 'arrange') return;
        const allReady = room.game === 'battleship'
          ? [...room.players.values()].every(p => p.fleet)
          : [...room.players.values()].every(p => p.board);
        if (!allReady) {
          return send(ws, { type: 'error', message: 'Not all boards ready' });
        }
        room.phase = 'playing';
        const turnPool = [...room.players.values()].filter(x => x.connected);
        room.turnId = turnPool.length ? turnPool[Math.floor(Math.random() * turnPool.length)].id : null;
        startTurnTimer(room);
        broadcastState(room);
        break;
      }

      case 'attack': {
        if (!player || !room || room.game !== 'battleship' || room.phase !== 'playing') {
          return send(ws, { type: 'error', message: 'Not in play' });
        }
        if (player.id !== room.turnId) {
          return send(ws, { type: 'error', message: 'Not your turn' });
        }
        const cell = msg.cell;
        if (!Number.isInteger(cell) || cell < 0 || cell > 99) {
          return send(ws, { type: 'error', message: 'Invalid target' });
        }
        if (player.shots.some(s => s.cell === cell)) {
          return send(ws, { type: 'error', message: 'Already fired there' });
        }
        const defender = [...room.players.values()].find(p => p.id !== player.id);
        if (!defender || !defender.fleet) return;
        let hit = false;
        let sunk = null;
        let sunkCells = null;
        for (const ship of defender.fleet) {
          const i = ship.cells.indexOf(cell);
          if (i >= 0) {
            ship.hit[i] = true;
            hit = true;
            if (ship.hit.every(Boolean)) {
              sunk = ship.name;
              sunkCells = ship.cells.slice();
            }
            break;
          }
        }
        player.shots.push({ cell, hit });
        if (hit) defender.hitsOnMe.add(cell);
        if (hit) send(defender.ws, youMsg(room, defender));
        send(player.ws, { type: 'shot', cell, hit, by: player.id, sunk, sunkCells });
        broadcast(room, { type: 'shot', cell, hit, by: player.id, sunk });
        if (fleetSunk(defender.fleet)) {
          room.phase = 'ended';
          clearTurnTimer(room);
          broadcast(room, { type: 'winner', id: player.id, name: player.name, game: 'battleship' });
          broadcastState(room);
          return;
        }
        advanceTurn(room);
        startTurnTimer(room);
        broadcastState(room);
        break;
      }

      case 'eliminate': {
        if (!player || !room || room.phase !== 'playing' || room.claimWindow) {
          return send(ws, { type: 'error', message: 'Not in play' });
        }
        if (player.id !== room.turnId) {
          return send(ws, { type: 'error', message: 'Not your turn' });
        }
        const num = msg.num;
        if (!Number.isInteger(num) || num < 1 || num > 25 || room.balls.includes(num)) {
          return send(ws, { type: 'error', message: 'Number already eliminated' });
        }
        applyElimination(room, num, null);
        break;
      }

      case 'claim': {
        if (!player || !room || room.phase !== 'playing') {
          return send(ws, { type: 'error', message: 'Not in play' });
        }
        if (player.claimed) return;
        if (playerLines(player) < 5) {
          return send(ws, { type: 'error', message: 'You need 5 complete lines first' });
        }
        player.claimed = true;
        room.claims.push({ id: player.id, name: player.name, time: Date.now() });
        broadcast(room, { type: 'claim', id: player.id, name: player.name });
        if (!room.claimWindow) openClaimWindow(room);
        break;
      }

      case 'rematch': {
        if (!player || !room || room.phase !== 'ended') return;
        player.rematch = true;
        broadcastState(room);
        break;
      }

      case 'newRound': {
        if (!player || !room || player.id !== room.hostId || room.phase !== 'ended') return;
        if ([...room.players.values()].some(p => p.connected && !p.rematch)) {
          return send(ws, { type: 'error', message: 'Waiting for all players to press Ready' });
        }
        clearTurnTimer(room);
        room.phase = 'arrange';
        room.balls = [];
        room.lastBall = null;
        room.claims = [];
        room.claimWindow = false;
        if (room.claimTimer) {
          clearTimeout(room.claimTimer);
          room.claimTimer = null;
        }
        for (const p of room.players.values()) {
          p.marks = new Set();
          p.claimed = false;
          p.rematch = false;
          p.fleet = null;
          p.shots = [];
          p.hitsOnMe = new Set();
        }
        broadcast(room, { type: 'newRound' });
        broadcastState(room);
        break;
      }

      case 'webrtc': {
        if (!player || !room) return;
        const target = room.players.get(msg.to);
        if (target && target.connected) {
          send(target.ws, { type: 'webrtc', from: player.id, payload: msg.payload });
        }
        break;
      }

      case 'leave': {
        if (player && room) removePlayer(room, player);
        ctx.room = null;
        ctx.player = null;
        break;
      }
    }
  });

  ws.on('close', () => {
    const { room, player } = ctx;
    if (!room || !player) return;
    player.connected = false;
    player.ws = null;
    if (room.phase === 'playing' && room.turnId === player.id) {
      advanceTurn(room);
      startTurnTimer(room);
    }
    broadcastState(room);
    player.graceTimer = setTimeout(() => {
      if (!player.connected && room.players.get(player.id)) removePlayer(room, player);
    }, RECONNECT_GRACE_MS);
  });
});

server.listen(PORT, () => {
  console.log(`Bingo server running at http://localhost:${PORT}`);
});
