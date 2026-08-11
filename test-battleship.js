const WebSocket = require('ws');

function client() {
  const ws = new WebSocket('ws://localhost:3999');
  const c = { ws, queue: [], pending: [] };
  const pump = () => {
    for (const p of c.pending) {
      if (p.done) continue;
      const i = c.queue.findIndex(p.pred);
      if (i >= 0) {
        p.done = true;
        clearTimeout(p.t);
        p.res(c.queue.splice(i, 1)[0]);
      }
    }
    c.pending = c.pending.filter(p => !p.done);
  };
  ws.on('message', (raw) => {
    try { c.queue.push(JSON.parse(raw)); pump(); } catch (e) { }
  });
  c.next = (pred, timeout) => new Promise((res, rej) => {
    const p = { pred, res, rej, done: false };
    p.t = setTimeout(() => { p.done = true; c.pending = c.pending.filter(x => x !== p); rej(new Error('timeout')); }, timeout || 4000);
    c.pending.push(p);
    pump();
  });
  c.send = (msg) => ws.send(JSON.stringify(msg));
  return c;
}

// fleet for testing: Carrier row 0 (0-4), Battleship row 2 (20-23), Cruiser row 4 (40-42), Sub row 6 (60-62), Destroyer row 8 (80-81)
function testFleet() {
  return [
    { cells: [0, 1, 2, 3, 4] },
    { cells: [20, 21, 22, 23] },
    { cells: [40, 41, 42] },
    { cells: [60, 61, 62] },
    { cells: [80, 81] },
  ];
}

async function main() {
  const a = client();
  const b = client();
  await Promise.all([new Promise(r => a.ws.on('open', r)), new Promise(r => b.ws.on('open', r))]);

  a.send({ type: 'createRoom', name: 'Alice', roomName: 'Sea Battle', game: 'battleship' });
  const aliceId = (await a.next(m => m.type === 'you')).id;
  const rs1 = await a.next(m => m.type === 'roomState');
  const code = rs1.room.code;
  console.log('PASS battleship room created:', rs1.room.game === 'battleship');
  b.send({ type: 'joinRoom', code, name: 'Bob' });
  const bobId = (await b.next(m => m.type === 'you')).id;

  a.send({ type: 'setup' });
  await a.next(m => m.type === 'roomState');

  // invalid fleet: overlapping ships
  const badFleet = [
    { cells: [0, 1, 2, 3, 4] },
    { cells: [4, 5, 6, 7] }, // overlaps at 4
    { cells: [40, 41, 42] },
    { cells: [60, 61, 62] },
    { cells: [80, 81] },
  ];
  a.send({ type: 'placeShips', ships: badFleet });
  const badErr = await a.next(m => m.type === 'error');
  console.log('PASS overlapping fleet rejected:', badErr.message === 'Invalid ship placement');

  a.send({ type: 'placeShips', ships: testFleet() });
  await a.next(m => m.type === 'you' && Array.isArray(m.fleet) && m.fleet.length === 5);
  b.send({ type: 'placeShips', ships: testFleet() });
  await a.next(m => m.type === 'roomState' && m.room.players.every(p => p.ready));
  console.log('PASS both fleets placed + ready');

  a.send({ type: 'startGame' });
  const st = await a.next(m => m.type === 'roomState' && m.room.phase === 'playing');
  const turnId = st.room.turnId;
  const first = turnId === aliceId ? a : b;
  const second = first === a ? b : a;
  console.log('PASS game started, random first turn:', turnId === aliceId || turnId === bobId);

  // out-of-turn attack
  second.send({ type: 'attack', cell: 0 });
  const errOff = await second.next(m => m.type === 'error');
  console.log('PASS out-of-turn attack rejected:', errOff.message === 'Not your turn');

  // valid attack: hit 0 (on defender's carrier) then miss
  const defenderId = first === a ? bobId : aliceId;
  first.send({ type: 'attack', cell: 0 });
  const shot1 = await first.next(m => m.type === 'shot' && m.cell === 0);
  console.log('PASS shot 0 is a hit:', shot1.hit === true);
  console.log('PASS turn flipped to defender:', st.room.turnId !== first.id);

  // defender misses at 99 (turn returns to first), then first duplicate-shot rejected
  second.send({ type: 'attack', cell: 99 });
  const shotMiss = await second.next(m => m.type === 'shot' && m.cell === 99);
  console.log('PASS shot 99 is a miss:', shotMiss.hit === false);

  first.send({ type: 'attack', cell: 0 });
  const errDup = await first.next(m => m.type === 'error');
  console.log('PASS duplicate shot rejected:', errDup.message === 'Already fired there');

  // full game: first player sinks the whole defender fleet
  // defender ships at: row0 0-4, row2 20-23, row4 40-42, row6 60-62, row8 80-81
  // first already hit 0; remaining cells to hit:
  const rem = [1, 2, 3, 4, 20, 21, 22, 23, 40, 41, 42, 60, 61, 62, 80, 81];
  const secondFired = new Set([99]);
  let cur = first; // first is on turn after second's miss
  let ri = 0;
  const tracked = (label, p) => p.then(
    v => v,
    e => { console.error('DEBUG await failed at:', label); throw e; }
  );
  while (ri < rem.length) {
    if (cur === first) {
      first.send({ type: 'attack', cell: rem[ri] });
      await tracked('first-shot-' + rem[ri], first.next(m => m.type === 'shot' && m.cell === rem[ri] && 'sunkCells' in m));
      ri++;
    } else {
      let c = 10; // harmless row-1 cells (not on first's fleet at rows 0,2,4,6,8)
      while (secondFired.has(c)) c++;
      second.send({ type: 'attack', cell: c });
      await tracked('second-shot-' + c, second.next(m => m.type === 'shot' && m.cell === c && 'sunkCells' in m));
      secondFired.add(c);
    }
    cur = cur === first ? second : first;
  }
  // The winner broadcast
  const win = await tracked('winner', first.next(m => m.type === 'winner', 8000));
  console.log('PASS winner is first player:', win.name === (first === a ? 'Alice' : 'Bob'));

  // rematch flow
  a.send({ type: 'newRound' });
  const errRem = await a.next(m => m.type === 'error');
  console.log('PASS newRound blocked in battleship too:', errRem.message === 'Waiting for all players to press Ready');
  const secondId = second === a ? aliceId : bobId;
  const firstId = first === a ? aliceId : bobId;
  second.send({ type: 'rematch' });
  await a.next(m => m.type === 'roomState' && m.room.players.some(p => p.id === secondId && p.rematch));
  first.send({ type: 'rematch' });
  await a.next(m => m.type === 'roomState' && m.room.players.every(p => p.rematch));
  a.send({ type: 'newRound' });
  const rsNew = await a.next(m => m.type === 'roomState' && m.room.phase === 'arrange' && m.room.turnId && m.room.players.every(p => !p.ready));
  console.log('PASS battleship fleets reset after newRound:', rsNew.room.players.every(p => !p.ready));

  console.log('ALL BATTLESHIP TESTS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
