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
  gameSidebar: $('#game-sidebar'),
  arrangeBingo: $('#arrange-bingo'),
  arrangeBs: $('#arrange-bs'),
  arrangeBsStatus: $('#arrange-bs-status'),
  bsFleetGrid: $('#bs-fleet-grid'),
  bsShipList: $('#bs-ship-list'),
  btnBsAuto: $('#btn-bs-auto'),
  btnBsClear: $('#btn-bs-clear'),
  btnBsReady: $('#btn-bs-ready'),
  btnBsStart: $('#btn-bs-start'),
  arrangeBsHint: $('#arrange-bs-hint'),
  gameBingo: $('#game-bingo'),
  gameBs: $('#game-bs'),
  bsTurnStatus: $('#bs-turn-status'),
  bsTurnClock: $('#bs-turn-clock'),
  bsOwn: $('#bs-own'),
  bsTracking: $('#bs-tracking'),
  endSub: $('#end-sub'),
};

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
  bsFleet: null,
  bsShots: null,
  bsHits: new Set(),
  bsSunk: new Set(),
  bsPlacing: null,
  bsReady: false,
};

const BS_SIZES = [5, 4, 3, 3, 2];
const BS_NAMES = ['Carrier', 'Battleship', 'Cruiser', 'Submarine', 'Destroyer'];

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
      state.board = msg.board || null;
      state.marks = new Set(msg.marks || []);
      state.lines = msg.lines || 0;
      state.canClaim = !!msg.canClaim;
      state.claimed = !!msg.claimed;
      state.placed = msg.board ? msg.board.slice() : Array(25).fill(0);
      state.bsFleet = msg.fleet || null;
      state.bsShots = msg.shots || null;
      state.bsHits = new Set(msg.hits || []);
      state.bsSunk = new Set(msg.shipsSunk || []);
      if (!state.bsPlacing) state.bsPlacing = { ship: 0, dir: 0, shipKeys: [[], [], [], [], []] };
      state.bsReady = !!msg.fleet;
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
      if (msg.room.phase === 'arrange' && msg.room.game === 'battleship' && !state.bsFleet) {
        if (!state.bsPlacing) state.bsPlacing = { ship: 0, dir: 0, shipKeys: [[], [], [], [], []] };
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
      state.placed = state.board ? state.board.slice() : Array(25).fill(0);
      state.marks = new Set();
      state.lines = 0;
      state.canClaim = false;
      state.claimed = false;
      state.claimEnd = 0;
      resetBsLocal();
      renderAll();
      break;
    case 'shot':
      handleShot(msg);
      break;
    case 'skip':
      if (msg.timedOutId) {
        const who = state.room && state.room.players.find(p => p.id === msg.timedOutId);
        toast((who ? who.name : 'A player') + ' ran out of time - turn passed', 'warn');
      }
      if (msg.turnId && msg.turnId !== state.room.turnId) state.turnStart = Date.now();
      state.room.turnId = msg.turnId;
      renderTurnStatus();
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
  renderSidebar();
  renderPlayers();
  renderPanels();
  renderBall();
  renderTray();
  renderPlayBoard();
  renderLines();
  renderBingo();
  renderClaimBanner();
  renderArrange();
  renderPeers();
  renderTurnStatus();
  renderEndPanel();
  renderBsSetup();
  renderBsBattle();
  const isBingo = state.room.game !== 'battleship';
  els.btnStart.disabled = !allReady;
  els.btnBsStart.disabled = !allReady;
  if (state.room.phase === 'arrange') {
    if (isHost) {
      if (isBingo) {
        els.arrangeHint.textContent = allReady ? 'Everyone is ready - press Start game!' : 'Waiting for players to ready up...';
      } else {
        els.arrangeBsHint.textContent = allReady ? 'Everyone is ready - press Start battle!' : 'Waiting for players to ready up...';
      }
    } else if (isBingo) {
      els.arrangeHint.textContent = state.placed.filter(Boolean).length === 25 ? 'Waiting for other players...' : 'Type numbers 1-25 into the cells, then press Ready';
    } else {
      els.arrangeBsHint.textContent = state.bsReady ? 'Waiting for other players...' : 'Place your ships, then press Ready';
    }
  }
}

function renderPanels() {
  const ph = state.room.phase;
  const isBingo = state.room.game !== 'battleship';
  els.panelLobby.classList.toggle('active', ph === 'lobby');
  els.panelArrange.classList.toggle('active', ph === 'arrange');
  els.panelGame.classList.toggle('active', ph === 'playing');
  els.panelEnd.classList.toggle('active', ph === 'ended');
  els.lobbyHint.hidden = state.room.hostId === state.me.id;
  els.arrangeHint.hidden = state.room.hostId === state.me.id;
  els.arrangeBingo.classList.toggle('hidden', !isBingo);
  els.arrangeBs.classList.toggle('hidden', isBingo);
  els.gameBingo.classList.toggle('hidden', !isBingo);
  els.gameBs.classList.toggle('hidden', isBingo);
}

function renderSidebar() {
  const game = state.room.game;
  for (const btn of els.gameSidebar.querySelectorAll('.game-btn')) {
    const active = btn.dataset.game === game;
    btn.classList.toggle('active', active);
    const locked = state.room.phase !== 'lobby' || state.me.id !== state.room.hostId;
    btn.disabled = locked;
    btn.title = locked ? 'Only the host can change the game before setup' : '';
  }
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
  const isBingo = state.room.game !== 'battleship';
  if (isBingo) {
    els.winnerTitle.textContent = msg.name ? 'BINGO! ' + msg.name + ' wins' : 'Round over - no winner';
    els.endSub.hidden = false;
  } else {
    els.winnerTitle.textContent = msg.name ? msg.name + ' wins the battle!' : 'Battle over';
    els.endSub.textContent = msg.name ? 'All enemy ships have been sunk.' : 'No winner';
    els.endSub.hidden = false;
  }
  els.claimsList.innerHTML = '';
  if (isBingo) {
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
    ? (state.room && state.room.game === 'battleship' ? 'All enemy ships sunk!' : 'BINGO - 5 lines complete!')
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
els.btnBsStart.addEventListener('click', () => send({ type: 'startGame' }));
els.btnNewRound.addEventListener('click', () => send({ type: 'newRound' }));
els.btnRematch.addEventListener('click', () => send({ type: 'rematch' }));
els.gameSidebar.addEventListener('click', (e) => {
  const btn = e.target.closest('.game-btn');
  if (!btn || btn.disabled) return;
  send({ type: 'setGame', game: btn.dataset.game });
});

/* ---------- battleship ---------- */

function resetBsLocal() {
  state.bsFleet = null;
  state.bsShots = null;
  state.bsHits = new Set();
  state.bsSunk = new Set();
  state.bsPlacing = { ship: 0, dir: 0, shipKeys: [[], [], [], [], []] };
  state.bsReady = false;
}

function bsCellsFor(shipIdx, r, c, dir, placed) {
  const size = BS_SIZES[shipIdx];
  const cells = [];
  const keys = [];
  for (let k = 0; k < size; k++) {
    const rr = dir === 0 ? r + k : r;
    const cc = dir === 0 ? c : c + k;
    if (rr < 0 || rr > 9 || cc < 0 || cc > 9) return null;
    keys.push(rr + ',' + cc);
  }
  if (keys.some(k => placed.some((keysArr) => keysArr.includes(k)))) return null;
  return keys;
}

function renderBsSetup() {
  const isBingo = state.room && state.room.game !== 'battleship';
  if (!state.room || isBingo) return;
  const placing = state.bsPlacing || (state.bsPlacing = { ship: 0, dir: 0, shipKeys: [[], [], [], [], []] });
  els.arrangeBsStatus.textContent = state.bsReady ? 'Fleet ready' : 'Placing: ' + BS_NAMES[placing.ship] + ' (' + BS_SIZES[placing.ship] + ') - ' + (placing.dir === 0 ? 'horizontal' : 'vertical');

  els.bsShipList.innerHTML = '';
  BS_NAMES.forEach((name, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bs-ship' + (i === placing.ship ? ' active' : '') + (placing.shipKeys[i].length ? ' done' : '');
    b.textContent = name + ' (' + BS_SIZES[i] + ')';
    b.disabled = state.bsReady;
    b.addEventListener('click', () => {
      if (state.bsReady) return;
      placing.ship = i;
      renderBsSetup();
    });
    els.bsShipList.appendChild(b);
  });

  els.bsFleetGrid.innerHTML = '';
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell bs-cell';
      const key = r + ',' + c;
      for (let i = 0; i < 5; i++) {
        if (placing.shipKeys[i].includes(key)) {
          const idx = placing.shipKeys[i].indexOf(key);
          cell.textContent = BS_NAMES[i][0];
          cell.classList.add('ship', 'ship-' + i + (idx === 0 ? ' head' : ''));
        }
      }
      const preview = bsCellsFor(placing.ship, r, c, placing.dir, placing.shipKeys);
      if (!state.bsReady && preview && preview.includes(key)) {
        cell.classList.add('preview');
        if (cell.textContent === '') cell.textContent = BS_NAMES[placing.ship][0];
      }
      cell.disabled = state.bsReady;
      cell.addEventListener('click', () => {
        if (state.bsReady) return;
        const keys = bsCellsFor(placing.ship, r, c, placing.dir, placing.shipKeys);
        if (!keys) { toast("Ships can't overlap or go off the board", 'err'); return; }
        placing.shipKeys[placing.ship] = keys;
        placing.ship = (placing.ship + 1) % 5;
        let next = placing.ship;
        while (placing.shipKeys[next].length && next !== (placing.ship - 1 + 5) % 5) next = (next + 1) % 5;
        if (placing.shipKeys[placing.ship].length) placing.ship = next;
        renderBsSetup();
      });
      els.bsFleetGrid.appendChild(cell);
    }
  }

  const complete = placing.shipKeys.every(k => k.length);
  els.btnBsReady.disabled = !complete || state.bsReady;
}

els.btnBsAuto.addEventListener('click', () => {
  if (!state.bsPlacing) resetBsLocal();
  const placing = state.bsPlacing;
  placing.shipKeys = [[], [], [], [], []];
  for (let i = 0; i < 5; i++) {
    let placed = false;
    for (let tries = 0; tries < 200 && !placed; tries++) {
      const dir = Math.random() < 0.5 ? 0 : 1;
      const size = BS_SIZES[i];
      const r = Math.floor(Math.random() * (dir === 0 ? 10 : 10 - size + 1));
      const c = Math.floor(Math.random() * (dir === 1 ? 10 : 10 - size + 1));
      const keys = bsCellsFor(i, r, c, dir, placing.shipKeys);
      if (keys) { placing.shipKeys[i] = keys; placed = true; }
    }
  }
  renderBsSetup();
});

els.btnBsClear.addEventListener('click', () => {
  if (!state.bsPlacing) resetBsLocal();
  state.bsPlacing.shipKeys = [[], [], [], [], []];
  state.bsPlacing.ship = 0;
  renderBsSetup();
});

els.btnBsReady.addEventListener('click', () => {
  if (!state.bsPlacing || !state.bsPlacing.shipKeys.every(k => k.length)) {
    toast('Place all 5 ships first', 'err');
    return;
  }
  const ships = state.bsPlacing.shipKeys.map((keys, i) => {
    const first = keys[0].split(',');
    const last = keys[keys.length - 1].split(',');
    const dir = first[0] !== last[0] ? 1 : 0;
    return { r: parseInt(first[0], 10), c: parseInt(first[1], 10), dir };
  });
  state.bsReady = true;
  send({ type: 'placeFleet', ships });
  toast('Fleet deployed');
});

function renderBsBattle() {
  const isBingo = state.room && state.room.game !== 'battleship';
  if (!state.room || isBingo || state.room.phase !== 'playing') return;

  els.bsOwn.innerHTML = '';
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell bs-cell';
      const key = r + ',' + c;
      const shipIdx = state.bsFleet && state.bsFleet[r][c];
      if (shipIdx !== null && shipIdx !== undefined) {
        cell.textContent = BS_NAMES[shipIdx][0];
        cell.classList.add('ship', 'ship-' + shipIdx);
      }
      if (state.bsHits.has(key)) cell.classList.add('hit');
      els.bsOwn.appendChild(cell);
    }
  }

  els.bsTracking.innerHTML = '';
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell bs-cell';
      const key = r + ',' + c;
      const shot = state.bsShots && state.bsShots[r][c];
      if (shot === 'hit') {
        cell.classList.add('hit');
        cell.textContent = 'X';
      } else if (shot === 'miss') {
        cell.classList.add('miss');
        cell.textContent = '·';
      }
      const myTurn = state.room.turnId === state.me.id && !state.room.claimWindow;
      cell.disabled = !myTurn || !!shot;
      if (myTurn && !shot) cell.classList.add('firable');
      cell.addEventListener('click', () => send({ type: 'fire', r, c }));
      els.bsTracking.appendChild(cell);
    }
  }
}

function handleShot(msg) {
  if (!state.room) return;
  const key = msg.r + ',' + msg.c;
  if (msg.myShot) {
    if (state.bsShots) state.bsShots[msg.r][msg.c] = msg.result;
    if (msg.sunk) {
      toast('You sank the ' + msg.sunk.name + '!', 'warn');
      if (state.bsShots) for (const [rr, cc] of msg.sunk.cells) state.bsShots[rr][cc] = 'hit';
      state.bsSunk.add(msg.sunk.idx);
      sClaim();
    } else {
      toast(msg.result === 'hit' ? 'Hit!' : 'Miss', msg.result === 'hit' ? 'warn' : '');
      sBall();
    }
  } else {
    if (msg.result === 'hit') {
      state.bsHits.add(key);
      if (msg.sunk) toast('Your ' + msg.sunk.name + ' was sunk!', 'warn');
      else toast('Your fleet was hit!', 'warn');
      sErr();
    } else {
      toast('The enemy fired - miss', '');
    }
  }
  if (msg.turnId && msg.turnId !== state.room.turnId) state.turnStart = Date.now();
  state.room.turnId = msg.turnId;
  renderTurnStatus();
  renderBsBattle();
}

/* ---------- turn-based elimination ---------- */

function renderTurnStatus() {
  if (!state.room || !state.me) return;
  const isBingo = state.room.game !== 'battleship';
  const statusEl = isBingo ? els.turnStatus : els.bsTurnStatus;
  const clockEl = isBingo ? els.turnClock : els.bsTurnClock;
  const isMe = state.room.turnId === state.me.id;
  const turnPlayer = state.room.players.find(p => p.id === state.room.turnId);
  if (state.room.phase === 'playing') {
    statusEl.textContent = isMe
      ? (isBingo ? 'Your turn - pick a number to eliminate!' : 'Your turn - fire on enemy waters!')
      : 'Waiting for ' + (turnPlayer ? turnPlayer.name : '...') + (isBingo ? ' to eliminate a number...' : ' to fire...');
  } else {
    statusEl.textContent = 'Waiting for the game to start...';
  }
  statusEl.classList.toggle('mine', isMe && state.room.phase === 'playing');
  clockEl.classList.toggle('urgent', false);
  updateTurnClock();
  if (isBingo) renderElimPalette();
}

function updateTurnClock() {
  if (!state.room || !state.me) {
    els.turnClock.textContent = '';
    els.bsTurnClock.textContent = '';
    return;
  }
  const isBingo = state.room.game !== 'battleship';
  const clockEl = isBingo ? els.turnClock : els.bsTurnClock;
  const inPlay = state.room.phase === 'playing' && !state.room.claimWindow;
  if (!inPlay || !state.room.turnId) {
    clockEl.textContent = '';
    return;
  }
  const left = Math.max(0, Math.ceil(10 - (Date.now() - state.turnStart) / 1000));
  clockEl.textContent = left + 's';
  clockEl.classList.toggle('urgent', left <= 1);
}

setInterval(() => {
  if (!state.room || state.room.phase !== 'playing' || state.room.claimWindow) return;
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
  save({ code: '', name, roomName: els.homeRoomName.value.trim() });
  send({ type: 'createRoom', name, roomName: els.homeRoomName.value.trim() });
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

const saved = loadSaved();
if (saved) {
  els.homeName.value = saved.name;
  els.homeName2.value = saved.name;
  if (saved.roomName) els.homeRoomName.value = saved.roomName;
  if (saved.code) els.homeCode.value = saved.code;
}

spawnFloaters();
connect();
