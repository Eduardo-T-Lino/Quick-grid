import assert from 'node:assert/strict';
import { state } from '../src/game.js';
import { Car } from '../src/car.js';

// Actual integration, flat isolated track. A scripted driver exercises the same tyres
// with partial pedal/steering inputs; it is not a replacement AI implementation.
const path = Array.from({ length: 100 }, (_, i) => ({ x: i * 10, y: 0, z: 0,
  normalX: 0, normalY: 1, angle: 0, slope: 0, curvature: 0,
  cumulativeDistance: i * 10, segmentLength: 10, targetSpeed: 1.35 }));
function run({ side = 1, mode = 'recover', wet = false, ticks = 240, initialSlip = .28, initialYaw = .045, keyboard = false } = {}) {
  Object.assign(state, { trackPath: path, totalTrackLength: 1000, racePhase: 'racing', isPaused: false,
    selectedTrackData: { trackWidth: 1000000, escapeType: 'gravel_asphalt' }, gameMode: 'race',
    trackCondition: wet ? 'wet' : 'dry', cars: [], keys: {}, particles: [], skidMarks: [], floatingNotices: [] });
  const car = new Car('#ff3333', 'Drift fixture', !keyboard, 0, true);
  Object.assign(car, { x: 100, y: 0, angle: 0, vx: .85 * Math.cos(initialSlip), vy: -side * .85 * Math.sin(initialSlip),
    yawRate: side * initialYaw, rearSlip: .7, tyreTemp: wet ? 62 : 92, gear: 4 });
  car.getTrackDistanceAndSegment = () => ({ lateralDist: 0, closestIdx: 0, segmentIdx: 0, segmentT: 0 });
  car.updateCheckpoints = () => {};
  state.cars = [car];
  const samples = [];
  let beta = -side * initialSlip;
  if (!keyboard) car.brain.computeInputs = () => ({ brakeInput: 0,
    throttleInput: mode === 'drift' ? .5 : mode === 'wrong' ? 1 : 0,
    steerInput: mode === 'wrong' ? side : mode === 'neutral' ? 0
      : Math.max(-1, Math.min(1, (beta + (mode === 'drift' ? side * .24 : 0)) * 4)) });
  for (let i = 0; i < ticks; i++) {
    if (keyboard) {
      const steeringError = beta + (mode === 'drift' ? side * .24 : 0);
      state.keys = { KeyW: mode === 'drift' && i % 10 < 5,
        KeyA: steeringError < -.025, KeyD: steeringError > .025 };
    }
    car.update();
    const fwd = car.vx * Math.cos(car.angle) + car.vy * Math.sin(car.angle);
    const lat = -car.vx * Math.sin(car.angle) + car.vy * Math.cos(car.angle);
    beta = Math.atan2(lat, fwd);
    samples.push({ beta, yaw: car.yawRate, speed: Math.hypot(car.vx, car.vy), slip: car.rearSlip });
    assert.ok([beta, car.vx, car.vy, car.yawRate].every(Number.isFinite));
    assert.ok(Math.abs(car.yawRate) <= .10000001);
    state.particles.length = 0; state.skidMarks.length = 0;
  }
  return { car, samples, maxSlip: Math.max(...samples.map(s => Math.abs(s.beta))) };
}
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };
test('timely countersteer recovers a rear slide in dry and wet conditions', () => {
  for (const wet of [false, true]) {
    const recover = run({ wet }), wrong = run({ wet, mode: 'wrong' });
    assert.ok(recover.maxSlip < wrong.maxSlip, `max slip ${recover.maxSlip}/${wrong.maxSlip}`);
    assert.ok(Math.abs(recover.samples.at(-1).beta) < .06);
    assert.ok(Math.abs(recover.car.yawRate) < .01);
    console.log(`RECOVERY ${wet ? 'wet' : 'dry'}: correct=${recover.maxSlip.toFixed(3)}, wrong=${wrong.maxSlip.toFixed(3)}`);
    if (wet) assert.ok(wrong.maxSlip > 1.5, 'Wrong input must still permit a spin on wet asphalt');
  }
});
test('keyboard countersteering also recovers slides through the normal input ramp', () => {
  for (const wet of [false, true]) {
    const result = run({ keyboard: true, wet });
    assert.ok(Math.abs(result.samples.at(-1).beta) < .07);
    assert.ok(result.maxSlip < 1);
  }
});
test('recovery is symmetric and never snaps heading or velocity to the road', () => {
  const left = run({ side: -1 }), right = run({ side: 1 });
  assert.ok(Math.abs(left.car.angle + right.car.angle) < 1e-9);
  assert.ok(Math.abs(left.car.vy + right.car.vy) < 1e-9);
  assert.ok(Math.abs(right.samples[0].beta) > .1, 'Slide must persist through the first correction');
});
test('modulated steering and throttle sustain a bounded powered slide', () => {
  const drift = run({ mode: 'drift', ticks: 300 });
  const held = drift.samples.slice(60).filter(s => Math.abs(s.beta) > .10 && Math.abs(s.beta) < .8 && s.speed > .3);
  assert.ok(held.length >= 120, `Only ${held.length} drift ticks`);
  assert.ok(drift.maxSlip < 1.5, `Unrecoverable slide ${drift.maxSlip}`);
  console.log(`DRIFT: ${held.length} controlled ticks, final ${drift.samples.at(-1).beta.toFixed(3)} rad`);
});
console.log(`${passed} PASSOU | 0 FALHOU`);
