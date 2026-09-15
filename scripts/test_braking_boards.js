import assert from 'node:assert/strict';
import { generateTrackPath } from '../src/track.js';
import { state } from '../src/game.js';
import { F1_TRACKS } from '../src/f1Tracks.js';
import { getBrakingBoards, sampleTrackDistance, BOARD_DISTANCES } from '../src/brakingBoards.js';

let passed = 0;
for (const track of F1_TRACKS) {
  generateTrackPath(track.id);
  const path = state.trackPath, before = JSON.stringify(path), length = state.totalTrackLength;
  const boards = getBrakingBoards(path, track.trackWidth);
  assert.ok(boards.length >= 6 && boards.length < 150, track.name);
  assert.equal(boards.length % 6, 0);
  for (let i = 0; i < boards.length; i += 6) assert.deepEqual(boards.slice(i, i + 6).map(b => b.metres), BOARD_DISTANCES);
  for (const b of boards) {
    assert.ok(Math.abs(((b.entry - b.distance + length) % length) - b.metres) < 1e-6);
    const centre = sampleTrackDistance(path, b.distance);
    assert.ok(Math.abs(Math.hypot(b.x - centre.x, b.y - centre.y) - (track.trackWidth / 2 + 5)) < 1e-6);
    assert.ok(Number.isFinite(b.angle) && [-1, 1].includes(b.direction));
  }
  assert.equal(getBrakingBoards(path, track.trackWidth), boards, 'cached instance');
  assert.equal(JSON.stringify(path), before, 'coordinates, curvature and AI speed profile unchanged');
  assert.deepEqual(sampleTrackDistance(path, -50), sampleTrackDistance(path, length - 50));
  console.log(`PASS ${track.name}: ${boards.length / 6} approaches, ${boards.length} metric boards`); passed++;
}
assert.deepEqual(getBrakingBoards([]), []); passed++;
console.log(`${passed} PASSOU | 0 FALHOU`);
