import {
  ELIGIBILITY_DECISION,
  evaluateLap,
  evaluateLineage,
  evaluateLineagePartition,
  evaluateSample,
  evaluateSegment,
  evaluateSession,
  ML3_QUALITY_POLICY_VERSION,
  QUALITY_POLICY
} from './ml3/qualityPolicy.js';
import {
  SIMULATION_FINGERPRINT_SHA256,
  TELEMETRY_LINEAGE_VERSIONS
} from '../src/ml/lineage/acceptedBaseline.js';
import {
  SIMULATION_FINGERPRINT_SHA256 as RUNTIME_FINGERPRINT,
  TELEMETRY_LINEAGE_VERSIONS as RUNTIME_VERSIONS
} from '../src/ml/lineage/baselineManifest.js';

let passed = 0;
let failed = 0;

function check(condition, label) {
  if (!condition) {
    failed++;
    throw new Error(label);
  }
  passed++;
  console.log(`  PASS: ${label}`);
}

function acceptedLineage(gameBuildVersion = '0.2.0-ml2', overrides = {}) {
  return {
    schemaVersion: TELEMETRY_LINEAGE_VERSIONS.SCHEMA_VERSION,
    gameBuildVersion,
    trackGeometryVersion: TELEMETRY_LINEAGE_VERSIONS.TRACK_GEOMETRY_VERSION,
    physicsVersion: TELEMETRY_LINEAGE_VERSIONS.PHYSICS_VERSION,
    featureManifestVersion: TELEMETRY_LINEAGE_VERSIONS.FEATURE_MANIFEST_VERSION,
    simulationFingerprint: gameBuildVersion === '0.3.0-ml2' ? SIMULATION_FINGERPRINT_SHA256 : null,
    ...overrides
  };
}

function verifiedQuality(batchCount = 41, overrides = {}) {
  return {
    structuralIntegrity: {
      invalidNumeric: 0,
      trackProgressOutOfRange: 0,
      driverActionOutOfRange: 0,
      sampleCountMismatch: false,
      batchCountMismatch: false,
      schemaVersionMismatch: 0,
      trackIdMismatch: 0,
      driverTypeInvalid: 0
    },
    temporalIntegrity: {
      timestampMonotonicityViolations: 0,
      sampleIndexMonotonicityViolations: 0,
      duplicateSamples: 0,
      batchGaps: 0,
      batchSequenceDuplicates: 0,
      sampleIndexGaps: 0,
      timestampGaps: { above150ms: 2, above250ms: 2, above500ms: 2, above1s: 2 }
    },
    payloadIntegrity: {
      batchesTotal: batchCount,
      gzipValid: batchCount,
      gzipInvalid: 0,
      jsonValid: batchCount,
      jsonInvalid: 0,
      arrayValid: batchCount,
      arrayInvalid: 0,
      countMatch: batchCount,
      countMismatch: 0,
      firstLastMetadataMatch: batchCount,
      firstLastMetadataMismatch: 0
    },
    ...overrides
  };
}

function humanSession(overrides = {}) {
  return {
    ...acceptedLineage(),
    sessionId: 'ad759118-4386-481f-9d34-f3d496eb1854',
    collectionKind: 'HUMAN',
    status: 'COMPLETED',
    scope: 'PLAYER_ONLY',
    driverTypes: ['PLAYER'],
    rawPayloadAvailable: true,
    sampleRateHz: 10,
    sampleCount: 1940,
    batchCount: 41,
    qualitySignals: verifiedQuality(),
    ...overrides
  };
}

function cleanLap(overrides = {}) {
  return {
    lapNumber: 1,
    sampleCount: 600,
    lapTime: 60,
    validLap: true,
    offTrackCount: 0,
    collisionCount: 0,
    spinCount: 0,
    ...overrides
  };
}

function cleanSegment(overrides = {}) {
  return {
    sampleCount: 50,
    sampleRateHz: 10,
    lineageStratum: '0.2.0-ml2',
    sameSession: true,
    sameLap: true,
    sampleIndexesContiguous: true,
    timestampsStrictlyIncreasing: true,
    minDeltaMs: 100,
    maxDeltaMs: 100,
    temporalGapCount: 0,
    boundaryContextComplete: true,
    eventWindowContaminatedSamples: 0,
    invalidNumericSamples: 0,
    invalidActionSamples: 0,
    disallowedSurfaceSamples: 0,
    ...overrides
  };
}

function cleanSample(overrides = {}) {
  return {
    requiredFieldsPresent: true,
    numericFinite: true,
    actionInRange: true,
    causalV2: true,
    eventFlagsClear: true,
    eventWindowClear: true,
    temporalWindowClear: true,
    sameSession: true,
    sameLap: true,
    sameLineageStratum: true,
    surface: 'TARMAC',
    ...overrides
  };
}

function run() {
  console.log('ML3.1 deterministic quality-policy tests');
  try {
    check(ML3_QUALITY_POLICY_VERSION === 'ML3.1-1'
      && QUALITY_POLICY.acceptedInventoryCanonicalSha256 === 'ade0e99d5162eeea75dfeea9aa70068b64588d025d33d35b5cf7ea335a3ffe68',
    'policy is versioned and anchored to the final ML3.0 canonical inventory');
    check(Object.isFrozen(QUALITY_POLICY) && Object.isFrozen(QUALITY_POLICY.eventExclusionWindowsMs),
      'policy constants and exclusion windows are immutable');

    const lineage02 = evaluateLineage(acceptedLineage());
    check(lineage02.decision === ELIGIBILITY_DECISION.ELIGIBLE
      && lineage02.lineageStratum === '0.2.0-ml2'
      && lineage02.reasons.includes('HISTORICAL_0_2_FINGERPRINT_NOT_RECORDED'),
    'historical 0.2 is isolated and may retain its documented missing fingerprint');

    const lineage03 = evaluateLineage(acceptedLineage('0.3.0-ml2'));
    check(lineage03.decision === ELIGIBILITY_DECISION.ELIGIBLE
      && lineage03.lineageStratum === '0.3.0-ml2',
    '0.3 with the accepted fingerprint forms its own eligible lineage stratum');

    const missing03Fingerprint = evaluateLineage(acceptedLineage('0.3.0-ml2', { simulationFingerprint: null }));
    check(missing03Fingerprint.decision === ELIGIBILITY_DECISION.REVIEW_REQUIRED,
      '0.3 cannot advance without the accepted fingerprint');

    const mismatchedFingerprint = evaluateLineage(acceptedLineage('0.2.0-ml2', { simulationFingerprint: 'a'.repeat(64) }));
    check(mismatchedFingerprint.decision === ELIGIBILITY_DECISION.INELIGIBLE,
      'a recorded fingerprint mismatch is ineligible');

    const runtimeLineage = evaluateLineage({
      schemaVersion: RUNTIME_VERSIONS.SCHEMA_VERSION,
      gameBuildVersion: RUNTIME_VERSIONS.GAME_BUILD_VERSION,
      trackGeometryVersion: RUNTIME_VERSIONS.TRACK_GEOMETRY_VERSION,
      physicsVersion: RUNTIME_VERSIONS.PHYSICS_VERSION,
      featureManifestVersion: RUNTIME_VERSIONS.FEATURE_MANIFEST_VERSION,
      simulationFingerprint: RUNTIME_FINGERPRINT
    });
    check(runtimeLineage.decision === ELIGIBILITY_DECISION.INELIGIBLE
      && runtimeLineage.reasons.includes('RUNTIME_0_6_STRATUM_ISOLATED'),
    'runtime 0.6.x is not admitted into either accepted historical stratum');

    check(evaluateLineagePartition([acceptedLineage(), acceptedLineage()]).decision === ELIGIBILITY_DECISION.ELIGIBLE,
      'a partition containing only 0.2 lineage remains eligible');
    check(evaluateLineagePartition([acceptedLineage(), acceptedLineage('0.3.0-ml2')])
      .reasons.includes('CROSS_LINEAGE_MIX_PROHIBITED'),
    '0.2 and 0.3 cannot be mixed automatically');
    check(evaluateLineagePartition([acceptedLineage(), {
      ...acceptedLineage(), gameBuildVersion: RUNTIME_VERSIONS.GAME_BUILD_VERSION
    }]).decision === ELIGIBILITY_DECISION.INELIGIBLE,
    'a partition containing runtime 0.6.x is rejected');

    const eligibleSession = evaluateSession(humanSession());
    check(eligibleSession.decision === ELIGIBILITY_DECISION.ELIGIBLE
      && eligibleSession.reasons.includes('TEMPORAL_GAPS_REQUIRE_SEGMENT_BOUNDARIES'),
    'ad759 session-level integrity passes while timestamp gaps remain segment boundaries');

    const automatic03 = evaluateSession(humanSession({
      ...acceptedLineage('0.3.0-ml2'),
      sessionId: 'd2d44255-6487-4210-9daa-2e19f2df5ff3',
      collectionKind: 'AUTOMATIC',
      sampleCount: 58,
      batchCount: 2,
      qualitySignals: verifiedQuality(2)
    }));
    check(automatic03.decision === ELIGIBILITY_DECISION.NON_TRAINING,
      'the only 0.3 reference remains automatic non-training evidence');

    check(evaluateSession(humanSession({ collectionKind: 'UNKNOWN' })).decision === ELIGIBILITY_DECISION.REVIEW_REQUIRED,
      'unknown provenance is never promoted automatically');
    check(evaluateSession(humanSession({ status: 'ACTIVE' })).decision === ELIGIBILITY_DECISION.INELIGIBLE,
      'an active session is ineligible');
    check(evaluateSession(humanSession({ payloadCorrupt: true })).decision === ELIGIBILITY_DECISION.INELIGIBLE,
      'a corrupt payload is ineligible');
    check(evaluateSession(humanSession({ qualitySignals: null })).decision === ELIGIBILITY_DECISION.REVIEW_REQUIRED,
      'missing enhanced quality evidence requires review');
    const mismatchedPayload = verifiedQuality();
    mismatchedPayload.payloadIntegrity.countMismatch = 1;
    check(evaluateSession(humanSession({ qualitySignals: mismatchedPayload })).decision === ELIGIBILITY_DECISION.INELIGIBLE,
      'a payload count mismatch blocks the session');

    const eligibleLap = evaluateLap(cleanLap(), eligibleSession);
    check(eligibleLap.decision === ELIGIBILITY_DECISION.ELIGIBLE && eligibleLap.allowsSegmentEvaluation,
      'a clean valid lap is eligible and may be segmented');
    const eventLap = evaluateLap(cleanLap({ validLap: false, offTrackCount: 1, spinCount: 2 }), eligibleSession);
    check(eventLap.decision === ELIGIBILITY_DECISION.SEGMENT_ONLY && eventLap.allowsSegmentEvaluation,
      'localized off-track or spin events block whole-lap use but permit clean-segment review');
    check(evaluateLap(cleanLap({ validLap: false, collisionCount: 1 }), eligibleSession)
      .decision === ELIGIBILITY_DECISION.INELIGIBLE,
    'a collision blocks the remainder of its lap');
    check(evaluateLap(cleanLap(), evaluateSession(humanSession({ status: 'ACTIVE' })))
      .decision === ELIGIBILITY_DECISION.INELIGIBLE,
    'lap eligibility cannot bypass its parent session');

    const eligibleSegment = evaluateSegment(cleanSegment(), {
      sessionEvaluation: eligibleSession,
      lapEvaluation: eventLap
    });
    check(eligibleSegment.decision === ELIGIBILITY_DECISION.ELIGIBLE,
      'a fixed clean window can pass inside a segment-only lap');
    check(evaluateSegment(cleanSegment({ lineageStratum: '0.3.0-ml2' }), {
      sessionEvaluation: eligibleSession, lapEvaluation: eventLap
    }).decision === ELIGIBILITY_DECISION.INELIGIBLE,
    'a segment cannot cross lineage strata');
    check(evaluateSegment(cleanSegment({ maxDeltaMs: 151, temporalGapCount: 1 }), {
      sessionEvaluation: eligibleSession, lapEvaluation: eventLap
    }).decision === ELIGIBILITY_DECISION.INELIGIBLE,
    'a temporal gap blocks the segment');
    check(evaluateSegment(cleanSegment({ eventWindowContaminatedSamples: 1 }), {
      sessionEvaluation: eligibleSession, lapEvaluation: eventLap
    }).decision === ELIGIBILITY_DECISION.INELIGIBLE,
    'event exclusion windows block contaminated segments');
    check(evaluateSegment(cleanSegment({ boundaryContextComplete: false }), {
      sessionEvaluation: eligibleSession, lapEvaluation: eventLap
    }).decision === ELIGIBILITY_DECISION.INELIGIBLE,
    'incomplete pre/post exclusion context blocks a segment');
    check(evaluateSegment(cleanSegment({ sampleCount: 49 }), {
      sessionEvaluation: eligibleSession, lapEvaluation: eventLap
    }).decision === ELIGIBILITY_DECISION.INELIGIBLE,
    'segments must use the fixed 50-sample window');

    const eligibleSample = evaluateSample(cleanSample(), eligibleSegment);
    check(eligibleSample.decision === ELIGIBILITY_DECISION.ELIGIBLE
      && eligibleSample.finalTrainingEligible === false,
    'sample policy eligibility never declares a final training sample');
    check(evaluateSample({ unflagged: true }, eligibleSegment).decision === ELIGIBILITY_DECISION.REVIEW_REQUIRED,
      'UNFLAGGED alone is insufficient for sample eligibility');
    check(evaluateSample(cleanSample({ eventWindowClear: false }), eligibleSegment)
      .decision === ELIGIBILITY_DECISION.INELIGIBLE,
    'a sample inside an event exclusion window is ineligible');
    check(evaluateSample(cleanSample({ surface: 'GRAVEL' }), eligibleSegment)
      .decision === ELIGIBILITY_DECISION.INELIGIBLE,
    'gravel and runoff are excluded from training-policy samples');
    check(evaluateSample(cleanSample({ surface: 'KERB' }), eligibleSegment)
      .decision === ELIGIBILITY_DECISION.ELIGIBLE,
    'kerb remains an explicitly allowed surface');

    const decisions = [lineage02, lineage03, runtimeLineage, eligibleSession, automatic03,
      eligibleLap, eventLap, eligibleSegment, eligibleSample];
    check(decisions.every(item => item.finalTrainingEligible === false),
      'no ML3.1 decision constructs or approves the final training dataset');
  } catch (error) {
    if (!failed) failed++;
    console.error(`FAIL: ${error.message}`);
  }
  console.log(`ML3_QUALITY_POLICY_CHECKS: ${passed} total, ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

run();
