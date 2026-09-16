import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { state } from '../src/game.js';
import { Car } from '../src/car.js';
import { createKeyboardControls } from '../src/controlBindings.js';
import { TelemetryCollector } from '../src/ml/telemetry/telemetryCollector.js';
import {
  TelemetryCollectorV3,
  V3_CAPTURE_READINESS,
  V3_REMOTE_INGEST_STATUS
} from '../src/ml/telemetry/telemetryCollectorV3.js';
import { formatSamplesToJSONL } from '../src/ml/telemetry/telemetryExport.js';
import { onlineUploader } from '../src/ml/telemetry/telemetryUploader.js';
import { validateTelemetrySample } from '../src/ml/telemetry/telemetrySchema.js';
import {
  buildObservationVectorV3,
  buildTargetVectorV3,
  validateTelemetrySampleV3
} from '../src/ml/telemetry/telemetrySchemaV3.js';
import {
  DATASET_GENERATION_ID,
  RUNTIME_DATASET_SIMULATION_FINGERPRINT_SHA256,
  V3_OBSERVATION_FEATURES,
  V3_TARGET_ORDER
} from '../src/ml/lineage/runtimeDatasetContract.js';

let passed = 0;
function test(label, fn) {
  fn();
  passed++;
  console.log(`PASS ${label}`);
}

const path = Array.from({ length: 120 }, (_, index) => ({
  x: index * 10,
  y: 0,
  z: 0,
  normalX: 0,
  normalY: 1,
  angle: 0,
  slope: index === 0 ? 0.01 : 0,
  curvature: index % 12 === 0 ? 0.005 : 0,
  effectiveCurvature: index % 12 === 0 ? 0.005 : 0,
  cumulativeDistance: index * 10,
  segmentLength: 10,
  targetSpeed: 1.35
}));

function resetWorld({ automatic = false, lateralDistance = 0 } = {}) {
  Object.assign(state, {
    trackPath: path,
    totalTrackLength: 1200,
    selectedTrack: 21,
    selectedTrackData: { id: 21, trackWidth: 24, escapeType: 'gravel_asphalt' },
    isRunning: true,
    isPaused: false,
    racePhase: 'racing',
    raceFinished: false,
    gameMode: 'race',
    trackCondition: 'dry',
    onlineSession: null,
    keys: {},
    cars: [],
    particles: [],
    skidMarks: [],
    floatingNotices: []
  });
  const car = new Car('#ff3333', 'PRIVATE DRIVER NAME', false, 0, automatic);
  Object.assign(car, { x: 100, y: 0, angle: 0, vx: 0.6, vy: 0, pathIndex: 0, tyreTemp: 92 });
  car.getTrackDistanceAndSegment = () => ({
    lateralDist: lateralDistance,
    closestIdx: 0,
    segmentIdx: 0,
    segmentT: 0
  });
  car.updateCheckpoints = () => {};
  state.cars = [car];
  return car;
}

function collector(sessionId = 'ml36-capture-fixture') {
  return new TelemetryCollectorV3({ enabled: true, sessionId });
}

function capture(car, target, timestamp, keys = {}) {
  state.keys = keys;
  car.update();
  const sample = target.sampleCar(
    car,
    state.trackPath,
    state.selectedTrackData.trackWidth / 2,
    state.totalTrackLength,
    state.selectedTrack,
    timestamp
  );
  assert.ok(sample, 'V3 sample must be accepted');
  return sample;
}

test('allowed boost preserves State(t), records request(t), and exposes the effect only next tick', () => {
  const car = resetWorld();
  const target = collector('boost-allowed');
  const first = capture(car, target, 1000, { KeyW: true, Space: true });
  assert.equal(first.boostState.active, false);
  assert.equal(first.driverAction.boostRequested, true);
  assert.equal(car.boostActive, true);
  const second = capture(car, target, 1100, { KeyW: true, Space: true });
  assert.equal(second.boostState.active, true);
  assert.equal(second.driverAction.boostRequested, true);
  assert.ok(second.boostState.charge < first.boostState.charge);
});

test('blocked boost records human intent without inventing an effective boost state', () => {
  const car = resetWorld({ lateralDistance: 20 });
  const sample = capture(car, collector('boost-blocked'), 1000, { KeyW: true, Space: true });
  assert.equal(sample.trackState.surface, 'GRAVEL');
  assert.equal(sample.driverAction.boostRequested, true);
  assert.equal(sample.boostState.active, false);
  assert.equal(car.boostActive, false);
  assert.equal(car.boostCharge, 1);
});

test('boost release latch and cooldown remain pre-effect observations across release', () => {
  const car = resetWorld();
  Object.assign(car, {
    boostActive: false,
    boostCharge: 0,
    boostCooldown: 1,
    boostNeedsRelease: true
  });
  const target = collector('boost-release');
  const held = capture(car, target, 1000, { KeyW: true, Space: true });
  assert.equal(held.boostState.needsRelease, true);
  assert.equal(held.boostState.cooldownSeconds, 1);
  assert.equal(car.boostNeedsRelease, true);
  const released = capture(car, target, 1100, { KeyW: true, Space: false });
  assert.equal(released.boostState.needsRelease, true);
  assert.equal(released.driverAction.boostRequested, false);
  assert.equal(car.boostNeedsRelease, false);
  const afterRelease = capture(car, target, 1200, { KeyW: true, Space: false });
  assert.equal(afterRelease.boostState.needsRelease, false);
  assert.ok(afterRelease.boostState.cooldownSeconds < released.boostState.cooldownSeconds);
});

test('manual shift captures pre-shift gear/RPM and the same-tick human request', () => {
  const car = resetWorld({ automatic: false });
  Object.assign(car, { gear: 2, rpm: 4200 });
  const controls = createKeyboardControls(() => state);
  controls.down({ code: 'ArrowUp', repeat: false, preventDefault() {} });
  assert.equal(car.gear, 3);
  const target = collector('manual-shift');
  const first = capture(car, target, 1000, { KeyW: true });
  assert.equal(first.powertrainState.automaticTransmission, false);
  assert.equal(first.powertrainState.gear, 2);
  assert.equal(first.powertrainState.rpm, 4200);
  assert.equal(first.driverAction.gearShiftRequest, 1);
  assert.equal(car.gear, 3);
  const second = capture(car, target, 1100, { KeyW: true });
  assert.equal(second.powertrainState.gear, 3);
  assert.equal(second.driverAction.gearShiftRequest, 0);
});

test('automatic shifts are runtime state transitions and never V3 human targets', () => {
  const car = resetWorld({ automatic: true });
  Object.assign(car, { gear: 2, rpm: 8400, vx: 0.45 });
  const sample = capture(car, collector('automatic-shift'), 1000, { KeyW: true });
  assert.equal(car.gear, 3);
  assert.equal(sample.powertrainState.automaticTransmission, true);
  assert.equal(sample.powertrainState.gear, 3);
  assert.equal(sample.driverAction.gearShiftRequest, 0);
});

test('collector emits exact 33-observation and 5-target canonical orders', () => {
  const car = resetWorld();
  const sample = capture(car, collector('canonical-order'), 1000, {
    KeyW: true,
    KeyD: true,
    Space: true
  });
  const observations = buildObservationVectorV3(sample);
  const targets = buildTargetVectorV3(sample);
  assert.equal(V3_OBSERVATION_FEATURES.length, 33);
  assert.equal(observations.length, 33);
  assert.deepEqual(V3_TARGET_ORDER, [
    'driverAction.steering',
    'driverAction.throttle',
    'driverAction.brake',
    'driverAction.boostRequested',
    'driverAction.gearShiftRequest'
  ]);
  assert.deepEqual(targets, [car.lastSteerInput, 1, 0, 1, 0]);
  assert.ok(validateTelemetrySampleV3(sample));
});

test('10 Hz scheduler is stable, indices are contiguous, validator accepts all samples, and bots are excluded', () => {
  const car = resetWorld();
  const bot = new Car('#999999', 'BOT', true, 1, true);
  bot.getTrackDistanceAndSegment = car.getTrackDistanceAndSegment;
  bot.updateCheckpoints = () => {};
  state.cars.push(bot);
  const target = collector('ten-hz');
  for (let tick = 0; tick < 600; tick++) {
    state.keys = { KeyW: true };
    car.update();
    target.update(1000 + tick * (1000 / 60), state);
  }
  assert.equal(target.session.samples.length, 100);
  assert.deepEqual(target.session.samples.map(sample => sample.metadata.sampleIndex),
    Array.from({ length: 100 }, (_, index) => index));
  assert.ok(target.session.samples.every(validateTelemetrySampleV3));
  assert.ok(target.session.samples.every(sample => sample.metadata.driverType === 'PLAYER'));
  assert.equal(target.getStats().botSamples, 0);
});

test('session metadata and local JSONL export are complete and sanitized', () => {
  const car = resetWorld();
  const target = collector('sanitized-export');
  const sample = capture(car, target, 1000, { KeyW: true });
  const stats = target.getStats();
  const jsonl = formatSamplesToJSONL(target.session.samples);
  assert.equal(sample.schemaVersion, 3);
  assert.equal(stats.datasetGenerationId, DATASET_GENERATION_ID);
  assert.equal(stats.simulationFingerprintSha256, RUNTIME_DATASET_SIMULATION_FINGERPRINT_SHA256);
  assert.equal(stats.sampleRateHz, 10);
  assert.equal(stats.scope, 'PLAYER_ONLY');
  assert.equal(stats.captureReadiness, 'READY_FOR_CONTROLLED_COLLECTION');
  assert.ok(!jsonl.includes(car.name));
  assert.ok(!jsonl.includes('DATABASE_URL'));
  assert.ok(!jsonl.includes('postgres://'));
  assert.ok(validateTelemetrySampleV3(JSON.parse(jsonl.trim())));
});

test('V3 remote ingest is explicitly blocked and never calls the V2 uploader', () => {
  const original = {
    consentEnabled: onlineUploader.consentEnabled,
    beginRace: onlineUploader.beginRace,
    queueSample: onlineUploader.queueSample,
    endSession: onlineUploader.endSession
  };
  onlineUploader.consentEnabled = true;
  onlineUploader.beginRace = onlineUploader.queueSample = onlineUploader.endSession = () => {
    throw new Error('V2_UPLOADER_CALLED_BY_V3');
  };
  try {
    const target = new TelemetryCollectorV3({ sessionId: 'local-only' });
    for (const remoteOption of ['online', 'onlineOnly', 'remote', 'remoteUpload', 'upload', 'uploader']) {
      assert.throws(() => target.start({ trackId: 21, [remoteOption]: true }),
        error => error.message === V3_REMOTE_INGEST_STATUS);
    }
    target.start({ trackId: 21 });
    const car = resetWorld();
    state.keys = { KeyW: true };
    car.update();
    target.update(1000, state);
    target.stop();
    assert.equal(target.session.samples.length, 1);
  } finally {
    Object.assign(onlineUploader, original);
  }
});

test('V2 collector and validator remain operational beside V3', () => {
  const car = resetWorld();
  state.keys = { KeyW: true };
  car.update();
  const v2 = new TelemetryCollector({ enabled: true, sampleRateHz: 10, scope: 'PLAYER_ONLY' });
  v2.update(1000, state);
  assert.equal(v2.session.samples.length, 1);
  assert.equal(v2.session.samples[0].schemaVersion, 2);
  assert.ok(validateTelemetrySample(v2.session.samples[0]));
  assert.equal(validateTelemetrySampleV3(v2.session.samples[0]), false);
});

test('readiness has no database dependency and is gated as controlled local collection only', () => {
  const collectorSource = readFileSync('src/ml/telemetry/telemetryCollectorV3.js', 'utf8');
  const sessionSource = readFileSync('src/ml/telemetry/telemetrySessionV3.js', 'utf8');
  assert.ok(!/DATABASE_URL|server\/src\/db|\bpg\b/.test(`${collectorSource}\n${sessionSource}`));
  assert.equal(V3_CAPTURE_READINESS, 'READY_FOR_CONTROLLED_COLLECTION');
  assert.equal(V3_REMOTE_INGEST_STATUS, 'V3_REMOTE_INGEST_NOT_READY');
});

console.log(`ML36_V3_CAPTURE_CHECKS: ${passed} total, ${passed} passed, 0 failed`);
