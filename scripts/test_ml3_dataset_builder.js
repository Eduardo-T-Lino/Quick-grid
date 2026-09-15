import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  BASELINE_MANIFEST,
  SIMULATION_FINGERPRINT_SHA256,
  stableSerialize,
  TELEMETRY_LINEAGE_VERSIONS
} from '../src/ml/lineage/acceptedBaseline.js';
import {
  buildCanonicalDataset,
  ML3_DATASET_VERSION,
  SURFACE_ENCODING,
  validateEvidenceArtifact
} from './ml3/datasetBuilder.js';
import { analyzeSamples } from './ml3/inventoryCore.js';
import { ML3_QUALITY_POLICY_VERSION, QUALITY_POLICY } from './ml3/qualityPolicy.js';
import { ML3_RAW_EVIDENCE_VERSION, assertNoRawPayloadFields } from './ml3/rawEvidenceMaterializer.js';
import { ML3_SEGMENT_FILTER_VERSION } from './ml3/segmentFilter.js';
import { parseArgs } from './ml3_build_dataset.js';

let passed = 0;

function check(condition, label) {
  assert.ok(condition, label);
  passed++;
  console.log(`  PASS: ${label}`);
}

function sample(index, surface = index % 2 ? 'KERB' : 'TARMAC') {
  return {
    schemaVersion: 2,
    metadata: {
      sessionId: 'raw-human-session', sampleIndex: index, timestamp: 1000 + index * 100,
      trackId: 21, lapNumber: 1, driverType: 'PLAYER', participantId: 'player'
    },
    trackState: {
      trackProgress: index / 10, pathIndex: index, currentCurvature: 0.01 + index,
      futureCurvature5m: 0.02 + index, futureCurvature10m: 0.03 + index,
      futureCurvature20m: 0.04 + index, futureCurvature40m: 0.05 + index,
      targetSpeed: 1.2, distanceToLeftEdge: 10 + index,
      distanceToRightEdge: 11 + index, surface
    },
    carState: {
      speed: 100 + index, forwardVelocity: 1 + index, lateralVelocity: 0.1 + index,
      heading: 0.2 + index, headingError: 0.3 + index, yawRate: 0.4 + index,
      slipAngle: 0.5 + index, crossTrackError: 0.6 + index, steeringAngle: 0.7 + index
    },
    driverAction: { steering: index / 10, throttle: 1 - index / 10, brake: index / 20 },
    eventState: { offTrack: false, spin: false, collision: false, isRecovering: false }
  };
}

const rawSamples = [sample(0), sample(1), sample(2), sample(3)];
const sessionId = 'ad759118-4386-481f-9d34-f3d496eb1854';

function frozenSession(overrides = {}) {
  return {
    source: 'CLOUD_POSTGRES',
    sessionId,
    localCollectionSessionId: 'raw-human-session',
    collectionKind: 'HUMAN',
    schemaVersion: TELEMETRY_LINEAGE_VERSIONS.SCHEMA_VERSION,
    gameBuildVersion: '0.2.0-ml2',
    trackGeometryVersion: TELEMETRY_LINEAGE_VERSIONS.TRACK_GEOMETRY_VERSION,
    physicsVersion: TELEMETRY_LINEAGE_VERSIONS.PHYSICS_VERSION,
    featureManifestVersion: TELEMETRY_LINEAGE_VERSIONS.FEATURE_MANIFEST_VERSION,
    simulationFingerprint: null,
    trackId: 21,
    sampleRateHz: 10,
    batchCount: 1,
    sampleCount: rawSamples.length,
    lapCount: 1,
    qualitySignals: analyzeSamples(rawSamples, { sampleRateHz: 10 }),
    ...overrides
  };
}

function mask(index, accepted, overrides = {}) {
  return {
    provenance: {
      source: 'CLOUD_POSTGRES', collectionKind: 'HUMAN',
      localCollectionSessionId: 'raw-human-session'
    },
    sessionId,
    sampleSessionId: 'raw-human-session',
    lapNumber: 1,
    sampleIndex: index,
    lineageStratum: '0.2.0-ml2',
    mask: accepted ? 'ACCEPTED' : 'REJECTED',
    accepted,
    primaryReason: accepted ? 'ACCEPTED_BY_ELIGIBLE_SEGMENT' : 'NO_ELIGIBLE_SEGMENT',
    reasonCodes: [accepted ? 'ACCEPTED_BY_ELIGIBLE_SEGMENT' : 'NO_ELIGIBLE_SEGMENT'],
    finalTrainingEligible: false,
    ...overrides
  };
}

function sealEvidence(body) {
  const copy = structuredClone(body);
  delete copy.evidenceSha256;
  return {
    ...copy,
    evidenceSha256: createHash('sha256').update(stableSerialize(copy)).digest('hex')
  };
}

function evidence(overrides = {}) {
  const masks = overrides.masks ?? [mask(0, false), mask(1, true), mask(2, false), mask(3, true)];
  const body = {
    evidenceVersion: ML3_RAW_EVIDENCE_VERSION,
    filterVersion: ML3_SEGMENT_FILTER_VERSION,
    filterSha256: 'f'.repeat(64),
    qualityPolicyVersion: ML3_QUALITY_POLICY_VERSION,
    sourceInventoryCanonicalSha256: QUALITY_POLICY.acceptedInventoryCanonicalSha256,
    sessionId,
    lineageStratum: '0.2.0-ml2',
    databaseRead: {
      transactionMode: 'REPEATABLE READ READ ONLY', sessions: 1, batches: 1, samples: 4,
      payloadIntegrity: {
        gzipValid: 1, gzipInvalid: 0, jsonValid: 1, jsonInvalid: 0,
        arrayValid: 1, arrayInvalid: 0, countMatch: 1, countMismatch: 0,
        firstLastMetadataMatch: 1, firstLastMetadataMismatch: 0
      },
      freezeInventoryMismatchCount: 0, freezeInventoryMismatchCodes: [],
      rawSampleInventoryMismatchCount: 0, rawSampleInventoryMismatchCodes: []
    },
    summary: {
      totalSamples: 4, accepted: 2, rejected: 2, coveragePercent: 50,
      acceptedCandidateSegments: 1, rejectedCandidateSegments: 1,
      reasonCounts: { NO_ELIGIBLE_SEGMENT: 2 }
    },
    byLineage: { '0.2.0-ml2': { sessions: 1, totalSamples: 4, accepted: 2, rejected: 2 } },
    masks,
    acceptedSegments: [],
    acceptedIntervals: [],
    rejectedIntervals: [],
    finalTrainingDataset: false,
    ...overrides
  };
  return sealEvidence(body);
}

function bodyWithoutDatasetSha(dataset) {
  const { datasetSha256: ignored, ...body } = dataset;
  return body;
}

console.log('ML3.3 canonical dataset builder tests');

const sourceEvidence = evidence();
const built = buildCanonicalDataset({
  evidence: sourceEvidence,
  frozenSession: frozenSession(),
  samples: structuredClone(rawSamples)
});

check(built.datasetVersion === ML3_DATASET_VERSION && built.summary.rowCount === 2,
  'builder materializes exactly the accepted masks as canonical rows');
check(built.rows.map(row => row.identity.sampleIndex).join(',') === '1,3',
  'rejected sample identities never enter the dataset and accepted rows are canonically sorted');
check(built.rows.every(row => row.identity.sessionId === sessionId
  && row.identity.sampleSessionId === 'raw-human-session'
  && row.identity.lapNumber === 1),
  'canonical and raw identities are preserved on every row');
check(built.rows.every(row => row.provenance.source === 'CLOUD_POSTGRES'
  && row.provenance.collectionKind === 'HUMAN'
  && row.provenance.localCollectionSessionId === 'raw-human-session'),
  'ML3.2 provenance is preserved without reconstruction');
check(stableSerialize(built.featureSchema.observationFeatures)
    === stableSerialize(BASELINE_MANIFEST.featureManifest.observationFeatures)
  && stableSerialize(built.featureSchema.actionTargets)
    === stableSerialize(BASELINE_MANIFEST.featureManifest.actionTargets),
  'feature and target order comes directly from the accepted historical manifest');
check(built.rows[0].observation[0] === rawSamples[1].carState.speed
  && built.rows[0].target[0] === rawSamples[1].driverAction.steering,
  'each row preserves causal State(t) to Action(t) from the same authoritative sample');
check(built.rows[0].observation.at(-1) === 1 && built.rows[1].observation.at(-1) === 1
  && built.featureSchema.encodings['trackState.surface'].type === SURFACE_ENCODING,
  'surface uses the frozen domain order as a deterministic ordinal encoding');
check(built.featureSchema.normalization === 'NONE'
  && built.splitApplied === false && built.shuffled === false
  && built.finalTrainingDataset === false,
  'builder performs no normalization, split, shuffle or final-training promotion');
check(createHash('sha256').update(stableSerialize(bodyWithoutDatasetSha(built))).digest('hex')
    === built.datasetSha256,
  'declared dataset SHA-256 matches canonical serialization');

const repeated = buildCanonicalDataset({
  evidence: sourceEvidence,
  frozenSession: frozenSession(),
  samples: rawSamples
});
check(repeated.datasetSha256 === built.datasetSha256
  && stableSerialize(repeated) === stableSerialize(built),
  'identical evidence and authoritative raw samples produce byte-identical output');
check(assertNoRawPayloadFields(built)
  && built.rows.every(row => !Object.hasOwn(row, 'trackState')
    && !Object.hasOwn(row, 'carState')
    && !Object.hasOwn(row, 'driverAction')
    && !Object.hasOwn(row, 'eventState')),
  'dataset contains vectors and metadata, never persisted raw payload objects');

const tampered = structuredClone(sourceEvidence);
tampered.summary.accepted = 3;
assert.throws(() => validateEvidenceArtifact(tampered), /ML3_2_EVIDENCE_SHA_INVALID/);
check(true, 'tampered ML3.2 evidence is rejected before dataset construction');

const duplicateMasks = structuredClone(sourceEvidence);
duplicateMasks.masks[2] = structuredClone(duplicateMasks.masks[1]);
assert.throws(() => validateEvidenceArtifact(sealEvidence(duplicateMasks)), /ML3_2_MASK_IDENTITY_DUPLICATE/);
check(true, 'duplicate or ambiguous mask identities are rejected');

const ambiguousProvenance = structuredClone(sourceEvidence);
ambiguousProvenance.masks[1].provenance.source = null;
assert.throws(() => validateEvidenceArtifact(sealEvidence(ambiguousProvenance)),
  /ML3_2_MASK_PROVENANCE_INVALID/);
check(true, 'missing provenance fields are rejected instead of being inferred');

const duplicateRaw = [rawSamples[0], rawSamples[1], rawSamples[1], rawSamples[3]];
assert.throws(() => buildCanonicalDataset({
  evidence: sourceEvidence, frozenSession: frozenSession(), samples: duplicateRaw
}), /RAW_SAMPLE_IDENTITY_DUPLICATE/);
check(true, 'duplicate authoritative raw identities are rejected');

const missingAcceptedRaw = [rawSamples[0], rawSamples[2], sample(4), sample(5)];
assert.throws(() => buildCanonicalDataset({
  evidence: sourceEvidence, frozenSession: frozenSession(), samples: missingAcceptedRaw
}), /ACCEPTED_RAW_SAMPLE_MISSING/);
check(true, 'an accepted mask without its unique authoritative raw sample is rejected');

const crossLineage = structuredClone(sourceEvidence);
crossLineage.masks[1].lineageStratum = '0.3.0-ml2';
assert.throws(() => validateEvidenceArtifact(sealEvidence(crossLineage)), /CROSS_LINEAGE_MASK_PROHIBITED/);
check(true, 'one dataset artifact cannot mix lineage strata');

const evidence03Body = structuredClone(sourceEvidence);
evidence03Body.lineageStratum = '0.3.0-ml2';
evidence03Body.masks = evidence03Body.masks.map(item => ({ ...item, lineageStratum: '0.3.0-ml2' }));
evidence03Body.byLineage = { '0.3.0-ml2': evidence03Body.byLineage['0.2.0-ml2'] };
const built03 = buildCanonicalDataset({
  evidence: sealEvidence(evidence03Body),
  frozenSession: frozenSession({
    gameBuildVersion: '0.3.0-ml2', simulationFingerprint: SIMULATION_FINGERPRINT_SHA256
  }),
  samples: rawSamples
});
check(built03.lineage.lineageStratum === '0.3.0-ml2'
  && built03.datasetSha256 !== built.datasetSha256,
  '0.2 and 0.3 produce separate lineage-bound dataset fingerprints');

const runtimeBody = structuredClone(sourceEvidence);
runtimeBody.lineageStratum = '0.6.4-ml2';
runtimeBody.masks = runtimeBody.masks.map(item => ({ ...item, lineageStratum: '0.6.4-ml2' }));
runtimeBody.byLineage = { '0.6.4-ml2': runtimeBody.byLineage['0.2.0-ml2'] };
assert.throws(() => buildCanonicalDataset({
  evidence: sealEvidence(runtimeBody), frozenSession: frozenSession({ gameBuildVersion: '0.6.4-ml2' }), samples: rawSamples
}), /LINEAGE_NOT_ACCEPTED_FOR_CANONICAL_BUILD/);
check(true, 'runtime lineage cannot be mixed into historical canonical datasets');

const parsed = parseArgs([
  '--inventory', 'inventory.json', '--evidence', 'evidence.json', '--output', 'dataset.json'
]);
check(parsed.inventory === 'inventory.json' && parsed.evidence === 'evidence.json'
  && parsed.output === 'dataset.json',
  'CLI requires explicit immutable inventory, evidence and output paths');

console.log(`ML3_DATASET_BUILDER_CHECKS: ${passed} total, ${passed} passed, 0 failed`);
