import { createHash } from 'node:crypto';
import {
  BASELINE_MANIFEST,
  SIMULATION_FINGERPRINT_SHA256,
  stableSerialize,
  TELEMETRY_LINEAGE_VERSIONS
} from '../../src/ml/lineage/acceptedBaseline.js';
import { assertNoCredentials } from './inventoryCore.js';
import { ML3_QUALITY_POLICY_VERSION, QUALITY_POLICY } from './qualityPolicy.js';
import {
  assertNoRawPayloadFields,
  ML3_RAW_EVIDENCE_VERSION,
  reconcileCloudEvidence
} from './rawEvidenceMaterializer.js';
import {
  ML3_SEGMENT_FILTER_VERSION,
  rawInventoryMismatches,
  SAMPLE_MASK,
  selectFrozenInventorySessions
} from './segmentFilter.js';

export const ML3_DATASET_VERSION = 'ML3.3-1';
export const SURFACE_ENCODING = 'ORDINAL_INDEX';

const HISTORICAL_LINEAGES = new Set(['0.2.0-ml2', '0.3.0-ml2']);
const SHA256 = /^[a-f0-9]{64}$/;

function datasetError(code) {
  throw new Error(code);
}

function identity(mask) {
  return {
    sessionId: mask?.sessionId,
    sampleSessionId: mask?.sampleSessionId,
    lapNumber: mask?.lapNumber,
    sampleIndex: mask?.sampleIndex
  };
}

function identityKey(value) {
  return `${value.sessionId}\u0000${value.sampleSessionId}\u0000${value.lapNumber}\u0000${value.sampleIndex}`;
}

function canonicalIdentityKey(value) {
  return `${value.sessionId}\u0000${value.lapNumber}\u0000${value.sampleIndex}`;
}

function rawIdentityKey(sample) {
  return `${sample?.metadata?.sessionId}\u0000${sample?.metadata?.lapNumber}\u0000${sample?.metadata?.sampleIndex}`;
}

function rawIdentity(sample) {
  return {
    sampleSessionId: sample?.metadata?.sessionId,
    lapNumber: sample?.metadata?.lapNumber,
    sampleIndex: sample?.metadata?.sampleIndex
  };
}

function valueAtPath(value, field) {
  return field.split('.').reduce((current, key) => current?.[key], value);
}

function compareRows(a, b) {
  return String(a.identity.sessionId).localeCompare(String(b.identity.sessionId))
    || Number(a.identity.lapNumber) - Number(b.identity.lapNumber)
    || Number(a.identity.sampleIndex) - Number(b.identity.sampleIndex)
    || String(a.identity.sampleSessionId).localeCompare(String(b.identity.sampleSessionId));
}

function validateIdentity(value) {
  return typeof value.sessionId === 'string' && value.sessionId.length > 0
    && typeof value.sampleSessionId === 'string' && value.sampleSessionId.length > 0
    && Number.isInteger(value.lapNumber)
    && Number.isInteger(value.sampleIndex);
}

function manifestForLineage(lineageStratum) {
  if (!HISTORICAL_LINEAGES.has(lineageStratum)) datasetError('LINEAGE_NOT_ACCEPTED_FOR_CANONICAL_BUILD');
  return BASELINE_MANIFEST.featureManifest;
}

function canonicalEvidenceHash(evidence) {
  const { evidenceSha256: ignored, ...body } = evidence;
  return createHash('sha256').update(stableSerialize(body)).digest('hex');
}

export function validateEvidenceArtifact(evidence) {
  if (!evidence || typeof evidence !== 'object') datasetError('ML3_2_EVIDENCE_REQUIRED');
  if (evidence.evidenceVersion !== ML3_RAW_EVIDENCE_VERSION) datasetError('ML3_2_EVIDENCE_VERSION_INVALID');
  if (evidence.filterVersion !== ML3_SEGMENT_FILTER_VERSION) datasetError('ML3_2_FILTER_VERSION_INVALID');
  if (evidence.qualityPolicyVersion !== ML3_QUALITY_POLICY_VERSION)
    datasetError('ML3_2_QUALITY_POLICY_VERSION_INVALID');
  if (!SHA256.test(evidence.filterSha256 ?? '')) datasetError('ML3_2_FILTER_SHA_INVALID');
  if (!SHA256.test(evidence.evidenceSha256 ?? '')
    || canonicalEvidenceHash(evidence) !== evidence.evidenceSha256)
    datasetError('ML3_2_EVIDENCE_SHA_INVALID');
  if (evidence.sourceInventoryCanonicalSha256 !== QUALITY_POLICY.acceptedInventoryCanonicalSha256)
    datasetError('ML3_0_FREEZE_SHA_INVALID');
  if (evidence.databaseRead?.freezeInventoryMismatchCount !== 0)
    datasetError('ML3_2_FREEZE_INVENTORY_MISMATCH');
  if (evidence.databaseRead?.rawSampleInventoryMismatchCount !== 0)
    datasetError('ML3_2_RAW_SAMPLE_INVENTORY_MISMATCH');
  const databaseRead = evidence.databaseRead;
  if (databaseRead?.transactionMode !== 'REPEATABLE READ READ ONLY'
    || databaseRead.sessions !== 1
    || databaseRead.samples !== evidence.summary?.totalSamples
    || !Number.isInteger(databaseRead.batches) || databaseRead.batches <= 0)
    datasetError('ML3_2_DATABASE_EVIDENCE_INVALID');
  const integrity = databaseRead.payloadIntegrity ?? {};
  for (const field of ['gzipInvalid', 'jsonInvalid', 'arrayInvalid', 'countMismatch', 'firstLastMetadataMismatch']) {
    if (integrity[field] !== 0) datasetError('ML3_2_PAYLOAD_INTEGRITY_INVALID');
  }
  for (const field of ['gzipValid', 'jsonValid', 'arrayValid', 'countMatch', 'firstLastMetadataMatch']) {
    if (integrity[field] !== databaseRead.batches) datasetError('ML3_2_PAYLOAD_INTEGRITY_INVALID');
  }
  if (evidence.finalTrainingDataset !== false) datasetError('ML3_2_FINAL_TRAINING_STATE_INVALID');
  if (!Array.isArray(evidence.masks) || !evidence.summary) datasetError('ML3_2_MASKS_REQUIRED');

  const seen = new Set();
  const canonicalSeen = new Set();
  let accepted = 0;
  let rejected = 0;
  for (const mask of evidence.masks) {
    const maskIdentity = identity(mask);
    if (!validateIdentity(maskIdentity)) datasetError('ML3_2_MASK_IDENTITY_INVALID');
    const key = identityKey(maskIdentity);
    const canonicalKey = canonicalIdentityKey(maskIdentity);
    if (seen.has(key) || canonicalSeen.has(canonicalKey)) datasetError('ML3_2_MASK_IDENTITY_DUPLICATE');
    seen.add(key);
    canonicalSeen.add(canonicalKey);
    if (mask.lineageStratum !== evidence.lineageStratum) datasetError('CROSS_LINEAGE_MASK_PROHIBITED');
    if (!mask.provenance || typeof mask.provenance !== 'object') datasetError('ML3_2_MASK_PROVENANCE_MISSING');
    if (typeof mask.provenance.source !== 'string' || mask.provenance.source.length === 0
      || typeof mask.provenance.collectionKind !== 'string' || mask.provenance.collectionKind.length === 0
      || typeof mask.provenance.localCollectionSessionId !== 'string'
      || mask.provenance.localCollectionSessionId.length === 0)
      datasetError('ML3_2_MASK_PROVENANCE_INVALID');
    if (mask.sessionId !== evidence.sessionId
      || mask.sampleSessionId !== mask.provenance.localCollectionSessionId)
      datasetError('ML3_2_MASK_PROVENANCE_MISMATCH');
    if (mask.finalTrainingEligible !== false) datasetError('ML3_2_MASK_TRAINING_STATE_INVALID');
    if (mask.mask === SAMPLE_MASK.ACCEPTED && mask.accepted === true) accepted++;
    else if (mask.mask === SAMPLE_MASK.REJECTED && mask.accepted === false) rejected++;
    else datasetError('ML3_2_MASK_DECISION_INCONSISTENT');
  }

  if (evidence.summary.totalSamples !== evidence.masks.length
    || evidence.summary.accepted !== accepted
    || evidence.summary.rejected !== rejected
    || accepted + rejected !== evidence.masks.length)
    datasetError('ML3_2_MASK_COUNTS_INVALID');
  const reasonCount = Object.values(evidence.summary.reasonCounts ?? {})
    .reduce((sum, count) => sum + count, 0);
  if (reasonCount !== rejected) datasetError('ML3_2_REASON_COUNTS_INVALID');
  if (accepted === 0) datasetError('NO_ACCEPTED_ROWS');
  const lineageKeys = Object.keys(evidence.byLineage ?? {});
  if (lineageKeys.length !== 1 || lineageKeys[0] !== evidence.lineageStratum)
    datasetError('CROSS_LINEAGE_EVIDENCE_PROHIBITED');

  return {
    acceptedMasks: evidence.masks.filter(mask => mask.mask === SAMPLE_MASK.ACCEPTED),
    accepted,
    rejected
  };
}

function validateFrozenSession(evidence, frozenSession) {
  if (!frozenSession || frozenSession.sessionId !== evidence.sessionId)
    datasetError('FROZEN_SESSION_ID_MISMATCH');
  if (frozenSession.gameBuildVersion !== evidence.lineageStratum)
    datasetError('FROZEN_SESSION_LINEAGE_MISMATCH');
  if (frozenSession.sampleCount !== evidence.summary.totalSamples)
    datasetError('FROZEN_SESSION_SAMPLE_COUNT_MISMATCH');
  if (frozenSession.schemaVersion !== TELEMETRY_LINEAGE_VERSIONS.SCHEMA_VERSION
    || frozenSession.trackGeometryVersion !== TELEMETRY_LINEAGE_VERSIONS.TRACK_GEOMETRY_VERSION
    || frozenSession.physicsVersion !== TELEMETRY_LINEAGE_VERSIONS.PHYSICS_VERSION
    || frozenSession.featureManifestVersion !== TELEMETRY_LINEAGE_VERSIONS.FEATURE_MANIFEST_VERSION)
    datasetError('FROZEN_SESSION_MANIFEST_MISMATCH');
  if (frozenSession.gameBuildVersion === '0.3.0-ml2'
    && frozenSession.simulationFingerprint !== SIMULATION_FINGERPRINT_SHA256)
    datasetError('FROZEN_SESSION_FINGERPRINT_MISMATCH');
  if (frozenSession.gameBuildVersion === '0.2.0-ml2'
    && frozenSession.simulationFingerprint !== null
    && frozenSession.simulationFingerprint !== SIMULATION_FINGERPRINT_SHA256)
    datasetError('FROZEN_SESSION_FINGERPRINT_MISMATCH');
}

function encodeObservation(sample, featureManifest) {
  return featureManifest.observationFeatures.map(field => {
    const raw = valueAtPath(sample, field);
    if (field === 'trackState.surface') {
      const encoded = featureManifest.surfaceEncodingDomain.indexOf(raw);
      if (encoded < 0) datasetError('SURFACE_ENCODING_VALUE_INVALID');
      return encoded;
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) datasetError(`OBSERVATION_VALUE_INVALID:${field}`);
    return raw;
  });
}

function encodeTarget(sample, featureManifest) {
  return featureManifest.actionTargets.map(field => {
    const raw = valueAtPath(sample, field);
    if (typeof raw !== 'number' || !Number.isFinite(raw)) datasetError(`TARGET_VALUE_INVALID:${field}`);
    return raw;
  });
}

export function buildCanonicalDataset({ evidence, frozenSession, samples } = {}) {
  const evidenceValidation = validateEvidenceArtifact(evidence);
  const featureManifest = manifestForLineage(evidence.lineageStratum);
  validateFrozenSession(evidence, frozenSession);
  if (!Array.isArray(samples)) datasetError('RAW_SAMPLES_ARRAY_REQUIRED');
  if (samples.length !== frozenSession.sampleCount) datasetError('RAW_SAMPLE_COUNT_MISMATCH');

  const rawByIdentity = new Map();
  for (const sample of samples) {
    const raw = rawIdentity(sample);
    if (typeof raw.sampleSessionId !== 'string' || raw.sampleSessionId.length === 0
      || !Number.isInteger(raw.lapNumber) || !Number.isInteger(raw.sampleIndex))
      datasetError('RAW_SAMPLE_IDENTITY_INVALID');
    if (raw.sampleSessionId !== frozenSession.localCollectionSessionId)
      datasetError('RAW_SAMPLE_SESSION_MISMATCH');
    const key = rawIdentityKey(sample);
    if (rawByIdentity.has(key)) datasetError('RAW_SAMPLE_IDENTITY_DUPLICATE');
    rawByIdentity.set(key, sample);
  }
  for (const mask of evidenceValidation.acceptedMasks) {
    const maskIdentity = identity(mask);
    const key = `${maskIdentity.sampleSessionId}\u0000${maskIdentity.lapNumber}\u0000${maskIdentity.sampleIndex}`;
    if (!rawByIdentity.has(key)) datasetError('ACCEPTED_RAW_SAMPLE_MISSING');
  }
  const inventoryMismatches = rawInventoryMismatches(frozenSession, samples);
  if (inventoryMismatches.length) datasetError('RAW_SAMPLE_INVENTORY_MISMATCH');

  const lineage = {
    lineageStratum: evidence.lineageStratum,
    schemaVersion: frozenSession.schemaVersion,
    gameBuildVersion: frozenSession.gameBuildVersion,
    trackGeometryVersion: frozenSession.trackGeometryVersion,
    physicsVersion: frozenSession.physicsVersion,
    featureManifestVersion: frozenSession.featureManifestVersion,
    simulationFingerprint: frozenSession.simulationFingerprint ?? null
  };
  const rows = evidenceValidation.acceptedMasks.map(mask => {
    const maskIdentity = identity(mask);
    const sample = rawByIdentity.get(`${maskIdentity.sampleSessionId}\u0000${maskIdentity.lapNumber}\u0000${maskIdentity.sampleIndex}`);
    if (!sample) datasetError('ACCEPTED_RAW_SAMPLE_MISSING');
    if (sample.schemaVersion !== frozenSession.schemaVersion) datasetError('RAW_SAMPLE_SCHEMA_MISMATCH');
    return {
      provenance: {
        source: mask.provenance.source ?? null,
        collectionKind: mask.provenance.collectionKind ?? null,
        localCollectionSessionId: mask.provenance.localCollectionSessionId ?? null
      },
      identity: maskIdentity,
      lineage: { ...lineage },
      observation: encodeObservation(sample, featureManifest),
      target: encodeTarget(sample, featureManifest)
    };
  }).sort(compareRows);

  if (rows.length !== evidence.summary.accepted) datasetError('CANONICAL_ROW_COUNT_MISMATCH');
  const core = {
    datasetVersion: ML3_DATASET_VERSION,
    sourceEvidenceSha256: evidence.evidenceSha256,
    sourceInventoryCanonicalSha256: evidence.sourceInventoryCanonicalSha256,
    lineage,
    featureSchema: {
      observationFeatures: [...featureManifest.observationFeatures],
      actionTargets: [...featureManifest.actionTargets],
      encodings: {
        'trackState.surface': {
          type: SURFACE_ENCODING,
          domain: [...featureManifest.surfaceEncodingDomain]
        }
      },
      normalization: 'NONE'
    },
    summary: {
      rowCount: rows.length,
      sourceTotalSamples: evidence.summary.totalSamples,
      sourceAcceptedSamples: evidence.summary.accepted,
      sourceRejectedSamples: evidence.summary.rejected,
      lineageStratum: evidence.lineageStratum
    },
    rows,
    canonicalDataset: true,
    finalTrainingDataset: false,
    splitApplied: false,
    shuffled: false
  };
  assertNoCredentials(core);
  assertNoRawPayloadFields(core);
  return {
    ...core,
    datasetSha256: createHash('sha256').update(stableSerialize(core)).digest('hex')
  };
}

export function materializeCanonicalDataset({ inventoryArtifact, evidence, cloudResult } = {}) {
  validateEvidenceArtifact(evidence);
  const { computedHash, selected } = selectFrozenInventorySessions(inventoryArtifact, {
    sessionId: evidence.sessionId
  });
  if (computedHash !== evidence.sourceInventoryCanonicalSha256)
    datasetError('EVIDENCE_INVENTORY_SHA_MISMATCH');
  if (cloudResult?.status?.status !== 'AVAILABLE_FULL') {
    const code = cloudResult?.status?.code ?? 'CLOUD_FULL_INVENTORY_BLOCKED';
    const reason = cloudResult?.status?.reason ?? 'CLOUD_QUERY_FAILED';
    datasetError(`${code}:${reason}`);
  }
  if (!(cloudResult.samplesBySession instanceof Map)) datasetError('SAMPLES_BY_SESSION_MAP_REQUIRED');
  const frozenSession = selected[0];
  const cloudSession = cloudResult.sessions?.find(session => session.sessionId === evidence.sessionId);
  const samples = cloudResult.samplesBySession.get(evidence.sessionId);
  const reconciliation = reconcileCloudEvidence({
    frozenSession,
    cloudSession,
    cloudStatus: cloudResult.status,
    samples
  });
  if (reconciliation.mismatchCount) datasetError('RAW_EVIDENCE_FREEZE_MISMATCH');
  return buildCanonicalDataset({ evidence, frozenSession, samples });
}
