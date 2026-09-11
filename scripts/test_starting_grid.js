import assert from 'node:assert/strict';
import { getStartingGrid, drawGridSlot, GRID_LAYOUT } from '../src/startingGrid.js';
import { BASELINE_MANIFEST } from '../src/ml/lineage/baselineManifest.js';
import { generateTrackPath } from '../src/track.js';
import { state } from '../src/game.js';
import { Car } from '../src/car.js';
import { F1_TRACKS } from '../src/f1Tracks.js';
import { GEAR_POWER, GEAR_SPEEDS, GT3_TOP_SPEED } from '../src/constants.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
test('original power and lower gears retained with sixth gear extended for 320 km/h', () => {
  assert.ok(Math.abs(GT3_TOP_SPEED - 1.35 * 320 / 285) < 1e-9);
  assert.deepEqual(GEAR_SPEEDS, [0, .25, .46, .68, .90, 1.13, 1.72]);
  assert.deepEqual(GEAR_POWER, [0, .028, .024, .021, .018, .016, .014]);
  assert.deepEqual(BASELINE_MANIFEST.startingGrid, GRID_LAYOUT);
});
test('distance follows real segment length, with alternating lanes and elevation', () => {
  const path = [{ x: 0, y: 0, z: 20 }, { x: 200, y: 200, z: 0 }, { x: -200, y: 0, z: 0 }];
  const grid = getStartingGrid(path);
  grid.forEach((slot, i) => {
    assert.ok(Math.abs(slot.x + 6 + i * 8) < 1e-12);
    assert.equal(slot.y, i % 2 === 0 ? -4.5 : 4.5);
    assert.equal(slot.angle, 0);
    assert.ok(Math.abs(slot.z - (20 - (6 + i * 8) / 10)) < 1e-12);
    assert.equal(slot.pathIndex, 2);
  });
  assert.equal(getStartingGrid(path), grid);
  assert.notEqual(getStartingGrid(path, 12), grid);
});
test('all 24 circuits: 20 cars on painted slots, inside asphalt, no overlaps or geometry mutation', () => {
  for (const track of F1_TRACKS) {
    generateTrackPath(track.id);
    const before = JSON.stringify(state.trackPath);
    const width = state.selectedTrackData.trackWidth || 24;
    const slots = getStartingGrid(state.trackPath, width);
    const cars = slots.map((slot, i) => {
      const car = new Car('#ff0000', `Fixture ${i}`, false, i);
      for (const key of ['x', 'y', 'z', 'angle', 'pathIndex']) assert.equal(car[key], slot[key]);
      assert.ok(car.getTrackDistanceAndSegment().lateralDist + 1.9 < width / 2, `outside track ${track.id}, slot ${i}`);
      assert.equal(car.currentLap, 1); assert.equal(car.nextCheckpoint, 1);
      assert.equal(car.vx, 0); assert.equal(car.vy, 0);
      return car;
    });
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      assert.ok(Math.hypot(cars[i].x - cars[j].x, cars[i].y - cars[j].y) > 6.5, `overlap track ${track.id}`);
    }
    assert.equal(JSON.stringify(state.trackPath), before);
  }
});
test('slot painter uses shared pose and keeps its number visible ahead of bodywork', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]), set: () => true });
  const slot = getStartingGrid(state.trackPath, state.selectedTrackData.trackWidth || 24)[19];
  drawGridSlot(ctx, slot);
  assert.ok(calls.some(c => c[0] === 'translate' && c[1] === slot.x && c[2] === slot.y));
  assert.ok(calls.some(c => c[0] === 'rotate' && c[1] === slot.angle));
  assert.ok(calls.some(c => c[0] === 'fillText' && c[1] === '20' && c[2] > 3.2));
});
console.log(`${passed} PASSOU | 0 FALHOU`);
