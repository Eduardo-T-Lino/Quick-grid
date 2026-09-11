import assert from 'node:assert/strict';
import { wakeInfluence, updateAerodynamicWake, aerodynamicFactors, WAKE_TUNING } from '../src/aerodynamics.js';
import { readFileSync } from 'node:fs';
const car = (x, y = 0, overrides = {}) => ({ x, y, z: 0, angle: 0, vx: 1, vy: 0, finished: false, wakeIntensity: 0, ...overrides });
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
test('aligned following car receives wake, leader does not', () => {
  const a = car(0), b = car(15); assert.ok(wakeInfluence(a, b) > 0); assert.equal(wakeInfluence(b, a), 0);
});
test('no wake for parked, opposite, adjacent, distant, finished or elevated cars', () => {
  const a = car(0);
  for (const b of [car(15, 0, { vx: 0 }), car(15, 0, { angle: Math.PI, vx: -1 }), car(15, 10), car(100), car(15, 0, { finished: true }), car(15, 0, { z: 10 })]) assert.equal(wakeInfluence(a, b), 0);
  assert.equal(wakeInfluence(a, a), 0); assert.equal(wakeInfluence(a, car(1)), 0);
});
test('wake decreases with gap and lateral offset', () => {
  const a = car(0); assert.ok(wakeInfluence(a, car(10)) > wakeInfluence(a, car(40)));
  assert.ok(wakeInfluence(a, car(10)) > wakeInfluence(a, car(10, 2)));
});
test('multiple leaders do not stack an unlimited benefit', () => {
  const a = car(0), b = car(0); updateAerodynamicWake([a, car(10)]); updateAerodynamicWake([b, car(10), car(10)]);
  assert.equal(a.wakeIntensity, b.wakeIntensity);
});
test('wake is independent of grid array order and does not alter positions', () => {
  const a = [car(0), car(12), car(25)], b = a.map(c => ({ ...c })).reverse();
  updateAerodynamicWake(a); updateAerodynamicWake(b);
  assert.deepEqual(a.map(c => c.wakeIntensity), b.reverse().map(c => c.wakeIntensity));
  assert.deepEqual(a.map(c => c.x), [0, 12, 25]);
});
test('entry and exit are gradual; downforce and drag losses remain bounded', () => {
  const a = car(0), leader = car(10); updateAerodynamicWake([a, leader]); const first = a.wakeIntensity;
  assert.ok(first > 0 && first < wakeInfluence(a, leader));
  updateAerodynamicWake([a]); assert.ok(a.wakeIntensity > 0 && a.wakeIntensity < first);
  for (const intensity of [-1, 0, 0.5, 1, 10, NaN]) {
    const result = aerodynamicFactors(intensity);
    assert.ok(result.drag >= 1 - WAKE_TUNING.dragLoss && result.drag <= 1);
    assert.ok(result.downforce >= 1 - WAKE_TUNING.downforceLoss && result.downforce <= 1);
  }
});
test('runtime uses the wake before physics and reduces actual aero/drag', () => {
  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  assert.ok(game.indexOf('updateAerodynamicWake(state.cars)') < game.indexOf('state.cars.forEach(car => car.update())'));
  const source = readFileSync(new URL('../src/car.js', import.meta.url), 'utf8');
  assert.ok(source.includes('RESISTENCIA_AR * (1 - wake * WAKE_TUNING.dragLoss)'));
  assert.ok(source.includes('(1 - wake * WAKE_TUNING.downforceLoss)'));
});
console.log(`${passed} wake checks passed`);
