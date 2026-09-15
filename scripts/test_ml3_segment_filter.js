import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  FILTER_REASON,
  filterInventoryArtifact,
  filterSessionSamples,
  ML3_SEGMENT_FILTER_VERSION,
  SAMPLE_MASK,
  summarizeInventorySessionWithoutRawSamples
} from './ml3/segmentFilter.js';
import {
  assertNoRawPayloadFields,
  buildRawEvidenceArtifact,
  ML3_RAW_EVIDENCE_VERSION,
  reconcileCloudEvidence
} from './ml3/rawEvidenceMaterializer.js';
import { QUALITY_POLICY } from './ml3/qualityPolicy.js';
import {
  SIMULATION_FINGERPRINT_SHA256,
  stableSerialize,
  TELEMETRY_LINEAGE_VERSIONS
} from '../src/ml/lineage/acceptedBaseline.js';
import {
  SIMULATION_FINGERPRINT_SHA256 as RUNTIME_FINGERPRINT,
  TELEMETRY_LINEAGE_VERSIONS as RUNTIME_VERSIONS
} from '../src/ml/lineage/baselineManifest.js';

let passed = 0;

function check(condition, label) {
  assert.ok(condition, label);
  passed++;
  console.log(`  PASS: ${label}`);
}

function verifiedQuality(sampleCount, gapCount = 0) {
  return {
    structuralIntegrity: {
      invalidNumeric: 0, trackProgressOutOfRange: 0, driverActionOutOfRange: 0,
      sampleCountMismatch: false, batchCountMismatch: false, schemaVersionMismatch: 0,
      trackIdMismatch: 0, driverTypeInvalid: 0
    },
    temporalIntegrity: {
      timestampMonotonicityViolations: 0, sampleIndexMonotonicityViolations: 0,
      duplicateSamples: 0, batchGaps: 0, batchSequenceDuplicates: 0, sampleIndexGaps: 0,
      timestampGaps: { above150ms: gapCount, above250ms: gapCount, above500ms: gapCount, above1s: 0 }
    },
    payloadIntegrity: {
      batchesTotal: 1, gzipValid: 1, gzipInvalid: 0, jsonValid: 1, jsonInvalid: 0,
      arrayValid: 1, arrayInvalid: 0, countMatch: 1, countMismatch: 0,
      firstLastMetadataMatch: 1, firstLastMetadataMismatch: 0
    },
    samplesMeasured: sampleCount
  };
}

function session(sampleCount, overrides = {}) {
  return {
    schemaVersion: TELEMETRY_LINEAGE_VERSIONS.SCHEMA_VERSION,
    gameBuildVersion: '0.2.0-ml2',
    trackGeometryVersion: TELEMETRY_LINEAGE_VERSIONS.TRACK_GEOMETRY_VERSION,
    physicsVersion: TELEMETRY_LINEAGE_VERSIONS.PHYSICS_VERSION,
    featureManifestVersion: TELEMETRY_LINEAGE_VERSIONS.FEATURE_MANIFEST_VERSION,
    simulationFingerprint: null,
    sessionId: 'server-session-02',
    localCollectionSessionId: 'raw-session-02',
    source: 'TEST_FIXTURE',
    collectionKind: 'HUMAN',
    status: 'COMPLETED',
    scope: 'PLAYER_ONLY',
    driverTypes: ['PLAYER'],
    rawPayloadAvailable: true,
    sampleRateHz: 10,
    sampleCount,
    batchCount: 1,
    qualitySignals: verifiedQuality(sampleCount),
    ...overrides
  };
}

function sample(index, overrides = {}) {
  const timestamp = overrides.timestamp ?? index * 100;
  return {
    schemaVersion: overrides.schemaVersion ?? 2,
    ...overrides,
    metadata: { sessionId: 'raw-session-02', sampleIndex: index, timestamp, trackId: 21,
      lapNumber: 1, driverType: 'PLAYER', participantId: 'player', ...(overrides.metadata ?? {}) },
    trackState: { trackProgress: index / 1000, pathIndex: index, currentCurvature: 0.01,
      futureCurvature5m: 0.01, futureCurvature10m: 0.01, futureCurvature20m: 0.01,
      futureCurvature40m: 0.01, targetSpeed: 1.2, distanceToLeftEdge: 10,
      distanceToRightEdge: 10, surface: 'TARMAC', ...(overrides.trackState ?? {}) },
    carState: { speed: 1, forwardVelocity: 1, lateralVelocity: 0, heading: 0,
      headingError: 0, yawRate: 0, slipAngle: 0, crossTrackError: 0,
      steeringAngle: 0, ...(overrides.carState ?? {}) },
    driverAction: { steering: 0, throttle: 1, brake: 0, ...(overrides.driverAction ?? {}) },
    eventState: { offTrack: false, spin: false, collision: false,
      isRecovering: false, ...(overrides.eventState ?? {}) }
  };
}

function samples(count, mutate = () => ({})) {
  return Array.from({ length: count }, (_, index) => sample(index, mutate(index)));
}

function withLapEvidence(baseSession, rawSamples) {
  const offTrackCount = rawSamples.filter(item => item.eventState.offTrack).length;
  const spinCount = rawSamples.filter(item => item.eventState.spin).length;
  const collisionCount = rawSamples.filter(item => item.eventState.collision).length;
  return {
    ...baseSession,
    qualitySignals: {
      ...baseSession.qualitySignals,
      laps: { items: [{ lapNumber: 1, sampleCount: rawSamples.length,
        lapTime: (rawSamples.at(-1).metadata.timestamp - rawSamples[0].metadata.timestamp) / 1000,
        validLap: offTrackCount === 0 && spinCount === 0 && collisionCount === 0,
        offTrackCount, spinCount, collisionCount }] }
    }
  };
}

function acceptedInventory(sessionSummary) {
  const canonicalInventory = { sessions: [sessionSummary] };
  return {
    canonicalInventory,
    canonicalSha256: createHash('sha256').update(stableSerialize(canonicalInventory)).digest('hex')
  };
}

console.log('ML3.2 deterministic segment-filter tests');

check(ML3_SEGMENT_FILTER_VERSION === 'ML3.2-1' && QUALITY_POLICY.segmentSamples === 50,
  'filter is versioned and consumes the ML3.1 fixed-window policy');

const cleanSamples = samples(120);
const cleanResult = filterSessionSamples({ session: withLapEvidence(session(120), cleanSamples), samples: cleanSamples });
check(cleanResult.summary.accepted === 120 && cleanResult.summary.rejected === 0,
  'all samples in a complete clean lap belong to at least one eligible fixed window');
check(cleanResult.acceptedSegments.length === 71 && cleanResult.acceptedIntervals.length === 1,
  'exhaustive stride-one windows produce one deduplicated accepted interval');
check(cleanResult.masks.every(item => item.finalTrainingEligible === false),
  'accepted policy masks never declare final training eligibility');
check(cleanResult.masks[0].sessionId === 'server-session-02'
  && cleanResult.masks[0].sampleSessionId === 'raw-session-02'
  && cleanResult.masks[0].lapNumber === 1 && cleanResult.masks[0].sampleIndex === 0,
  'provenance, canonical session, raw session, lap and sample index are preserved');
assert.throws(() => filterSessionSamples({ session: session(121), samples: cleanSamples }),
  /RAW_SAMPLE_COUNT_MISMATCH/);
check(true, 'declared and supplied raw sample counts cannot diverge');

const offTrackSamples = samples(120, index => index === 60 ? { eventState: { offTrack: true } } : {});
const offTrackResult = filterSessionSamples({
  session: withLapEvidence(session(120), offTrackSamples), samples: offTrackSamples
});
check(offTrackResult.lapEvaluations[0].decision === 'SEGMENT_ONLY'
  && offTrackResult.summary.accepted === 50 && offTrackResult.summary.rejected === 70,
  'SEGMENT_ONLY salvages a valid 50-sample region outside the ML3.1 off-track window');
check(offTrackResult.masks[60].reasonCodes.includes(FILTER_REASON.EVENT_OFF_TRACK)
  && offTrackResult.masks[50].reasonCodes.includes(FILTER_REASON.EVENT_WINDOW_OFF_TRACK),
  'off-track direct and exclusion-window reasons are localized per sample');

const spinSamples = samples(160, index => index === 60 ? { eventState: { spin: true } } : {});
const spinResult = filterSessionSamples({ session: withLapEvidence(session(160), spinSamples), samples: spinSamples });
check(spinResult.summary.accepted === 69 && spinResult.summary.rejected === 91,
  'spin uses the ML3.1 two-second before and three-second after window');

const recoverySamples = samples(120, index => index === 60 ? { eventState: { isRecovering: true } } : {});
const recoveryResult = filterSessionSamples({
  session: withLapEvidence(session(120), recoverySamples), samples: recoverySamples
});
check(recoveryResult.summary.accepted === 60 && recoveryResult.summary.rejected === 60,
  'recovery uses the ML3.1 two-second forward exclusion window');

const collisionSamples = samples(160, index => index === 80 ? { eventState: { collision: true } } : {});
const collisionResult = filterSessionSamples({
  session: withLapEvidence(session(160), collisionSamples), samples: collisionSamples
});
check(collisionResult.summary.accepted === 0
  && collisionResult.masks.every(item => item.reasonCodes.includes(FILTER_REASON.PARENT_LAP_BLOCKS_SEGMENTS)),
  'collision follows ML3.1 and blocks segment evaluation for the contaminated lap');

let timestampOffset = 0;
const gapSamples = samples(160, index => {
  if (index === 80) timestampOffset = 1000;
  return { timestamp: index * 100 + timestampOffset };
});
const gapSession = withLapEvidence(session(160, {
  qualitySignals: verifiedQuality(160, 1)
}), gapSamples);
const gapResult = filterSessionSamples({ session: gapSession, samples: gapSamples });
check(gapResult.summary.accepted === 138 && gapResult.summary.rejected === 22,
  'a temporal gap creates ML3.1 one-second exclusion windows on both sides');
check(gapResult.masks.filter(item => item.reasonCodes.includes(FILTER_REASON.TEMPORAL_GAP_WINDOW)).length === 22,
  'gap-adjacent samples are unioned without double counting');

const invalidSamples = samples(120, index => index === 60 ? { driverAction: { throttle: 2 } } : {});
const invalidResult = filterSessionSamples({ session: withLapEvidence(session(120), invalidSamples), samples: invalidSamples });
check(invalidResult.summary.accepted === 0 && invalidResult.summary.rejected === 120
  && invalidResult.masks.every(item => item.primaryReason === FILTER_REASON.RAW_SAMPLE_INVENTORY_MISMATCH)
  && invalidResult.masks[60].reasonCodes.includes(FILTER_REASON.INVALID_SAMPLE),
  'raw samples contradicting the frozen integrity audit reject the session without hiding the invalid sample');

const surfaceSamples = samples(120, index => index === 60 ? { trackState: { surface: 'GRAVEL' } } : {});
const surfaceResult = filterSessionSamples({
  session: withLapEvidence(session(120), surfaceSamples), samples: surfaceSamples
});
check(surfaceResult.summary.accepted === 119 && surfaceResult.summary.rejected === 1
  && surfaceResult.masks[60].primaryReason === FILTER_REASON.SAMPLE_SURFACE_DISALLOWED,
  'a localized disallowed surface sample cannot enter an eligible segment');

const overlappingEvents = samples(120, index => index === 60
  ? { eventState: { offTrack: true, spin: true } } : {});
const overlappingResult = filterSessionSamples({
  session: withLapEvidence(session(120), overlappingEvents), samples: overlappingEvents
});
const exclusiveReasonTotal = Object.values(overlappingResult.summary.reasonCounts).reduce((sum, count) => sum + count, 0);
check(exclusiveReasonTotal === overlappingResult.summary.rejected,
  'exclusive primary reason counts cannot double count rejected samples');
check(overlappingResult.masks[60].reasonCodes.includes(FILTER_REASON.EVENT_OFF_TRACK)
  && overlappingResult.masks[60].reasonCodes.includes(FILTER_REASON.EVENT_SPIN),
  'the full reason mask retains overlapping event causes');
check(offTrackResult.acceptedIntervals.length === 1 && offTrackResult.rejectedIntervals.length === 1
  && offTrackResult.acceptedIntervals[0].startSampleIndex === 0
  && offTrackResult.acceptedIntervals[0].endSampleIndex === 49,
  'accepted and rejected masks collapse into deterministic continuous intervals');

const shortSamples = samples(49);
const shortResult = filterSessionSamples({ session: withLapEvidence(session(49), shortSamples), samples: shortSamples });
check(shortResult.summary.accepted === 0
  && shortResult.summary.reasonCounts[FILTER_REASON.NO_ELIGIBLE_SEGMENT] === 49,
  'unflagged samples shorter than one policy window are not accepted');

const session03 = session(120, {
  gameBuildVersion: '0.3.0-ml2', simulationFingerprint: SIMULATION_FINGERPRINT_SHA256,
  sessionId: 'server-session-03', localCollectionSessionId: 'raw-session-03'
});
const raw03 = samples(120).map(item => ({ ...item, metadata: { ...item.metadata, sessionId: 'raw-session-03' } }));
const result03 = filterSessionSamples({ session: withLapEvidence(session03, raw03), samples: raw03 });
check(result03.lineageEvaluation.lineageStratum === '0.3.0-ml2' && result03.summary.accepted === 120,
  '0.3 remains eligible only in its own accepted lineage stratum');

const runtimeSession = session(120, {
  schemaVersion: RUNTIME_VERSIONS.SCHEMA_VERSION,
  gameBuildVersion: RUNTIME_VERSIONS.GAME_BUILD_VERSION,
  trackGeometryVersion: RUNTIME_VERSIONS.TRACK_GEOMETRY_VERSION,
  physicsVersion: RUNTIME_VERSIONS.PHYSICS_VERSION,
  featureManifestVersion: RUNTIME_VERSIONS.FEATURE_MANIFEST_VERSION,
  simulationFingerprint: RUNTIME_FINGERPRINT
});
const runtimeResult = filterSessionSamples({ session: withLapEvidence(runtimeSession, cleanSamples), samples: cleanSamples });
check(runtimeResult.summary.accepted === 0
  && runtimeResult.masks.every(item => item.primaryReason === FILTER_REASON.PARENT_LINEAGE_NOT_ELIGIBLE),
  'runtime 0.6.x is isolated and cannot enter historical acceptance masks');

const repeated = filterSessionSamples({ session: withLapEvidence(session(120), cleanSamples), samples: cleanSamples });
check(stableSerialize(repeated) === stableSerialize(cleanResult),
  'the same input produces byte-identical deterministic output');

const summarySession = {
  ...session(1940),
  sessionId: 'ad759118-4386-481f-9d34-f3d496eb1854',
  qualitySignals: verifiedQuality(1940)
};
const artifact = acceptedInventory(summarySession);
const original = stableSerialize(artifact);
assert.throws(() => filterInventoryArtifact(artifact), /INVENTORY_NOT_ACCEPTED_BY_ML3_1/);
check(stableSerialize(artifact) === original,
  'inventory application is read-only even when the canonical hash is not the accepted freeze');

const summarizedRejection = summarizeInventorySessionWithoutRawSamples(summarySession);
check(summarizedRejection.accepted === 0 && summarizedRejection.rejected === 1940
  && summarizedRejection.reason === FILTER_REASON.RAW_SAMPLE_EVIDENCE_MISSING
  && summarizedRejection.maskMaterialized === false,
  'an unflagged aggregate without raw sample evidence cannot materialize or accept masks');
check(SAMPLE_MASK.ACCEPTED !== SAMPLE_MASK.REJECTED,
  'mask vocabulary keeps accepted and rejected states explicit');

const frozenEvidenceSession = withLapEvidence(session(120), cleanSamples);
const cloudEvidenceSession = {
  ...frozenEvidenceSession,
  rawPayloadAvailable: true,
  payloadCorrupt: false
};
const cloudEvidenceStatus = {
  status: 'AVAILABLE_FULL', sessions: 1, batches: 1, samples: 120, rawSamplesInMemory: true,
  payloadIntegrity: {
    gzipValid: 1, gzipInvalid: 0, jsonValid: 1, jsonInvalid: 0,
    arrayValid: 1, arrayInvalid: 0, countMatch: 1, countMismatch: 0,
    firstLastMetadataMatch: 1, firstLastMetadataMismatch: 0
  }
};
const rawReconciliation = reconcileCloudEvidence({
  frozenSession: frozenEvidenceSession,
  cloudSession: cloudEvidenceSession,
  cloudStatus: cloudEvidenceStatus,
  samples: cleanSamples
});
check(rawReconciliation.mismatchCount === 0,
  'an explicit false payloadCorrupt reconciles as non-corrupt evidence');

const { payloadCorrupt: omittedPayloadCorrupt, ...cloudEvidenceWithoutPayloadCorrupt } = cloudEvidenceSession;
const omittedPayloadCorruptReconciliation = reconcileCloudEvidence({
  frozenSession: frozenEvidenceSession,
  cloudSession: cloudEvidenceWithoutPayloadCorrupt,
  cloudStatus: cloudEvidenceStatus,
  samples: cleanSamples
});
check(omittedPayloadCorrupt === false
  && !Object.hasOwn(cloudEvidenceWithoutPayloadCorrupt, 'payloadCorrupt')
  && omittedPayloadCorruptReconciliation.mismatchCount === 0,
  'an omitted payloadCorrupt field reconciles as non-corrupt evidence');

const corruptPayloadReconciliation = reconcileCloudEvidence({
  frozenSession: frozenEvidenceSession,
  cloudSession: { ...cloudEvidenceSession, payloadCorrupt: true },
  cloudStatus: cloudEvidenceStatus,
  samples: cleanSamples
});
check(corruptPayloadReconciliation.mismatchCount === 1
  && corruptPayloadReconciliation.mismatchCodes.includes('FREEZE_MISMATCH:cloudSession.payloadCorrupt'),
  'an explicit true payloadCorrupt field produces a freeze mismatch');

const filterEnvelope = {
  filterVersion: ML3_SEGMENT_FILTER_VERSION,
  filterSha256: 'filter-sha-fixture',
  qualityPolicyVersion: cleanResult.qualityPolicyVersion,
  sourceInventoryCanonicalSha256: QUALITY_POLICY.acceptedInventoryCanonicalSha256,
  sessions: [cleanResult],
  byLineage: { '0.2.0-ml2': { sessions: 1, totalSamples: 120, accepted: 120, rejected: 0, coveragePercent: 100 } }
};
const derivedEvidence = buildRawEvidenceArtifact({
  filterResult: filterEnvelope,
  reconciliation: rawReconciliation,
  cloudStatus: cloudEvidenceStatus,
  sessionId: 'server-session-02'
});
const repeatedEvidence = buildRawEvidenceArtifact({
  filterResult: filterEnvelope,
  reconciliation: rawReconciliation,
  cloudStatus: cloudEvidenceStatus,
  sessionId: 'server-session-02'
});
check(derivedEvidence.evidenceVersion === ML3_RAW_EVIDENCE_VERSION
  && derivedEvidence.summary.accepted === 120
  && derivedEvidence.databaseRead.rawSampleInventoryMismatchCount === 0,
  'derived evidence contains materialized masks, metrics and explicit zero mismatch proof');
check(derivedEvidence.evidenceSha256 === repeatedEvidence.evidenceSha256,
  'identical raw evidence produces a reproducible SHA-256 fingerprint');
check(assertNoRawPayloadFields(derivedEvidence)
  && !JSON.stringify(derivedEvidence).includes('driverAction'),
  'derived evidence persists no raw telemetry payload fields');

const mismatchedEvidence = reconcileCloudEvidence({
  frozenSession: frozenEvidenceSession,
  cloudSession: { ...cloudEvidenceSession, sampleCount: 119 },
  cloudStatus: cloudEvidenceStatus,
  samples: cleanSamples
});
check(mismatchedEvidence.mismatchCount === 1
  && mismatchedEvidence.mismatchCodes.includes('FREEZE_MISMATCH:sampleCount'),
  'freeze reconciliation fails closed when cloud metadata diverges');
assert.throws(() => assertNoRawPayloadFields({ driverAction: { throttle: 1 } }),
  /RAW_PAYLOAD_FIELD_FORBIDDEN/);
check(true, 'raw sample payload fields cannot be serialized as ML3.2-B evidence');

console.log(`ML3_SEGMENT_FILTER_CHECKS: ${passed} total, ${passed} passed, 0 failed`);
