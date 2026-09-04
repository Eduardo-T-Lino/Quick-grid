import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { F1_TRACKS } from '../src/f1Tracks.js';
import { filterTracks, trackDisplayName } from '../src/trackPicker.js';
import { getTrackRenderPaths, getRenderBounds, withinRenderBounds } from '../src/renderGeometry.js';
import { getMinimapGeometry, drawMinimap } from '../src/minimap.js';
import { Camera } from '../src/camera.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };
globalThis.Path2D = class {
  commands = [];
  moveTo(...args) { this.commands.push(['M', ...args]); }
  lineTo(...args) { this.commands.push(['L', ...args]); }
  closePath() { this.commands.push(['Z']); }
};

test('all 24 tracks remain available, Interlagos first', () => {
  const tracks = filterTracks(F1_TRACKS);
  assert.equal(tracks.length, 24);
  assert.equal(tracks[0].id, 21);
  assert.equal(new Set(tracks.map(t => t.id)).size, 24);
});
test('search supports accents, case, city and country', () => {
  assert.equal(filterTracks(F1_TRACKS, ' SAO PAULO ')[0].id, 21);
  assert.equal(filterTracks(F1_TRACKS, 'belgica')[0].id, 14);
  assert.equal(filterTracks(F1_TRACKS, 'MÉXICO')[0].id, 20);
  assert.equal(filterTracks(F1_TRACKS, 'monza italia')[0].id, 16);
});
test('short and official names both searchable', () => {
  assert.equal(filterTracks(F1_TRACKS, 'Interlagos')[0].id, 21);
  assert.equal(filterTracks(F1_TRACKS, F1_TRACKS.find(t => t.id === 21).name)[0].id, 21);
  assert.equal(trackDisplayName(F1_TRACKS.find(t => t.id === 4)), 'Suzuka');
});
test('featured filter and empty results', () => {
  assert.equal(filterTracks(F1_TRACKS, '', true).length, 8);
  assert.equal(filterTracks(F1_TRACKS, 'Interlagos', true).length, 1);
  assert.equal(filterTracks(F1_TRACKS, 'xyzno-track').length, 0);
});
test('search does not mutate source data/order', () => {
  const before = JSON.stringify(F1_TRACKS);
  filterTracks(F1_TRACKS, 'a', true);
  assert.equal(JSON.stringify(F1_TRACKS), before);
});

const points = Object.freeze([
  Object.freeze({ x: 0, y: 0, normalX: 0, normalY: 1 }),
  Object.freeze({ x: 40, y: 0, normalX: 0, normalY: 1 }),
  Object.freeze({ x: 40, y: 60, normalX: -1, normalY: 0 })
]);
test('cached render paths keep every original sample and exact offsets', () => {
  const paths = getTrackRenderPaths(points, 12, 23.5);
  assert.deepEqual(paths.center.commands, [['M', 0, 0], ['L', 40, 0], ['L', 40, 60], ['Z']]);
  for (const [name, offset] of [['left', 12], ['right', -12], ['barrierLeft', 23.5], ['barrierRight', -23.5]]) {
    const expected = points.map((p, i) => [i ? 'L' : 'M', p.x + p.normalX * offset, p.y + p.normalY * offset]);
    expected.push(['Z']);
    assert.deepEqual(paths[name].commands, expected);
  }
  assert.equal(getTrackRenderPaths(points, 12, 23.5), paths);
});
test('render cache invalidates on new track, width or barrier type', () => {
  const paths = getTrackRenderPaths(points, 12, 23.5);
  assert.notEqual(getTrackRenderPaths([...points], 12, 23.5), paths);
  assert.notEqual(getTrackRenderPaths(points, 10, 23.5), paths);
  assert.notEqual(getTrackRenderPaths(points, 12, 15), paths);
});
test('conservative culling includes all rotated viewport corners and padded edges', () => {
  const camera = new Camera();
  camera.x = 321; camera.y = -99;
  for (const [width, height] of [[1440, 900], [390, 844], [800, 800]]) {
    const canvas = { width, height };
    for (const rotation of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3]) {
      for (const zoom of [1, 6.4, 9.2]) {
        camera.rotation = rotation; camera.zoom = zoom;
        const bounds = getRenderBounds(camera, canvas, 48);
        for (const [x, y] of [[0, 0], [width, 0], [0, height], [width, height], [width / 2, height / 2]])
          assert.ok(withinRenderBounds(camera.screenToWorld(x, y, canvas), bounds));
        assert.ok(withinRenderBounds({ x: bounds.minX, y: bounds.maxY }, bounds));
        assert.ok(!withinRenderBounds({ x: bounds.maxX + 1, y: bounds.maxY }, bounds));
      }
    }
  }
});
test('minimap projection is cached without mutation and retains all points', () => {
  const geometry = getMinimapGeometry(points);
  assert.equal(getMinimapGeometry(points), geometry);
  assert.notEqual(getMinimapGeometry([...points]), geometry);
  assert.equal(geometry.path.commands.length, points.length + 1);
  for (const p of points) {
    assert.ok(geometry.toMapX(p.x) >= 16 && geometry.toMapX(p.x) <= 224);
    assert.ok(geometry.toMapY(p.y) >= 32 && geometry.toMapY(p.y) <= 166);
  }
});
test('minimap remains finite for a zero-size circuit', () => {
  const geometry = getMinimapGeometry([{ x: 3, y: 4 }]);
  assert.ok(Number.isFinite(geometry.toMapX(3)) && Number.isFinite(geometry.toMapY(4)));
});
test('minimap markers still follow bots/ghost on every frame and resize', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_, key) => (...args) => calls.push([key, ...args]), set: () => true });
  const bot = { isBot: true, x: 5, y: 6, color: 'red' };
  const state = { trackPath: points, cars: [bot], gameMode: 'ghost', bestLapPath: [{ x: 10, y: 12 }], ghostLapFrameIndex: 0 };
  drawMinimap(ctx, { height: 900 }, state);
  const geometry = getMinimapGeometry(points);
  assert.ok(calls.some(([name, x, y, radius]) => name === 'arc' && x === geometry.toMapX(5) && y === geometry.toMapY(6) && radius === 3.8));
  assert.ok(calls.some(([name, x, y, radius]) => name === 'arc' && x === geometry.toMapX(10) && y === geometry.toMapY(12) && radius === 3.5));
  bot.x = 18; calls.length = 0;
  drawMinimap(ctx, { height: 844 }, state);
  assert.ok(calls.some(([name, x, y]) => name === 'translate' && x === 16 && y === 648));
  assert.ok(calls.some(([name, x, , radius]) => name === 'arc' && x === geometry.toMapX(18) && radius === 3.8));
});
test('catalogue preserves original game selectors and native fallback', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['trackSelect', 'gameMode', 'lapCount', 'trackCondition', 'transMode', 'botCount', 'botDifficulty'])
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
  assert.match(html, /<select id="trackSelect"><\/select>/);
  assert.match(html, /<dialog id="track-dialog" aria-labelledby="track-dialog-title"/);
});
console.log(`${passed} PASSOU | 0 FALHOU`);
