// Current runtime lineage. Historical acceptance is preserved in acceptedBaseline.js.
// This module must stay browser/server neutral.

export const BASELINE_MANIFEST_FORMAT_VERSION = 1;

export const TELEMETRY_LINEAGE_VERSIONS = Object.freeze({
  SCHEMA_VERSION: 2,
  GAME_BUILD_VERSION: '0.6.3-ml2',
  TRACK_GEOMETRY_VERSION: '1.5.0-centripetal',
  PHYSICS_VERSION: '1.8.3-gt3-drift-coast',
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
    baseGrip: 0.047,
    aeroGrip: 0.030,
    rearLateralDemand: 0.60,
    drivenAxle: 'rear',
    engineSpeedLimitMetersPerTick: 1.35 * 320 / 285,
    boost: { duration: 3, recharge: 12, delay: 2, minCharge: 0.2, power: 2.1, maxSpeedKmh: 400,
      coastAeroFactor: 0.15, coastRollingDrag: 0.9997, coastBlendKmh: 20 },
    driftControl: { slipWindow: 0.25, fadeAngle: 1.05, fadeRange: 0.4, yawResponse: 0.16, oversteerRelief: 0.65 },
    reverse: { maxSpeedKmh: 50, driveFraction: 0.35, signedBrakingAndDrag: true },
    gravelHandling: { lowSpeedDrag: 0.985, highSpeedDrag: 0.88,
      dragBlendSpeed: 0.5, maneuverSpeed: 0.18, extraSteer: 0.35 },
    rearSlideGripLoss: 0.45,
    oversteerGain: 0.035,
    yawRecoveryLoss: 0.65,
    maxYawRate: 0.10,
    rearSlip: { max: 1.5, lateralExcessGain: 0.65, rise: 0.16, recovery: 0.07,
      axleAngleSpeedFloor: 0.05, axleLateralDemandGain: 0.045, axleDemandFadeSpeed: 0.35,
      maxAxleAngle: 0.35, torqueFadeSpeed: 0.45, yawDamping: 0.98, yawStopFadeSpeed: 0.15 },
    tractionControlSlipLimit: 0.105,
    absSlipLimit: 0.165,
    gearSpeeds: [0, 0.25, 0.46, 0.68, 0.90, 1.13, 1.72],
    gearPower: [0, 0.028, 0.024, 0.021, 0.018, 0.016, 0.014],
    wake: { range: 70, nearFade: 3, minGap: 3, halfWidth: 2.8, spread: 0.025,
      minSpeed: 0.25, fullSpeed: 0.9, headingAlignment: 0.8, maxHeightGap: 3,
      dragLoss: 0.55, downforceLoss: 0.40, response: 0.12,
      accelerationGain: 0.18, extraSpeedKmh: 30, unlockKmhPerSecond: 2 },
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
  startingGrid: { slots: 20, firstGap: 6, slotGap: 8, laneOffset: 4.5 },
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
export const SIMULATION_FINGERPRINT_SHA256 = '53193ebb1921ecd3f56638054d0acf8fa31d1d7c7647f0e85349a32b96319173';

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
