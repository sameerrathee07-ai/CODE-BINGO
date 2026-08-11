const $ = (s) => document.querySelector(s);

const els = {
  screenHome: $('#screen-home'),
  screenRoom: $('#screen-room'),
  homeName: $('#home-name'),
  homeRoomName: $('#home-room-name'),
  homeName2: $('#home-name2'),
  homeCode: $('#home-code'),
  btnCreate: $('#btn-create'),
  btnJoin: $('#btn-join'),
  roomName: $('#room-name'),
  roomCode: $('#room-code'),
  btnMic: $('#btn-mic'),
  btnMute: $('#btn-mute'),
  btnLeave: $('#btn-leave'),
  peers: $('#peers'),
  playerList: $('#player-list'),
  lobbyHint: $('#lobby-hint'),
  btnSetup: $('#btn-setup'),
  panelLobby: $('#panel-lobby'),
  panelArrange: $('#panel-arrange'),
  panelGame: $('#panel-game'),
  panelEnd: $('#panel-end'),
  arrangeBoard: $('#arrange-board'),
  arrangeStatus: $('#arrange-status'),
  arrangeHint: $('#arrange-hint'),
  btnShuffle: $('#btn-shuffle'),
  btnClear: $('#btn-clear'),
  btnReady: $('#btn-ready'),
  btnStart: $('#btn-start'),
  ballDisplay: $('#ball-display'),
  remaining: $('#remaining'),
  tray: $('#called-tray'),
  turnStatus: $('#turn-status'),
  turnClock: $('#turn-clock'),
  elimPalette: $('#elim-palette'),
  linesCount: $('#lines-count'),
  claimBanner: $('#claim-banner'),
  btnBingo: $('#btn-bingo'),
  playBoard: $('#play-board'),
  winnerTitle: $('#winner-title'),
  endSub: $('#end-sub'),
  claimsList: $('#claims-list'),
  endHint: $('#end-hint'),
  btnNewRound: $('#btn-new-round'),
  btnRematch: $('#btn-rematch'),
  toasts: $('#toasts'),
  overlayReconnect: $('#overlay-reconnect'),
  bgFloats: $('#bg-floats'),
  resultOverlay: $('#result-overlay'),
  resultBox: $('#result-box'),
  resultTitle: $('#result-title'),
  resultSub: $('#result-sub'),
  confetti: $('#confetti-canvas'),
  gameCards: [...document.querySelectorAll('.game-card')],
  rulesGameName: $('#rules-game-name'),
  rulesBingo: $('#rules-list-bingo'),
  rulesBattleship: $('#rules-list-battleship'),
  panelArrangeBs: $('#panel-arrange-bs'),
  panelGameBs: $('#panel-game-bs'),
  bsArrangeStatus: $('#bs-arrange-status'),
  bsArrangeHint: $('#bs-arrange-hint'),
  bsPalette: $('#bs-palette'),
  btnRotate: $('#btn-rotate'),
  btnShipsClear: $('#btn-ships-clear'),
  btnShipsReady: $('#btn-ships-ready'),
  btnStartBs: $('#btn-start-bs'),
  arrangeSea: $('#arrange-sea'),
  bsTurnStatus: $('#bs-turn-status'),
  bsTurnClock: $('#bs-turn-clock'),
  bsFeed: $('#bs-feed'),
  enemySea: $('#enemy-sea'),
  mySea: $('#my-sea'),
  enemyFleetStatus: $('#enemy-fleet-status'),
};

const SHIP_DEFS = [
  { name: 'Carrier', size: 5 },
  { name: 'Battleship', size: 4 },
  { name: 'Cruiser', size: 3 },
  { name: 'Submarine', size: 3 },
  { name: 'Destroyer', size: 2 },
];

const state = {
  room: null,
  me: null,
  board: null,
  marks: new Set(),
  lines: 0,
  canClaim: false,
  claimed: false,
  placed: Array(25).fill(0),
  localStream: null,
  micOn: false,
  muted: false,
  peers: new Map(),
  claimEnd: 0,
  turnStart: 0,
  lastTurnId: null,
  selectedGame: 'bingo',
  ships: null,
  curShip: 0,
  shipDir: 'h',
  myFleet: null,
  myShots: [],
  enemyShots: new Map(),
  sunkCells: new Set(),
  enemySunk: [],
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function toast(msg, type) {
  const t = document.createElement('div');
  t.className = 'toast ' + (type || '');
  t.textContent = msg;
  els.toasts.appendChild(t);
  setTimeout(() => t.classList.add('out'), 1400);
  setTimeout(() => t.remove(), 1700);
}

let ac = null;
function tone(freq, dur, when, type, vol) {
  if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type || 'sine';
  o.frequency.value = freq;
  const t0 = ac.currentTime + (when || 0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol || 0.25, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + (dur || 0.2));
  o.connect(g);
  g.connect(ac.destination);
  o.start(t0);
  o.stop(t0 + (dur || 0.2) + 0.05);
}
const sBall = () => { tone(880, 0.12, 0, 'sine', 0.25); tone(1318, 0.2, 0.09, 'sine', 0.2); };
const sClaim = () => { tone(660, 0.1, 0, 'triangle', 0.25); tone(990, 0.18, 0.12, 'triangle', 0.25); };
const sWin = () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28, i * 0.15, 'triangle', 0.28));
const sErr = () => tone(220, 0.18, 0, 'sawtooth', 0.12);

let ws = null;
let reconnectTimer = null;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  ws = new WebSocket(proto + location.host);
  ws.onopen = () => {
    els.overlayReconnect.classList.add('hidden');
    const saved = loadSaved();
    if (saved && getScreen() === 'room') {
      send({ type: 'joinRoom', code: saved.code, name: saved.name });
    }
  };
  ws.onclose = () => {
    if (getScreen() === 'room') els.overlayReconnect.classList.remove('hidden');
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1500);
  };
  ws.onmessage = (e) => {
    try { handle(JSON.parse(e.data)); } catch (err) { }
  };
}

function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function handle(msg) {
  switch (msg.type) {
    case 'you':
      state.me = { id: msg.id, name: msg.name };
      if (msg.game === 'battleship') {
        state.myFleet = msg.fleet || null;
        state.myShots = msg.shots || [];
        if (msg.hitsOnMe) for (const c of msg.hitsOnMe) state.enemyShots.set(c, true);
      } else {
        state.board = msg.board || null;
        state.marks = new Set(msg.marks || []);
        state.lines = msg.lines || 0;
        state.canClaim = !!msg.canClaim;
        state.claimed = !!msg.claimed;
        state.placed = msg.board ? msg.board.slice() : Array(25).fill(0);
      }
      showScreen('room');
      renderAll();
      if (state.micOn) ensureConnections();
      break;
    case 'roomState':
      state.room = msg.room;
      if (state.me && !state.room.players.some(p => p.id === state.me.id)) {
        showScreen('home');
        clearSaved();
      }
      if (state.room.turnId !== state.lastTurnId) {
        state.lastTurnId = state.room.turnId;
        state.turnStart = Date.now();
      }
      renderAll();
      break;
    case 'eliminate':
      if (!state.room) return;
      state.room.balls.push(msg.num);
      state.room.lastBall = msg.num;
      if (msg.turnId && msg.turnId !== state.room.turnId) state.turnStart = Date.now();
      state.room.turnId = msg.turnId;
      if (msg.timedOut) toast(msg.timedOut + ' ran out of time - ' + msg.num + ' was eliminated', 'warn');
      renderBall();
      renderTray();
      renderTurnStatus();
      renderPlayBoard();
      sBall();
      setTimeout(() => renderPlayBoard(), 900);
      break;
    case 'marks':
      state.marks.add(msg.num);
      state.lines = msg.lines;
      state.canClaim = msg.canClaim;
      renderPlayBoard();
      renderLines();
      renderBingo();
      break;
    case 'shot':
      if (!state.room || state.room.game !== 'battleship') break;
      if (msg.by === state.me.id) {
        if (state.myShots.some(s => s.cell === msg.cell)) break;
        state.myShots.push({ cell: msg.cell, hit: msg.hit });
        if (msg.sunk) {
          for (const c of msg.sunkCells) state.sunkCells.add(c);
          if (state.enemySunk.indexOf(msg.sunk) < 0) state.enemySunk.push(msg.sunk);
          feed('Sunk the enemy ' + msg.sunk + '!', true);
          sWin();
        } else if (msg.hit) {
          feed('Direct hit!', false);
        } else {
          feed('Miss.', false);
        }
      } else {
        state.enemyShots.set(msg.cell, !!msg.hit);
        if (msg.sunk) {
          feed('Your ' + msg.sunk + ' was sunk!', true);
          sClaim();
        }
      }
      renderBsSea();
      renderBsTurn();
      break;
    case 'turnSkipped':
      if (msg.by) toast(msg.by + ' ran out of time', 'warn');
      break;
    case 'claim':
      toast(msg.name + ' claimed BINGO!', 'warn');
      sClaim();
      break;
    case 'claimWindow':
      state.claimEnd = Date.now() + 8000;
      renderClaimBanner();
      renderElimPalette();
      break;
    case 'winner':
      sWin();
      showResult(msg.id === state.me.id, msg.name);
      fillEnd(msg);
      break;
    case 'newRound':
      if (state.room && state.room.game === 'battleship') {
        state.myFleet = null;
        state.myShots = [];
        state.enemyShots = new Map();
        state.sunkCells = new Set();
        state.enemySunk = [];
        state.ships = null;
        state.curShip = 0;
      } else {
        state.placed = state.board ? state.board.slice() : Array(25).fill(0);
        state.marks = new Set();
        state.lines = 0;
        state.canClaim = false;
        state.claimed = false;
        state.claimEnd = 0;
      }
      renderAll();
      break;
    case 'peerJoined':
      toast(msg.name + ' joined');
      createPeer(msg.id);
      break;
    case 'peerLeft':
      closePeer(msg.id);
      break;
    case 'webrtc':
      onWebrtc(msg.from, msg.payload);
      break;
    case 'error':
      toast(msg.message, 'err');
      sErr();
      break;
  }
}

function showScreen(s) {
  els.screenHome.classList.toggle('active', s === 'home');
  els.screenRoom.classList.toggle('active', s === 'room');
}
function getScreen() {
  return els.screenRoom.classList.contains('active') ? 'room' : 'home';
}

function save(v) { localStorage.setItem('bingo5x5', JSON.stringify(v)); }
function loadSaved() {
  try { return JSON.parse(localStorage.getItem('bingo5x5')); } catch (e) { return null; }
}
function clearSaved() { localStorage.removeItem('bingo5x5'); }

function renderAll() {
  if (!state.room || !state.me) return;
  const isHost = state.room.hostId === state.me.id;
  const allReady = state.room.players.every(p => p.ready);
  document.querySelectorAll('.host-only').forEach(el => { el.hidden = !isHost; });
  els.roomName.textContent = state.room.name || state.room.code;
  els.roomCode.textContent = state.room.code;
  renderPlayers();
  renderPanels();
  if (state.room.game === 'battleship') {
    renderBsPalette();
    renderBsArrange();
    renderBsSea();
    renderBsTurn();
  } else {
    renderBall();
    renderTray();
    renderPlayBoard();
    renderLines();
    renderBingo();
    renderClaimBanner();
    renderArrange();
    renderTurnStatus();
  }
  renderPeers();
  renderEndPanel();
  els.btnStart.disabled = !allReady;
  els.btnStartBs.disabled = !allReady;
  const mineReady = state.room.game === 'battleship' ? !!state.myFleet : !!state.board;
  if (state.room.phase === 'arrange') {
    if (isHost) {
      els.arrangeHint.textContent = allReady ? 'Everyone is ready - press Start game!' : 'Waiting for players to ready up...';
      els.bsArrangeHint.textContent = allReady ? 'Everyone is ready - press Start game!' : 'Waiting for players to ready up...';
    } else if (mineReady) {
      els.arrangeHint.textContent = allReady ? 'Waiting for the host to start the game...' : 'Waiting for other players...';
      els.bsArrangeHint.textContent = allReady ? 'Waiting for the host to start the game...' : 'Waiting for other players...';
    } else {
      els.arrangeHint.textContent = 'Type numbers 1-25 into the cells, then press Ready';
      els.bsArrangeHint.textContent = 'Place all 5 ships, then press Ready';
    }
  }
}

function renderPanels() {
  const ph = state.room.phase;
  const bs = state.room.game === 'battleship';
  els.panelLobby.classList.toggle('active', ph === 'lobby');
  els.panelArrange.classList.toggle('active', ph === 'arrange' && !bs);
  els.panelGame.classList.toggle('active', ph === 'playing' && !bs);
  els.panelArrangeBs.classList.toggle('active', ph === 'arrange' && bs);
  els.panelGameBs.classList.toggle('active', ph === 'playing' && bs);
  els.panelEnd.classList.toggle('active', ph === 'ended');
  els.lobbyHint.hidden = state.room.hostId === state.me.id;
  els.arrangeHint.hidden = state.room.hostId === state.me.id;
  els.bsArrangeHint.hidden = state.room.hostId === state.me.id;
}

function renderPlayers() {
  els.playerList.innerHTML = '';
  for (const p of state.room.players) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = p.name;
    li.appendChild(name);
    if (p.host) {
      const b = document.createElement('span');
      b.className = 'badge host';
      b.textContent = 'HOST';
      li.appendChild(b);
    } else if (!p.connected) {
      const b = document.createElement('span');
      b.className = 'badge away';
      b.textContent = 'AWAY';
      li.appendChild(b);
    } else {
      const b = document.createElement('span');
      b.className = 'badge ' + (p.ready ? 'ready' : 'dim');
      b.textContent = p.ready ? 'READY' : 'SETTING UP';
      li.appendChild(b);
    }
    els.playerList.appendChild(li);
  }
}

function renderBall() {
  const last = state.room.lastBall;
  els.ballDisplay.innerHTML = last ? '<span>' + last + '</span>' : '<span>-</span>';
  els.ballDisplay.classList.remove('pop');
  void els.ballDisplay.offsetWidth;
  els.ballDisplay.classList.add('pop');
  const left = 25 - state.room.balls.length;
  els.remaining.textContent = left > 0 ? left + ' numbers left' : 'All numbers eliminated';
}

function renderTray() {
  els.tray.innerHTML = '';
  state.room.balls.forEach((num, i) => {
    const b = document.createElement('div');
    b.className = 'ball' + (i === state.room.balls.length - 1 ? ' current' : '');
    b.textContent = num;
    els.tray.appendChild(b);
  });
}

function renderPlayBoard() {
  if (!state.board || !els.playBoard) return;
  els.playBoard.innerHTML = '';
  state.board.forEach((num, i) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cell';
    cell.textContent = num;
    const marked = state.marks.has(num);
    const called = state.room && state.room.balls.includes(num);
    if (marked) cell.classList.add('marked');
    else if (!called) cell.classList.add('uncalled');
    if (state.room && state.room.lastBall === num) cell.classList.add('fresh');
    els.playBoard.appendChild(cell);
  });
}

function renderLines() {
  els.linesCount.textContent = state.lines + ' / 5 lines';
  els.linesCount.classList.toggle('done', state.lines >= 5);
}

function renderBingo() {
  const b = els.btnBingo;
  const inPlay = state.room.phase === 'playing';
  if (state.claimed) {
    b.disabled = true;
    b.textContent = 'Claimed!';
    b.classList.add('claimed');
  } else {
    b.disabled = !(state.canClaim && inPlay);
    b.textContent = 'BINGO!';
    b.classList.remove('claimed');
  }
}

let countdownTimer = null;
function renderClaimBanner() {
  const open = state.room.claimWindow;
  els.claimBanner.classList.toggle('hidden', !open);
  if (!open) {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    return;
  }
  if (!countdownTimer) {
    countdownTimer = setInterval(() => {
      const s = Math.max(0, Math.ceil((state.claimEnd - Date.now()) / 1000));
      els.claimBanner.textContent = 'BINGO claimed - last caller wins! (' + s + 's)';
      if (s <= 0) { clearInterval(countdownTimer); countdownTimer = null; }
    }, 200);
  }
}

function fillEnd(msg) {
  const isHost = state.me.id === state.room.hostId;
  const bs = state.room.game === 'battleship';
  els.winnerTitle.textContent = msg.name ? (bs ? msg.name + ' wins!' : 'BINGO! ' + msg.name + ' wins') : 'Round over - no winner';
  els.endSub.textContent = bs ? 'The whole enemy fleet has been sunk.' : 'Claimed on the final call - the last caller wins.';
  els.claimsList.innerHTML = '';
  if (bs) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = msg.name || 'No winner';
    li.appendChild(name);
    const b = document.createElement('span');
    b.className = 'badge' + (msg.id ? ' winner' : '');
    b.textContent = msg.id ? 'WINNER' : '--';
    if (msg.id) li.classList.add('winner');
    li.appendChild(b);
    els.claimsList.appendChild(li);
  } else {
    (msg.claims || []).forEach((c, i) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = c.name + (i === (msg.claims.length - 1) ? ' (last claim)' : '');
      li.appendChild(name);
      const b = document.createElement('span');
      b.className = 'badge';
      if (c.id === msg.id) {
        b.textContent = 'WINNER';
        b.classList.add('winner');
        li.classList.add('winner');
      } else {
        b.textContent = 'CLAIMED';
        b.classList.add('dim');
      }
      li.appendChild(b);
      els.claimsList.appendChild(li);
    });
  }
  if (isHost) els.endHint.hidden = true;
}

function renderEndPanel() {
  if (!state.room || !state.me) return;
  const isHost = state.room.hostId === state.me.id;
  const ended = state.room.phase === 'ended';
  els.btnRematch.hidden = !ended;
  els.btnNewRound.disabled = !ended || !isHost || !allRematch();
  if (!ended) return;
  const mine = state.room.players.find(p => p.id === state.me.id);
  const meReady = !!(mine && mine.rematch);
  els.btnRematch.disabled = meReady;
  els.btnRematch.textContent = meReady ? 'Ready!' : 'Ready for next round';
  els.btnRematch.classList.toggle('done', meReady);
  const all = allRematch();
  els.endHint.hidden = false;
  if (isHost) {
    els.endHint.textContent = all ? 'Everyone ready - start the next round!' : 'Waiting for everyone to press Ready...';
  } else {
    els.endHint.textContent = all ? 'Waiting for the host to start the next round...' : 'Press Ready to continue';
  }
}

function allRematch() {
  return state.room.players.every(p => p.rematch || !p.connected);
}

/* ---------- result overlay (win / lose) ---------- */

let resultTimer = null;

function showResult(win, winnerName) {
  els.resultBox.classList.toggle('win', win);
  els.resultBox.classList.toggle('lose', !win);
  els.resultTitle.textContent = win ? 'YOU WIN!' : 'YOU LOST';
  els.resultTitle.classList.toggle('win', win);
  els.resultTitle.classList.toggle('lose', !win);
  els.resultSub.textContent = win
    ? (state.room && state.room.game === 'battleship' ? 'The enemy fleet is gone!' : 'BINGO - 5 lines complete!')
    : (winnerName ? winnerName + ' won this round' : 'Round over');
  els.resultOverlay.classList.remove('hidden');
  if (win) burstConfetti();
  clearTimeout(resultTimer);
  resultTimer = setTimeout(() => els.resultOverlay.classList.add('hidden'), 5000);
}

els.resultOverlay.addEventListener('click', () => {
  els.resultOverlay.classList.add('hidden');
});

function burstConfetti() {
  const cv = els.confetti;
  cv.width = window.innerWidth;
  cv.height = window.innerHeight;
  const ctx = cv.getContext('2d');
  const colors = ['#fbbf24', '#ef4444', '#3b82f6', '#22c55e', '#e879f9', '#38bdf8'];
  const parts = [];
  for (let i = 0; i < 180; i++) {
    parts.push({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 80,
      y: window.innerHeight * 0.35 + (Math.random() - 0.5) * 40,
      vx: (Math.random() - 0.5) * 16,
      vy: -(Math.random() * 13 + 5),
      g: 0.45 + Math.random() * 0.35,
      s: 6 + Math.random() * 8,
      c: colors[i % colors.length],
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.35,
    });
  }
  let last = performance.now();
  (function frame(now) {
    const dt = Math.min(2.5, (now - last) / 16);
    last = now;
    ctx.clearRect(0, 0, cv.width, cv.height);
    let alive = false;
    for (const p of parts) {
      p.vy += p.g * 0.3 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.vr * dt;
      if (p.y < cv.height + 40) alive = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
      ctx.restore();
    }
    if (alive) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, cv.width, cv.height);
  })(performance.now());
}

function renderPeers() {
  els.peers.innerHTML = '';
  for (const p of state.room.players || []) {
    if (p.id === state.me.id) continue;
    const chip = document.createElement('span');
    chip.className = 'peer' + (state.peers.has(p.id) ? ' voice' : '');
    chip.textContent = p.name + (state.peers.has(p.id) ? ' - voice' : '');
    els.peers.appendChild(chip);
  }
}

/* ---------- arrange ---------- */

function renderArrange() {
  const active = state.room.phase === 'arrange';
  els.arrangeBoard.innerHTML = '';
  for (let i = 0; i < 25; i++) {
    const cell = document.createElement('input');
    cell.type = 'number';
    cell.min = '1';
    cell.max = '25';
    cell.inputMode = 'numeric';
    cell.className = 'cell-input' + (state.placed[i] ? '' : ' empty');
    cell.value = state.placed[i] || '';
    cell.disabled = !active;
    cell.addEventListener('input', () => {
      const v = parseInt(cell.value, 10);
      state.placed[i] = (Number.isInteger(v) && v >= 1 && v <= 25) ? v : 0;
      updateArrangeStatus();
    });
    els.arrangeBoard.appendChild(cell);
  }
  updateArrangeStatus();
}

function updateArrangeStatus() {
  const counts = new Map();
  for (const v of state.placed) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  const count = state.placed.filter(Boolean).length;
  const complete = count === 25;
  const unique = [...counts.values()].every(n => n === 1);
  const invalid = complete && !unique;
  const children = els.arrangeBoard.children;
  for (let i = 0; i < children.length; i++) {
    const v = state.placed[i];
    children[i].classList.toggle('dup', !!v && counts.get(v) > 1);
  }
  els.arrangeStatus.textContent = count + ' / 25 placed' + (invalid ? ' - each number only once!' : '');
  els.btnReady.disabled = !(complete && unique);
}

els.btnShuffle.addEventListener('click', () => {
  const missing = [];
  for (let n = 1; n <= 25; n++) if (!state.placed.includes(n)) missing.push(n);
  shuffle(missing);
  const empties = [];
  state.placed.forEach((v, i) => { if (!v) empties.push(i); });
  empties.forEach((i, k) => { state.placed[i] = missing[k]; });
  renderArrange();
});

els.btnClear.addEventListener('click', () => {
  state.placed = Array(25).fill(0);
  renderArrange();
});

els.btnReady.addEventListener('click', () => {
  const counts = new Map();
  for (const v of state.placed) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  if (state.placed.filter(Boolean).length !== 25 || [...counts.values()].some(n => n !== 1)) {
    toast('Board must have numbers 1-25 each once', 'err');
    return;
  }
  send({ type: 'setBoard', numbers: state.placed.slice() });
  toast('Board saved');
});

/* ---------- battleship ---------- */

function renderBsPalette() {
  els.bsPalette.innerHTML = '';
  const placedIdx = new Set((state.ships || []).map(s => s.idx));
  SHIP_DEFS.forEach((def, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bs-ship' + (state.curShip === i ? ' selected' : '') + (placedIdx.has(i) ? ' used' : '');
    btn.disabled = state.room.phase !== 'arrange';
    for (let k = 0; k < def.size; k++) {
      const seg = document.createElement('span');
      seg.className = 'seg' + (placedIdx.has(i) ? ' fill' : '');
      btn.appendChild(seg);
    }
    const lab = document.createElement('span');
    lab.className = 's-label';
    lab.textContent = def.name;
    btn.appendChild(lab);
    btn.addEventListener('click', () => { state.curShip = i; renderBsPalette(); });
    els.bsPalette.appendChild(btn);
  });
}

function shipCells(size, dir, anchor) {
  const r = Math.floor(anchor / 10);
  const col = anchor % 10;
  const cells = [];
  for (let i = 0; i < size; i++) {
    const nr = dir === 'h' ? r : r + i;
    const nc = dir === 'h' ? col + i : col;
    if (nr > 9 || nc > 9) return null;
    cells.push(nr * 10 + nc);
  }
  return cells;
}

function overlaps(existing, cells) {
  const taken = new Set((existing || []).flatMap(s => s.cells));
  return cells.some(c => taken.has(c));
}

function renderBsArrange() {
  if (!els.arrangeSea) return;
  const active = state.room.phase === 'arrange';
  const placed = new Set((state.ships || []).flatMap(s => s.cells));
  els.arrangeSea.innerHTML = '';
  for (let c = 0; c < 100; c++) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'sea-cell' + (placed.has(c) ? ' ship' : '');
    cell.disabled = !active;
    if (active) {
      if (placed.has(c)) {
        cell.addEventListener('click', () => {
          const i = (state.ships || []).findIndex(s => s.cells.includes(c));
          if (i >= 0) { state.ships.splice(i, 1); renderBsArrange(); renderBsPalette(); }
        });
      } else {
        cell.addEventListener('click', () => placeShipAt(c));
        cell.addEventListener('mouseenter', () => previewAt(c));
        cell.addEventListener('mouseleave', clearPreview);
      }
    }
    els.arrangeSea.appendChild(cell);
  }
  updateBsArrangeStatus();
}

function placeShipAt(c) {
  if (state.room.phase !== 'arrange') return;
  const def = SHIP_DEFS[state.curShip];
  const cells = shipCells(def.size, state.shipDir, c);
  if (!cells) { toast('Ship out of bounds', 'err'); return; }
  const remaining = (state.ships || []).filter(s => s.idx !== state.curShip);
  if (overlaps(remaining, cells)) { toast('Ships overlap', 'err'); return; }
  state.ships = remaining.concat([{ idx: state.curShip, cells }]);
  state.curShip = (state.curShip + 1) % SHIP_DEFS.length;
  renderBsArrange();
  renderBsPalette();
}

function previewAt(c) {
  const def = SHIP_DEFS[state.curShip];
  const cells = shipCells(def.size, state.shipDir, c);
  if (!cells || overlaps(state.ships, cells)) return;
  for (const cc of cells) {
    const el = els.arrangeSea.children[cc];
    if (el) el.classList.add('target');
  }
}
function clearPreview() {
  const t = els.arrangeSea.querySelectorAll('.target');
  for (const el of t) el.classList.remove('target');
}

function updateBsArrangeStatus() {
  const n = state.ships ? state.ships.length : 0;
  els.bsArrangeStatus.textContent = n + ' / 5 ships';
  els.btnShipsReady.disabled = n !== 5;
}

els.btnShipsReady.addEventListener('click', () => {
  if (!state.ships || state.ships.length !== 5) { toast('Place all 5 ships first', 'err'); return; }
  send({ type: 'placeShips', ships: state.ships.map(s => ({ cells: s.cells })) });
  toast('Fleet deployed');
});

els.btnShipsClear.addEventListener('click', () => {
  state.ships = null;
  renderBsArrange();
  renderBsPalette();
});

els.btnRotate.addEventListener('click', () => {
  state.shipDir = state.shipDir === 'h' ? 'v' : 'h';
  renderBsArrange();
});

els.btnStartBs.addEventListener('click', () => send({ type: 'startGame' }));

document.addEventListener('keydown', (e) => {
  if (getScreen() === 'room' && state.room && state.room.game === 'battleship' && state.room.phase === 'arrange' && (e.key === 'r' || e.key === 'R')) {
    state.shipDir = state.shipDir === 'h' ? 'v' : 'h';
    renderBsArrange();
  }
});

function renderBsSea() {
  renderEnemySea();
  renderMySea();
}

function renderEnemySea() {
  if (!els.enemySea) return;
  const playing = state.room.phase === 'playing';
  const myTurn = playing && state.room.turnId === state.me.id;
  const shotMap = new Map(state.myShots.map(s => [s.cell, s.hit]));
  els.enemySea.innerHTML = '';
  for (let c = 0; c < 100; c++) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'sea-cell';
    if (shotMap.has(c)) {
      cell.classList.add(shotMap.get(c) ? 'hit' : 'miss');
      if (state.sunkCells.has(c)) cell.classList.add('sunkcell');
    } else if (playing && myTurn) {
      cell.classList.add('target');
      cell.addEventListener('click', () => fireAt(c));
    }
    cell.disabled = !myTurn || shotMap.has(c);
    els.enemySea.appendChild(cell);
  }
  els.enemyFleetStatus.textContent = state.enemySunk.length ? state.enemySunk.join(' + ') + ' down' : '';
}

function renderMySea() {
  if (!els.mySea) return;
  const fleetCells = new Set();
  if (state.myFleet) for (const s of state.myFleet) for (const c of s.cells) fleetCells.add(c);
  els.mySea.innerHTML = '';
  for (let c = 0; c < 100; c++) {
    const cell = document.createElement('div');
    cell.className = 'sea-cell' + (fleetCells.has(c) ? ' ship' : '');
    const enemyHit = state.enemyShots.get(c);
    if (enemyHit === true) cell.classList.add('hit');
    else if (enemyHit === false) cell.classList.add('miss');
    els.mySea.appendChild(cell);
  }
}

function fireAt(c) {
  if (state.room.game !== 'battleship' || state.room.phase !== 'playing') return;
  if (state.room.turnId !== state.me.id) { toast('Not your turn', 'err'); return; }
  if (state.myShots.some(s => s.cell === c)) return;
  send({ type: 'attack', cell: c });
}

function feed(text, sink) {
  if (!els.bsFeed) return;
  const chip = document.createElement('div');
  chip.className = 'feed-chip' + (sink ? ' sink' : '');
  chip.textContent = text;
  els.bsFeed.appendChild(chip);
  while (els.bsFeed.children.length > 4) els.bsFeed.firstChild.remove();
  setTimeout(() => chip.remove(), 2600);
}

function renderBsTurn() {
  if (!state.room || !state.me) return;
  const playing = state.room.phase === 'playing';
  const isMe = playing && state.room.turnId === state.me.id;
  const turnPlayer = state.room.players.find(p => p.id === state.room.turnId);
  els.bsTurnStatus.textContent = playing
    ? (isMe ? 'Your turn - fire!' : 'Waiting for ' + (turnPlayer ? turnPlayer.name : '...') + ' to fire...')
    : 'Waiting for the game to start...';
  els.bsTurnStatus.classList.toggle('mine', isMe);
  updateBsClock();
}

function updateBsClock() {
  if (!state.room || !state.me) { els.bsTurnClock.textContent = ''; return; }
  const inPlay = state.room.phase === 'playing';
  if (!inPlay || !state.room.turnId) { els.bsTurnClock.textContent = ''; return; }
  const left = Math.max(0, Math.ceil(10 - (Date.now() - state.turnStart) / 1000));
  els.bsTurnClock.textContent = left + 's';
  els.bsTurnClock.classList.toggle('urgent', left <= 1);
}

/* ---------- playing ---------- */

els.btnBingo.addEventListener('click', () => {
  if (state.canClaim && !state.claimed) {
    state.claimed = true;
    state.canClaim = false;
    renderBingo();
    send({ type: 'claim' });
  }
});

/* ---------- host controls ---------- */

els.btnSetup.addEventListener('click', () => send({ type: 'setup' }));
els.btnStart.addEventListener('click', () => send({ type: 'startGame' }));
els.btnNewRound.addEventListener('click', () => send({ type: 'newRound' }));
els.btnRematch.addEventListener('click', () => send({ type: 'rematch' }));

/* ---------- turn-based elimination ---------- */

function renderTurnStatus() {
  if (!state.room || !state.me) return;
  const isMe = state.room.turnId === state.me.id;
  const turnPlayer = state.room.players.find(p => p.id === state.room.turnId);
  if (state.room.phase === 'playing') {
    els.turnStatus.textContent = isMe
      ? 'Your turn - pick a number to eliminate!'
      : 'Waiting for ' + (turnPlayer ? turnPlayer.name : '...') + ' to eliminate a number...';
  } else {
    els.turnStatus.textContent = 'Waiting for the game to start...';
  }
  els.turnStatus.classList.toggle('mine', isMe && state.room.phase === 'playing');
  updateTurnClock();
  renderElimPalette();
}

function updateTurnClock() {
  if (!state.room || !state.me) {
    els.turnClock.textContent = '';
    return;
  }
  const inPlay = state.room.phase === 'playing' && !state.room.claimWindow;
  if (!inPlay || !state.room.turnId) {
    els.turnClock.textContent = '';
    return;
  }
  const left = Math.max(0, Math.ceil(10 - (Date.now() - state.turnStart) / 1000));
  els.turnClock.textContent = left + 's';
  els.turnClock.classList.toggle('urgent', left <= 1);
}

setInterval(() => {
  if (!state.room || state.room.phase !== 'playing') return;
  if (state.room.game === 'battleship') { updateBsClock(); return; }
  if (state.room.claimWindow) return;
  updateTurnClock();
}, 250);

function renderElimPalette() {
  if (!state.room || !state.me) return;
  els.elimPalette.innerHTML = '';
  const myTurn = state.room.turnId === state.me.id;
  const active = state.room.phase === 'playing' && !state.room.claimWindow;
  for (let n = 1; n <= 25; n++) {
    const used = state.room.balls.includes(n);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (used ? ' used' : '') + (myTurn && !used ? ' turn' : '');
    chip.textContent = n;
    chip.disabled = !myTurn || used || !active;
    if (myTurn && !used && active) {
      chip.addEventListener('click', () => send({ type: 'eliminate', num: n }));
    }
    els.elimPalette.appendChild(chip);
  }
}

/* ---------- home ---------- */

function create() {
  const name = els.homeName.value.trim();
  if (!name) { toast('Enter a name', 'err'); return; }
  save({ code: '', name, roomName: els.homeRoomName.value.trim(), game: state.selectedGame });
  send({ type: 'createRoom', name, roomName: els.homeRoomName.value.trim(), game: state.selectedGame });
}

function join() {
  const name = els.homeName2.value.trim();
  const code = els.homeCode.value.trim().toUpperCase();
  if (!name || !code) { toast('Enter name and room code', 'err'); return; }
  save({ code, name });
  send({ type: 'joinRoom', code, name });
}

els.btnCreate.addEventListener('click', create);
els.btnJoin.addEventListener('click', join);
els.homeName.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
els.homeCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
els.homeName2.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

els.btnLeave.addEventListener('click', () => {
  send({ type: 'leave' });
  clearSaved();
  showScreen('home');
});

els.roomCode.addEventListener('click', () => {
  if (!state.room) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(state.room.code).then(() => toast('Room code copied')).catch(() => { });
  } else {
    toast('Room: ' + state.room.code);
  }
});

/* ---------- voice chat ---------- */

function updateMicBtn() {
  els.btnMic.textContent = state.micOn ? 'MIC ON' : 'MIC OFF';
  els.btnMic.classList.toggle('on', state.micOn);
}

async function toggleMic() {
  if (!state.localStream) {
    try {
      state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      toast('Microphone unavailable', 'err');
      return;
    }
  }
  state.micOn = !state.micOn;
  state.localStream.getAudioTracks().forEach(t => { t.enabled = state.micOn; });
  updateMicBtn();
  if (state.micOn) {
    addTracksToPeers();
    ensureConnections();
  }
}

function addTracksToPeers() {
  if (!state.localStream) return;
  for (const p of state.peers.values()) {
    if (p.pc.getSenders().length === 0) {
      state.localStream.getTracks().forEach(t => p.pc.addTrack(t, state.localStream));
    }
  }
}

function ensureConnections() {
  if (!state.room) return;
  for (const p of state.room.players) {
    if (p.id !== state.me.id && !state.peers.has(p.id)) createPeer(p.id);
  }
}

async function createPeer(id) {
  if (state.peers.has(id)) return;
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'turns:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    ],
  });
  const peer = { pc, el: null, makingOffer: false };
  if (state.localStream) {
    state.localStream.getTracks().forEach(t => pc.addTrack(t, state.localStream));
  }
  const el = document.createElement('audio');
  el.autoplay = true;
  el.playsInline = true;
  el.muted = state.muted;
  peer.el = el;
  pc.ontrack = (e) => {
    el.srcObject = e.streams[0];
  };
  pc.onicecandidate = (e) => {
    if (e.candidate) send({ type: 'webrtc', to: id, payload: { ice: e.candidate } });
  };
  pc.onnegotiationneeded = async () => {
    if (peer.makingOffer) return;
    peer.makingOffer = true;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ type: 'webrtc', to: id, payload: { desc: pc.localDescription } });
    } catch (e) { }
    peer.makingOffer = false;
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closePeer(id);
  };
  state.peers.set(id, peer);
  document.body.appendChild(el);
  renderPeers();
}

function closePeer(id) {
  const peer = state.peers.get(id);
  if (!peer) return;
  state.peers.delete(id);
  try { peer.pc.close(); } catch (e) { }
  if (peer.el.parentNode) peer.el.parentNode.removeChild(peer.el);
  renderPeers();
}

async function onWebrtc(from, payload) {
  if (payload.desc) {
    const type = payload.desc.type;
    let peer = state.peers.get(from);
    if (type === 'offer') {
      if (!peer) await createPeer(from);
      peer = state.peers.get(from);
      if (!peer) return;
      if (peer.pc.signalingState === 'have-local-offer') {
        try { await peer.pc.setLocalDescription({ type: 'rollback' }); } catch (e) { }
      }
      try {
        await peer.pc.setRemoteDescription(payload.desc);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        send({ type: 'webrtc', to: from, payload: { desc: peer.pc.localDescription } });
      } catch (e) { }
    } else if (type === 'answer') {
      if (peer && peer.pc.signalingState === 'have-local-offer') {
        try { await peer.pc.setRemoteDescription(payload.desc); } catch (e) { }
      }
    }
  } else if (payload.ice) {
    const peer = state.peers.get(from);
    if (peer) {
      try { await peer.pc.addIceCandidate(payload.ice); } catch (e) { }
    }
  }
}

els.btnMic.addEventListener('click', toggleMic);

els.btnMute.addEventListener('click', () => {
  state.muted = !state.muted;
  state.peers.forEach(p => { p.el.muted = state.muted; });
  els.btnMute.textContent = state.muted ? 'SPK OFF' : 'SPK';
  els.btnMute.classList.toggle('off', state.muted);
});

/* ---------- background floaters ---------- */

function spawnFloaters() {
  const wrap = els.bgFloats;
  if (!wrap) return;
  wrap.innerHTML = '';
  const letters = ['B', 'I', 'N', 'G', 'O'];
  const types = ['fl-ball', 'fl-ball', 'fl-tile', 'fl-tile', 'fl-letter', 'fl-letter', 'fl-mark', 'fl-mark', 'fl-game', 'fl-dice'];
  const count = Math.min(18, Math.max(9, Math.floor(window.innerWidth / 85)));
  for (let i = 0; i < count; i++) {
    const cls = types[i % types.length];
    const el = document.createElement('div');
    el.className = 'fl ' + cls;
    const size = 26 + Math.random() * 46;
    if (cls === 'fl-ball') {
      el.textContent = 1 + Math.floor(Math.random() * 25);
      el.style.width = size + 'px';
      el.style.height = size + 'px';
      el.style.fontSize = Math.round(size * 0.45) + 'px';
    } else if (cls === 'fl-tile') {
      el.textContent = 1 + Math.floor(Math.random() * 25);
      el.style.width = size + 'px';
      el.style.height = size + 'px';
      el.style.fontSize = Math.round(size * 0.4) + 'px';
    } else if (cls === 'fl-letter') {
      el.textContent = letters[Math.floor(Math.random() * 5)];
      el.style.fontSize = size + 'px';
    } else if (cls === 'fl-mark') {
      el.textContent = Math.random() < 0.5 ? 'X' : 'O';
      el.style.fontSize = size + 'px';
    } else if (cls === 'fl-game') {
      el.textContent = '\u{1F3AE}';
      el.style.fontSize = size + 'px';
    } else {
      el.textContent = '\u{1F3B2}';
      el.style.fontSize = size + 'px';
    }
    el.style.left = (Math.random() * 96) + '%';
    el.style.top = (Math.random() * 96) + '%';
    el.style.animationDuration = (10 + Math.random() * 16) + 's';
    el.style.animationDelay = (-Math.random() * 22) + 's';
    el.style.opacity = (0.16 + Math.random() * 0.22).toFixed(2);
    wrap.appendChild(el);
  }
}

let resizeT = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(spawnFloaters, 300);
});

/* ---------- init ---------- */

els.gameCards.forEach(card => {
  card.addEventListener('click', () => {
    if (card.disabled) return;
    state.selectedGame = card.dataset.game;
    els.gameCards.forEach(c => c.classList.toggle('selected', c === card));
    const bs = state.selectedGame === 'battleship';
    els.rulesBingo.classList.toggle('hidden', bs);
    els.rulesBattleship.classList.toggle('hidden', !bs);
    els.rulesGameName.textContent = bs ? 'Battleship' : 'Bingo';
  });
});

const saved = loadSaved();
if (saved) {
  els.homeName.value = saved.name;
  els.homeName2.value = saved.name;
  if (saved.roomName) els.homeRoomName.value = saved.roomName;
  if (saved.code) els.homeCode.value = saved.code;
  if (saved.game) {
    const card = els.gameCards.find(c => c.dataset.game === saved.game);
    if (card && !card.disabled) {
      state.selectedGame = saved.game;
      card.classList.add('selected');
      const bs = saved.game === 'battleship';
      els.rulesBingo.classList.toggle('hidden', bs);
      els.rulesBattleship.classList.toggle('hidden', !bs);
      els.rulesGameName.textContent = bs ? 'Battleship' : 'Bingo';
    }
  }
}

spawnFloaters();
connect();
