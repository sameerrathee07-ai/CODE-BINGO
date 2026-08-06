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

function freshRoom(c) {
  return {
    code: c,
    players: new Map(),
    hostId: null,
    phase: 'lobby',
    balls: [],
    lastBall: null,
    claimWindow: false,
    claims: [],
    claimTimer: null,
    autoCall: false,
    autoTimer: null,
    autoInterval: 5000,
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
    phase: room.phase,
    hostId: room.hostId,
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
    autoCall: room.autoCall,
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

function drawBall(room) {
  if (room.phase !== 'playing' || room.claimWindow || room.balls.length >= 25) return;
  const remaining = [];
  for (let i = 1; i <= 25; i++) if (!room.balls.includes(i)) remaining.push(i);
  const num = remaining[Math.floor(Math.random() * remaining.length)];
  room.balls.push(num);
  room.lastBall = num;
  broadcast(room, { type: 'ball', num, remaining: 25 - room.balls.length });
}

function stopAuto(room) {
  if (room.autoTimer) {
    clearInterval(room.autoTimer);
    room.autoTimer = null;
  }
}

function startAuto(room) {
  stopAuto(room);
  if (!room.autoCall) return;
  room.autoTimer = setInterval(() => drawBall(room), room.autoInterval);
}

function resolveClaims(room) {
  if (room.phase !== 'playing') return;
  if (room.claimTimer) {
    clearTimeout(room.claimTimer);
    room.claimTimer = null;
  }
  stopAuto(room);
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
  broadcast(room, { type: 'claimWindow', open: true });
  room.claimTimer = setTimeout(() => resolveClaims(room), CLAIM_WINDOW_MS);
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
    stopAuto(room);
    if (room.claimTimer) {
      clearTimeout(room.claimTimer);
      room.claimTimer = null;
    }
    rooms.delete(room.code);
  } else {
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
        const r = freshRoom(roomCode());
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
        broadcastState(room);
        if (room.autoCall) startAuto(room);
        break;
      }

      case 'draw': {
        if (!player || !room || player.id !== room.hostId) return;
        drawBall(room);
        break;
      }

      case 'autoCall': {
        if (!player || !room || player.id !== room.hostId) return;
        room.autoCall = !!msg.on;
        const iv = parseInt(msg.interval, 10);
        if (iv >= 2 && iv <= 60) room.autoInterval = iv * 1000;
        if (room.autoCall && room.phase === 'playing') startAuto(room);
        else stopAuto(room);
        broadcastState(room);
        break;
      }

      case 'mark': {
        if (!player || !room || room.phase !== 'playing') return;
        const num = msg.num;
        if (!player.board || !player.board.includes(num)) return;
        if (player.marks.has(num)) return;
        if (!room.balls.includes(num)) return send(ws, { type: 'error', message: 'Not called yet' });
        player.marks.add(num);
        const lines = playerLines(player);
        const canClaim = !player.claimed && lines >= 5;
        send(ws, { type: 'marks', num, lines, canClaim });
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
        stopAuto(room);
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
    broadcastState(room);
    player.graceTimer = setTimeout(() => {
      if (!player.connected && room.players.get(player.id)) removePlayer(room, player);
    }, RECONNECT_GRACE_MS);
  });
});

server.listen(PORT, () => {
  console.log(`Bingo server running at http://localhost:${PORT}`);
});
