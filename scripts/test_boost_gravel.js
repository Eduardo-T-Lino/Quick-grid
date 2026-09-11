import assert from 'node:assert/strict';
import { state } from '../src/game.js';
import { Car } from '../src/car.js';
import { BOOST_TUNING, updateBoost } from '../src/boost.js';
import { GRAVEL_HANDLING, GT3_TOP_SPEED, MAX_INTERNAL_SPEED, MAX_SPEED_KMH } from '../src/constants.js';

let passed = 0;
function test(label, fn) { fn(); passed++; console.log(`PASS ${label}`); }
const charge = () => ({ boostCharge: 1, boostCooldown: 0, boostActive: false, boostNeedsRelease: false });
test('boost lasts three seconds, cannot pulse indefinitely while held, and recharges on release', () => {
  const c = charge();
  for (let i = 0; i < 180; i++) { updateBoost(c, true, true, true); assert.equal(c.boostActive, true); }
  assert.equal(c.boostCharge, 0);
  for (let i = 0; i < 900; i++) updateBoost(c, true, true, true);
  assert.equal(c.boostActive, false); assert.equal(c.boostCharge, 0);
  for (let i = 0; i < 120; i++) updateBoost(c, false, true, true);
  assert.ok(c.boostCharge < 1e-9);
  for (let i = 0; i < 720; i++) updateBoost(c, false, true, true);
  assert.ok(c.boostCharge > 0.999999);
  updateBoost(c, true, true, true); assert.equal(c.boostActive, true);
});
test('ineligible inputs do not consume charge, paused/countdown updates cannot charge or activate', () => {
  const c = charge(); updateBoost(c, true, false, true); assert.equal(c.boostCharge, 1);
  c.boostCharge = .4; c.boostCooldown = 1;
  for (let i = 0; i < 600; i++) updateBoost(c, false, true, false);
  assert.equal(c.boostCharge, .4); assert.equal(c.boostCooldown, 1); assert.equal(c.boostActive, false);
});
test('charge below activation threshold cannot start boost', () => {
  const c = charge(); c.boostCharge = BOOST_TUNING.minCharge / 2;
  updateBoost(c, true, true, true); assert.equal(c.boostActive, false);
});

const path = Array.from({ length: 100 }, (_, i) => ({ x: i * 10, y: 0, z: 0,
  normalX: 0, normalY: 1, angle: 0, slope: 0, curvature: 0,
  cumulativeDistance: i * 10, segmentLength: 10, targetSpeed: 1.35 }));
function run({ wet = false, initialSpeed = 0, y = 0, ticks = 600, steer = 0, boost = false,
  gravel = false, escape = false, brake = false, throttle = true, bot = false, phase = 'racing', paused = false, wake = 0,
  releaseAt = Infinity, coastThrottle = true, coastBrake = false, coastGravel = false } = {}) {
  Object.assign(state, { trackPath: path, totalTrackLength: 1000, isPaused: paused, racePhase: phase,
    selectedTrackData: { trackWidth: 24, escapeType: 'gravel_asphalt' }, gameMode: 'race',
    trackCondition: wet ? 'wet' : 'dry', keys: {}, cars: [], particles: [], skidMarks: [], floatingNotices: [] });
  const car = new Car('#ff3333', 'Fixture', bot, 0, true);
  Object.assign(car, { x: 100, y, angle: 0, vx: initialSpeed, vy: 0, tyreTemp: wet ? 62 : 92,
    wakeIntensity: wake, gear: initialSpeed > 1.13 ? 6 : initialSpeed > .9 ? 5 : initialSpeed > .68 ? 4 : 1 });
  car.getTrackDistanceAndSegment = () => ({ lateralDist: escape ? Math.abs(car.y) : gravel ? 20 : 0,
    closestIdx: 0, segmentIdx: 0, segmentT: 0 });
  car.updateCheckpoints = () => {};
  if (bot) car.brain.computeInputs = () => ({ throttleInput: 1, brakeInput: 0, steerInput: steer });
  state.cars = [car];
  let maxSpeed = initialSpeed, minY = y, activeTicks = 0;
  for (let i = 0; i < ticks; i++) {
    const turn = escape ? (car.angle > -1.1 ? -1 : 0) : steer;
    if (i >= releaseAt && coastGravel) gravel = true;
    state.keys = { KeyW: i < releaseAt ? throttle : coastThrottle, KeyS: i < releaseAt ? brake : coastBrake,
      KeyA: turn < 0, KeyD: turn > 0, Space: boost && i < releaseAt };
    car.update();
    maxSpeed = Math.max(maxSpeed, Math.hypot(car.vx, car.vy)); minY = Math.min(minY, car.y);
    activeTicks += Number(car.boostActive);
    assert.ok([car.x, car.y, car.angle, car.vx, car.vy, car.yawRate, car.boostCharge].every(Number.isFinite));
    assert.ok(car.boostCharge >= 0 && car.boostCharge <= 1);
    if (i % 60 === 0) { state.particles.length = 0; state.skidMarks.length = 0; }
  }
  return { car, maxKmh: maxSpeed / MAX_INTERNAL_SPEED * MAX_SPEED_KMH, minY, activeTicks };
}
test('normal engine respects 320 and boost alone reaches up to 400 without changing track calibration', () => {
  assert.equal(MAX_SPEED_KMH, 285); assert.equal(MAX_INTERNAL_SPEED, 1.35);
  assert.ok(Math.abs(GT3_TOP_SPEED / MAX_INTERNAL_SPEED * MAX_SPEED_KMH - 320) < 1e-9);
  for (const boost of [false, true]) {
    const result = run({ ticks: 3600, boost, initialSpeed: boost ? GT3_TOP_SPEED : 0 });
    assert.ok(result.maxKmh >= (boost ? 395 : 315) && result.maxKmh <= (boost ? 400.001 : 320.001), `max ${result.maxKmh}`);
    if (boost) assert.ok(result.car.getKmh() <= 320, 'Empty boost returns gradually to normal speed');
  }
});
test('releasing boost above 320 preserves momentum instead of instant speed clipping', () => {
  const result = run({ initialSpeed: 1.35 * 348 / 285, ticks: 1 });
  assert.ok(result.car.getKmh() > 340 && result.car.getKmh() < 348);
});
test('boost adds acceleration through the real rear tyres, not direct velocity changes', () => {
  const normal = run({ initialSpeed: 1, ticks: 30 });
  const boosted = run({ initialSpeed: 1, ticks: 30, boost: true });
  assert.ok(boosted.maxKmh > normal.maxKmh + 3);
  assert.equal(boosted.activeTicks, 30);
});
test('no boost on gravel, while braking, without throttle, for bots, or before lights out', () => {
  for (const options of [{ gravel: true }, { brake: true }, { throttle: false }, { bot: true }, { phase: 'countdown' }, { paused: true }]) {
    const { car, activeTicks } = run({ boost: true, ticks: 30, ...options });
    assert.equal(activeTicks, 0); assert.equal(car.boostCharge, 1);
  }
});
test('dry and wet gravel allow symmetric low-speed steering; stationary car does not rotate', () => {
  for (const wet of [false, true]) {
    const right = run({ gravel: true, wet, steer: 1, ticks: 360 });
    const left = run({ gravel: true, wet, steer: -1, ticks: 360 });
    assert.ok(right.car.angle > .6, `insufficient turn: ${right.car.angle}`);
    assert.ok(Math.abs(right.car.angle + left.car.angle) < 1e-9, `asymmetric: ${right.car.angle} / ${left.car.angle}`);
    assert.ok(right.maxKmh < 45);
    const parked = run({ gravel: true, wet, steer: 1, throttle: false });
    assert.equal(parked.car.angle, 0); assert.equal(parked.maxKmh, 0);
  }
});
test('player can steer out of gravel and re-enter asphalt in dry and wet conditions', () => {
  for (const wet of [false, true]) {
    const result = run({ escape: true, y: 21, wet, ticks: 900 });
    assert.ok(result.minY < 12, `did not reach asphalt: ${result.minY}`);
  }
});
test('high-speed gravel still slows the car much more than asphalt', () => {
  const gravel = run({ initialSpeed: 1.2, gravel: true, throttle: false, ticks: 30 });
  const road = run({ initialSpeed: 1.2, throttle: false, ticks: 30 });
  assert.ok(gravel.car.getKmh() < road.car.getKmh() / 2);
  assert.equal(GRAVEL_HANDLING.highSpeedDrag, .88);
});
test('reverse remains below 50 km/h for a minute; boost cannot engage in reverse', () => {
  for (const wet of [false, true]) {
    const result = run({ ticks: 3600, throttle: false, brake: true, wet, boost: true });
    assert.ok(result.car.vx < 0);
    assert.ok(result.maxKmh <= 50.001, `reverse ${result.maxKmh}`);
    assert.equal(result.activeTicks, 0);
  }
});
test('reverse coast loses speed, W brakes reverse and S first brakes forward', () => {
  const coasting = run({ initialSpeed: -.2, throttle: false, ticks: 60 });
  assert.ok(coasting.car.vx < 0 && coasting.car.vx > -.2);
  const forward = run({ initialSpeed: -.2, ticks: 180 });
  assert.ok(forward.car.vx > 0);
  const braking = run({ initialSpeed: 1, throttle: false, brake: true, ticks: 10 });
  assert.ok(braking.car.vx > 0 && braking.car.vx < 1);
});
test('wake accelerates faster and unlocks overspeed slowly, bounded at 350 without boost', () => {
  const clean = run({ initialSpeed: 1, ticks: 60 });
  const tow = run({ initialSpeed: 1, ticks: 60, wake: 1 });
  assert.ok(tow.maxKmh > clean.maxKmh + 2);
  const first = run({ initialSpeed: GT3_TOP_SPEED, ticks: 1, wake: 1 });
  assert.ok(first.maxKmh <= 320.04);
  const sustained = run({ initialSpeed: GT3_TOP_SPEED, ticks: 1800, wake: 1 });
  assert.ok(sustained.maxKmh > 340 && sustained.maxKmh <= 350.001, `wake ${sustained.maxKmh}`);
  const boosted = run({ initialSpeed: GT3_TOP_SPEED, ticks: 1800, wake: 1, boost: true });
  assert.ok(boosted.maxKmh <= 400.001);
});
test('earned boost momentum decays gently after release, with or without throttle', () => {
  for (const coastThrottle of [false, true]) {
    const options = { initialSpeed: GT3_TOP_SPEED, boost: true, releaseAt: 175, coastThrottle };
    const release = run({ ...options, ticks: 175 });
    const first = run({ ...options, ticks: 176 });
    const second = run({ ...options, ticks: 235 });
    const later = run({ ...options, ticks: 415 });
    const end = run({ ...options, ticks: 1975 });
    assert.ok(release.car.getKmh() >= 395);
    assert.ok(first.car.getKmh() >= release.car.getKmh() - 1);
    assert.ok(second.car.getKmh() > 375 && second.car.getKmh() < release.car.getKmh());
    assert.ok(later.car.getKmh() < second.car.getKmh() && later.car.getKmh() > 320);
    assert.ok(end.car.getKmh() <= 320);
    assert.equal(second.car.boostActive, false);
  }
});
test('post-boost momentum does not weaken braking or gravel slowdown', () => {
  const options = { initialSpeed: GT3_TOP_SPEED, boost: true, releaseAt: 175, ticks: 235, coastThrottle: false };
  const coast = run(options), brake = run({ ...options, coastBrake: true }), gravel = run({ ...options, coastGravel: true });
  assert.ok(brake.car.getKmh() < coast.car.getKmh() - 80);
  assert.ok(gravel.car.getKmh() < coast.car.getKmh() / 2);
  assert.equal(brake.car.boostCarry, false); assert.equal(gravel.car.boostCarry, false);
});
console.log(`${passed} PASSOU | 0 FALHOU`);
