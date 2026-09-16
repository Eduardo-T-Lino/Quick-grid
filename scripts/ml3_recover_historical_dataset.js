import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { stableSerialize } from '../src/ml/lineage/acceptedBaseline.js';
import { buildCanonicalDataset, validateEvidenceArtifact } from './ml3/datasetBuilder.js';
import { inventoryCloud, documentedKnownSessions } from './ml3/inventorySources.js';
import { canonicalJson, mergeSessions } from './ml3/inventoryCore.js';
import { QUALITY_POLICY } from './ml3/qualityPolicy.js';
import {
  buildRawEvidenceArtifact,
  reconcileCloudEvidence
} from './ml3/rawEvidenceMaterializer.js';
import {
  filterSessionSamples,
  ML3_SEGMENT_FILTER_VERSION
} from './ml3/segmentFilter.js';

// LEGACY OPTIONAL RECOVERY: this CLI is retained only for historical audit/recovery.
// It is not a dependency or gate for the current ML data pipeline.
export const HISTORICAL_RECOVERY_MODE = 'LEGACY_OPTIONAL_RECOVERY';

export const HISTORICAL_RECOVERY = Object.freeze({
  operationalStatus: HISTORICAL_RECOVERY_MODE,
  sessionId: 'ad759118-4386-481f-9d34-f3d496eb1854',
  localCollectionSessionId: 'sess_ehzykwkmy8_1788522459201',
  sourceInventoryCanonicalSha256: 'ade0e99d5162eeea75dfeea9aa70068b64588d025d33d35b5cf7ea335a3ffe68',
  evidenceSha256: '1883f86b98ddf8467d332a43fb587cf88e1432ee0a70231f2addb90758bfccde',
  datasetSha256: '646963ddfb664343e195620ad4fe87e2d810e7d6ee2d8beb179fc581e9a58ab0',
  lineageStratum: '0.2.0-ml2',
  schemaVersion: 2,
  physicsVersion: '1.5.0-gt3',
  trackGeometryVersion: '1.5.0-centripetal',
  featureManifestVersion: '2.1.0',
  trackId: 21,
  sampleRateHz: 10,
  status: 'COMPLETED',
  scope: 'PLAYER_ONLY',
  batchCount: 41,
  sampleCount: 1940,
  lapCount: 3,
  accepted: 1190,
  rejected: 750,
  evidenceOutput: 'artifacts/ml3_segment_evidence_ad759.json',
  datasetOutput: 'artifacts/ml3_canonical_dataset_ad759.json'
});

const PAYLOAD_INTEGRITY_VALID = [
  'gzipValid', 'jsonValid', 'arrayValid', 'countMatch', 'firstLastMetadataMatch'
];
const PAYLOAD_INTEGRITY_INVALID = [
  'gzipInvalid', 'jsonInvalid', 'arrayInvalid', 'countMismatch', 'firstLastMetadataMismatch'
];

function recoveryError(code) {
  throw new Error(code);
}

function assertEqual(actual, expected, field) {
  if (actual !== expected) recoveryError(`DB_INTEGRITY_MISMATCH:${field}`);
}

export function parseArgs(args) {
  if (args.length) recoveryError('ARGUMENTS_NOT_ACCEPTED');
  return {};
}

export function validateCloudRecoveryInput(cloudResult, expected = HISTORICAL_RECOVERY) {
  const status = cloudResult?.status;
  if (status?.status !== 'AVAILABLE_FULL') {
    const reason = status?.reason ?? status?.code ?? 'CLOUD_QUERY_FAILED';
    recoveryError(`DATABASE_READ_BLOCKED:${reason}`);
  }
  assertEqual(status.sessions, 1, 'sessions');
  assertEqual(status.batches, expected.batchCount, 'batches');
  assertEqual(status.samples, expected.sampleCount, 'samples');
  assertEqual(status.rawSamplesInMemory, true, 'rawSamplesInMemory');
  for (const field of PAYLOAD_INTEGRITY_VALID)
    assertEqual(status.payloadIntegrity?.[field], expected.batchCount, `payloadIntegrity.${field}`);
  for (const field of PAYLOAD_INTEGRITY_INVALID)
    assertEqual(status.payloadIntegrity?.[field], 0, `payloadIntegrity.${field}`);

  if (!Array.isArray(cloudResult.sessions) || cloudResult.sessions.length !== 1)
    recoveryError('DB_INTEGRITY_MISMATCH:sessionResultCount');
  const session = cloudResult.sessions[0];
  const fields = {
    sessionId: expected.sessionId,
    localCollectionSessionId: expected.localCollectionSessionId,
    schemaVersion: expected.schemaVersion,
    gameBuildVersion: expected.lineageStratum,
    physicsVersion: expected.physicsVersion,
    trackGeometryVersion: expected.trackGeometryVersion,
    featureManifestVersion: expected.featureManifestVersion,
    trackId: expected.trackId,
    sampleRateHz: expected.sampleRateHz,
    status: expected.status,
    scope: expected.scope,
    batchCount: expected.batchCount,
    sampleCount: expected.sampleCount,
    lapCount: expected.lapCount,
    rawPayloadAvailable: true,
    payloadCorrupt: false,
    collectionKind: 'HUMAN'
  };
  for (const [field, value] of Object.entries(fields)) {
    const actual = field === 'payloadCorrupt' ? session.payloadCorrupt === true : session[field];
    assertEqual(actual, value, `session.${field}`);
  }
  if (session.simulationFingerprint !== null)
    recoveryError('DB_INTEGRITY_MISMATCH:session.simulationFingerprint');
  if (!Array.isArray(session.driverTypes)
    || session.driverTypes.length !== 1 || session.driverTypes[0] !== 'PLAYER')
    recoveryError('DB_INTEGRITY_MISMATCH:session.driverTypes');

  const structural = session.qualitySignals?.structuralIntegrity ?? {};
  const zeroFields = [
    'invalidNumeric', 'trackProgressOutOfRange', 'driverActionOutOfRange',
    'schemaVersionMismatch', 'trackIdMismatch', 'driverTypeInvalid'
  ];
  for (const field of zeroFields) assertEqual(structural[field], 0, `structuralIntegrity.${field}`);
  assertEqual(structural.sampleCountMismatch, false, 'structuralIntegrity.sampleCountMismatch');
  assertEqual(structural.batchCountMismatch, false, 'structuralIntegrity.batchCountMismatch');

  if (!(cloudResult.samplesBySession instanceof Map))
    recoveryError('DB_INTEGRITY_MISMATCH:samplesBySession');
  const samples = cloudResult.samplesBySession.get(expected.sessionId);
  if (!Array.isArray(samples)) recoveryError('DB_INTEGRITY_MISMATCH:rawSamplesMissing');
  assertEqual(samples.length, expected.sampleCount, 'rawSamples.length');
  return { cloudSession: session, samples };
}

export function reconstructFrozenSession(cloudSession, dependencies = {}) {
  const expected = dependencies.expected ?? HISTORICAL_RECOVERY;
  const knownSessions = (dependencies.documentedKnownSessions ?? documentedKnownSessions)();
  const documented = knownSessions.find(session => session.sessionId === expected.sessionId);
  if (!documented) recoveryError('DOCUMENTED_HISTORICAL_SESSION_MISSING');
  const historicalPublicProvenance = {
    source: 'PUBLIC_SESSION_API',
    sessionId: expected.sessionId,
    evidence: ['public-api:GET_SESSION_METADATA_ONLY']
  };
  const merged = (dependencies.mergeSessions ?? mergeSessions)([
    documented,
    historicalPublicProvenance,
    cloudSession
  ]);
  const frozenSession = merged.find(session => session.sessionId === expected.sessionId);
  if (!frozenSession) recoveryError('FROZEN_HISTORICAL_SESSION_MISSING');
  return frozenSession;
}

function round(value) {
  return Number(value.toFixed(6));
}

export function buildHistoricalFilterEnvelope(filteredSession, expected = HISTORICAL_RECOVERY) {
  const sessionSummary = filteredSession.summary;
  const summary = {
    totalSamples: sessionSummary.totalSamples,
    accepted: sessionSummary.accepted,
    rejected: sessionSummary.rejected,
    reasonCounts: { ...sessionSummary.reasonCounts }
  };
  summary.coveragePercent = summary.totalSamples
    ? round(100 * summary.accepted / summary.totalSamples) : 0;
  summary.reasonCounts = Object.fromEntries(Object.entries(summary.reasonCounts)
    .sort(([a], [b]) => a.localeCompare(b)));
  summary.acceptedIntervals = filteredSession.acceptedIntervals?.length ?? 0;
  summary.rejectedIntervals = filteredSession.rejectedIntervals?.length ?? 0;
  summary.unmaterializedRejectionBlocks = 0;
  const lineage = filteredSession.lineageEvaluation?.lineageStratum ?? 'UNRESOLVED';
  const byLineageValue = {
    sessions: 1,
    totalSamples: sessionSummary.totalSamples,
    accepted: sessionSummary.accepted,
    rejected: sessionSummary.rejected,
    coveragePercent: summary.coveragePercent
  };
  const core = {
    filterVersion: ML3_SEGMENT_FILTER_VERSION,
    qualityPolicyVersion: filteredSession.qualityPolicyVersion,
    sourceInventoryCanonicalSha256: expected.sourceInventoryCanonicalSha256,
    sessions: [filteredSession],
    byLineage: { [lineage]: byLineageValue },
    summary,
    finalTrainingDataset: false
  };
  return {
    ...core,
    filterSha256: createHash('sha256').update(stableSerialize(core)).digest('hex')
  };
}

function validateRecoveredEvidence(evidence, expected, validateEvidence) {
  validateEvidence(evidence);
  if (evidence.summary?.accepted !== expected.accepted
    || evidence.summary?.rejected !== expected.rejected)
    recoveryError('RECOVERED_EVIDENCE_COUNTS_MISMATCH');
  if (evidence.lineageStratum !== expected.lineageStratum)
    recoveryError('RECOVERED_EVIDENCE_LINEAGE_MISMATCH');
  if (evidence.sourceInventoryCanonicalSha256 !== expected.sourceInventoryCanonicalSha256)
    recoveryError('RECOVERED_EVIDENCE_INVENTORY_SHA_MISMATCH');
  if (evidence.evidenceSha256 !== expected.evidenceSha256)
    recoveryError('RECOVERED_EVIDENCE_SHA_MISMATCH');
}

function validateRecoveredDataset(dataset, expected) {
  if (dataset.summary?.rowCount !== expected.accepted || dataset.rows?.length !== expected.accepted)
    recoveryError('RECOVERED_DATASET_ROW_COUNT_MISMATCH');
  if (dataset.lineage?.lineageStratum !== expected.lineageStratum
    || dataset.summary?.lineageStratum !== expected.lineageStratum)
    recoveryError('RECOVERED_DATASET_LINEAGE_MISMATCH');
  if (dataset.sourceEvidenceSha256 !== expected.evidenceSha256)
    recoveryError('RECOVERED_DATASET_SOURCE_EVIDENCE_SHA_MISMATCH');
  if (dataset.datasetSha256 !== expected.datasetSha256)
    recoveryError('RECOVERED_DATASET_SHA_MISMATCH');
}

export function writeRecoveredArtifacts({ evidence, dataset, cwd = process.cwd(), fsApi = fs } = {}) {
  const evidencePath = path.resolve(cwd, HISTORICAL_RECOVERY.evidenceOutput);
  const datasetPath = path.resolve(cwd, HISTORICAL_RECOVERY.datasetOutput);
  if (fsApi.existsSync(evidencePath) || fsApi.existsSync(datasetPath))
    recoveryError('RECOVERY_OUTPUT_ALREADY_EXISTS');
  fsApi.mkdirSync(path.dirname(evidencePath), { recursive: true });
  const suffix = `.tmp-${process.pid}-${Date.now()}`;
  const evidenceTemp = `${evidencePath}${suffix}`;
  const datasetTemp = `${datasetPath}${suffix}`;
  let evidenceCommitted = false;
  try {
    fsApi.writeFileSync(evidenceTemp, canonicalJson(evidence), 'utf8');
    fsApi.writeFileSync(datasetTemp, canonicalJson(dataset), 'utf8');
    fsApi.renameSync(evidenceTemp, evidencePath);
    evidenceCommitted = true;
    fsApi.renameSync(datasetTemp, datasetPath);
  } catch (error) {
    for (const target of [evidenceTemp, datasetTemp, ...(evidenceCommitted ? [evidencePath] : [])]) {
      try { if (fsApi.existsSync(target)) fsApi.unlinkSync(target); } catch { /* best-effort pair rollback */ }
    }
    throw error;
  }
  return { evidencePath, datasetPath };
}

export async function recoverHistoricalDataset(options = {}, dependencies = {}) {
  const env = options.env ?? process.env;
  const write = options.write ?? console.log;
  const expected = dependencies.expected ?? HISTORICAL_RECOVERY;
  if (!env.DATABASE_URL) recoveryError('DATABASE_URL_MISSING');
  if (expected.sourceInventoryCanonicalSha256 !== QUALITY_POLICY.acceptedInventoryCanonicalSha256)
    recoveryError('HISTORICAL_FREEZE_SHA_NOT_ACCEPTED_BY_QUALITY_POLICY');
  const readCloud = dependencies.inventoryCloud ?? inventoryCloud;
  let cloudResult;
  try {
    cloudResult = await readCloud({
      sessionId: expected.sessionId,
      materializeRawSamples: true
    });
    const { cloudSession, samples } = validateCloudRecoveryInput(cloudResult, expected);
    const frozenSession = reconstructFrozenSession(cloudSession, {
      ...dependencies,
      expected
    });
    const reconcile = dependencies.reconcileCloudEvidence ?? reconcileCloudEvidence;
    const reconciliation = reconcile({
      frozenSession,
      cloudSession,
      cloudStatus: cloudResult.status,
      samples
    });
    if (reconciliation?.mismatchCount !== 0)
      recoveryError('DB_INVENTORY_RECONCILIATION_MISMATCH');

    const filter = dependencies.filterSessionSamples ?? filterSessionSamples;
    const filteredSession = filter({ session: frozenSession, samples });
    if (filteredSession.rawSampleInventoryMismatchCount !== 0)
      recoveryError('DB_RAW_SAMPLE_INVENTORY_MISMATCH');
    const filterResult = buildHistoricalFilterEnvelope(filteredSession, expected);
    const buildEvidence = dependencies.buildRawEvidenceArtifact ?? buildRawEvidenceArtifact;
    const evidence = buildEvidence({
      filterResult,
      reconciliation,
      cloudStatus: cloudResult.status,
      sessionId: expected.sessionId
    });
    validateRecoveredEvidence(
      evidence,
      expected,
      dependencies.validateEvidenceArtifact ?? validateEvidenceArtifact
    );

    const buildDataset = dependencies.buildCanonicalDataset ?? buildCanonicalDataset;
    const dataset = buildDataset({ evidence, frozenSession, samples });
    validateRecoveredDataset(dataset, expected);

    const persist = dependencies.writeRecoveredArtifacts ?? writeRecoveredArtifacts;
    persist({ evidence, dataset, cwd: options.cwd, fsApi: dependencies.fsApi });
    for (const line of [
      'DB_INTEGRITY=PASS',
      `RAW_SAMPLES=${samples.length}`,
      `ACCEPTED=${evidence.summary.accepted}`,
      `REJECTED=${evidence.summary.rejected}`,
      `EVIDENCE_SHA=${evidence.evidenceSha256}`,
      'EVIDENCE_SHA_MATCH=true',
      `DATASET_ROWS=${dataset.summary.rowCount}`,
      `DATASET_SHA=${dataset.datasetSha256}`,
      'DATASET_SHA_MATCH=true',
      'RECOVERY=SUCCESS'
    ]) write(line);
    return { evidence, dataset };
  } finally {
    cloudResult?.samplesBySession?.clear?.();
  }
}

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  write = console.log
} = {}, dependencies = {}) {
  parseArgs(argv);
  return recoverHistoricalDataset({ env, write }, dependencies);
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
