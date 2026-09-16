import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  BASELINE_MANIFEST,
  SIMULATION_FINGERPRINT_SHA256,
  stableSerialize
} from '../src/ml/lineage/baselineManifest.js';
import {
  DATASET_GENERATION_ID,
  FEATURE_ACTION_MANIFEST_VERSION,
  RUNTIME_DATASET_CONTRACT,
  RUNTIME_DATASET_FINGERPRINT_INPUT,
  RUNTIME_DATASET_SIMULATION_FINGERPRINT_SHA256,
  RUNTIME_TELEMETRY_SCHEMA_VERSION,
  V3_FEATURE_ACTION_MANIFEST,
  V3_FIELD_SPECIFICATIONS,
  V3_OBSERVATION_FEATURES,
  V3_TARGET_ORDER
} from '../src/ml/lineage/runtimeDatasetContract.js';
import { createTelemetrySample, validateTelemetrySample } from '../src/ml/telemetry/telemetrySchema.js';
import {
  buildObservationVectorV3,
  buildTargetVectorV3,
  createTelemetrySampleV3,
  validateTelemetrySampleV3
} from '../src/ml/telemetry/telemetrySchemaV3.js';
import {
  calculateGenerationManifestSha256,
  loadDatasetRegistry,
  validateDatasetRegistry,
  validateGenerationManifest
} from './ml3/runtimeDatasetRegistry.js';

let passed = 0;

function check(condition, label) {
  assert.ok(condition, label);
  passed++;
  console.log(`  PASS: ${label}`);
}

function expectCode(fn, code) {
  assert.throws(fn, error => error?.message === code);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validV3Sample() {
  return {
    schemaVersion: 3,
    metadata: {
      schemaVersion: 3,
      sessionId: 'runtime-v3-session-fixture',
      sampleIndex: 7,
      timestamp: 700,
      trackId: 21,
      lapNumber: 1,
      driverType: 'PLAYER',
      datasetGenerationId: DATASET_GENERATION_ID,
      runtimeDatasetContractVersion: 'ML3.5-1',
      gameBuildVersion: '0.6.3-ml2',
      physicsVersion: '1.8.3-gt3-drift-coast',
      trackGeometryVersion: '1.5.0-centripetal',
      featureActionManifestVersion: FEATURE_ACTION_MANIFEST_VERSION,
      sourceRuntimeFingerprintSha256: SIMULATION_FINGERPRINT_SHA256,
      simulationFingerprintSha256: RUNTIME_DATASET_SIMULATION_FINGERPRINT_SHA256
    },
    carState: {
      speed: 1.2,
      forwardVelocity: 1.18,
      lateralVelocity: 0.04,
      yawRate: 0.015,
      slipAngle: 0.034,
      steeringAngle: 0.1,
      crossTrackError: 0.2,
      headingError: -0.03
    },
    trackState: {
      distanceToLeftEdge: 5.8,
      distanceToRightEdge: 6.2,
      currentCurvature: 0.012,
      futureCurvature5m: 0.014,
      futureCurvature10m: 0.018,
      futureCurvature20m: 0.03,
      trackProgress: 0.42,
      surface: 'TARMAC',
      slope: 0.01
    },
    powertrainState: {
      gear: 4,
      rpm: 6200,
      engineAcceleration: 0.018,
      brakePressure: 0.1,
      automaticTransmission: false
    },
    boostState: {
      active: true,
      charge: 0.7,
      cooldownSeconds: 1.5,
      needsRelease: false,
      carry: true
    },
    dynamicsState: {
      rearSlip: 0.08,
      tyreTemperatureCelsius: 92,
      tyreWear: 0.1
    },
    aeroState: {
      wakeIntensity: 0.25,
      wakeSpeedAllowanceKmh: 5
    },
    environmentState: { trackCondition: 'dry' },
    driverAction: {
      steering: 0.2,
      throttle: 1,
      brake: 0,
      boostRequested: false,
      gearShiftRequest: 1
    },
    eventState: {
      offTrack: false,
      collision: false,
      spin: false,
      isRecovering: false
    }
  };
}

function validV2Sample() {
  return createTelemetrySample({
    sessionId: 'v2-session', sampleIndex: 0, timestamp: 0, trackId: 21, lapNumber: 1,
    driverType: 'PLAYER', participantId: 'fixture', trackProgress: 0.1, pathIndex: 1,
    currentCurvature: 0.01, futureCurvature5m: 0.01, futureCurvature10m: 0.01,
    futureCurvature20m: 0.01, futureCurvature40m: 0.01, targetSpeed: 1,
    distanceToLeftEdge: 6, distanceToRightEdge: 6, surface: 'TARMAC', speed: 1,
    forwardVelocity: 1, lateralVelocity: 0, heading: 0, headingError: 0, yawRate: 0,
    slipAngle: 0, crossTrackError: 0, steeringAngle: 0, steering: 0,
    throttle: 1, brake: 0, offTrack: false, collision: false, spin: false,
    isRecovering: false
  });
}

console.log('ML3.5 runtime dataset contract and durable registry tests');

const sample = validV3Sample();
check(validateTelemetrySampleV3(sample) && createTelemetrySampleV3(sample) !== sample,
  'a complete causal Schema V3 sample validates and is copied without mutation');

const missing = validV3Sample();
delete missing.boostState.charge;
check(!validateTelemetrySampleV3(missing), 'a missing required field is rejected');

const invalidRange = validV3Sample();
invalidRange.boostState.charge = 1.01;
check(!validateTelemetrySampleV3(invalidRange), 'invalid V3 numeric ranges are rejected');

const futureState = { ...validV3Sample(), futureState: { speed: 2 } };
check(!validateTelemetrySampleV3(futureState), 'undeclared future or post-action state is rejected');

check(V3_TARGET_ORDER.join('|') === [
  'driverAction.steering', 'driverAction.throttle', 'driverAction.brake',
  'driverAction.boostRequested', 'driverAction.gearShiftRequest'
].join('|') && buildTargetVectorV3(sample).join('|') === '0.2|1|0|0|1',
'target order is frozen and includes every trainable human control');

check(V3_FEATURE_ACTION_MANIFEST.version === FEATURE_ACTION_MANIFEST_VERSION
  && Object.isFrozen(V3_FEATURE_ACTION_MANIFEST)
  && Object.isFrozen(V3_FEATURE_ACTION_MANIFEST.observationFeatures)
  && Object.isFrozen(V3_FEATURE_ACTION_MANIFEST.actionTargets),
'feature/action manifest and both canonical orders are explicitly versioned and immutable');

check(V3_OBSERVATION_FEATURES.length === 33
  && V3_OBSERVATION_FEATURES.slice(0, 16).every((feature, index) =>
    feature === BASELINE_MANIFEST.featureManifest.observationFeatures[index])
  && buildObservationVectorV3(sample).length === 33,
'observation order preserves all 16 valid V2 features and freezes 17 causal runtime additions');

const observation = buildObservationVectorV3(sample);
const boostActiveIndex = V3_OBSERVATION_FEATURES.indexOf('boostState.active');
const boostTargetIndex = V3_TARGET_ORDER.indexOf('driverAction.boostRequested');
check(observation[boostActiveIndex] === 1 && buildTargetVectorV3(sample)[boostTargetIndex] === 0
  && !V3_TARGET_ORDER.includes('boostState.active')
  && !V3_OBSERVATION_FEATURES.includes('driverAction.boostRequested'),
'boost intent is a target while effective boost remains pre-physics observation state');

check(Object.values(V3_FIELD_SPECIFICATIONS).flat().every(field =>
  field.path && field.type && field.unit && field.range && field.required === true
  && field.captureTiming && field.causalSemantics && field.validationRule),
'every V3 field declares type, unit, range, presence, timing, semantics and validation');

const computedFingerprint = createHash('sha256')
  .update(stableSerialize(RUNTIME_DATASET_FINGERPRINT_INPUT)).digest('hex');
check(computedFingerprint === RUNTIME_DATASET_SIMULATION_FINGERPRINT_SHA256
  && computedFingerprint !== SIMULATION_FINGERPRINT_SHA256,
'V3 fingerprint is deterministic and distinct from the source runtime fingerprint');

const v2 = validV2Sample();
check(validateTelemetrySample(v2) && !validateTelemetrySampleV3(v2)
  && validateTelemetrySampleV3(sample) && !validateTelemetrySample(sample)
  && RUNTIME_TELEMETRY_SCHEMA_VERSION !== BASELINE_MANIFEST.lineage.schemaVersion,
'Schema V2 and V3 remain readable but cannot enter the same lineage');

const registryRoot = path.resolve('dataset-registry');
const loaded = loadDatasetRegistry(registryRoot);
const manifest = loaded.manifests.get(DATASET_GENERATION_ID);
check(loaded.registry.generations.length === 1 && validateGenerationManifest(manifest),
'versioned registry and canonical checksum load deterministically');

check(manifest.status === 'CONTRACT_FROZEN_NO_DATA' && manifest.collectionStatus === 'NOT_STARTED'
  && manifest.sessionCount === 0 && manifest.rowCount === 0 && manifest.artifacts.length === 0
  && manifest.durableStorage === null && manifest.promoted === false,
'empty generation manifest is valid and creates no fictional dataset');

const duplicateRegistry = clone(loaded.registry);
duplicateRegistry.generations.push(clone(duplicateRegistry.generations[0]));
expectCode(() => validateDatasetRegistry(duplicateRegistry, () => manifest), 'DUPLICATE_GENERATION_ID');
check(true, 'registry rejects duplicate generation IDs');

const collisionRegistry = clone(loaded.registry);
collisionRegistry.generations.push({
  ...clone(collisionRegistry.generations[0]), manifestSha256: 'f'.repeat(64)
});
expectCode(() => validateDatasetRegistry(collisionRegistry, () => manifest), 'MUTABLE_VERSION_COLLISION');
check(true, 'registry rejects mutable version collisions');

const tampered = clone(manifest);
tampered.rowCount = 1;
expectCode(() => validateGenerationManifest(tampered), 'EMPTY_GENERATION_STATE_INVALID');
tampered.rowCount = 0;
tampered.manifestSha256 = 'e'.repeat(64);
expectCode(() => validateGenerationManifest(tampered), 'GENERATION_MANIFEST_HASH_MISMATCH');
check(true, 'registry validates semantic state and canonical manifest hash');

const mixed = clone(manifest);
mixed.runtimeLineage.gameBuildVersion = '0.3.0-ml2';
mixed.manifestSha256 = calculateGenerationManifestSha256(mixed);
expectCode(() => validateGenerationManifest(mixed), 'MIXED_RUNTIME_LINEAGE');
check(true, 'registry rejects historical or mixed lineage in the V3 generation');

const promotedWithoutStorage = clone(manifest);
promotedWithoutStorage.status = 'PROMOTED';
promotedWithoutStorage.collectionStatus = 'COMPLETE';
promotedWithoutStorage.sessionCount = 1;
promotedWithoutStorage.rowCount = 100;
promotedWithoutStorage.promoted = true;
promotedWithoutStorage.manifestSha256 = calculateGenerationManifestSha256(promotedWithoutStorage);
expectCode(() => validateGenerationManifest(promotedWithoutStorage),
  'PROMOTED_DATASET_DURABLE_STORAGE_REQUIRED');
check(true, 'promoted dataset without durable object reference, SHA and byte size is rejected');

check(RUNTIME_DATASET_CONTRACT.causalAlignment === 'STATE_T_TO_ACTION_T'
  && manifest.storagePolicy.databaseSoleCopyAllowed === false
  && manifest.storagePolicy.cleanMachineRecoveryRequired === true,
'contract freezes causal alignment and durable clean-machine recovery policy');

console.log(`ML35_RUNTIME_DATASET_CONTRACT_CHECKS: ${passed} total, ${passed} passed, 0 failed`);
