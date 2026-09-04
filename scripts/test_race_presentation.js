import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { RaceStartSequence } from '../src/raceStart.js';
import { getCarSprite, drawCarAppearance } from '../src/carAppearance.js';
import { getTrackMaterials } from '../src/trackAppearance.js';
import { createLeaderboardView } from '../src/leaderboardView.js';
import { generateTrackPath } from '../src/track.js';
import { state } from '../src/game.js';
import { F1_TRACKS } from '../src/f1Tracks.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };
test('five red stages are one second apart and release happens only once', () => {
  const s = new RaceStartSequence(); s.begin(0, 1500);
  for (let light = 1; light <= 5; light++) {
    assert.equal(s.update(light * 1000 - 1), false); assert.equal(s.lights, light - 1);
    assert.equal(s.update(light * 1000), false); assert.equal(s.lights, light);
    assert.equal(s.phase, 'countdown');
  }
  assert.equal(s.update(6499), false); assert.equal(s.lights, 5);
  assert.equal(s.update(6500), true); assert.equal(s.lights, 0);
  assert.equal(s.phase, 'racing'); assert.equal(s.releasedAt, 6500);
  assert.equal(s.update(9000), false);
});
test('long frame cannot skip red-light stages', () => {
  const s = new RaceStartSequence(); s.begin(0, 200);
  s.update(100000); assert.equal(s.lights, 1); assert.equal(s.phase, 'countdown');
  s.update(100000); assert.equal(s.lights, 1);
});
test('cancel/reset prevents late release and restart clears lights', () => {
  const s = new RaceStartSequence(); s.begin(0); s.update(1000); s.reset();
  assert.equal(s.update(999999), false); assert.equal(s.phase, 'idle'); assert.equal(s.lights, 0);
  s.begin(10000, 200); assert.equal(s.nextAt, 11000); assert.equal(s.releasedAt, null);
});
test('start hold is bounded and does not consume gameplay RNG', () => {
  const saved = Math.random; Math.random = () => { throw new Error('gameplay RNG consumed'); };
  try {
    const s = new RaceStartSequence(); s.begin(0); assert.ok(s.holdMs >= 200 && s.holdMs <= 3000);
    s.begin(0, -1); assert.equal(s.holdMs, 200); s.begin(0, 9000); assert.equal(s.holdMs, 3000);
  } finally { Math.random = saved; }
});
test('all 24 generated circuits retain the full geometry and speed-profile fingerprint', () => {
  const hash = createHash('sha256'), source = JSON.stringify(F1_TRACKS);
  for (const track of F1_TRACKS) { generateTrackPath(track.id); hash.update(JSON.stringify(state.trackPath)); }
  assert.equal(hash.digest('hex'), '4b37947beec2d0b072dc39122cd9e34bfb7a1430312af06ce44b8343e6b1c8da');
  assert.equal(JSON.stringify(F1_TRACKS), source);
});

const calls = [];
const context = new Proxy({}, {
  get: (_, key) => (...args) => {
    calls.push([key, ...args]);
    if (key === 'createLinearGradient') return { addColorStop() {} };
    if (key === 'createPattern') return { setTransform() {} };
  }, set: () => true
});
let canvases = 0;
class Element {
  children = []; textContent = ''; style = {}; hidden = false; classes = new Set();
  classList = { toggle: (name, active) => active ? this.classes.add(name) : this.classes.delete(name) };
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
}
globalThis.document = { createElement: tag => {
  if (tag === 'canvas') { canvases++; return { getContext: () => context }; }
  return new Element();
} };
globalThis.DOMMatrix = class { scale() { return this; } };
const car = Object.freeze({ x: 3, y: 4, angle: .5, color: '#ff4433', participantId: 'p_19_test', steerAmount: .4, brakePressure: .7, currentSurface: 'TARMAC' });
test('car body is cached per identity, with colour invalidation', () => {
  const count = canvases, sprite = getCarSprite(car);
  assert.equal(getCarSprite(car), sprite); assert.equal(canvases, count + 1);
  const mutable = { ...car }; const first = getCarSprite(mutable); mutable.color = '#3366ff';
  assert.notEqual(getCarSprite(mutable), first);
});
test('body drawing preserves every vehicle field, with live steering/braking', () => {
  const snapshot = JSON.stringify(car); calls.length = 0;
  drawCarAppearance(context, car); assert.equal(JSON.stringify(car), snapshot);
  assert.equal(calls.filter(([name]) => name === 'drawImage').length, 1);
  assert.equal(calls.filter(([name, angle]) => name === 'rotate' && angle === car.steerAmount * .35).length, 2);
  assert.ok(calls.some(([name, x]) => name === 'fillRect' && x === -2.39));
});
test('materials are cached and do not consume simulation RNG', () => {
  const random = Math.random; Math.random = () => { throw new Error('RNG'); };
  try { const first = getTrackMaterials(context); assert.equal(getTrackMaterials(context), first); assert.equal(Object.keys(first).length, 4); }
  finally { Math.random = random; }
});
test('leaderboard reuses nodes across speeds, ranks, and race/ghost modes', () => {
  const root = new Element(), render = createLeaderboardView(root), nodes = [...root.children];
  const player = { name: 'Player P1', rank: 20, x: 0, y: 0, color: 'red', isBot: false, getKmh: () => 123 };
  const cars = [player, ...Array.from({ length: 19 }, (_, i) => ({ name: `Bot ${i}`, rank: i + 1, color: 'blue', x: i, y: 0, isBot: true, getKmh: () => 100 + i }))];
  const game = { cars, gameMode: 'race', selectedTrackData: { location: 'Interlagos' } };
  render(game); assert.equal(root.children[7].children[0].textContent, '20º ▶ P1');
  player.getKmh = () => 145; render(game);
  assert.equal(root.children[7].children[1].textContent, '145 km/h'); assert.deepEqual(root.children, nodes);
  game.gameMode = 'ghost'; render(game); assert.ok(root.children.slice(3).every(row => row.hidden));
  game.gameMode = 'race'; render(game); assert.ok(root.children.slice(3).every(row => !row.hidden));
  assert.deepEqual(root.children, nodes);
});
console.log(`${passed} PASSOU | 0 FALHOU`);
