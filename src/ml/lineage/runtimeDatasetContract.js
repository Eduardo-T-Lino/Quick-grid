import {
  BASELINE_MANIFEST,
  SIMULATION_FINGERPRINT_SHA256 as SOURCE_RUNTIME_FINGERPRINT_SHA256
} from './baselineManifest.js';

export const RUNTIME_TELEMETRY_SCHEMA_VERSION = 3;
export const FEATURE_ACTION_MANIFEST_VERSION = '3.0.0';
export const RUNTIME_DATASET_CONTRACT_VERSION = 'ML3.5-1';
export const DATASET_GENERATION_ID = 'runtime-0.6.3-ml2-schema3-g1';
export const DATASET_GENERATION_VERSION = '1.0.0';

export const SURFACE_ENCODING = Object.freeze({
  version: 'surface-encoding-1.0.0',
  domain: Object.freeze(['TARMAC', 'KERB', 'RUNOFF', 'GRAVEL'])
});

export const TRACK_CONDITION_ENCODING = Object.freeze({
  version: 'track-condition-encoding-1.0.0',
  domain: Object.freeze(['dry', 'wet'])
});

export const V3_OBSERVATION_FEATURES = Object.freeze([
  'carState.speed',
  'carState.forwardVelocity',
  'carState.lateralVelocity',
  'carState.yawRate',
  'carState.slipAngle',
  'carState.steeringAngle',
  'carState.crossTrackError',
  'carState.headingError',
  'trackState.distanceToLeftEdge',
  'trackState.distanceToRightEdge',
  'trackState.currentCurvature',
  'trackState.futureCurvature5m',
  'trackState.futureCurvature10m',
  'trackState.futureCurvature20m',
  'trackState.trackProgress',
  'trackState.surface',
  'trackState.slope',
  'powertrainState.gear',
  'powertrainState.rpm',
  'powertrainState.engineAcceleration',
  'powertrainState.brakePressure',
  'powertrainState.automaticTransmission',
  'boostState.active',
  'boostState.charge',
  'boostState.cooldownSeconds',
  'boostState.needsRelease',
  'boostState.carry',
  'dynamicsState.rearSlip',
  'dynamicsState.tyreTemperatureCelsius',
  'dynamicsState.tyreWear',
  'aeroState.wakeIntensity',
  'aeroState.wakeSpeedAllowanceKmh',
  'environmentState.trackCondition'
]);

export const V3_TARGET_ORDER = Object.freeze([
  'driverAction.steering',
  'driverAction.throttle',
  'driverAction.brake',
  'driverAction.boostRequested',
  'driverAction.gearShiftRequest'
]);

const STATE_T = 'PRE_PHYSICS_STATE_T';
const ACTION_T = 'POST_INPUT_RESOLUTION_PRE_PHYSICS_ACTION_T';
const SAMPLE_T = 'ATOMIC_SAMPLE_ENVELOPE_T';

function spec(path, type, unit, range, captureTiming, causalSemantics, validationRule) {
  const frozenRange = range.values
    ? Object.freeze({ ...range, values: Object.freeze([...range.values]) })
    : Object.freeze({ ...range });
  return Object.freeze({
    path, type, unit, range: frozenRange, required: true,
    captureTiming, causalSemantics, validationRule
  });
}

const metadata = [
  spec('schemaVersion', 'integer', 'version', { min: 3, max: 3 }, SAMPLE_T,
    'Top-level discriminator for the V3 reader.', 'integer equal to 3'),
  spec('metadata.schemaVersion', 'integer', 'version', { min: 3, max: 3 }, SAMPLE_T,
    'Self-describes the metadata envelope without consulting outer context.', 'integer equal to 3'),
  spec('metadata.sessionId', 'string', 'opaque-id', { minLength: 1 }, SAMPLE_T,
    'Identifies one immutable collection session.', 'non-empty string'),
  spec('metadata.sampleIndex', 'integer', 'sample-index', { min: 0 }, SAMPLE_T,
    'Orders samples inside one session.', 'integer greater than or equal to zero'),
  spec('metadata.timestamp', 'number', 'milliseconds', { min: 0 }, SAMPLE_T,
    'Monotonic collection timestamp for state and action at t.', 'finite number greater than or equal to zero'),
  spec('metadata.trackId', 'integer', 'runtime-track-id', { min: 0 }, SAMPLE_T,
    'Identifies the runtime track used by this sample.', 'integer greater than or equal to zero'),
  spec('metadata.lapNumber', 'integer', 'lap-index', { min: 1 }, SAMPLE_T,
    'Identifies the lap containing the sample.', 'integer greater than or equal to one'),
  spec('metadata.driverType', 'enum', 'category', { values: ['PLAYER'] }, SAMPLE_T,
    'Constrains this generation to human player intent.', 'one of PLAYER'),
  spec('metadata.datasetGenerationId', 'string', 'version-id', { value: DATASET_GENERATION_ID }, SAMPLE_T,
    'Binds the sample to one immutable dataset generation.', `equal to ${DATASET_GENERATION_ID}`),
  spec('metadata.runtimeDatasetContractVersion', 'string', 'version', { value: RUNTIME_DATASET_CONTRACT_VERSION }, SAMPLE_T,
    'Binds field semantics and capture timing.', `equal to ${RUNTIME_DATASET_CONTRACT_VERSION}`),
  spec('metadata.gameBuildVersion', 'string', 'version', { value: BASELINE_MANIFEST.lineage.gameBuildVersion }, SAMPLE_T,
    'Prevents mixing runtime build strata.', `equal to ${BASELINE_MANIFEST.lineage.gameBuildVersion}`),
  spec('metadata.physicsVersion', 'string', 'version', { value: BASELINE_MANIFEST.lineage.physicsVersion }, SAMPLE_T,
    'Binds the dynamics that generated the transition.', `equal to ${BASELINE_MANIFEST.lineage.physicsVersion}`),
  spec('metadata.trackGeometryVersion', 'string', 'version', { value: BASELINE_MANIFEST.lineage.trackGeometryVersion }, SAMPLE_T,
    'Binds geometric feature meaning.', `equal to ${BASELINE_MANIFEST.lineage.trackGeometryVersion}`),
  spec('metadata.featureActionManifestVersion', 'string', 'version', { value: FEATURE_ACTION_MANIFEST_VERSION }, SAMPLE_T,
    'Binds canonical vector and target order.', `equal to ${FEATURE_ACTION_MANIFEST_VERSION}`),
  spec('metadata.sourceRuntimeFingerprintSha256', 'string', 'sha256', { pattern: '^[0-9a-f]{64}$' }, SAMPLE_T,
    'Records the pre-V3 runtime freeze used as source.', `equal to ${SOURCE_RUNTIME_FINGERPRINT_SHA256}`),
  spec('metadata.simulationFingerprintSha256', 'string', 'sha256', { pattern: '^[0-9a-f]{64}$' }, SAMPLE_T,
    'Binds runtime dynamics and the complete V3 data contract.', 'equal to the declared V3 simulation fingerprint')
];

const observations = [
  spec('carState.speed', 'number', 'meters-per-simulation-tick', { min: 0 }, STATE_T,
    'Scalar velocity before action(t).', 'finite number greater than or equal to zero'),
  spec('carState.forwardVelocity', 'number', 'meters-per-simulation-tick', {}, STATE_T,
    'Signed longitudinal velocity before action(t).', 'finite number'),
  spec('carState.lateralVelocity', 'number', 'meters-per-simulation-tick', {}, STATE_T,
    'Signed lateral velocity driving slip and tyre demand.', 'finite number'),
  spec('carState.yawRate', 'number', 'radians-per-simulation-tick', {}, STATE_T,
    'Angular velocity before action(t).', 'finite number'),
  spec('carState.slipAngle', 'number', 'radians', { min: -Math.PI, max: Math.PI }, STATE_T,
    'Current body slip, not an outcome of action(t).', 'finite number in [-pi, pi]'),
  spec('carState.steeringAngle', 'number', 'normalized', { min: -1, max: 1 }, STATE_T,
    'Steering actuator state inherited from the previous tick.', 'finite number in [-1, 1]'),
  spec('carState.crossTrackError', 'number', 'meters', {}, STATE_T,
    'Signed displacement from the reference lane.', 'finite number'),
  spec('carState.headingError', 'number', 'radians', { min: -Math.PI, max: Math.PI }, STATE_T,
    'Rotation-invariant orientation error.', 'finite number in [-pi, pi]'),
  spec('trackState.distanceToLeftEdge', 'number', 'meters', {}, STATE_T,
    'Signed physical clearance to the left track edge.', 'finite number'),
  spec('trackState.distanceToRightEdge', 'number', 'meters', {}, STATE_T,
    'Signed physical clearance to the right track edge.', 'finite number'),
  spec('trackState.currentCurvature', 'number', 'radians-per-meter', { min: 0 }, STATE_T,
    'Current absolute path curvature.', 'finite number greater than or equal to zero'),
  spec('trackState.futureCurvature5m', 'number', 'radians-per-meter', { min: 0 }, STATE_T,
    'Geometry known at t, sampled 5 m ahead; not future vehicle state.', 'finite number greater than or equal to zero'),
  spec('trackState.futureCurvature10m', 'number', 'radians-per-meter', { min: 0 }, STATE_T,
    'Geometry known at t, sampled 10 m ahead; not future vehicle state.', 'finite number greater than or equal to zero'),
  spec('trackState.futureCurvature20m', 'number', 'radians-per-meter', { min: 0 }, STATE_T,
    'Geometry known at t, sampled 20 m ahead; not future vehicle state.', 'finite number greater than or equal to zero'),
  spec('trackState.trackProgress', 'number', 'ratio', { min: 0, max: 1.0001 }, STATE_T,
    'Continuous current position around the lap.', 'finite number in [0, 1.0001]'),
  spec('trackState.surface', 'enum', 'category', { values: SURFACE_ENCODING.domain }, STATE_T,
    'Current tyre contact surface controlling grip and boost eligibility.', 'member of the versioned surface domain'),
  spec('trackState.slope', 'number', 'runtime-grade-coefficient', {}, STATE_T,
    'Current path slope used directly by longitudinal gravity.', 'finite number'),
  spec('powertrainState.gear', 'integer', 'gear-index', { min: 1, max: 6 }, STATE_T,
    'Current gear changes torque response.', 'integer in [1, 6]'),
  spec('powertrainState.rpm', 'number', 'revolutions-per-minute', { min: 0, max: 8500 }, STATE_T,
    'Current engine speed used by automatic shifting.', 'finite number in [0, 8500]'),
  spec('powertrainState.engineAcceleration', 'number', 'meters-per-simulation-tick-squared', {}, STATE_T,
    'Persistent smoothed engine acceleration entering the next update.', 'finite number'),
  spec('powertrainState.brakePressure', 'number', 'normalized', { min: 0, max: 1 }, STATE_T,
    'Persistent hydraulic brake state entering the next update.', 'finite number in [0, 1]'),
  spec('powertrainState.automaticTransmission', 'boolean', 'boolean', { values: [false, true] }, STATE_T,
    'Determines whether human gear-shift requests are effective.', 'boolean'),
  spec('boostState.active', 'boolean', 'boolean', { values: [false, true] }, STATE_T,
    'Effective boost state inherited from t-1; never the result of current request.', 'boolean'),
  spec('boostState.charge', 'number', 'ratio', { min: 0, max: 1 }, STATE_T,
    'Energy available before action(t).', 'finite number in [0, 1]'),
  spec('boostState.cooldownSeconds', 'number', 'seconds', { min: 0, max: BASELINE_MANIFEST.physicsConstants.boost.delay }, STATE_T,
    'Recharge delay remaining before action(t).', 'finite number within the runtime boost delay'),
  spec('boostState.needsRelease', 'boolean', 'boolean', { values: [false, true] }, STATE_T,
    'Latch requiring button release after depletion.', 'boolean'),
  spec('boostState.carry', 'boolean', 'boolean', { values: [false, true] }, STATE_T,
    'Previously earned boost momentum activates coast behavior.', 'boolean'),
  spec('dynamicsState.rearSlip', 'number', 'normalized-slip-demand', { min: 0, max: BASELINE_MANIFEST.physicsConstants.rearSlip.max }, STATE_T,
    'Persistent RWD rear-axle slip affecting drift response.', 'finite number within the runtime rear-slip bound'),
  spec('dynamicsState.tyreTemperatureCelsius', 'number', 'degrees-celsius', { min: 35, max: 145 }, STATE_T,
    'Current tyre temperature changes available grip.', 'finite number in [35, 145]'),
  spec('dynamicsState.tyreWear', 'number', 'ratio', { min: 0, max: 1 }, STATE_T,
    'Current tyre wear changes available grip.', 'finite number in [0, 1]'),
  spec('aeroState.wakeIntensity', 'number', 'ratio', { min: 0, max: 1 }, STATE_T,
    'Current aerodynamic wake changes drag, grip and acceleration.', 'finite number in [0, 1]'),
  spec('aeroState.wakeSpeedAllowanceKmh', 'number', 'kilometers-per-hour', { min: 0, max: BASELINE_MANIFEST.physicsConstants.wake.extraSpeedKmh }, STATE_T,
    'Persistent wake speed allowance entering the next update.', 'finite number within the runtime wake allowance'),
  spec('environmentState.trackCondition', 'enum', 'category', { values: TRACK_CONDITION_ENCODING.domain }, STATE_T,
    'Dry or wet condition changes the tyre grip model.', 'member of the versioned track-condition domain')
];

const actions = [
  spec('driverAction.steering', 'number', 'normalized', { min: -1, max: 1 }, ACTION_T,
    'Resolved steering intent consumed by physics at t.', 'finite number in [-1, 1]'),
  spec('driverAction.throttle', 'number', 'normalized', { min: 0, max: 1 }, ACTION_T,
    'Resolved accelerator intent consumed by physics at t.', 'finite number in [0, 1]'),
  spec('driverAction.brake', 'number', 'normalized', { min: 0, max: 1 }, ACTION_T,
    'Resolved braking/reverse intent consumed by physics at t.', 'finite number in [0, 1]'),
  spec('driverAction.boostRequested', 'boolean', 'boolean', { values: [false, true] }, ACTION_T,
    'Human boost-button intent before updateBoost computes effective state.', 'boolean'),
  spec('driverAction.gearShiftRequest', 'integer', 'discrete-step', { values: [-1, 0, 1] }, ACTION_T,
    'Human downshift, no-shift or upshift intent; automatic shifts are state transitions, not labels.', 'integer member of {-1, 0, 1}')
];

const events = [
  spec('eventState.offTrack', 'boolean', 'boolean', { values: [false, true] }, STATE_T,
    'Off-track state already observed at t.', 'boolean'),
  spec('eventState.collision', 'boolean', 'boolean', { values: [false, true] }, STATE_T,
    'Contact state already observed at t.', 'boolean'),
  spec('eventState.spin', 'boolean', 'boolean', { values: [false, true] }, STATE_T,
    'Spin condition already observed at t.', 'boolean'),
  spec('eventState.isRecovering', 'boolean', 'boolean', { values: [false, true] }, STATE_T,
    'Recovery condition already observed at t.', 'boolean')
];

export const V3_FIELD_SPECIFICATIONS = Object.freeze({
  metadata: Object.freeze(metadata),
  observations: Object.freeze(observations),
  actions: Object.freeze(actions),
  events: Object.freeze(events)
});

export const V3_FEATURE_ACTION_MANIFEST = Object.freeze({
  version: FEATURE_ACTION_MANIFEST_VERSION,
  observationFeatures: V3_OBSERVATION_FEATURES,
  actionTargets: V3_TARGET_ORDER,
  encodings: Object.freeze({ surface: SURFACE_ENCODING, trackCondition: TRACK_CONDITION_ENCODING })
});

export const RUNTIME_DATASET_CONTRACT = Object.freeze({
  contractVersion: RUNTIME_DATASET_CONTRACT_VERSION,
  datasetGenerationId: DATASET_GENERATION_ID,
  schemaVersion: RUNTIME_TELEMETRY_SCHEMA_VERSION,
  causalAlignment: 'STATE_T_TO_ACTION_T',
  sampleRateHz: BASELINE_MANIFEST.rates.sampleRateHz,
  featureActionManifest: V3_FEATURE_ACTION_MANIFEST,
  fields: V3_FIELD_SPECIFICATIONS
});

// The declared hash is verified in ML3.5 tests. Keep this input browser/server neutral.
export const RUNTIME_DATASET_FINGERPRINT_INPUT = Object.freeze({
  fingerprintFormatVersion: 1,
  sourceRuntimeFingerprintSha256: SOURCE_RUNTIME_FINGERPRINT_SHA256,
  runtime: Object.freeze({
    lineage: BASELINE_MANIFEST.lineage,
    rates: BASELINE_MANIFEST.rates,
    physicsConstants: BASELINE_MANIFEST.physicsConstants,
    playerInputConstants: BASELINE_MANIFEST.playerInputConstants,
    startingGrid: BASELINE_MANIFEST.startingGrid,
    geometry: BASELINE_MANIFEST.geometry
  }),
  datasetContract: RUNTIME_DATASET_CONTRACT
});

export const RUNTIME_DATASET_SIMULATION_FINGERPRINT_SHA256 = '7745d5d3641ca5f63ac3a38eed0af4e86c5509ea5f6964271759e3652ca94040';
export { SOURCE_RUNTIME_FINGERPRINT_SHA256 };
