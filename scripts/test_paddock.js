// Presentation helpers must never change circuit geometry or game settings.
import assert from 'node:assert/strict';
import { F1_TRACKS } from '../src/f1Tracks.js';
import { createTrackPreview, sessionBrief } from '../src/paddock.js';

let passed = 0;
for (const track of F1_TRACKS) {
  const before = JSON.stringify(track);
  const preview = createTrackPreview(track);
  assert.match(preview.path, /^M.+ Z$/);
  assert.ok(!preview.path.includes('NaN') && !preview.path.includes('Infinity'));
  assert.ok(preview.start.x >= 25 && preview.start.x <= 295);
  assert.ok(preview.start.y >= 25 && preview.start.y <= 175);
  assert.equal(JSON.stringify(track), before);
  passed++;
}
assert.equal(sessionBrief({ mode: 'race', bots: '19', laps: '3', transmission: 'manual' }),
  '20 carros no grid · 3 voltas · Manual'); passed++;
assert.equal(sessionBrief({ mode: 'ghost', bots: '19', laps: '1', transmission: 'auto' }),
  'Você contra o relógio · 1 volta · Automática'); passed++;
assert.equal(createTrackPreview(null).path, ''); passed++;
assert.ok(!createTrackPreview({ waypoints: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }).path.includes('NaN')); passed++;
console.log(`${passed} PASSOU | 0 FALHOU`);
