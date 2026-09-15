import {
  SIMULATION_FINGERPRINT_SHA256,
  TELEMETRY_LINEAGE_VERSIONS
} from '../../src/ml/lineage/acceptedBaseline.js';

export const ML3_QUALITY_POLICY_VERSION = 'ML3.1-1';

export const ELIGIBILITY_DECISION = Object.freeze({
  ELIGIBLE: 'ELIGIBLE',
  SEGMENT_ONLY: 'SEGMENT_ONLY',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  INELIGIBLE: 'INELIGIBLE',
  NON_TRAINING: 'NON_TRAINING'
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const QUALITY_POLICY = deepFreeze({
  acceptedInventoryCanonicalSha256: 'ade0e99d5162eeea75dfeea9aa70068b64588d025d33d35b5cf7ea335a3ffe68',
  lineageStrata: {
    '0.2.0-ml2': { fingerprintRequired: false },
    '0.3.0-ml2': { fingerprintRequired: true }
  },
  schemaVersion: TELEMETRY_LINEAGE_VERSIONS.SCHEMA_VERSION,
  trackGeometryVersion: TELEMETRY_LINEAGE_VERSIONS.TRACK_GEOMETRY_VERSION,
  physicsVersion: TELEMETRY_LINEAGE_VERSIONS.PHYSICS_VERSION,
  featureManifestVersion: TELEMETRY_LINEAGE_VERSIONS.FEATURE_MANIFEST_VERSION,
  simulationFingerprint: SIMULATION_FINGERPRINT_SHA256,
  sampleRateHz: 10,
  segmentSamples: 50,
  adjacentDeltaMs: { min: 50, max: 150 },
  allowedSurfaces: ['TARMAC', 'KERB'],
  eventExclusionWindowsMs: {
    OFF_TRACK: { before: 1000, after: 2000 },
    SPIN: { before: 2000, after: 3000 },
    COLLISION: { before: 2000, after: 'REST_OF_LAP' },
    RECOVERING: { before: 0, after: 2000 },
    TEMPORAL_GAP: { before: 1000, after: 1000 }
  }
});

function uniqueSorted(reasons) {
  return [...new Set(reasons)].sort();
}

function decision(level, value, reasons, details = {}) {
  return {
    policyVersion: ML3_QUALITY_POLICY_VERSION,
    level,
    decision: value,
    policyEligible: value === ELIGIBILITY_DECISION.ELIGIBLE,
    finalTrainingEligible: false,
    reasons: uniqueSorted(reasons),
    ...details
  };
}

function isMissing(value) {
  return value === null || value === undefined;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function exactPlayerDriverTypes(driverTypes) {
  return Array.isArray(driverTypes) && driverTypes.length === 1 && driverTypes[0] === 'PLAYER';
}

export function evaluateLineage(session = {}) {
  const reasons = [];
  const build = session.gameBuildVersion;
  if (isMissing(build)) {
    return decision('lineage', ELIGIBILITY_DECISION.REVIEW_REQUIRED,
      ['GAME_BUILD_MISSING'], { lineageStratum: null });
  }
  const stratum = QUALITY_POLICY.lineageStrata[build];
  if (!stratum) {
    reasons.push('GAME_BUILD_STRATUM_UNSUPPORTED');
    if (/^0\.6\./.test(String(build))) reasons.push('RUNTIME_0_6_STRATUM_ISOLATED');
    return decision('lineage', ELIGIBILITY_DECISION.INELIGIBLE, reasons, { lineageStratum: build });
  }

  const lineageFields = [
    ['schemaVersion', QUALITY_POLICY.schemaVersion, 'SCHEMA'],
    ['trackGeometryVersion', QUALITY_POLICY.trackGeometryVersion, 'TRACK_GEOMETRY'],
    ['physicsVersion', QUALITY_POLICY.physicsVersion, 'PHYSICS'],
    ['featureManifestVersion', QUALITY_POLICY.featureManifestVersion, 'FEATURE_MANIFEST']
  ];
  const missing = lineageFields.filter(([key]) => isMissing(session[key]));
  if (missing.length) {
    return decision('lineage', ELIGIBILITY_DECISION.REVIEW_REQUIRED,
      missing.map(([, , label]) => `${label}_MISSING`), { lineageStratum: build });
  }
  for (const [key, expected, label] of lineageFields) {
    if (session[key] !== expected) reasons.push(`${label}_INCOMPATIBLE`);
  }
  if (reasons.length) {
    return decision('lineage', ELIGIBILITY_DECISION.INELIGIBLE, reasons, { lineageStratum: build });
  }

  const fingerprint = session.simulationFingerprint;
  if (!isMissing(fingerprint) && fingerprint !== QUALITY_POLICY.simulationFingerprint) {
    return decision('lineage', ELIGIBILITY_DECISION.INELIGIBLE,
      ['SIMULATION_FINGERPRINT_MISMATCH'], { lineageStratum: build });
  }
  if (stratum.fingerprintRequired && isMissing(fingerprint)) {
    return decision('lineage', ELIGIBILITY_DECISION.REVIEW_REQUIRED,
      ['SIMULATION_FINGERPRINT_REQUIRED'], { lineageStratum: build });
  }
  reasons.push(isMissing(fingerprint)
    ? 'HISTORICAL_0_2_FINGERPRINT_NOT_RECORDED'
    : 'SIMULATION_FINGERPRINT_MATCH');
  reasons.push('LINEAGE_STRATUM_ISOLATED');
  return decision('lineage', ELIGIBILITY_DECISION.ELIGIBLE, reasons, { lineageStratum: build });
}

export function evaluateLineagePartition(items = []) {
  const evaluations = items.map(item => item?.level === 'lineage' ? item : evaluateLineage(item));
  if (!evaluations.length) {
    return decision('lineage-partition', ELIGIBILITY_DECISION.REVIEW_REQUIRED,
      ['NO_LINEAGE_CANDIDATES'], { lineageStratum: null });
  }
  const blocked = evaluations.filter(item => item.decision !== ELIGIBILITY_DECISION.ELIGIBLE);
  if (blocked.length) {
    return decision('lineage-partition', ELIGIBILITY_DECISION.INELIGIBLE,
      ['PARTITION_CONTAINS_NON_ELIGIBLE_LINEAGE'], { lineageStratum: null });
  }
  const strata = [...new Set(evaluations.map(item => item.lineageStratum))].sort();
  if (strata.length !== 1) {
    return decision('lineage-partition', ELIGIBILITY_DECISION.INELIGIBLE,
      ['CROSS_LINEAGE_MIX_PROHIBITED'], { lineageStratum: null, observedStrata: strata });
  }
  return decision('lineage-partition', ELIGIBILITY_DECISION.ELIGIBLE,
    ['SINGLE_LINEAGE_STRATUM'], { lineageStratum: strata[0], observedStrata: strata });
}

function missingKeys(value, keys) {
  if (!value || typeof value !== 'object') return [...keys];
  return keys.filter(key => isMissing(value[key]));
}

export function evaluateSession(session = {}, lineageEvaluation = evaluateLineage(session)) {
  if (lineageEvaluation.decision !== ELIGIBILITY_DECISION.ELIGIBLE) {
    return decision('session', lineageEvaluation.decision,
      ['PARENT_LINEAGE_NOT_ELIGIBLE', ...lineageEvaluation.reasons],
      { lineageStratum: lineageEvaluation.lineageStratum ?? null });
  }
  const stratum = lineageEvaluation.lineageStratum;
  if (session.collectionKind === 'AUTOMATIC') {
    return decision('session', ELIGIBILITY_DECISION.NON_TRAINING,
      ['AUTOMATIC_COLLECTION_NON_TRAINING'], { lineageStratum: stratum });
  }
  if (session.collectionKind !== 'HUMAN') {
    return decision('session', ELIGIBILITY_DECISION.REVIEW_REQUIRED,
      ['HUMAN_PROVENANCE_NOT_ESTABLISHED'], { lineageStratum: stratum });
  }

  const missing = [];
  if (isMissing(session.status)) missing.push('SESSION_STATUS_MISSING');
  if (isMissing(session.scope)) missing.push('SESSION_SCOPE_MISSING');
  if (!Array.isArray(session.driverTypes) || !session.driverTypes.length) missing.push('DRIVER_TYPES_MISSING');
  if (isMissing(session.rawPayloadAvailable)) missing.push('RAW_PAYLOAD_AVAILABILITY_MISSING');
  if (!finite(session.sampleRateHz)) missing.push('SAMPLE_RATE_MISSING');
  if (!nonNegativeInteger(session.sampleCount)) missing.push('SAMPLE_COUNT_MISSING');
  if (!nonNegativeInteger(session.batchCount)) missing.push('BATCH_COUNT_MISSING');
  if (missing.length) {
    return decision('session', ELIGIBILITY_DECISION.REVIEW_REQUIRED, missing, { lineageStratum: stratum });
  }

  const violations = [];
  if (session.status !== 'COMPLETED') violations.push('SESSION_NOT_COMPLETED');
  if (session.scope !== 'PLAYER_ONLY') violations.push('SESSION_SCOPE_NOT_PLAYER_ONLY');
  if (!exactPlayerDriverTypes(session.driverTypes)) violations.push('SESSION_DRIVER_TYPES_NOT_PLAYER_ONLY');
  if (session.rawPayloadAvailable !== true) violations.push('RAW_PAYLOAD_UNAVAILABLE');
  if (session.sampleRateHz !== QUALITY_POLICY.sampleRateHz) violations.push('SAMPLE_RATE_INCOMPATIBLE');
  if (session.sampleCount <= 0) violations.push('SESSION_EMPTY');
  if (session.batchCount <= 0) violations.push('SESSION_HAS_NO_BATCHES');
  if (session.payloadCorrupt === true) violations.push('PAYLOAD_CORRUPT');

  const quality = session.qualitySignals;
  if (!quality) {
    return decision('session', ELIGIBILITY_DECISION.REVIEW_REQUIRED,
      [...violations, 'SESSION_QUALITY_AUDIT_MISSING'], { lineageStratum: stratum });
  }
  const structuralKeys = [
    'invalidNumeric', 'trackProgressOutOfRange', 'driverActionOutOfRange',
    'sampleCountMismatch', 'batchCountMismatch', 'schemaVersionMismatch',
    'trackIdMismatch', 'driverTypeInvalid'
  ];
  const temporalKeys = [
    'timestampMonotonicityViolations', 'sampleIndexMonotonicityViolations',
    'duplicateSamples', 'batchGaps', 'batchSequenceDuplicates', 'sampleIndexGaps'
  ];
  const payloadKeys = [
    'batchesTotal', 'gzipValid', 'gzipInvalid', 'jsonValid', 'jsonInvalid',
    'arrayValid', 'arrayInvalid', 'countMatch', 'countMismatch',
    'firstLastMetadataMatch', 'firstLastMetadataMismatch'
  ];
  const auditMissing = [
    ...missingKeys(quality.structuralIntegrity, structuralKeys).map(key => `STRUCTURAL_AUDIT_MISSING:${key}`),
    ...missingKeys(quality.temporalIntegrity, temporalKeys).map(key => `TEMPORAL_AUDIT_MISSING:${key}`),
    ...missingKeys(quality.payloadIntegrity, payloadKeys).map(key => `PAYLOAD_AUDIT_MISSING:${key}`)
  ];
  if (auditMissing.length) {
    return decision('session', ELIGIBILITY_DECISION.REVIEW_REQUIRED,
      [...violations, ...auditMissing], { lineageStratum: stratum });
  }

  const structural = quality.structuralIntegrity;
  const temporal = quality.temporalIntegrity;
  const payload = quality.payloadIntegrity;
  for (const key of structuralKeys) {
    if (structural[key] !== 0 && structural[key] !== false) violations.push(`STRUCTURAL_INTEGRITY_FAILED:${key}`);
  }
  for (const key of temporalKeys) {
    if (temporal[key] !== 0) violations.push(`TEMPORAL_INTEGRITY_FAILED:${key}`);
  }
  for (const key of ['gzipInvalid', 'jsonInvalid', 'arrayInvalid', 'countMismatch', 'firstLastMetadataMismatch']) {
    if (payload[key] !== 0) violations.push(`PAYLOAD_INTEGRITY_FAILED:${key}`);
  }
  for (const key of ['batchesTotal', 'gzipValid', 'jsonValid', 'arrayValid', 'countMatch', 'firstLastMetadataMatch']) {
    if (payload[key] !== session.batchCount) violations.push(`PAYLOAD_BATCH_COUNT_FAILED:${key}`);
  }
  if (violations.length) {
    return decision('session', ELIGIBILITY_DECISION.INELIGIBLE, violations, { lineageStratum: stratum });
  }

  const reasons = ['HUMAN_PROVENANCE_ESTABLISHED', 'SESSION_INTEGRITY_VERIFIED'];
  if ((temporal.timestampGaps?.above150ms ?? 0) > 0)
    reasons.push('TEMPORAL_GAPS_REQUIRE_SEGMENT_BOUNDARIES');
  return decision('session', ELIGIBILITY_DECISION.ELIGIBLE, reasons, { lineageStratum: stratum });
}

export function evaluateLap(lap = {}, sessionEvaluation) {
  if (!sessionEvaluation) {
    return decision('lap', ELIGIBILITY_DECISION.REVIEW_REQUIRED,
      ['PARENT_SESSION_EVALUATION_MISSING'], { lineageStratum: null, allowsSegmentEvaluation: false });
  }
  const stratum = sessionEvaluation.lineageStratum ?? null;
  if (sessionEvaluation.decision !== ELIGIBILITY_DECISION.ELIGIBLE) {
    return decision('lap', sessionEvaluation.decision,
      ['PARENT_SESSION_NOT_ELIGIBLE'], { lineageStratum: stratum, allowsSegmentEvaluation: false });
  }
  const required = ['lapNumber', 'sampleCount', 'lapTime', 'validLap', 'offTrackCount', 'collisionCount', 'spinCount'];
  const missing = missingKeys(lap, required);
  if (missing.length) {
    return decision('lap', ELIGIBILITY_DECISION.REVIEW_REQUIRED,
      missing.map(key => `LAP_EVIDENCE_MISSING:${key}`),
      { lineageStratum: stratum, allowsSegmentEvaluation: false });
  }
  const violations = [];
  if (!Number.isInteger(lap.lapNumber) || lap.lapNumber < 1) violations.push('LAP_NUMBER_INVALID');
  if (!Number.isInteger(lap.sampleCount) || lap.sampleCount < 2) violations.push('LAP_SAMPLE_COUNT_INVALID');
  if (!finite(lap.lapTime) || lap.lapTime <= 0) violations.push('LAP_TIME_INVALID');
  for (const key of ['offTrackCount', 'collisionCount', 'spinCount']) {
    if (!nonNegativeInteger(lap[key])) violations.push(`LAP_EVENT_COUNT_INVALID:${key}`);
  }
  if (violations.length) {
    return decision('lap', ELIGIBILITY_DECISION.INELIGIBLE, violations,
      { lineageStratum: stratum, allowsSegmentEvaluation: false });
  }
  if (lap.collisionCount > 0) {
    return decision('lap', ELIGIBILITY_DECISION.INELIGIBLE,
      ['COLLISION_INVALIDATES_REMAINDER_OF_LAP'],
      { lineageStratum: stratum, allowsSegmentEvaluation: false });
  }
  const localizedEvents = lap.offTrackCount > 0 || lap.spinCount > 0;
  if (lap.validLap === true && localizedEvents) {
    return decision('lap', ELIGIBILITY_DECISION.INELIGIBLE,
      ['LAP_VALIDITY_CONFLICT'], { lineageStratum: stratum, allowsSegmentEvaluation: false });
  }
  if (lap.validLap === false && !localizedEvents) {
    return decision('lap', ELIGIBILITY_DECISION.REVIEW_REQUIRED,
      ['INVALID_LAP_WITHOUT_LOCALIZED_REASON'],
      { lineageStratum: stratum, allowsSegmentEvaluation: false });
  }
  if (localizedEvents) {
    return decision('lap', ELIGIBILITY_DECISION.SEGMENT_ONLY,
      ['WHOLE_LAP_EVENT_CONTAMINATED', 'CLEAN_SEGMENTS_REQUIRE_EXCLUSION_WINDOWS'],
      { lineageStratum: stratum, allowsSegmentEvaluation: true });
  }
  if (lap.validLap !== true) {
    return decision('lap', ELIGIBILITY_DECISION.REVIEW_REQUIRED,
      ['LAP_VALIDITY_NOT_PROVEN'], { lineageStratum: stratum, allowsSegmentEvaluation: false });
  }
  return decision('lap', ELIGIBILITY_DECISION.ELIGIBLE,
    ['WHOLE_LAP_INTEGRITY_VERIFIED'],
    { lineageStratum: stratum, allowsSegmentEvaluation: true });
}

export function evaluateSegment(segment = {}, { sessionEvaluation, lapEvaluation } = {}) {
  const stratum = sessionEvaluation?.lineageStratum ?? lapEvaluation?.lineageStratum ?? null;
  if (!sessionEvaluation || !lapEvaluation) {
    return decision('segment', ELIGIBILITY_DECISION.REVIEW_REQUIRED,
      ['PARENT_EVALUATION_MISSING'], { lineageStratum: stratum });
  }
  if (sessionEvaluation.decision !== ELIGIBILITY_DECISION.ELIGIBLE) {
    return decision('segment', sessionEvaluation.decision,
      ['PARENT_SESSION_NOT_ELIGIBLE'], { lineageStratum: stratum });
  }
  if (!lapEvaluation.allowsSegmentEvaluation) {
    const inherited = lapEvaluation.decision === ELIGIBILITY_DECISION.REVIEW_REQUIRED
      ? ELIGIBILITY_DECISION.REVIEW_REQUIRED : ELIGIBILITY_DECISION.INELIGIBLE;
    return decision('segment', inherited, ['PARENT_LAP_BLOCKS_SEGMENTS'], { lineageStratum: stratum });
  }
  const required = [
    'sampleCount', 'sampleRateHz', 'lineageStratum', 'sameSession', 'sameLap',
    'sampleIndexesContiguous', 'timestampsStrictlyIncreasing', 'minDeltaMs', 'maxDeltaMs',
    'temporalGapCount', 'boundaryContextComplete', 'eventWindowContaminatedSamples',
    'invalidNumericSamples', 'invalidActionSamples', 'disallowedSurfaceSamples'
  ];
  const missing = missingKeys(segment, required);
  if (missing.length) {
    return decision('segment', ELIGIBILITY_DECISION.REVIEW_REQUIRED,
      missing.map(key => `SEGMENT_EVIDENCE_MISSING:${key}`), { lineageStratum: stratum });
  }
  const violations = [];
  if (segment.sampleCount !== QUALITY_POLICY.segmentSamples) violations.push('SEGMENT_LENGTH_INCOMPATIBLE');
  if (segment.sampleRateHz !== QUALITY_POLICY.sampleRateHz) violations.push('SEGMENT_SAMPLE_RATE_INCOMPATIBLE');
  if (segment.lineageStratum !== stratum) violations.push('SEGMENT_LINEAGE_STRATUM_MISMATCH');
  if (segment.sameSession !== true) violations.push('SEGMENT_CROSSES_SESSION_BOUNDARY');
  if (segment.sameLap !== true) violations.push('SEGMENT_CROSSES_LAP_BOUNDARY');
  if (segment.sampleIndexesContiguous !== true) violations.push('SEGMENT_SAMPLE_INDEX_GAP');
  if (segment.timestampsStrictlyIncreasing !== true) violations.push('SEGMENT_TIMESTAMP_NON_MONOTONIC');
  if (!finite(segment.minDeltaMs) || segment.minDeltaMs < QUALITY_POLICY.adjacentDeltaMs.min)
    violations.push('SEGMENT_DELTA_BELOW_MINIMUM');
  if (!finite(segment.maxDeltaMs) || segment.maxDeltaMs > QUALITY_POLICY.adjacentDeltaMs.max)
    violations.push('SEGMENT_DELTA_ABOVE_MAXIMUM');
  if (segment.temporalGapCount !== 0) violations.push('SEGMENT_CONTAINS_TEMPORAL_GAP');
  if (segment.boundaryContextComplete !== true) violations.push('SEGMENT_EXCLUSION_CONTEXT_INCOMPLETE');
  for (const key of [
    'eventWindowContaminatedSamples', 'invalidNumericSamples',
    'invalidActionSamples', 'disallowedSurfaceSamples'
  ]) {
    if (!nonNegativeInteger(segment[key]) || segment[key] !== 0) violations.push(`SEGMENT_QUALITY_FAILED:${key}`);
  }
  if (violations.length) {
    return decision('segment', ELIGIBILITY_DECISION.INELIGIBLE, violations, { lineageStratum: stratum });
  }
  return decision('segment', ELIGIBILITY_DECISION.ELIGIBLE,
    ['FIXED_WINDOW_INTEGRITY_VERIFIED', 'EVENT_EXCLUSION_WINDOWS_CLEAR'],
    { lineageStratum: stratum });
}

export function evaluateSample(sample = {}, segmentEvaluation) {
  const stratum = segmentEvaluation?.lineageStratum ?? null;
  if (!segmentEvaluation) {
    return decision('sample', ELIGIBILITY_DECISION.REVIEW_REQUIRED,
      ['PARENT_SEGMENT_EVALUATION_MISSING'], { lineageStratum: stratum });
  }
  if (segmentEvaluation.decision !== ELIGIBILITY_DECISION.ELIGIBLE) {
    return decision('sample', ELIGIBILITY_DECISION.INELIGIBLE,
      ['PARENT_SEGMENT_NOT_ELIGIBLE'], { lineageStratum: stratum });
  }
  const booleanEvidence = [
    'requiredFieldsPresent', 'numericFinite', 'actionInRange', 'causalV2',
    'eventFlagsClear', 'eventWindowClear', 'temporalWindowClear',
    'sameSession', 'sameLap', 'sameLineageStratum'
  ];
  const missing = missingKeys(sample, [...booleanEvidence, 'surface']);
  if (missing.length) {
    return decision('sample', ELIGIBILITY_DECISION.REVIEW_REQUIRED,
      missing.map(key => `SAMPLE_EVIDENCE_MISSING:${key}`), { lineageStratum: stratum });
  }
  const violations = [];
  for (const key of booleanEvidence) {
    if (sample[key] !== true) violations.push(`SAMPLE_QUALITY_FAILED:${key}`);
  }
  if (!QUALITY_POLICY.allowedSurfaces.includes(sample.surface)) violations.push('SAMPLE_SURFACE_DISALLOWED');
  if (violations.length) {
    return decision('sample', ELIGIBILITY_DECISION.INELIGIBLE, violations, { lineageStratum: stratum });
  }
  return decision('sample', ELIGIBILITY_DECISION.ELIGIBLE,
    ['SAMPLE_POLICY_CHECKS_VERIFIED'], { lineageStratum: stratum });
}
