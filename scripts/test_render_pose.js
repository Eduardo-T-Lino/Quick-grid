import assert from 'node:assert/strict';
import { RenderPoseBuffer } from '../src/renderPose.js';
import { drawCarAppearance, getCarSprite } from '../src/carAppearance.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
const car = () => ({ x: 0, y: 2, angle: .2, vx: 1, vy: 0, color: '#ff2222', participantId: 'p_19_test' });
test('countdown, missing car and reset use the authoritative pose without modification', () => {
  const buffer = new RenderPoseBuffer(), c = car();
  assert.equal(buffer.sample(c, .4), c); assert.equal(buffer.sample(undefined, .4), undefined);
  buffer.capture(c); c.x = 1; buffer.reset(); assert.equal(buffer.sample(c, 0), c);
});
test('only presentation interpolates, without mutating a frozen physics car', () => {
  const buffer = new RenderPoseBuffer(), c = car(); buffer.capture(c);
  c.x = 2; c.y = 4; c.vx = 3; c.vy = 2; c.angle = .6; Object.freeze(c);
  const before = JSON.stringify(c), pose = buffer.sample(c, .25);
  near(pose.x, .5); near(pose.y, 2.5); near(pose.vx, 1.5); near(pose.vy, .5); near(pose.angle, .3);
  assert.equal(JSON.stringify(c), before); assert.notEqual(pose, c);
});
test('zero-tick rendered frames advance smoothly between the same snapshots', () => {
  const buffer = new RenderPoseBuffer(), c = car(); buffer.capture(c); c.x = 1.65;
  near(buffer.sample(c, .2).x, .33); near(buffer.sample(c, .7).x, 1.155);
  near(c.x, 1.65);
});
test('catch-up uses the final two physics poses, not an entire multi-tick jump', () => {
  const buffer = new RenderPoseBuffer(), c = car();
  for (let i = 0; i < 3; i++) { buffer.capture(c); c.x += 1; }
  near(buffer.sample(c, .5).x, 2.5); assert.equal(c.x, 3);
});
test('angle interpolation takes the short arc across both +/- pi boundaries', () => {
  for (const sign of [-1, 1]) {
    const buffer = new RenderPoseBuffer(), c = car(); c.angle = sign * (Math.PI - .1); buffer.capture(c);
    c.angle = -sign * (Math.PI - .1);
    near(Math.abs(buffer.sample(c, .5).angle), Math.PI);
  }
});
test('resets/teleports snap immediately and do not smear across the map', () => {
  const buffer = new RenderPoseBuffer(), c = car(); buffer.capture(c); c.x = 100;
  assert.equal(buffer.sample(c, .1), c);
});
test('presentation clamps alpha, handles invalid alpha and reuses one pose per car', () => {
  const buffer = new RenderPoseBuffer(), c = car(); buffer.capture(c); c.x = 1;
  const pose = buffer.sample(c, -.1); near(pose.x, 0);
  assert.equal(buffer.sample(c, 1.5), pose); near(pose.x, 1);
  near(buffer.sample(c, NaN).x, 1);
});
test('same 60 Hz simulation presents constant motion at 60/120/144 Hz and jittered RAF', () => {
  const STEP = 1000 / 60;
  for (const intervals of [[STEP], [1000 / 120], [1000 / 144], [16.5, 16.9, 16.3, 17, 16.6]]) {
    const c = car(), buffer = new RenderPoseBuffer(); c.x = 0;
    let accumulator = 0, elapsed = 0, ticks = 0;
    for (let frame = 0; frame < 1000; frame++) {
      const dt = intervals[frame % intervals.length]; elapsed += dt; accumulator += dt;
      while (accumulator >= STEP) { buffer.capture(c); c.x++; ticks++; accumulator -= STEP; }
      const pose = buffer.sample(c, accumulator / STEP);
      if (ticks) near(pose.x, elapsed / STEP - 1);
      assert.equal(c.x, ticks);
    }
  }
});
test('interpolation remains separate for all 20 cars and never consumes gameplay RNG', () => {
  const buffer = new RenderPoseBuffer(), cars = Array.from({ length: 20 }, car);
  const saved = Math.random; Math.random = () => { throw Error('gameplay RNG'); };
  try { cars.forEach((c, i) => { c.x = i; buffer.capture(c); c.x++; });
    cars.forEach((c, i) => near(buffer.sample(c, .5).x, i + .5));
  } finally { Math.random = saved; }
});
test('drawing an interpolated car reuses its artwork and leaves simulation untouched', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_, name) => (...args) => {
    calls.push([name, ...args]); if (name === 'createLinearGradient') return { addColorStop() {} };
  }, set: () => true });
  globalThis.document = { createElement: () => ({ getContext: () => ctx }) };
  const c = Object.freeze(car()), before = JSON.stringify(c), sprite = getCarSprite(c);
  const pose = Object.freeze({ x: 9, y: 8, angle: .7 }); calls.length = 0;
  drawCarAppearance(ctx, c, pose);
  assert.ok(calls.some(([name, x, y]) => name === 'translate' && x === 9 && y === 8));
  assert.ok(calls.some(([name, angle]) => name === 'rotate' && angle === .7));
  assert.equal(calls.find(([name]) => name === 'drawImage')[1], sprite);
  assert.equal(JSON.stringify(c), before);
});
console.log(`${passed} PASSOU | 0 FALHOU`);
