import { createHash } from 'node:crypto';
import { stableSerialize } from '../../src/ml/lineage/acceptedBaseline.js';
import { assertNoCredentials } from './inventoryCore.js';
import { filterInventoryArtifact, selectFrozenInventorySessions } from './segmentFilter.js';

export const ML3_RAW_EVIDENCE_VERSION = 'ML3.2-B-1';

const RAW_PAYLOAD_KEYS = new Set([
  'payload_compressed',
  'trackState',
  'carState',
  'driverAction',
  'eventState'
]);

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compare(mismatches, field, expected, actual) {
  if (expected !== actual) mismatches.push(`FREEZE_MISMATCH:${field}`);
}

export function assertNoRawPayloadFields(value, path = '') {
  if (!value || typeof value !== 'object') return true;
  for (const [key, child] of Object.entries(value)) {
    if (RAW_PAYLOAD_KEYS.has(key)) throw new Error(`RAW_PAYLOAD_FIELD_FORBIDDEN:${path}${key}`);
    assertNoRawPayloadFields(child, `${path}${key}.`);
  }
  return true;
}

export function reconcileCloudEvidence({ frozenSession, cloudSession, cloudStatus, samples } = {}) {
  const mismatches = [];
  if (!frozenSession || !cloudSession) {
    return { mismatchCount: 1, mismatchCodes: ['FREEZE_MISMATCH:SESSION_MISSING'] };
  }

  for (const field of [
    'sessionId',
    'localCollectionSessionId',
    'schemaVersion',
    'gameBuildVersion',
    'physicsVersion',
    'trackGeometryVersion',
    'featureManifestVersion',
    'simulationFingerprint',
    'trackId',
    'sampleRateHz',
    'batchCount',
    'sampleCount',
    'lapCount'
  ]) compare(mismatches, field, frozenSession[field] ?? null, cloudSession[field] ?? null);

  compare(mismatches, 'cloudStatus.status', 'AVAILABLE_FULL', cloudStatus?.status ?? null);
  compare(mismatches, 'cloudStatus.rawSamplesInMemory', true, cloudStatus?.rawSamplesInMemory === true);
  compare(mismatches, 'cloudStatus.sessions', 1, numeric(cloudStatus?.sessions));
  compare(mismatches, 'cloudStatus.batches', numeric(frozenSession.batchCount), numeric(cloudStatus?.batches));
  compare(mismatches, 'cloudStatus.samples', numeric(frozenSession.sampleCount), numeric(cloudStatus?.samples));
  compare(mismatches, 'samplesBySession.length', numeric(frozenSession.sampleCount),
    Array.isArray(samples) ? samples.length : null);
  compare(mismatches, 'cloudSession.rawPayloadAvailable', true, cloudSession.rawPayloadAvailable === true);
  compare(mismatches, 'cloudSession.payloadCorrupt', false, cloudSession.payloadCorrupt ?? null);

  const integrity = cloudStatus?.payloadIntegrity ?? {};
  for (const field of ['gzipInvalid', 'jsonInvalid', 'arrayInvalid', 'countMismatch', 'firstLastMetadataMismatch'])
    compare(mismatches, `payloadIntegrity.${field}`, 0, numeric(integrity[field]));
  for (const field of ['gzipValid', 'jsonValid', 'arrayValid', 'countMatch', 'firstLastMetadataMatch'])
    compare(mismatches, `payloadIntegrity.${field}`, numeric(frozenSession.batchCount), numeric(integrity[field]));

  return {
    mismatchCount: new Set(mismatches).size,
    mismatchCodes: [...new Set(mismatches)].sort()
  };
}

export function buildRawEvidenceArtifact({ filterResult, reconciliation, cloudStatus, sessionId } = {}) {
  const session = filterResult?.sessions?.find(item =>
    (item.sessionId ?? item.masks?.[0]?.sessionId) === sessionId);
  if (!session) throw new Error('FILTERED_SESSION_MISSING');
  if (reconciliation?.mismatchCount !== 0) throw new Error('RAW_EVIDENCE_FREEZE_MISMATCH');
  if (session.rawSampleInventoryMismatchCount !== 0)
    throw new Error('RAW_SAMPLE_INVENTORY_MISMATCH');

  const result = {
    evidenceVersion: ML3_RAW_EVIDENCE_VERSION,
    filterVersion: filterResult.filterVersion,
    filterSha256: filterResult.filterSha256,
    qualityPolicyVersion: filterResult.qualityPolicyVersion,
    sourceInventoryCanonicalSha256: filterResult.sourceInventoryCanonicalSha256,
    sessionId,
    lineageStratum: session.lineageEvaluation?.lineageStratum ?? null,
    databaseRead: {
      transactionMode: 'REPEATABLE READ READ ONLY',
      sessions: numeric(cloudStatus?.sessions),
      batches: numeric(cloudStatus?.batches),
      samples: numeric(cloudStatus?.samples),
      payloadIntegrity: cloudStatus?.payloadIntegrity ?? {},
      freezeInventoryMismatchCount: reconciliation.mismatchCount,
      freezeInventoryMismatchCodes: reconciliation.mismatchCodes,
      rawSampleInventoryMismatchCount: session.rawSampleInventoryMismatchCount,
      rawSampleInventoryMismatchCodes: session.rawInventoryMismatches
    },
    summary: session.summary,
    byLineage: filterResult.byLineage,
    masks: session.masks,
    acceptedSegments: session.acceptedSegments,
    acceptedIntervals: session.acceptedIntervals,
    rejectedIntervals: session.rejectedIntervals,
    finalTrainingDataset: false
  };
  assertNoCredentials(result);
  assertNoRawPayloadFields(result);
  return {
    ...result,
    evidenceSha256: createHash('sha256').update(stableSerialize(result)).digest('hex')
  };
}

export function materializeCloudEvidence(artifact, { sessionId, cloudResult } = {}) {
  const { selected } = selectFrozenInventorySessions(artifact, { sessionId });
  if (cloudResult?.status?.status !== 'AVAILABLE_FULL') {
    const code = cloudResult?.status?.code ?? 'CLOUD_FULL_INVENTORY_BLOCKED';
    const reason = cloudResult?.status?.reason ?? 'CLOUD_QUERY_FAILED';
    throw new Error(`${code}:${reason}`);
  }
  if (!(cloudResult.samplesBySession instanceof Map)) throw new Error('SAMPLES_BY_SESSION_MAP_REQUIRED');
  const frozenSession = selected[0];
  const cloudSession = cloudResult.sessions?.find(session => session.sessionId === sessionId);
  const samples = cloudResult.samplesBySession.get(sessionId);
  const reconciliation = reconcileCloudEvidence({
    frozenSession,
    cloudSession,
    cloudStatus: cloudResult.status,
    samples
  });
  if (reconciliation.mismatchCount) {
    throw new Error(`RAW_EVIDENCE_FREEZE_MISMATCH:${reconciliation.mismatchCodes.join(',')}`);
  }
  const filterResult = filterInventoryArtifact(artifact, {
    sessionId,
    samplesBySession: cloudResult.samplesBySession
  });
  return buildRawEvidenceArtifact({
    filterResult,
    reconciliation,
    cloudStatus: cloudResult.status,
    sessionId
  });
}
