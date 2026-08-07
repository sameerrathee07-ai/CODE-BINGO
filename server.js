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
const TURN_TIMEOUT_MS = 5000;
const MAX_PLAYERS = 12;

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

function freshRoom(c, roomName) {
  return {
    code: c,
    name: roomName || null,
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
    graceTimer: null,
  };
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
    phase: room.phase,
    hostId: room.hostId,
    turnId: room.turnId,
    players: [...room.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      ready: !!p.board,
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
  return {
    type: 'you',
    id: p.id,
    name: p.name,
    host: p.id === room.hostId,
    phase: room.phase,
    board: p.board,
    marks: [...p.marks],
    lines: playerLines(p),
    canClaim: !p.claimed && playerLines(p) >= 5,
    claimed: p.claimed,
  };
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
  if (room.phase !== 'playing' || room.claimWindow || room.balls.length >= 25) return;
  room.turnTimer = setTimeout(() => {
    room.turnTimer = null;
    if (room.phase !== 'playing' || room.claimWindow || room.balls.length >= 25) return;
    const remaining = [];
    for (let i = 1; i <= 25; i++) if (!room.balls.includes(i)) remaining.push(i);
    if (!remaining.length) return;
    applyElimination(room, remaining[Math.floor(Math.random() * remaining.length)], room.turnId);
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
        const r = freshRoom(code, cleanName(msg.roomName));
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
        if (r.phase === 'playing' || r.phase === 'ended') {
          const existing = [...r.players.values()].find(x => x.name === name);
          if (!existing) return send(ws, { type: 'error', message: 'Game already started' });
          if (existing.graceTimer) clearTimeout(existing.graceTimer);
          existing.ws = ws;
          existing.connected = true;
          ctx.room = r;
          ctx.player = existing;
          send(ws, youMsg(r, existing));
          broadcastState(r);
          break;
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
        if (!player || !room || room.phase !== 'arrange') {
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

      case 'startGame': {
        if (!player || !room || player.id !== room.hostId || room.phase !== 'arrange') return;
        if ([...room.players.values()].some(p => !p.board)) {
          return send(ws, { type: 'error', message: 'Not all boards ready' });
        }
        room.phase = 'playing';
        const first = [...room.players.values()].find(x => x.connected) || [...room.players.values()][0];
        room.turnId = first ? first.id : null;
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

      case 'newRound': {
        if (!player || !room || player.id !== room.hostId || room.phase !== 'ended') return;
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
