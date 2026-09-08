import assert from 'node:assert/strict';
import { Car } from '../src/car.js';
import { state } from '../src/game.js';
import { generateTrackPath } from '../src/track.js';
import { F1_TRACKS } from '../src/f1Tracks.js';

// Reference search retains the previous per-candidate Euclidean distance operation.
function reference(car) {
  const points = state.trackPath, n = points.length;
  let distance = Infinity, closest = car.pathIndex, segment = car.pathIndex, fraction = 0;
  for (let offset = -45; offset <= 45; offset++) {
    const index = (car.pathIndex + offset + n) % n, next = (index + 1) % n;
    const a = points[index], b = points[next], dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    if (!length) continue;
    const t = Math.max(0, Math.min(1, ((car.x - a.x) * dx + (car.y - a.y) * dy) / length));
    const candidate = Math.hypot(car.x - a.x - t * dx, car.y - a.y - t * dy);
    if (candidate < distance) { distance = candidate; segment = index; closest = t > .5 ? next : index; fraction = t; }
  }
  return { lateralDist: distance, closestIdx: closest, segmentIdx: segment, segmentT: fraction };
}
const query = car => Car.prototype.getTrackDistanceAndSegment.call(car);
let checked = 0;
for (const track of F1_TRACKS) {
  generateTrackPath(track.id);
  for (let i = 0; i < 200; i++) {
    const index = Math.floor(i * state.trackPath.length / 200), point = state.trackPath[index];
    const car = { x: point.x + point.normalX * ((i % 17) - 8) * 3.27 + .123,
      y: point.y + point.normalY * ((i % 17) - 8) * 3.27 + .456, pathIndex: index };
    const old = reference(car), current = query(car);
    assert.ok(Math.abs(old.lateralDist - current.lateralDist) < 1e-9);
    assert.equal(current.closestIdx, old.closestIdx); assert.equal(current.segmentIdx, old.segmentIdx);
    assert.ok(Math.abs(current.segmentT - old.segmentT) < 1e-12); checked++;
  }
}
console.log(`PASS ${checked} distance queries across all 24 tracks match the reference`);
generateTrackPath(21);
const cars = state.trackPath.filter((_, i) => i % 40 === 0).map((point, i) => ({ x: point.x + 1.23, y: point.y - 3.45, pathIndex: i * 40 }));
let sink = 0;
function bench(fn) {
  const start = performance.now();
  for (let i = 0; i < 20000; i++) sink += fn(cars[i % cars.length]).lateralDist;
  return performance.now() - start;
}
bench(reference); bench(query);
const before = [], after = [];
for (let i = 0; i < 7; i++) {
  if (i % 2) { after.push(bench(query)); before.push(bench(reference)); }
  else { before.push(bench(reference)); after.push(bench(query)); }
}
const median = list => list.sort((a, b) => a - b)[3];
console.log(JSON.stringify({ queriesPerRound: 20000, beforeMedianMs: median(before), afterMedianMs: median(after), sinkFinite: Number.isFinite(sink) }));
