import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { RoomHub } from '../server/src/online/rooms.js';
import { attachOnline } from '../server/src/online/socket.js';
import { ONLINE_VERSION, INPUT_KEYS, ONLINE_LIMITS } from '../src/online/protocol.js';
import { OnlineSimulation } from '../server/src/online/simulation.js';
import { state } from '../src/game.js';
import { SnapshotBuffer } from '../src/online/snapshotBuffer.js';

let passed = 0;
const test = async (label, fn) => { await fn(); passed++; console.log(`PASS ${label}`); };
const posePacket = (time, extra = {}) => ({ serverTime: time, phase: 'racing', cars: [{ id: 'car', x: time / (1000 / 60), y: 0, angle: 0, vx: 1, vy: 0, yawRate: 0, ...extra }] });
await test('timestamped rendering remains continuous with 35–80ms arrival jitter and does not mutate server positions', () => {
  const buffer = new SnapshotBuffer(), car = { id: 'car', x: -999 }, positions = [];
  const arrivals = Array.from({ length: 30 }, (_, i) => ({ packet: posePacket(i * 50), arrival: i * 50 + [10, 35, 15, 40][i % 4] }));
  for (let now = 0; now < 1400; now += 1000 / 60) {
    while (arrivals[0]?.arrival <= now) { const event = arrivals.shift(); buffer.push(event.packet, event.arrival); }
    const pose = buffer.sample(car, now); if (now >= 200) positions.push(pose.x);
  }
  for (let i = 1; i < positions.length; i++) assert.ok(Math.abs(positions[i] - positions[i - 1] - 1) < 1e-8);
  assert.equal(car.x, -999); assert.equal(buffer.extrapolatedFrames, 0);
});
await test('snapshot storage is bounded and duplicate/out-of-order packets cannot rewind presentation', () => {
  const buffer = new SnapshotBuffer(); for (let t = 0; t < 5000; t += 50) buffer.push(posePacket(t), t + 20);
  assert.equal(buffer.frames.length, 32); assert.equal(buffer.push(posePacket(200), 5100), false);
  assert.equal(buffer.push(posePacket(NaN), 5100), false);
  const latest = buffer.sample({ id: 'car' }, 5100).x;
  assert.ok(buffer.sample({ id: 'car' }, 5090).x >= latest);
});
await test('brief underruns extrapolate for at most 80ms and reconnect clears stale history', () => {
  const buffer = new SnapshotBuffer(); buffer.push(posePacket(0), 20); buffer.push(posePacket(50), 70);
  assert.ok(buffer.sample({ id: 'car' }, 190).x > 3);
  const stopped = buffer.sample({ id: 'car' }, 1000).x;
  assert.equal(buffer.sample({ id: 'car' }, 5000).x, stopped); assert.ok(stopped <= 7.81);
  buffer.reset(); const car = { id: 'car', x: 9 }; assert.equal(buffer.sample(car, 6000), car);
});
await test('countdown/finished/retired cars never extrapolate and angles cross the short arc', () => {
  const buffer = new SnapshotBuffer();
  buffer.push(posePacket(0, { angle: Math.PI - .1 }), 0); buffer.push(posePacket(50, { angle: -Math.PI + .1 }), 50);
  assert.ok(Math.abs(buffer.sample({ id: 'car' }, 125).angle - Math.PI) < 1e-8);
  for (const extra of [{ finished: true }, { retired: true }, {}]) {
    buffer.reset(); const packet = posePacket(0, extra); if (!Object.keys(extra).length) packet.phase = 'countdown';
    buffer.push(packet, 0); assert.equal(buffer.sample({ id: 'car' }, 1000).x, 0);
  }
});
await test('teleports snap without sweeping across the track and missing cars use authoritative fallback', () => {
  const buffer = new SnapshotBuffer(); buffer.push(posePacket(0), 0); buffer.push(posePacket(50, { x: 1000 }), 50);
  assert.equal(buffer.sample({ id: 'car' }, 125).x, 1000);
  const car = { id: 'unknown', x: 10 }; assert.equal(buffer.sample(car, 125), car);
});
let now = 0;
const fixtures = () => {
  now = 0;
  const h = new RoomHub({ clock: () => now, pick: () => 0 });
  const settings = { laps: 3, rounds: 3, weather: 'dry', trackId: 21 };
  const a = h.attach(() => {}, { type: 'create', version: ONLINE_VERSION, name: 'Piloto A', auto: true, settings });
  const b = h.attach(() => {}, { type: 'join', version: ONLINE_VERSION, name: 'Piloto B', auto: false, code: a.room.code });
  return { h, a, b, room: a.room };
};
const readyStart = ({ h, a, b }) => { h.command(a, { type: 'ready', ready: true }); h.command(b, { type: 'ready', ready: true }); h.command(a, { type: 'start' }); };
await test('rooms accept guests, generate private codes, and never expose resume tokens to other players', () => {
  const { h, a, room } = fixtures();
  assert.match(room.code, /^[A-F0-9]{6}$/);
  assert.equal(room.players.length, 2);
  assert.ok(!JSON.stringify(h.publicRoom(room)).includes(a.token));
});
await test('bad versions, forged names, limits, unknown rooms and non-host starts are rejected', () => {
  const f = fixtures();
  assert.throws(() => f.h.attach(() => {}, { type: 'join', version: 'old' }), /VERSION_MISMATCH/);
  assert.throws(() => f.h.attach(() => {}, { type: 'join', version: ONLINE_VERSION, name: '<script>', auto: true }), /INVALID_REQUEST/);
  assert.throws(() => f.h.attach(() => {}, { type: 'join', version: ONLINE_VERSION, name: 'Guest', auto: true, code: 'XXXXXX' }), /INVALID_CODE/);
  assert.throws(() => f.h.command(f.b, { type: 'start' }), /HOST_ONLY/);
  assert.throws(() => f.h.command(f.a, { type: 'start' }), /NOT_READY/);
  for (const rounds of [0, 13, 1.5]) assert.throws(() => f.h.attach(() => {}, { type: 'create', version: ONLINE_VERSION,
    name: 'Guest', auto: true, settings: { ...f.room.settings, rounds } }), /INVALID_SETTINGS/);
});
await test('eight-player cap and room isolation are enforced', () => {
  const { h, room } = fixtures();
  for (let i = 2; i < 8; i++) h.attach(() => {}, { type: 'join', version: ONLINE_VERSION, name: `Guest ${i}`, auto: true, code: room.code });
  assert.throws(() => h.attach(() => {}, { type: 'join', version: ONLINE_VERSION, name: 'Guest 9', auto: true, code: room.code }), /ROOM_FULL/);
  const other = h.attach(() => {}, { type: 'create', version: ONLINE_VERSION, name: 'Other', auto: true, settings: room.settings });
  assert.notEqual(other.room.code, room.code); assert.equal(other.room.players.length, 1);
});
await test('tournament offers exactly three unique tracks; one vote per member may be changed', () => {
  const f = fixtures(); readyStart(f);
  assert.equal(f.room.phase, 'voting'); assert.equal(new Set(f.room.candidates).size, 3);
  f.h.command(f.a, { type: 'vote', trackId: f.room.candidates[0] });
  f.h.command(f.a, { type: 'vote', trackId: f.room.candidates[1] });
  assert.equal(Object.keys(f.room.votes).length, 1);
  assert.throws(() => f.h.command(f.b, { type: 'vote', trackId: -1 }), /INVALID_VOTE/);
  f.h.command(f.b, { type: 'vote', trackId: f.room.candidates[1] });
  assert.equal(f.room.phase, 'loading'); assert.equal(f.room.trackId, f.room.candidates[1]);
});
await test('voting timeout/ties are server-resolved and future candidates exclude completed tracks', () => {
  const f = fixtures(); readyStart(f); now += ONLINE_LIMITS.voteMs + 1; f.h.tick();
  assert.equal(f.room.phase, 'loading'); assert.equal(f.room.trackId, f.room.candidates[0]);
  const prior = f.room.trackId;
  f.room.phase = 'results'; f.h.command(f.a, { type: 'start' });
  assert.equal(f.room.round, 2); assert.ok(!f.room.candidates.includes(prior));
});
await test('single race skips voting, waits for loaded clients, then releases the grid together', () => {
  const f = fixtures(); f.room.settings.rounds = 1; readyStart(f);
  assert.equal(f.room.phase, 'loading');
  const before = f.room.sim.snapshot(); now += 1000; f.h.tick(); assert.deepEqual(f.room.sim.snapshot(), before);
  for (const p of [f.a, f.b]) f.h.command(p, { type: 'loaded', raceId: f.room.raceId });
  f.h.tick(); assert.equal(f.room.phase, 'countdown');
  now += 5999; f.h.tick(); assert.equal(f.room.phase, 'countdown');
  now++; f.h.tick(); assert.equal(f.room.phase, 'racing');
});
await test('server accepts only control keys, monotonic sequence and bounded gear commands', () => {
  const { h, a } = fixtures(), keys = Object.fromEntries(INPUT_KEYS.map(k => [k, false]));
  h.command(a, { type: 'input', seq: 1, keys, shift: 0, x: 1e9, currentLap: 80 });
  assert.equal(a.x, undefined); assert.equal(a.currentLap, undefined);
  assert.throws(() => h.command(a, { type: 'input', seq: 1, keys, shift: 0 }), /INVALID_INPUT/);
  assert.throws(() => h.command(a, { type: 'input', seq: 2, keys: { ...keys, KeyW: 1 }, shift: 0 }), /INVALID_INPUT/);
});
await test('disconnect transfers host, neutralizes controls, and permits bounded reconnection', () => {
  const { h, a, b, room } = fixtures(); h.disconnect(a); assert.equal(room.host, b.id);
  assert.deepEqual(a.keys, {});
  now += 100; assert.equal(h.attach(() => {}, { type: 'resume', version: ONLINE_VERSION, token: a.token }), a);
  h.disconnect(a); now += ONLINE_LIMITS.reconnectMs + 1; h.tick();
  assert.throws(() => h.attach(() => {}, { type: 'resume', version: ONLINE_VERSION, token: a.token }), /SESSION_EXPIRED/);
});
await test('results award points only to finishers and accumulate across stages', () => {
  const f = fixtures(); readyStart(f); now += ONLINE_LIMITS.voteMs + 1; f.h.tick();
  f.room.sim.results = () => [{ id: f.a.id, name: f.a.name, rank: 1, finished: true, time: 100 }, { id: f.b.id, name: f.b.name, rank: 2, finished: false, time: null }];
  f.h.finish(f.room); assert.equal(f.a.points, 25); assert.equal(f.b.points, 0); assert.equal(f.room.complete, false);
  f.h.finish(f.room); assert.equal(f.a.points, 25, 'Repeated completion cannot duplicate points');
  f.room.round = 3; f.room.phase = 'racing'; f.h.finish(f.room); assert.equal(f.a.points, 50); assert.equal(f.room.complete, true);
  assert.throws(() => f.h.command(f.a, { type: 'start' }), /INVALID_PHASE/);
});
await test('real physics uses isolated room state; server alone advances cars and boost', () => {
  const original = { ...state };
  const players = [{ id: 'a', name: 'Driver', color: '#ff3333', auto: true, connected: true,
    keys: { KeyW: true, Space: true }, inputAt: performance.now() }];
  const sim = new OnlineSimulation(21, 3, 'dry', players), other = new OnlineSimulation(4, 5, 'wet', players);
  const before = sim.snapshot()[0], untouched = other.snapshot(); sim.start(performance.now());
  for (let i = 0; i < 60; i++) sim.tick(players, performance.now());
  const after = sim.snapshot()[0]; assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 1);
  assert.ok(after.boostCharge < 1); assert.deepEqual(other.snapshot(), untouched);
  for (const key of Object.keys(original)) assert.equal(state[key], original[key], key);
});
await test('two-stage tournament completes server checkpoints, scores stages and closes on final standings', () => {
  const f = fixtures(); f.room.settings.rounds = 2; readyStart(f);
  for (let stage = 1; stage <= 2; stage++) {
    assert.equal(f.room.phase, 'voting');
    const choice = f.room.candidates[0];
    f.h.command(f.a, { type: 'vote', trackId: choice }); f.h.command(f.b, { type: 'vote', trackId: choice });
    for (const p of [f.a, f.b]) f.h.command(p, { type: 'loaded', raceId: f.room.raceId });
    f.h.tick(); now += 6000; f.h.tick();
    // Server-owned checkpoint fixture: clients cannot submit these positions.
    // Uses the real checkpoint/finish implementation, not a fabricated results response.
    f.room.sim.withContext(() => {
      for (const car of state.cars) {
        for (let n = 0; n < 16 * 3; n++) {
          const cp = state.trackPath[(car.nextCheckpoint * Math.floor(state.trackPath.length / 16)) % state.trackPath.length];
          car.x = cp.x; car.y = cp.y; car.updateCheckpoints();
        }
        assert.equal(car.finished, true);
      }
    });
    now += 20; f.h.tick(); assert.equal(f.room.phase, 'results');
    assert.equal(f.a.points, stage * 25); assert.equal(f.b.points, stage * 18);
    if (stage === 1) { assert.equal(f.room.complete, false); f.h.command(f.a, { type: 'start' }); assert.ok(!f.room.candidates.includes(choice)); }
  }
  assert.equal(f.room.complete, true); assert.equal(f.room.results.length, 2);
});
await test('idle/abandoned rooms are removed and expired drivers cannot return into a new stage', () => {
  const f = fixtures(); f.h.leave(f.a); f.h.leave(f.b); assert.equal(f.h.rooms.size, 0);
  const next = fixtures(); readyStart(next); now += ONLINE_LIMITS.voteMs + 1; next.h.tick();
  next.h.disconnect(next.b); now += ONLINE_LIMITS.reconnectMs + 1; next.h.tick();
  assert.equal(next.room.sim.context.cars.find(c => c.id === next.b.id).retired, true);
});

await test('real WebSocket path handles two guests, ready/start/voting and rejects foreign origins', async () => {
  const server = createServer((req, res) => { res.end('test'); });
  const online = attachOnline(server); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, sockets = [];
  const connect = async () => {
    const ws = new WebSocket(origin.replace('http:', 'ws:') + '/online', { origin }); sockets.push(ws);
    ws.messages = []; ws.on('message', data => ws.messages.push(JSON.parse(data))); await new Promise(resolve => ws.once('open', resolve)); return ws;
  };
  const wait = async (ws, fn) => { const end = Date.now() + 3000; while (!ws.messages.some(fn)) { if (Date.now() > end) throw Error('WS timeout'); await new Promise(r => setTimeout(r, 10)); } return ws.messages.find(fn); };
  try {
    const a = await connect(); a.send(JSON.stringify({ type: 'create', version: ONLINE_VERSION, name: 'Guest A', auto: true, settings: { laps: 3, rounds: 2, weather: 'dry', trackId: 21 } }));
    const welcome = await wait(a, m => m.type === 'welcome');
    const b = await connect(); b.send(JSON.stringify({ type: 'join', version: ONLINE_VERSION, name: 'Guest B', auto: true, code: welcome.room.code }));
    await wait(b, m => m.type === 'welcome');
    for (const ws of [a, b]) ws.send(JSON.stringify({ type: 'ready', ready: true }));
    await wait(a, m => m.room?.players.length === 2 && m.room.players.every(p => p.ready));
    a.send(JSON.stringify({ type: 'start' })); await wait(b, m => m.room?.phase === 'voting');
    const bad = new WebSocket(origin.replace('http:', 'ws:') + '/online', { origin: 'https://foreign.invalid' });
    await new Promise(resolve => bad.once('error', resolve));
  } finally { for (const ws of sockets) ws.terminate(); online.close(); await new Promise(resolve => server.close(resolve)); }
});
console.log(`${passed} PASSOU | 0 FALHOU`);
