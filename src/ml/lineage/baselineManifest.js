// ML2.2 accepted-lineage metadata. This module must stay browser/server neutral.

export const BASELINE_MANIFEST_FORMAT_VERSION = 1;

export const TELEMETRY_LINEAGE_VERSIONS = Object.freeze({
  SCHEMA_VERSION: 2,
  GAME_BUILD_VERSION: '0.3.0-ml2',
  TRACK_GEOMETRY_VERSION: '1.5.0-centripetal',
  PHYSICS_VERSION: '1.5.0-gt3',
  FEATURE_MANIFEST_VERSION: '2.1.0',
  CONSENT_VERSION: '1.0.0'
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

// Arrays are ordered deliberately: feature and target order is part of the fingerprint.
export const BASELINE_MANIFEST = deepFreeze({
  manifestFormatVersion: BASELINE_MANIFEST_FORMAT_VERSION,
  lineage: {
    schemaVersion: TELEMETRY_LINEAGE_VERSIONS.SCHEMA_VERSION,
    gameBuildVersion: TELEMETRY_LINEAGE_VERSIONS.GAME_BUILD_VERSION,
    trackGeometryVersion: TELEMETRY_LINEAGE_VERSIONS.TRACK_GEOMETRY_VERSION,
    physicsVersion: TELEMETRY_LINEAGE_VERSIONS.PHYSICS_VERSION,
    featureManifestVersion: TELEMETRY_LINEAGE_VERSIONS.FEATURE_MANIFEST_VERSION
  },
  rates: {
    sampleRateHz: 10,
    simulationHz: 60
  },
  physicsConstants: {
    maxSpeedKmh: 285,
    maxInternalSpeedMetersPerTick: 1.35,
    defaultTrackWidthMeters: 24,
    tractionForce: 0.045,
    airResistance: 0.00105,
    accelerationSmoothing: 0.028,
    brakeSmoothing: 0.12,
    maxBrakeForce: 0.020,
    wheelbaseMeters: 2.70,
    baseGrip: 0.052,
    aeroGrip: 0.030,
    tractionControlSlipLimit: 0.105,
    absSlipLimit: 0.165,
    gearSpeeds: [0, 0.25, 0.46, 0.68, 0.90, 1.13, 1.38],
    gearPower: [0, 0.028, 0.024, 0.021, 0.018, 0.016, 0.014],
    steeringApplication: {
      roadWheelAngleRadiansAtZeroSpeed: 0.32,
      roadWheelAngleSpeedReductionRadians: 0.20
    }
  },
  playerInputConstants: {
    keyboardSteeringRampPerTickAtZeroSpeed: 0.085,
    keyboardSteeringRampPerTickAtMaxSpeed: 0.060,
    keyboardSteeringLockAtZeroSpeed: 1.0,
    keyboardSteeringLockAtMaxSpeed: 0.88,
    keyboardSteeringReturnPerTick: 0.12,
    keyboardSteeringDeadzone: 0.01
  },
  geometry: {
    algorithm: 'centripetal-catmull-rom',
    alpha: 0.5,
    nominalSamplingMeters: 1.5,
    minimumStepsPerSegment: 4,
    duplicateWaypointThresholdMeters: 0.5,
    projection: 'continuous-nearest-segment',
    progress: 'cumulative-distance-normalized'
  },
  featureManifest: {
    observationFeatures: [
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
      'trackState.surface'
    ],
    actionTargets: [
      'driverAction.steering',
      'driverAction.throttle',
      'driverAction.brake'
    ],
    surfaceEncodingDomain: ['TARMAC', 'KERB', 'RUNOFF', 'GRAVEL']
  }
});

// SHA-256 of stableSerialize(BASELINE_MANIFEST); verified by test:ml22:final.
export const SIMULATION_FINGERPRINT_SHA256 = '919c932171a41a44d40af1d86df530a8f3db911b030691b68908766712a6c16c';

export function stableSerialize(value) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  throw new TypeError(`Unsupported baseline manifest value: ${typeof value}`);
}
