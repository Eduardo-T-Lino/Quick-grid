import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  ACCEPTED_ML3_DATASET,
  formTemporalGroups,
  ML3_SPLIT_ALGORITHM,
  ML3_SPLIT_MANIFEST_VERSION,
  splitCanonicalDataset,
  validateCanonicalDataset
} from './ml3/datasetSplitter.js';
import { stableSerialize } from '../src/ml/lineage/acceptedBaseline.js';
import { ML3_DATASET_VERSION } from './ml3/datasetBuilder.js';
import { main, parseArgs } from './ml3_split_dataset.js';

let passed = 0;

function check(condition, label) {
  assert.ok(condition, label);
  passed++;
  console.log(`  PASS: ${label}`);
}

function expectError(fn, code) {
  assert.throws(fn, error => error?.message === code);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const lineage = {
  lineageStratum: '0.2.0-ml2',
  schemaVersion: 2,
  gameBuildVersion: '0.2.0-ml2',
  trackGeometryVersion: '1.5.0-centripetal',
  physicsVersion: '2.2.0',
  featureManifestVersion: '2.1.0',
  simulationFingerprint: null
};

function row(sampleIndex) {
  return {
    provenance: {
      source: 'CLOUD_POSTGRES',
      collectionKind: 'HUMAN',
      localCollectionSessionId: 'historical-local-session'
    },
    identity: {
      sessionId: 'historical-cloud-session',
      sampleSessionId: 'historical-local-session',
      lapNumber: 1,
      sampleIndex
    },
    lineage: { ...lineage },
    observation: [sampleIndex],
    target: [sampleIndex / 100]
  };
}

function rehash(dataset) {
  const { datasetSha256: ignored, ...core } = dataset;
  dataset.datasetSha256 = createHash('sha256').update(stableSerialize(core)).digest('hex');
  return dataset;
}

function fixtureDataset() {
  const indexes = [
    0, 1, 2, 3, 4, 5, 6,
    10, 11, 12, 13, 14, 15, 16,
    20, 21, 22,
    30, 31, 32
  ];
  return rehash({
    datasetVersion: ML3_DATASET_VERSION,
    sourceEvidenceSha256: 'a'.repeat(64),
    sourceInventoryCanonicalSha256: 'b'.repeat(64),
    lineage: { ...lineage },
    featureSchema: {
      observationFeatures: ['fixture.value'],
      actionTargets: ['fixture.action'],
      encodings: {},
      normalization: 'NONE'
    },
    summary: {
      rowCount: indexes.length,
      sourceTotalSamples: 24,
      sourceAcceptedSamples: indexes.length,
      sourceRejectedSamples: 4,
      lineageStratum: lineage.lineageStratum
    },
    rows: indexes.map(row),
    canonicalDataset: true,
    finalTrainingDataset: false,
    splitApplied: false,
    shuffled: false
  });
}

function expectedFor(dataset) {
  return {
    datasetVersion: dataset.datasetVersion,
    datasetSha256: dataset.datasetSha256,
    sourceEvidenceSha256: dataset.sourceEvidenceSha256,
    lineageStratum: dataset.lineage.lineageStratum,
    rowCount: dataset.rows.length
  };
}

function manifestCoreHash(manifest) {
  const { splitManifestSha256: ignored, ...core } = manifest;
  return createHash('sha256').update(stableSerialize(core)).digest('hex');
}

console.log('ML3.4 deterministic dataset splitter tests');

const dataset = fixtureDataset();
const expected = expectedFor(dataset);
const before = stableSerialize(dataset);
validateCanonicalDataset(dataset, expected);
check(true, 'only a canonical ML3.3 dataset matching the supplied immutable contract is accepted');

check(ACCEPTED_ML3_DATASET.datasetVersion === 'ML3.3-1'
  && ACCEPTED_ML3_DATASET.rowCount === 1190
  && ACCEPTED_ML3_DATASET.lineageStratum === '0.2.0-ml2'
  && ACCEPTED_ML3_DATASET.datasetSha256 === '646963ddfb664343e195620ad4fe87e2d810e7d6ee2d8beb179fc581e9a58ab0'
  && ACCEPTED_ML3_DATASET.sourceEvidenceSha256 === '1883f86b98ddf8467d332a43fb587cf88e1432ee0a70231f2addb90758bfccde',
  'production contract is frozen to the validated ML3.3 artifact');

const groups = formTemporalGroups(dataset.rows);
check(groups.length === 4 && groups.map(group => group.rowCount).join(',') === '7,7,3,3',
  'maximal sample-index runs form deterministic temporal groups');
check(groups.every(group => group.groupIdentity.sessionId === 'historical-cloud-session'
  && group.groupIdentity.sampleSessionId === 'historical-local-session'
  && group.groupIdentity.provenance.source === 'CLOUD_POSTGRES'),
  'group identities are composed only from real row identity and provenance');

const manifest = splitCanonicalDataset(dataset, { expectedDataset: expected });
check(manifest.splitManifestVersion === ML3_SPLIT_MANIFEST_VERSION
  && manifest.algorithm.name === ML3_SPLIT_ALGORITHM.name
  && manifest.algorithm.version === ML3_SPLIT_ALGORITHM.version,
  'split manifest records the versioned deterministic algorithm');
check(manifest.summary.rowCounts.train === 14
  && manifest.summary.rowCounts.validation === 3
  && manifest.summary.rowCounts.test === 3,
  'whole-group cuts minimize deviation from the 70/15/15 row targets');
check(manifest.summary.groupCounts.train === 2
  && manifest.summary.groupCounts.validation === 1
  && manifest.summary.groupCounts.test === 1,
  'three or more temporal groups guarantee at least one group per split');
check(manifest.summary.assignedRowCount === dataset.rows.length
  && manifest.summary.coveragePercent === 100,
  'the split preserves the exact source-row union with full coverage');
check(manifest.leakageChecks.sampleIdentityDisjoint
  && manifest.leakageChecks.duplicateSampleAssignments === 0,
  'sample identities are disjoint across train, validation and test');
check(manifest.leakageChecks.groupIdentityDisjoint
  && manifest.leakageChecks.duplicateGroupAssignments === 0,
  'temporal group identities are disjoint across all splits');
check(manifest.leakageChecks.temporalContinuityDisjoint
  && manifest.leakageChecks.temporalContinuityCrossSplitCount === 0,
  'no continuous sample-index edge crosses a split boundary');

const assignedIdentities = Object.values(manifest.splits)
  .flatMap(split => split.assignedGroups)
  .flatMap(group => group.sampleIdentities)
  .map(identity => stableSerialize(identity));
const sourceIdentities = dataset.rows.map(item => stableSerialize(item.identity));
check(assignedIdentities.length === sourceIdentities.length
  && new Set(assignedIdentities).size === sourceIdentities.length
  && sourceIdentities.every(identity => assignedIdentities.includes(identity)),
  'no source identity is lost, duplicated or created');
check(stableSerialize(dataset) === before && manifest.canonicalDatasetUnmodified === true,
  'the canonical ML3.3 dataset remains byte-logically immutable');
check(manifest.splitApplied === true && manifest.finalTrainingDataset === false,
  'manifest records split assignment without promoting a final training dataset');
check(manifest.evaluationScope.kind === 'HISTORICAL_SINGLE_SESSION_PIPELINE_SMOKE'
  && manifest.evaluationScope.independentSessionGeneralization === false,
  'single-session fallback is explicitly limited to historical pipeline and smoke use');
check(manifest.algorithm.rowShuffle === false
  && manifest.normalization === 'NONE'
  && manifest.augmentation === false
  && manifest.balancing === false
  && manifest.trainingPerformed === false,
  'split performs no row shuffle, normalization, augmentation, balancing or training');
check(manifestCoreHash(manifest) === manifest.splitManifestSha256,
  'declared split manifest SHA-256 matches canonical serialization');
const repeated = splitCanonicalDataset(clone(dataset), { expectedDataset: expected });
check(stableSerialize(repeated) === stableSerialize(manifest),
  'identical canonical input produces a byte-identical split manifest');

const badVersion = clone(dataset);
badVersion.datasetVersion = 'ML3.2-INVALID';
expectError(() => validateCanonicalDataset(badVersion, expected), 'CANONICAL_DATASET_VERSION_INVALID');
check(true, 'datasetVersion mismatch fails closed');

const badLineage = clone(dataset);
badLineage.summary.lineageStratum = '0.3.0-ml2';
expectError(() => validateCanonicalDataset(badLineage, expected), 'CANONICAL_DATASET_LINEAGE_INVALID');
check(true, 'lineage mismatch fails closed');

const runtime = clone(dataset);
runtime.lineage.lineageStratum = '0.6.0';
runtime.summary.lineageStratum = '0.6.0';
for (const item of runtime.rows) item.lineage.lineageStratum = '0.6.0';
rehash(runtime);
expectError(() => validateCanonicalDataset(runtime, expectedFor(runtime)), 'RUNTIME_OR_UNACCEPTED_LINEAGE_PROHIBITED');
check(true, 'runtime 0.6.x cannot enter the historical split');

const badCount = clone(dataset);
badCount.summary.rowCount--;
expectError(() => validateCanonicalDataset(badCount, expected), 'CANONICAL_DATASET_ROW_COUNT_INVALID');
check(true, 'row-count mismatch fails closed');

const badDeclaredSha = clone(dataset);
badDeclaredSha.datasetSha256 = 'f'.repeat(64);
expectError(() => validateCanonicalDataset(badDeclaredSha, expected), 'CANONICAL_DATASET_SHA_INVALID');
check(true, 'dataset SHA must match the accepted contract exactly');

const tampered = clone(dataset);
tampered.rows[0].target[0] = 999;
expectError(() => validateCanonicalDataset(tampered, expected), 'CANONICAL_DATASET_SHA_MISMATCH');
check(true, 'canonical content tampering is detected by SHA recomputation');

const duplicate = clone(dataset);
duplicate.rows[1].identity = { ...duplicate.rows[0].identity };
rehash(duplicate);
expectError(() => validateCanonicalDataset(duplicate, expectedFor(duplicate)), 'CANONICAL_SAMPLE_IDENTITY_DUPLICATE');
check(true, 'duplicate sample identities are rejected');

const ambiguous = clone(dataset);
ambiguous.rows[0].provenance.localCollectionSessionId = 'different-session';
rehash(ambiguous);
expectError(() => validateCanonicalDataset(ambiguous, expectedFor(ambiguous)), 'CANONICAL_SAMPLE_PROVENANCE_INVALID');
check(true, 'group provenance cannot be invented or detached from sample identity');

check(parseArgs(['--dataset', 'input.json', '--output', 'split.json']).dataset === 'input.json',
  'CLI requires explicit canonical input and split output paths');
expectError(() => parseArgs(['--dataset', 'input.json']),
  'USAGE: npm run ml3:split -- --dataset <path> --output <path>');
expectError(() => main(['--dataset', '__missing_ml3_dataset__.json', '--output', 'split.json']),
  'CANONICAL_DATASET_ARTIFACT_MISSING');
check(true, 'missing real canonical artifact fails without synthesizing rows or output');

console.log(`ML3_DATASET_SPLITTER_CHECKS: ${passed} total, ${passed} passed, 0 failed`);
