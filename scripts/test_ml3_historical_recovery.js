import assert from 'node:assert/strict';
import {
  buildHistoricalFilterEnvelope,
  HISTORICAL_RECOVERY,
  parseArgs,
  recoverHistoricalDataset,
  reconstructFrozenSession,
  writeRecoveredArtifacts
} from './ml3_recover_historical_dataset.js';
import { ML3_QUALITY_POLICY_VERSION } from './ml3/qualityPolicy.js';

let passed = 0;

function check(condition, label) {
  assert.ok(condition, label);
  passed++;
  console.log(`  PASS: ${label}`);
}

async function expectError(fn, code) {
  await assert.rejects(fn, error => error?.message === code);
}

function payloadIntegrity() {
  return {
    gzipValid: 41, gzipInvalid: 0,
    jsonValid: 41, jsonInvalid: 0,
    arrayValid: 41, arrayInvalid: 0,
    countMatch: 41, countMismatch: 0,
    firstLastMetadataMatch: 41, firstLastMetadataMismatch: 0
  };
}

function cloudFixture() {
  const samples = Array.from({ length: HISTORICAL_RECOVERY.sampleCount }, (_, index) => ({
    metadata: {
      sessionId: HISTORICAL_RECOVERY.localCollectionSessionId,
      sampleIndex: index,
      lapNumber: index < 623 ? 1 : index < 1359 ? 2 : 3
    }
  }));
  const cloudSession = {
    source: 'CLOUD_POSTGRES',
    sessionId: HISTORICAL_RECOVERY.sessionId,
    localCollectionSessionId: HISTORICAL_RECOVERY.localCollectionSessionId,
    knownGroup: 'HUMAN_VALIDATED',
    collectionKind: 'HUMAN',
    schemaVersion: 2,
    gameBuildVersion: '0.2.0-ml2',
    physicsVersion: '1.5.0-gt3',
    trackGeometryVersion: '1.5.0-centripetal',
    featureManifestVersion: '2.1.0',
    simulationFingerprint: null,
    fingerprintStatus: 'MISSING',
    trackId: 21,
    sampleRateHz: 10,
    scope: 'PLAYER_ONLY',
    status: 'COMPLETED',
    driverTypes: ['PLAYER'],
    batchCount: 41,
    sampleCount: 1940,
    lapCount: 3,
    rawPayloadAvailable: true,
    payloadCorrupt: false,
    evidence: ['postgres:READ_ONLY_REPEATABLE_READ'],
    qualitySignals: {
      structuralIntegrity: {
        invalidNumeric: 0,
        trackProgressOutOfRange: 0,
        driverActionOutOfRange: 0,
        schemaVersionMismatch: 0,
        trackIdMismatch: 0,
        driverTypeInvalid: 0,
        sampleCountMismatch: false,
        batchCountMismatch: false
      },
      payloadIntegrity: payloadIntegrity()
    }
  };
  return {
    sessions: [cloudSession],
    samplesBySession: new Map([[HISTORICAL_RECOVERY.sessionId, samples]]),
    status: {
      source: 'CLOUD_POSTGRES',
      status: 'AVAILABLE_FULL',
      sessions: 1,
      batches: 41,
      samples: 1940,
      rawSamplesInMemory: true,
      payloadIntegrity: payloadIntegrity()
    }
  };
}

function filteredFixture() {
  return {
    filterVersion: 'ML3.2-1',
    qualityPolicyVersion: ML3_QUALITY_POLICY_VERSION,
    lineageEvaluation: { lineageStratum: '0.2.0-ml2' },
    rawSampleInventoryMismatchCount: 0,
    rawInventoryMismatches: [],
    masks: [{ sessionId: HISTORICAL_RECOVERY.sessionId }],
    acceptedSegments: [],
    acceptedIntervals: Array.from({ length: 8 }, (_, index) => ({ index })),
    rejectedIntervals: Array.from({ length: 7 }, (_, index) => ({ index })),
    summary: {
      totalSamples: 1940,
      accepted: 1190,
      rejected: 750,
      coveragePercent: 61.340206,
      reasonCounts: { REJECTED_FIXTURE: 750 },
      acceptedCandidateSegments: 798,
      rejectedCandidateSegments: 995
    },
    finalTrainingDataset: false
  };
}

function evidenceFixture(sha = HISTORICAL_RECOVERY.evidenceSha256) {
  return {
    evidenceVersion: 'ML3.2-B-1',
    sourceInventoryCanonicalSha256: HISTORICAL_RECOVERY.sourceInventoryCanonicalSha256,
    lineageStratum: HISTORICAL_RECOVERY.lineageStratum,
    summary: { totalSamples: 1940, accepted: 1190, rejected: 750 },
    databaseRead: {
      transactionMode: 'REPEATABLE READ READ ONLY',
      freezeInventoryMismatchCount: 0,
      rawSampleInventoryMismatchCount: 0
    },
    evidenceSha256: sha
  };
}

function datasetFixture(sha = HISTORICAL_RECOVERY.datasetSha256) {
  return {
    datasetVersion: 'ML3.3-1',
    sourceEvidenceSha256: HISTORICAL_RECOVERY.evidenceSha256,
    lineage: { lineageStratum: HISTORICAL_RECOVERY.lineageStratum },
    summary: { rowCount: 1190, lineageStratum: HISTORICAL_RECOVERY.lineageStratum },
    rows: Array.from({ length: 1190 }, () => ({})),
    datasetSha256: sha
  };
}

function dependencies(cloud, overrides = {}) {
  return {
    inventoryCloud: async options => {
      overrides.observeInventoryOptions?.(options);
      return cloud;
    },
    reconcileCloudEvidence: () => ({ mismatchCount: 0, mismatchCodes: [] }),
    filterSessionSamples: () => filteredFixture(),
    buildRawEvidenceArtifact: () => evidenceFixture(),
    validateEvidenceArtifact: () => true,
    buildCanonicalDataset: () => datasetFixture(),
    writeRecoveredArtifacts: payload => overrides.observeWrite?.(payload),
    ...overrides.dependencies
  };
}

console.log('ML3 historical dataset recovery CLI tests');

const envelope = buildHistoricalFilterEnvelope(filteredFixture());
const repeatedEnvelope = buildHistoricalFilterEnvelope(filteredFixture());
check(envelope.sourceInventoryCanonicalSha256 === HISTORICAL_RECOVERY.sourceInventoryCanonicalSha256
  && envelope.filterSha256 === repeatedEnvelope.filterSha256,
  'historical filter envelope is anchored to the accepted freeze and deterministic');

const reconstructed = reconstructFrozenSession(cloudFixture().sessions[0]);
check(reconstructed.source === 'CLOUD_POSTGRES+DOCUMENTED_KNOWN_SESSION+PUBLIC_SESSION_API'
  && reconstructed.localCollectionSessionId === HISTORICAL_RECOVERY.localCollectionSessionId
  && reconstructed.gameBuildVersion === HISTORICAL_RECOVERY.lineageStratum,
  'frozen session restores only the versioned historical provenance around authoritative cloud metadata');

const successCloud = cloudFixture();
const output = [];
let writes = 0;
let observedOptions;
const result = await recoverHistoricalDataset({
  env: { DATABASE_URL: 'DB_PRESENT_FIXTURE' },
  write: line => output.push(line)
}, dependencies(successCloud, {
  observeInventoryOptions: options => { observedOptions = options; },
  observeWrite: ({ evidence, dataset }) => {
    writes++;
    assert.equal(evidence.evidenceSha256, HISTORICAL_RECOVERY.evidenceSha256);
    assert.equal(dataset.datasetSha256, HISTORICAL_RECOVERY.datasetSha256);
  }
}));
check(result.evidence.evidenceSha256 === HISTORICAL_RECOVERY.evidenceSha256
  && result.dataset.datasetSha256 === HISTORICAL_RECOVERY.datasetSha256
  && writes === 1,
  'successful recovery computes both gated artifacts before one pair-write operation');
check(observedOptions.sessionId === HISTORICAL_RECOVERY.sessionId
  && observedOptions.materializeRawSamples === true
  && Object.keys(observedOptions).length === 2,
  'inventoryCloud is restricted to the historical session and in-memory raw samples');
check(successCloud.samplesBySession.size === 0,
  'authoritative raw samples are cleared after successful use');
check(output.includes('DB_INTEGRITY=PASS')
  && output.includes('RAW_SAMPLES=1940')
  && output.includes('ACCEPTED=1190')
  && output.includes('REJECTED=750')
  && output.includes('RECOVERY=SUCCESS'),
  'successful CLI output contains only the expected sanitized recovery summary');
check(!output.join('\n').includes('DB_PRESENT_FIXTURE'),
  'DATABASE_URL never appears in CLI output');

let missingDbCalled = false;
await expectError(() => recoverHistoricalDataset({ env: {}, write: () => {} }, {
  inventoryCloud: async () => { missingDbCalled = true; }
}), 'DATABASE_URL_MISSING');
check(!missingDbCalled, 'missing DATABASE_URL stops before inventoryCloud');

const mismatchCloud = cloudFixture();
mismatchCloud.status.batches = 40;
let mismatchWrites = 0;
await expectError(() => recoverHistoricalDataset({ env: { DATABASE_URL: 'fixture' }, write: () => {} },
  dependencies(mismatchCloud, { observeWrite: () => mismatchWrites++ })),
'DB_INTEGRITY_MISMATCH:batches');
check(mismatchWrites === 0 && mismatchCloud.samplesBySession.size === 0,
  'DB mismatch creates no artifacts and still clears raw samples');

const evidenceMismatchCloud = cloudFixture();
let evidenceMismatchWrites = 0;
let datasetCalledAfterEvidenceMismatch = false;
await expectError(() => recoverHistoricalDataset({ env: { DATABASE_URL: 'fixture' }, write: () => {} },
  dependencies(evidenceMismatchCloud, {
    observeWrite: () => evidenceMismatchWrites++,
    dependencies: {
      buildRawEvidenceArtifact: () => evidenceFixture('f'.repeat(64)),
      buildCanonicalDataset: () => {
        datasetCalledAfterEvidenceMismatch = true;
        return datasetFixture();
      }
    }
  })), 'RECOVERED_EVIDENCE_SHA_MISMATCH');
check(evidenceMismatchWrites === 0 && !datasetCalledAfterEvidenceMismatch
  && evidenceMismatchCloud.samplesBySession.size === 0,
  'evidence SHA mismatch stops before dataset construction and writes nothing');

const datasetMismatchCloud = cloudFixture();
let datasetMismatchWrites = 0;
await expectError(() => recoverHistoricalDataset({ env: { DATABASE_URL: 'fixture' }, write: () => {} },
  dependencies(datasetMismatchCloud, {
    observeWrite: () => datasetMismatchWrites++,
    dependencies: { buildCanonicalDataset: () => datasetFixture('e'.repeat(64)) }
  })), 'RECOVERED_DATASET_SHA_MISMATCH');
check(datasetMismatchWrites === 0 && datasetMismatchCloud.samplesBySession.size === 0,
  'dataset SHA mismatch writes neither evidence nor dataset');

check(mismatchWrites + evidenceMismatchWrites + datasetMismatchWrites === 0,
  'all failure gates guarantee no partial artifact write');

const fakeFiles = new Set();
let renameCalls = 0;
const failingFs = {
  existsSync: target => fakeFiles.has(target),
  mkdirSync: () => {},
  writeFileSync: target => fakeFiles.add(target),
  renameSync: (source, target) => {
    renameCalls++;
    if (renameCalls === 2) throw new Error('FIXTURE_SECOND_RENAME_FAILURE');
    fakeFiles.delete(source);
    fakeFiles.add(target);
  },
  unlinkSync: target => fakeFiles.delete(target)
};
assert.throws(() => writeRecoveredArtifacts({
  evidence: evidenceFixture(), dataset: datasetFixture(), cwd: 'C:/fixture-recovery', fsApi: failingFs
}), /FIXTURE_SECOND_RENAME_FAILURE/);
check(fakeFiles.size === 0,
  'pair writer rolls back the first artifact if the second atomic promotion fails');

assert.throws(() => parseArgs(['--database-url', 'forbidden']), /ARGUMENTS_NOT_ACCEPTED/);
check(true, 'CLI accepts no DATABASE_URL or other command-line arguments');

console.log(`ML3_HISTORICAL_RECOVERY_CHECKS: ${passed} total, ${passed} passed, 0 failed`);
