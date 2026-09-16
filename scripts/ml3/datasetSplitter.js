import { createHash } from 'node:crypto';
import { stableSerialize } from '../../src/ml/lineage/acceptedBaseline.js';
import { assertNoCredentials } from './inventoryCore.js';
import { assertNoRawPayloadFields } from './rawEvidenceMaterializer.js';
import { ML3_DATASET_VERSION } from './datasetBuilder.js';

export const ML3_SPLIT_MANIFEST_VERSION = 'ML3.4-1';
export const ML3_SPLIT_ALGORITHM = Object.freeze({
  name: 'ORDERED_CONTIGUOUS_GROUP_CUTS',
  version: '1.0.0'
});

export const ACCEPTED_ML3_DATASET = Object.freeze({
  datasetVersion: ML3_DATASET_VERSION,
  datasetSha256: '646963ddfb664343e195620ad4fe87e2d810e7d6ee2d8beb179fc581e9a58ab0',
  sourceEvidenceSha256: '1883f86b98ddf8467d332a43fb587cf88e1432ee0a70231f2addb90758bfccde',
  lineageStratum: '0.2.0-ml2',
  rowCount: 1190
});

const SHA256 = /^[a-f0-9]{64}$/;
const SPLIT_NAMES = ['train', 'validation', 'test'];
const TARGET_PERCENT = Object.freeze({ train: 70, validation: 15, test: 15 });

function splitError(code) {
  throw new Error(code);
}

function datasetCoreHash(dataset) {
  const { datasetSha256: ignored, ...core } = dataset;
  return createHash('sha256').update(stableSerialize(core)).digest('hex');
}

function sampleIdentity(row) {
  return {
    sessionId: row?.identity?.sessionId,
    sampleSessionId: row?.identity?.sampleSessionId,
    lapNumber: row?.identity?.lapNumber,
    sampleIndex: row?.identity?.sampleIndex
  };
}

function sampleIdentityKey(identity) {
  return `${identity.sessionId}\u0000${identity.sampleSessionId}\u0000${identity.lapNumber}\u0000${identity.sampleIndex}`;
}

function validSampleIdentity(identity) {
  return typeof identity.sessionId === 'string' && identity.sessionId.length > 0
    && typeof identity.sampleSessionId === 'string' && identity.sampleSessionId.length > 0
    && Number.isInteger(identity.lapNumber)
    && Number.isInteger(identity.sampleIndex);
}

function validProvenance(provenance) {
  return provenance && typeof provenance === 'object'
    && typeof provenance.source === 'string' && provenance.source.length > 0
    && typeof provenance.collectionKind === 'string' && provenance.collectionKind.length > 0
    && typeof provenance.localCollectionSessionId === 'string'
    && provenance.localCollectionSessionId.length > 0;
}

function compareRows(a, b) {
  return String(a.identity.sessionId).localeCompare(String(b.identity.sessionId))
    || Number(a.identity.lapNumber) - Number(b.identity.lapNumber)
    || Number(a.identity.sampleIndex) - Number(b.identity.sampleIndex)
    || String(a.identity.sampleSessionId).localeCompare(String(b.identity.sampleSessionId));
}

function sameTemporalStream(a, b) {
  return a.identity.sessionId === b.identity.sessionId
    && a.identity.sampleSessionId === b.identity.sampleSessionId
    && a.identity.lapNumber === b.identity.lapNumber
    && a.provenance.source === b.provenance.source
    && a.provenance.collectionKind === b.provenance.collectionKind
    && a.provenance.localCollectionSessionId === b.provenance.localCollectionSessionId;
}

function isContinuous(a, b) {
  return sameTemporalStream(a, b)
    && b.identity.sampleIndex === a.identity.sampleIndex + 1;
}

export function validateCanonicalDataset(dataset, expected = ACCEPTED_ML3_DATASET) {
  if (!dataset || typeof dataset !== 'object' || Array.isArray(dataset))
    splitError('CANONICAL_DATASET_REQUIRED');
  if (dataset.datasetVersion !== expected.datasetVersion)
    splitError('CANONICAL_DATASET_VERSION_INVALID');
  if (dataset.canonicalDataset !== true || dataset.finalTrainingDataset !== false
    || dataset.splitApplied !== false || dataset.shuffled !== false)
    splitError('CANONICAL_DATASET_STATE_INVALID');
  if (dataset.sourceEvidenceSha256 !== expected.sourceEvidenceSha256)
    splitError('CANONICAL_DATASET_SOURCE_EVIDENCE_INVALID');
  if (dataset.lineage?.lineageStratum !== expected.lineageStratum
    || dataset.summary?.lineageStratum !== expected.lineageStratum)
    splitError('CANONICAL_DATASET_LINEAGE_INVALID');
  if (dataset.lineage.lineageStratum !== '0.2.0-ml2')
    splitError('RUNTIME_OR_UNACCEPTED_LINEAGE_PROHIBITED');
  if (!Array.isArray(dataset.rows)
    || dataset.rows.length !== expected.rowCount
    || dataset.summary?.rowCount !== expected.rowCount)
    splitError('CANONICAL_DATASET_ROW_COUNT_INVALID');
  if (!SHA256.test(dataset.datasetSha256 ?? '')
    || dataset.datasetSha256 !== expected.datasetSha256)
    splitError('CANONICAL_DATASET_SHA_INVALID');
  if (datasetCoreHash(dataset) !== dataset.datasetSha256)
    splitError('CANONICAL_DATASET_SHA_MISMATCH');

  const seen = new Set();
  const lineageKey = stableSerialize(dataset.lineage);
  for (let index = 0; index < dataset.rows.length; index++) {
    const row = dataset.rows[index];
    const identity = sampleIdentity(row);
    if (!validSampleIdentity(identity)) splitError('CANONICAL_SAMPLE_IDENTITY_INVALID');
    if (!validProvenance(row.provenance)
      || row.provenance.localCollectionSessionId !== identity.sampleSessionId)
      splitError('CANONICAL_SAMPLE_PROVENANCE_INVALID');
    if (stableSerialize(row.lineage) !== lineageKey)
      splitError('CANONICAL_SAMPLE_LINEAGE_INVALID');
    const key = sampleIdentityKey(identity);
    if (seen.has(key)) splitError('CANONICAL_SAMPLE_IDENTITY_DUPLICATE');
    seen.add(key);
    if (index > 0 && compareRows(dataset.rows[index - 1], row) >= 0)
      splitError('CANONICAL_DATASET_ORDER_INVALID');
  }
  return dataset;
}

function closeGroup(group) {
  const first = group.rows[0];
  const last = group.rows.at(-1);
  return {
    groupIdentity: {
      provenance: { ...first.provenance },
      sessionId: first.identity.sessionId,
      sampleSessionId: first.identity.sampleSessionId,
      lapNumber: first.identity.lapNumber,
      startSampleIndex: first.identity.sampleIndex,
      endSampleIndex: last.identity.sampleIndex
    },
    rowCount: group.rows.length,
    sampleIdentities: group.rows.map(sampleIdentity)
  };
}

export function formTemporalGroups(rows) {
  const groups = [];
  let current = null;
  for (const row of rows) {
    if (!current || !isContinuous(current.rows.at(-1), row)) {
      if (current) groups.push(closeGroup(current));
      current = { rows: [row] };
    } else {
      current.rows.push(row);
    }
  }
  if (current) groups.push(closeGroup(current));
  return groups;
}

function chooseCuts(groups) {
  if (groups.length === 1) return [1, 1];
  if (groups.length === 2) return [1, 2];
  const prefix = [0];
  for (const group of groups) prefix.push(prefix.at(-1) + group.rowCount);
  const total = prefix.at(-1);
  let best = null;
  for (let trainCut = 1; trainCut <= groups.length - 2; trainCut++) {
    for (let validationCut = trainCut + 1; validationCut <= groups.length - 1; validationCut++) {
      const counts = {
        train: prefix[trainCut],
        validation: prefix[validationCut] - prefix[trainCut],
        test: total - prefix[validationCut]
      };
      const score = SPLIT_NAMES.reduce((sum, name) =>
        sum + Math.abs(counts[name] * 100 - total * TARGET_PERCENT[name]), 0);
      if (!best || score < best.score) best = { trainCut, validationCut, score };
    }
  }
  return [best.trainCut, best.validationCut];
}

function splitGroups(groups) {
  const [trainCut, validationCut] = chooseCuts(groups);
  return {
    train: groups.slice(0, trainCut),
    validation: groups.slice(trainCut, validationCut),
    test: groups.slice(validationCut)
  };
}

function summarizeAssignedGroups(assigned) {
  return Object.fromEntries(SPLIT_NAMES.map(name => [name, {
    rowCount: assigned[name].reduce((sum, group) => sum + group.rowCount, 0),
    groupCount: assigned[name].length,
    assignedGroups: assigned[name]
  }]));
}

function leakageChecks(rows, splits) {
  const sampleOwners = new Map();
  const groupOwners = new Map();
  let duplicateSampleAssignments = 0;
  let duplicateGroupAssignments = 0;
  let assignedRows = 0;
  for (const name of SPLIT_NAMES) {
    for (const group of splits[name].assignedGroups) {
      const groupKey = stableSerialize(group.groupIdentity);
      if (groupOwners.has(groupKey)) duplicateGroupAssignments++;
      groupOwners.set(groupKey, name);
      for (const identity of group.sampleIdentities) {
        assignedRows++;
        const key = sampleIdentityKey(identity);
        if (sampleOwners.has(key)) duplicateSampleAssignments++;
        sampleOwners.set(key, name);
      }
    }
  }
  let temporalContinuityCrossSplitCount = 0;
  for (let index = 1; index < rows.length; index++) {
    if (!isContinuous(rows[index - 1], rows[index])) continue;
    const previousOwner = sampleOwners.get(sampleIdentityKey(sampleIdentity(rows[index - 1])));
    const currentOwner = sampleOwners.get(sampleIdentityKey(sampleIdentity(rows[index])));
    if (previousOwner !== currentOwner) temporalContinuityCrossSplitCount++;
  }
  return {
    sampleIdentityDisjoint: duplicateSampleAssignments === 0,
    groupIdentityDisjoint: duplicateGroupAssignments === 0,
    temporalContinuityDisjoint: temporalContinuityCrossSplitCount === 0,
    completeRowCoverage: assignedRows === rows.length && sampleOwners.size === rows.length,
    duplicateSampleAssignments,
    duplicateGroupAssignments,
    temporalContinuityCrossSplitCount,
    assignedRows
  };
}

export function splitCanonicalDataset(dataset, { expectedDataset = ACCEPTED_ML3_DATASET } = {}) {
  validateCanonicalDataset(dataset, expectedDataset);
  const groups = formTemporalGroups(dataset.rows);
  if (groups.length === 0) splitError('TEMPORAL_GROUPS_REQUIRED');
  const assigned = splitGroups(groups);
  const splits = summarizeAssignedGroups(assigned);
  if (groups.length >= 3 && SPLIT_NAMES.some(name => splits[name].groupCount === 0))
    splitError('NON_EMPTY_SPLIT_GUARANTEE_FAILED');
  const checks = leakageChecks(dataset.rows, splits);
  if (!checks.sampleIdentityDisjoint || !checks.groupIdentityDisjoint
    || !checks.temporalContinuityDisjoint || !checks.completeRowCoverage)
    splitError('SPLIT_LEAKAGE_OR_COVERAGE_CHECK_FAILED');

  const sessionCount = new Set(dataset.rows.map(row => row.identity.sessionId)).size;
  const rowCounts = Object.fromEntries(SPLIT_NAMES.map(name => [name, splits[name].rowCount]));
  const groupCounts = Object.fromEntries(SPLIT_NAMES.map(name => [name, splits[name].groupCount]));
  const core = {
    splitManifestVersion: ML3_SPLIT_MANIFEST_VERSION,
    sourceDatasetSha256: dataset.datasetSha256,
    sourceDatasetVersion: dataset.datasetVersion,
    sourceEvidenceSha256: dataset.sourceEvidenceSha256,
    lineage: { ...dataset.lineage },
    algorithm: {
      ...ML3_SPLIT_ALGORITHM,
      groupingUnit: 'MAXIMAL_CONTIGUOUS_SAMPLE_INDEX_RUN_WITHIN_REAL_PROVENANCE_AND_LAP',
      allocationUnit: 'WHOLE_TEMPORAL_GROUP',
      ordering: 'CANONICAL_SOURCE_ORDER',
      cutSelection: 'MINIMUM_TOTAL_ABSOLUTE_ROW_RATIO_DEVIATION',
      tieBreak: 'EARLIEST_TRAIN_CUT_THEN_EARLIEST_VALIDATION_CUT',
      targetPercent: { ...TARGET_PERCENT },
      rowShuffle: false
    },
    evaluationScope: {
      kind: sessionCount === 1
        ? 'HISTORICAL_SINGLE_SESSION_PIPELINE_SMOKE'
        : 'HISTORICAL_MULTI_SESSION_PIPELINE_SMOKE',
      sessionCount,
      independentSessionGeneralization: false
    },
    summary: {
      sourceRowCount: dataset.rows.length,
      assignedRowCount: checks.assignedRows,
      coveragePercent: 100,
      sourceGroupCount: groups.length,
      rowCounts,
      groupCounts
    },
    splits,
    leakageChecks: checks,
    splitApplied: true,
    finalTrainingDataset: false,
    canonicalDatasetUnmodified: true,
    normalization: 'NONE',
    augmentation: false,
    balancing: false,
    trainingPerformed: false
  };
  assertNoCredentials(core);
  assertNoRawPayloadFields(core);
  return {
    ...core,
    splitManifestSha256: createHash('sha256').update(stableSerialize(core)).digest('hex')
  };
}
