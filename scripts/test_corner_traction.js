import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as constants from '../src/constants.js';
import { WAKE_TUNING } from '../src/aerodynamics.js';

// Exercise the actual force-integration block without DOM, AI or rendering.
const source = readFileSync(new URL('../src/car.js', import.meta.url), 'utf8');
const start = source.indexOf('    // --- PNEUS GT3:');
const end = source.indexOf('    // Temperatura e desgaste:', start);
assert.ok(start >= 0 && end > start);
const block = source.slice(start, end);
assert.ok(block.includes('GT3_REAR_LATERAL_DEMAND'));
const integrate = new Function('c', 'input', `
  const { MAX_INTERNAL_SPEED, MAX_SPEED_KMH, GT3_BASE_GRIP, GT3_AERO_GRIP,
    GT3_WHEELBASE, GT3_ABS_SLIP_LIMIT, FORCA_FREIO_MAX, GT3_REAR_LATERAL_DEMAND,
    GT3_REAR_SLIDE_GRIP_LOSS, GT3_OVERSTEER_GAIN, GT3_YAW_RECOVERY_LOSS, GT3_MAX_YAW_RATE, WAKE_TUNING, GRAVEL_HANDLING, DRIFT_CONTROL } = c;
  const { speed, steerInput, engineAccelFinal, throttleInput, state } = input;
  const headingX = Math.cos(this.angle), headingY = Math.sin(this.angle), rightX = -headingY, rightY = headingX;
  const wake = this.wakeIntensity || 0;
  ${block}
  return { rearLongLimit, rearLateralUse, driveAccel, brakeAccel, lateralCapacity,
    yawRate: this.yawRate, rearSlip: this.rearSlip, vx: this.vx, vy: this.vy,
    tcActive: this.tcActive, absActive: this.absActive, rearGripRetention };
`);
function run(demand, steerInput, speed = 0.9, wet = false, throttleInput = 1) {
  return integrate.call({ vx: speed, vy: 0, angle: 0, yawRate: 0, rearSlip: 0,
    tyreTemp: wet ? 62 : 92, tyreWear: 0, currentSurface: 'TARMAC', brakePressure: 0 },
  { ...constants, WAKE_TUNING, GT3_REAR_LATERAL_DEMAND: demand },
  { speed, steerInput, engineAccelFinal: 0.014 * throttleInput, throttleInput,
    state: { trackCondition: wet ? 'wet' : 'dry' } });
}
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const current = constants.GT3_REAR_LATERAL_DEMAND;
test('rear-drive corner demand is explicitly calibrated', () => {
  assert.equal(current, 0.60);
});
test('straight-line integration stays identical in dry and wet conditions', () => {
  for (const wet of [false, true]) for (const speed of [0, 0.1, 0.5, 0.9, 1.35]) {
    assert.deepEqual(run(current, 0, speed, wet), run(0.48, 0, speed, wet));
  }
});
test('cornering reduces traction margin and reaches slip sooner', () => {
  let earlier = 0;
  for (const wet of [false, true]) for (const speed of [0.3, 0.6, 0.9, 1.2]) {
    for (let i = 1; i <= 100; i++) {
      const old = run(0.48, i / 100, speed, wet);
      const next = run(current, i / 100, speed, wet);
      assert.ok(next.rearLongLimit <= old.rearLongLimit + 1e-12);
      assert.ok(next.rearSlip >= old.rearSlip - 1e-12);
      assert.ok(next.rearLateralUse <= 0.96);
      if (!old.tcActive && next.tcActive && next.rearSlip > 0) earlier++;
    }
  }
  assert.ok(earlier > 0, 'must actually cross the traction limit earlier, not just change a display flag');
});
test('left and right turns remain symmetric', () => {
  for (const wet of [false, true]) {
    const left = run(current, -0.6, 0.9, wet), right = run(current, 0.6, 0.9, wet);
    assert.equal(left.rearSlip, right.rearSlip);
    assert.equal(left.rearLongLimit, right.rearLongLimit);
    assert.equal(left.yawRate, -right.yawRate);
  }
});
test('no throttle produces no new powered oversteer', () => {
  for (const wet of [false, true]) assert.deepEqual(run(current, 0.4, 0.9, wet, 0),
    { ...run(0.48, 0.4, 0.9, wet, 0),
      rearLongLimit: run(current, 0.4, 0.9, wet, 0).rearLongLimit,
      rearLateralUse: run(current, 0.4, 0.9, wet, 0).rearLateralUse });
});
test('all six gears restore original force without removing RWD tuning', () => {
  const oldPower = [0, 0.028, 0.024, 0.021, 0.018, 0.016, 0.014];
  for (let gear = 1; gear <= 6; gear++) {
    assert.equal(constants.GEAR_POWER[gear], oldPower[gear]);
    assert.ok(constants.GEAR_SPEEDS[gear] > constants.GEAR_SPEEDS[gear - 1]);
  }
  assert.ok(constants.GEAR_SPEEDS[6] >= constants.GT3_TOP_SPEED);
  assert.ok(Math.abs(constants.GT3_TOP_SPEED / constants.MAX_INTERNAL_SPEED * constants.MAX_SPEED_KMH - 320) < 1e-9);
});
console.log(`${passed} passed`);
