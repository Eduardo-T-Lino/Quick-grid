import assert from 'node:assert/strict';
import { getVisibleTrackRenderPaths } from '../src/renderGeometry.js';
import { TrackTileCache, TRACK_TILE_SIZE, TRACK_TILE_SCALE, TRACK_TILE_GUTTER, TRACK_TILE_LIMIT } from '../src/trackTileCache.js';
import { readFileSync } from 'node:fs';

let passed = 0;
const test = (label, fn) => { fn(); passed++; console.log(`PASS ${label}`); };
globalThis.Path2D = class {
  commands = [];
  moveTo(...args) { this.commands.push(['M', ...args]); }
  lineTo(...args) { this.commands.push(['L', ...args]); }
  closePath() { this.commands.push(['Z']); }
};
const ring = Object.freeze(Array.from({ length: 256 }, (_, i) => {
  const a = i / 256 * Math.PI * 2;
  return Object.freeze({ x: 1000 * Math.cos(a), y: 1000 * Math.sin(a), normalX: -Math.cos(a), normalY: -Math.sin(a) });
}));
const bounds = Object.freeze({ minX: 900, maxX: 1100, minY: -50, maxY: 50 });
test('visible paths reuse unchanged chunks and retain original offset samples', () => {
  const before = JSON.stringify(ring);
  const paths = getVisibleTrackRenderPaths(ring, 12, 23.5, bounds);
  assert.equal(getVisibleTrackRenderPaths(ring, 12, 23.5, { ...bounds, minX: 901 }), paths);
  assert.ok(paths.center.commands.length < ring.length / 2);
  for (const [name, offset] of [['center', 0], ['left', 12], ['right', -12], ['barrierLeft', 23.5], ['barrierRight', -23.5]]) {
    for (const [, x, y] of paths[name].commands) assert.ok(ring.some(p => x === p.x + p.normalX * offset && y === p.y + p.normalY * offset));
  }
  assert.equal(JSON.stringify(ring), before);
});
test('visible start/finish run joins last segment to first without a cap or gap', () => {
  const commands = getVisibleTrackRenderPaths(ring, 12, 23.5, bounds).center.commands;
  assert.equal(commands.filter(([op]) => op === 'M').length, 1);
  const last = commands.findIndex(([, x, y]) => x === ring[255].x && y === ring[255].y);
  assert.deepEqual(commands[last + 1], ['L', ring[0].x, ring[0].y]);
  assert.deepEqual(commands[last + 2], ['L', ring[1].x, ring[1].y]);
});
test('crossing segments are retained even with both endpoints off screen', () => {
  const points = Array.from({ length: 96 }, (_, i) => ({ x: i === 0 ? -1000 : i === 1 ? 1000 : 3000, y: 0, normalX: 0, normalY: 1 }));
  const paths = getVisibleTrackRenderPaths(points, 12, 23.5, { minX: -1, maxX: 1, minY: -1, maxY: 1 });
  const crossing = paths.center.commands.findIndex(([, x]) => x === -1000);
  assert.deepEqual(paths.center.commands[crossing + 1], ['L', 1000, 0]);
});
test('culling invalidates for camera region, dimensions and replacement geometry', () => {
  const paths = getVisibleTrackRenderPaths(ring, 12, 23.5, bounds);
  assert.notEqual(getVisibleTrackRenderPaths(ring, 12, 23.5, { minX: -1100, maxX: -900, minY: -50, maxY: 50 }), paths);
  assert.notEqual(getVisibleTrackRenderPaths(ring, 10, 23.5, bounds), paths);
  assert.notEqual(getVisibleTrackRenderPaths([...ring], 12, 23.5, bounds), paths);
});
test('offscreen and empty tracks produce empty paths; full view stays closed', () => {
  assert.equal(getVisibleTrackRenderPaths(ring, 12, 23.5, { minX: 5000, maxX: 6000, minY: 5000, maxY: 6000 }).center.commands.length, 0);
  assert.equal(getVisibleTrackRenderPaths([], 12, 23.5, bounds).center.commands.length, 0);
  assert.deepEqual(getVisibleTrackRenderPaths(ring, 12, 23.5, { minX: -2000, maxX: 2000, minY: -2000, maxY: 2000 }).center.commands.at(-1), ['Z']);
});

function harness() {
  const paints = [], draws = [], transforms = [], allocations = [], stateCalls = [];
  const cache = new TrackTileCache(() => {
    const canvas = { width: 0, height: 0, getContext: (_, options) => {
      assert.equal(options.alpha, false);
      return { setTransform: (...args) => transforms.push(args),
        save: () => stateCalls.push('save'), restore: () => stateCalls.push('restore') };
    } };
    allocations.push(canvas); return canvas;
  });
  const context = { drawImage: (...args) => draws.push(args) };
  const paint = (_, b) => paints.push(b);
  cache.reset(ring, 'dry');
  return { cache, context, paint, paints, draws, transforms, allocations, stateCalls };
}
const oneTile = Object.freeze({ minX: 1, maxX: 63, minY: 1, maxY: 63 });
test('tiles are sharp, opaque and world aligned with overlapping gutters', () => {
  const h = harness(); h.cache.draw(h.context, oneTile, h.paint);
  const [canvas, x, y, width, height] = h.draws[0];
  assert.ok(TRACK_TILE_SCALE >= 9.2);
  assert.equal(canvas.width, TRACK_TILE_SIZE * TRACK_TILE_SCALE + TRACK_TILE_GUTTER * 2);
  assert.equal(x, -.2); assert.equal(y, -.2); assert.equal(width, 64.4); assert.equal(height, 64.4);
  assert.deepEqual(h.transforms[0], [10, 0, 0, 10, 2, 2]);
  assert.deepEqual(h.paints[0], { minX: -.2, minY: -.2, maxX: 64.2, maxY: 64.2 });
});
test('stationary frames reuse pixels and prepare at most one adjacent tile per frame', () => {
  const h = harness();
  for (let frame = 0; frame < 12; frame++) {
    const before = h.cache.builds; h.cache.draw(h.context, oneTile, h.paint);
    assert.ok(h.cache.builds - before <= (frame === 0 ? 2 : 1));
  }
  assert.equal(h.cache.builds, 9); assert.equal(h.draws.length, 12);
});
test('negative world coordinates use floor, not truncation', () => {
  const h = harness(); h.cache.draw(h.context, { minX: -63, maxX: -1, minY: -63, maxY: -1 }, h.paint);
  assert.equal(h.draws[0][1], -64.2); assert.equal(h.draws[0][2], -64.2);
});
test('moving viewport retains visible tiles under a full memory budget', () => {
  const h = harness();
  h.cache.draw(h.context, { minX: 0, maxX: 511, minY: 0, maxY: 511 }, h.paint);
  assert.equal(h.cache.tiles.size, TRACK_TILE_LIMIT);
  const before = h.cache.builds;
  h.cache.draw(h.context, { minX: -64, maxX: 447, minY: 0, maxY: 511 }, h.paint);
  assert.equal(h.cache.builds - before, 8);
  assert.equal(h.cache.tiles.size, TRACK_TILE_LIMIT);
});
test('cache stays bounded across long travel and falls back for enormous viewports', () => {
  const h = harness();
  for (let i = 0; i < 200; i++) h.cache.draw(h.context, { minX: i * 128, maxX: i * 128 + 300, minY: -20, maxY: 180 }, h.paint);
  assert.ok(h.cache.tiles.size <= TRACK_TILE_LIMIT);
  const builds = h.cache.builds, paints = h.paints.length, draws = h.draws.length;
  const huge = { minX: 0, maxX: 10000, minY: 0, maxY: 10000 };
  h.cache.draw(h.context, huge, h.paint);
  assert.equal(h.cache.builds, builds); assert.equal(h.paints.length, paints + 1);
  assert.equal(h.draws.length, draws); assert.equal(h.paints.at(-1), huge);
});
test('long travel recycles at most 64 surfaces without resizing them', () => {
  const h = harness();
  for (let i = 0; i < 200; i++) h.cache.draw(h.context, { minX: i * 128, maxX: i * 128 + 300, minY: -20, maxY: 180 }, h.paint);
  assert.ok(h.cache.builds > 1000);
  assert.equal(h.allocations.length, TRACK_TILE_LIMIT);
  assert.ok(h.allocations.every(c => c.width === 644 && c.height === 644));
  assert.equal(new Set([...h.cache.tiles.values()].map(t => t.canvas)).size, TRACK_TILE_LIMIT);
});
test('recycling does not repaint any retained visible tile', () => {
  const h = harness();
  h.cache.draw(h.context, { minX: 0, maxX: 511, minY: 0, maxY: 511 }, h.paint);
  const retained = new Map([...h.cache.tiles].filter(([key]) => Number(key.split(',')[0]) < 7)
    .map(([key, tile]) => [key, { canvas: tile.canvas, bounds: { ...tile.bounds } }]));
  h.cache.draw(h.context, { minX: -64, maxX: 447, minY: 0, maxY: 511 }, h.paint);
  for (const [key, old] of retained) {
    assert.equal(h.cache.tiles.get(key).canvas, old.canvas);
    assert.deepEqual(h.cache.tiles.get(key).bounds, old.bounds);
  }
  assert.equal(h.allocations.length, TRACK_TILE_LIMIT);
});
test('repaint state is isolated and restored even when a painter fails', () => {
  const h = harness(); h.cache.getTile(0, 0, h.paint);
  assert.deepEqual(h.stateCalls, ['save', 'restore']);
  assert.throws(() => h.cache.getTile(1, 0, () => { throw Error('paint failed'); }), /paint failed/);
  assert.deepEqual(h.stateCalls, ['save', 'restore', 'save', 'restore']);
  assert.ok(!h.cache.tiles.has('1,0'));
});
test('new track or weather invalidates tiles; same identity retains them', () => {
  const h = harness(); h.cache.draw(h.context, oneTile, h.paint);
  const canvas = h.draws[0][0]; h.cache.reset(ring, 'dry'); assert.ok(h.cache.tiles.size > 0);
  h.cache.reset(ring, 'wet'); assert.equal(h.cache.tiles.size, 0); assert.equal(canvas.width, 0);
  h.cache.draw(h.context, oneTile, h.paint); h.cache.reset([...ring], 'wet'); assert.equal(h.cache.tiles.size, 0);
});
test('render cache never consumes gameplay randomness or mutates view bounds', () => {
  const saved = Math.random; Math.random = () => { throw new Error('gameplay RNG consumed'); };
  try { const h = harness(); h.cache.draw(h.context, oneTile, h.paint); }
  finally { Math.random = saved; }
});
test('RPM uses transform instead of width transitions; HUD skips repeated text writes', () => {
  const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /transition:\s*width/); assert.match(css, /transform-origin: left/);
  assert.doesNotMatch(ui, /\.innerText\s*=|\.style\.width\s*=/);
  assert.match(ui, /element\.textContent !== text/); assert.match(ui, /scaleX/);
});
console.log(`${passed} PASSOU | 0 FALHOU`);
