import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { config } from '../server/src/config.js';
import {
  FORCA_TRACAO, RESISTENCIA_AR, TAXA_SUAVIZACAO_ACEL, TAXA_SUAVIZACAO_FREIO,
  FORCA_FREIO_MAX, GT3_WHEELBASE, GT3_BASE_GRIP, GT3_AERO_GRIP,
  GT3_TC_SLIP_LIMIT, GT3_ABS_SLIP_LIMIT, GT3_REAR_LATERAL_DEMAND, GEAR_SPEEDS, GEAR_POWER,
  GT3_TOP_SPEED, GT3_REAR_SLIDE_GRIP_LOSS, GT3_OVERSTEER_GAIN, GT3_YAW_RECOVERY_LOSS, GT3_MAX_YAW_RATE,
  MAX_SPEED_KMH, MAX_INTERNAL_SPEED, TRACK_WIDTH, TELEMETRY_VERSIONS, GRAVEL_HANDLING, DRIFT_CONTROL
} from '../src/constants.js';
import { playerSteering } from '../src/raceSettings.js';
import { WAKE_TUNING } from '../src/aerodynamics.js';
import { BOOST_TUNING } from '../src/boost.js';
import { SCHEMA_VERSION } from '../src/ml/telemetry/telemetrySchema.js';
import {
  BASELINE_MANIFEST, BASELINE_MANIFEST_FORMAT_VERSION, SIMULATION_FINGERPRINT_SHA256,
  TELEMETRY_LINEAGE_VERSIONS, stableSerialize
} from '../src/ml/lineage/baselineManifest.js';

let passed = 0;
let failed = 0;
function check(condition, label) {
  if (condition) { passed++; console.log(`PASS: ${label}`); }
  else { failed++; console.error(`FAIL: ${label}`); }
}
const close = (actual, expected) => Math.abs(actual - expected) <= 1e-12;
const equalArray = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);

const serialized = stableSerialize(BASELINE_MANIFEST);
const fingerprint = createHash('sha256').update(serialized).digest('hex');
const manifestText = JSON.stringify(BASELINE_MANIFEST);
const gameSource = fs.readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
const trackSource = fs.readFileSync(new URL('../src/track.js', import.meta.url), 'utf8');
const freezeDoc = fs.readFileSync(new URL('../docs/ml2_2_baseline_freeze.md', import.meta.url), 'utf8');

check(BASELINE_MANIFEST_FORMAT_VERSION === 1 && BASELINE_MANIFEST.manifestFormatVersion === 1,
  'baseline manifest format is versioned');
check(Object.isFrozen(BASELINE_MANIFEST) && Object.isFrozen(BASELINE_MANIFEST.physicsConstants),
  'baseline manifest is immutable at runtime');
check(stableSerialize({ z: 1, a: 2 }) === '{"a":2,"z":1}', 'stable serializer sorts object keys');
check(stableSerialize(BASELINE_MANIFEST) === serialized, 'stable serialization is repeatable');
check(fingerprint === SIMULATION_FINGERPRINT_SHA256, 'declared simulation fingerprint matches canonical manifest');
check(/^[0-9a-f]{64}$/.test(SIMULATION_FINGERPRINT_SHA256), 'simulation fingerprint is lowercase SHA-256');
check(!/timestamp|hostname|database|secret|token|authorization|localpath/i.test(manifestText),
  'baseline manifest contains no volatile host data or secrets');

check(TELEMETRY_VERSIONS === TELEMETRY_LINEAGE_VERSIONS, 'frontend versions use the canonical source');
check(config.VERSIONS === TELEMETRY_LINEAGE_VERSIONS, 'backend versions use the canonical source');
check(SCHEMA_VERSION === TELEMETRY_LINEAGE_VERSIONS.SCHEMA_VERSION, 'sample schema uses the canonical source');
check(TELEMETRY_LINEAGE_VERSIONS.SCHEMA_VERSION === 2, 'final schema is causal V2');
check(TELEMETRY_LINEAGE_VERSIONS.GAME_BUILD_VERSION === '0.6.3-ml2', 'game build identifies compact instruments and stacked RPM/boost');
check(TELEMETRY_LINEAGE_VERSIONS.PHYSICS_VERSION === '1.8.3-gt3-drift-coast', 'physics lineage distinguishes countersteer recovery and boost momentum');
check(TELEMETRY_LINEAGE_VERSIONS.TRACK_GEOMETRY_VERSION === '1.5.0-centripetal',
  'track geometry lineage remains 1.5.0-centripetal');
check(TELEMETRY_LINEAGE_VERSIONS.FEATURE_MANIFEST_VERSION === '2.1.0', 'feature manifest remains 2.1.0');
check(BASELINE_MANIFEST.rates.sampleRateHz === 10, 'telemetry baseline is 10 Hz');
check(BASELINE_MANIFEST.rates.simulationHz === 60 && /PHYSICS_STEP_MS\s*=\s*1000\s*\/\s*60/.test(gameSource),
  'simulation baseline and fixed timestep are both 60 Hz');

const p = BASELINE_MANIFEST.physicsConstants;
check(stableSerialize(WAKE_TUNING) === stableSerialize(p.wake), 'wake tuning matches the fingerprint');
check(stableSerialize(BOOST_TUNING) === stableSerialize(p.boost), 'boost tuning matches the fingerprint');
check(stableSerialize(DRIFT_CONTROL) === stableSerialize(p.driftControl), 'drift recovery tuning matches the fingerprint');
check(stableSerialize(GRAVEL_HANDLING) === stableSerialize(p.gravelHandling), 'gravel tuning matches the fingerprint');
check(GT3_REAR_LATERAL_DEMAND === p.rearLateralDemand, 'rear lateral demand matches the fingerprint');
check(equalArray([GT3_TOP_SPEED, GT3_REAR_SLIDE_GRIP_LOSS, GT3_OVERSTEER_GAIN, GT3_YAW_RECOVERY_LOSS, GT3_MAX_YAW_RATE],
  [p.engineSpeedLimitMetersPerTick, p.rearSlideGripLoss, p.oversteerGain, p.yawRecoveryLoss, p.maxYawRate]), 'RWD tuning matches the fingerprint');
check(equalArray(
  [MAX_SPEED_KMH, MAX_INTERNAL_SPEED, TRACK_WIDTH, FORCA_TRACAO, RESISTENCIA_AR, TAXA_SUAVIZACAO_ACEL,
    TAXA_SUAVIZACAO_FREIO, FORCA_FREIO_MAX, GT3_WHEELBASE, GT3_BASE_GRIP, GT3_AERO_GRIP,
    GT3_TC_SLIP_LIMIT, GT3_ABS_SLIP_LIMIT],
  [p.maxSpeedKmh, p.maxInternalSpeedMetersPerTick, p.defaultTrackWidthMeters, p.tractionForce,
    p.airResistance, p.accelerationSmoothing, p.brakeSmoothing, p.maxBrakeForce, p.wheelbaseMeters,
    p.baseGrip, p.aeroGrip, p.tractionControlSlipLimit, p.absSlipLimit]),
  'canonical physics constants match runtime exports');
check(equalArray(GEAR_SPEEDS, p.gearSpeeds) && equalArray(GEAR_POWER, p.gearPower),
  'gear speed and power maps match the fingerprint');
check(/steerInput\s*\*\s*\(0\.32\s*-\s*0\.20/.test(fs.readFileSync(new URL('../src/car.js', import.meta.url), 'utf8')),
  'normalized steering application matches the fingerprint');
check(close(playerSteering(0, 1, 0), 0.085), 'low-speed keyboard steering policy matches the manifest');
check(close(playerSteering(0, 1, 1), 0.0528), 'high-speed keyboard steering policy combines 0.060 ramp and 0.88 lock');
check(close(playerSteering(1, 0, 0.5), 0.88), 'keyboard steering return rate remains 0.12 per tick');

check(/centripetalCatmullRomPoint\(p0, p1, p2, p3, t, 0\.5\)/.test(trackSource)
  && /Math\.round\(segDist \/ 1\.5\)/.test(trackSource)
  && /cumulativeDistance = accumDist/.test(trackSource),
  'geometry implementation matches alpha, spacing and cumulative-distance manifest fields');
check(BASELINE_MANIFEST.geometry.projection === 'continuous-nearest-segment'
  && BASELINE_MANIFEST.geometry.progress === 'cumulative-distance-normalized',
  'geometry projection and progress semantics are explicit');
check(BASELINE_MANIFEST.featureManifest.observationFeatures.length === 16
  && new Set(BASELINE_MANIFEST.featureManifest.observationFeatures).size === 16,
  'feature manifest contains 16 unique ordered observations');
check(equalArray(BASELINE_MANIFEST.featureManifest.actionTargets,
  ['driverAction.steering', 'driverAction.throttle', 'driverAction.brake']),
  'feature manifest preserves the three ordered action targets');
check(equalArray(BASELINE_MANIFEST.featureManifest.surfaceEncodingDomain,
  ['TARMAC', 'KERB', 'RUNOFF', 'GRAVEL']), 'surface encoding domain is frozen');
check(freezeDoc.includes(SIMULATION_FINGERPRINT_SHA256)
  && freezeDoc.includes(TELEMETRY_LINEAGE_VERSIONS.GAME_BUILD_VERSION),
  'baseline freeze document matches canonical game build and fingerprint');

console.log(`ML2.2_FINAL_CHECKS: ${passed + failed} total, ${passed} passed, ${failed} failed`);
console.log(`${passed} PASSOU | ${failed} FALHOU`);
process.exitCode = failed === 0 ? 0 : 1;
