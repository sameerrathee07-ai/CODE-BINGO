const $ = (s) => document.querySelector(s);

const els = {
  screenHome: $('#screen-home'),
  screenRoom: $('#screen-room'),
  homeName: $('#home-name'),
  homeName2: $('#home-name2'),
  homeCode: $('#home-code'),
  btnCreate: $('#btn-create'),
  btnJoin: $('#btn-join'),
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
  arrangePalette: $('#arrange-palette'),
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
  elimPalette: $('#elim-palette'),
  linesCount: $('#lines-count'),
  claimBanner: $('#claim-banner'),
  btnBingo: $('#btn-bingo'),
  playBoard: $('#play-board'),
  winnerTitle: $('#winner-title'),
  claimsList: $('#claims-list'),
  endHint: $('#end-hint'),
  btnNewRound: $('#btn-new-round'),
  toasts: $('#toasts'),
  overlayReconnect: $('#overlay-reconnect'),
  bgFloats: $('#bg-floats'),
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
  selectedChip: 0,
  localStream: null,
  micOn: false,
  muted: false,
  peers: new Map(),
  claimEnd: 0,
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
  setTimeout(() => t.classList.add('out'), 2200);
  setTimeout(() => t.remove(), 2600);
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
      renderAll();
      break;
    case 'eliminate':
      if (!state.room) return;
      state.room.balls.push(msg.num);
      state.room.lastBall = msg.num;
      state.room.turnId = msg.turnId;
      renderBall();
      renderTray();
      renderTurnStatus();
      renderPlayBoard();
      sBall();
      setTimeout(() => renderPlayBoard(), 2500);
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
      fillEnd(msg);
      break;
    case 'newRound':
      state.placed = state.board ? state.board.slice() : Array(25).fill(0);
      state.marks = new Set();
      state.lines = 0;
      state.canClaim = false;
      state.claimed = false;
      state.claimEnd = 0;
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
  els.roomCode.textContent = state.room.code;
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
  els.btnStart.disabled = !allReady;
  const mineReady = !!state.board;
  if (state.room.phase === 'arrange') {
    if (isHost) {
      els.arrangeHint.textContent = allReady ? 'Everyone is ready - press Start game!' : 'Waiting for players to ready up...';
    } else if (mineReady) {
      els.arrangeHint.textContent = allReady ? 'Waiting for the host to start the game...' : 'Waiting for other players...';
    } else {
      els.arrangeHint.textContent = 'Arrange your board, then press Ready';
    }
  }
}

function renderPanels() {
  const ph = state.room.phase;
  els.panelLobby.classList.toggle('active', ph === 'lobby');
  els.panelArrange.classList.toggle('active', ph === 'arrange');
  els.panelGame.classList.toggle('active', ph === 'playing');
  els.panelEnd.classList.toggle('active', ph === 'ended');
  els.lobbyHint.hidden = state.room.hostId === state.me.id;
  els.arrangeHint.hidden = state.room.hostId === state.me.id;
  els.endHint.hidden = state.room.hostId === state.me.id;
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
  els.winnerTitle.textContent = msg.name ? 'BINGO! ' + msg.name + ' wins' : 'Round over - no winner';
  els.claimsList.innerHTML = '';
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
  if (isHost) els.endHint.hidden = true;
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
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cell' + (state.placed[i] ? '' : ' empty');
    cell.textContent = state.placed[i] || '';
    if (active) cell.addEventListener('click', () => placeAt(i));
    else cell.disabled = true;
    els.arrangeBoard.appendChild(cell);
  }
  els.arrangePalette.innerHTML = '';
  const used = new Set(state.placed.filter(Boolean));
  for (let n = 1; n <= 25; n++) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (used.has(n) ? ' used' : '') + (state.selectedChip === n ? ' selected' : '');
    chip.textContent = n;
    chip.disabled = used.has(n) || !active;
    if (active && !used.has(n)) {
      chip.addEventListener('click', () => {
        state.selectedChip = state.selectedChip === n ? 0 : n;
        renderArrange();
      });
    }
    els.arrangePalette.appendChild(chip);
  }
  const count = state.placed.filter(Boolean).length;
  els.arrangeStatus.textContent = count + ' / 25 placed';
  els.btnReady.disabled = count !== 25;
}

function placeAt(i) {
  if (!state.selectedChip || state.placed[i]) return;
  state.placed[i] = state.selectedChip;
  state.selectedChip = 0;
  renderArrange();
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
  state.selectedChip = 0;
  renderArrange();
});

els.btnReady.addEventListener('click', () => {
  if (state.placed.filter(Boolean).length !== 25) return;
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
els.btnNewRound.addEventListener('click', () => send({ type: 'newRound' }));

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
  renderElimPalette();
}

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
  save({ code: '', name });
  send({ type: 'createRoom', name });
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
    el.style.opacity = (0.10 + Math.random() * 0.16).toFixed(2);
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
  if (saved.code) els.homeCode.value = saved.code;
}

spawnFloaters();
connect();
