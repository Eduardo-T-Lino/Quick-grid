import {
  ACCEPTED_GAME_BUILDS,
  analyzeSamples,
  assertNoCredentials,
  buildInventory,
  canonicalJson,
  classifyLineage,
  completeSession,
  INVENTORY_SCHEMA_VERSION,
  KNOWN_SESSIONS,
  LINEAGE_ELIGIBILITY,
  mergeSessions,
  QUALITY_ELIGIBILITY
} from './ml3/inventoryCore.js';
import { CLOUD_QUERIES, fetchPublicSessionMetadata, inventoryCloud } from './ml3/inventorySources.js';
import { createInventory, parseArgs } from './ml3_inventory.js';
import { SIMULATION_FINGERPRINT_SHA256, TELEMETRY_LINEAGE_VERSIONS } from '../src/ml/lineage/baselineManifest.js';

let passed = 0, failed = 0;
function check(condition, label) {
  if (!condition) { failed++; throw new Error(label); }
  passed++; console.log(`  PASS: ${label}`);
}

function sample(index, timestamp = 1000 + index * 100, overrides = {}) {
  const base = {
    schemaVersion: 2,
    metadata: { sessionId: 'fixture', sampleIndex: index, timestamp, trackId: 21, lapNumber: 1, driverType: 'PLAYER' },
    trackState: { trackProgress: index / 100, pathIndex: index, currentCurvature: .01,
      futureCurvature5m: .01, futureCurvature10m: .02, futureCurvature20m: .03,
      futureCurvature40m: .04, targetSpeed: 1.2, distanceToLeftEdge: 10, distanceToRightEdge: 11, surface: 'TARMAC' },
    carState: { speed: 1 + index / 10, forwardVelocity: 1, lateralVelocity: 0,
      heading: 0, headingError: .01, yawRate: .02, slipAngle: .03, crossTrackError: .1, steeringAngle: 0 },
    driverAction: { steering: index % 2 ? 1 : -1, throttle: index % 2, brake: index % 3 ? 0 : 1 },
    eventState: { offTrack: false, collision: false, spin: false, isRecovering: false }
  };
  return {
    ...base, ...overrides,
    metadata: { ...base.metadata, ...(overrides.metadata || {}) },
    trackState: { ...base.trackState, ...(overrides.trackState || {}) },
    carState: { ...base.carState, ...(overrides.carState || {}) },
    driverAction: { ...base.driverAction, ...(overrides.driverAction || {}) },
    eventState: { ...base.eventState, ...(overrides.eventState || {}) }
  };
}

function compatible(overrides = {}) {
  return completeSession({
    source: 'TEST', sessionId: 'fixture-compatible', collectionKind: 'HUMAN',
    schemaVersion: 2, gameBuildVersion: '0.3.0-ml2', physicsVersion: '1.5.0-gt3',
    trackGeometryVersion: '1.5.0-centripetal', featureManifestVersion: '2.1.0',
    simulationFingerprint: SIMULATION_FINGERPRINT_SHA256, trackId: 21, sampleRateHz: 10,
    scope: 'PLAYER_ONLY', status: 'COMPLETED', driverTypes: ['PLAYER'],
    batchCount: 1, sampleCount: 2, lapCount: 1, qualitySignals: analyzeSamples([sample(0), sample(1)]),
    ...overrides
  });
}

async function main() {
  console.log('ML3.0 dataset inventory deterministic tests');
  try {
    check(INVENTORY_SCHEMA_VERSION === 1 && TELEMETRY_LINEAGE_VERSIONS.SCHEMA_VERSION === 2
      && ACCEPTED_GAME_BUILDS.includes('0.2.0-ml2') && ACCEPTED_GAME_BUILDS.includes('0.3.0-ml2'),
    'accepted baseline versions and both human-policy build strata are explicit');

    const infrastructure = compatible({ sessionId: '014398f2-d1ce-4c40-8bcb-3a65a1008065', collectionKind: 'AUTOMATIC' });
    check(infrastructure.lineageEligibility === LINEAGE_ELIGIBILITY.INFRASTRUCTURE_ONLY
      && infrastructure.qualityEligibility === QUALITY_ELIGIBILITY.NOT_EVALUATED,
    'known benchmark session is infrastructure-only');

    const human = compatible({ sessionId: 'ad759118-4386-481f-9d34-f3d496eb1854',
      gameBuildVersion: '0.2.0-ml2', simulationFingerprint: null, qualitySignals: null });
    check(human.lineageEligibility === LINEAGE_ELIGIBILITY.COMPATIBLE
      && human.qualityEligibility === QUALITY_ELIGIBILITY.REVIEW && human.finalTrainingDataset === false,
    'validated human session remains a review candidate, never an automatic final-train dataset');

    const preMl15 = compatible({ sessionId: 'pre-ml15', preMl15: true });
    check(preMl15.lineageEligibility === LINEAGE_ELIGIBILITY.REJECT
      && preMl15.lineageReasons.includes('PRE_ML1_5_GEOMETRY'), 'pre-ML1.5 data is rejected without rewriting');

    const geometry = compatible({ sessionId: 'wrong-geometry', trackGeometryVersion: '1.4.0-linear' });
    check(geometry.lineageEligibility === LINEAGE_ELIGIBILITY.REJECT
      && geometry.lineageReasons.some(reason => reason.startsWith('GEOMETRY_INCOMPATIBLE')),
    'Schema V2 with incompatible geometry is rejected');

    const match = classifyLineage(compatible());
    check(match.lineageEligibility === LINEAGE_ELIGIBILITY.COMPATIBLE
      && match.lineageReasons.includes('SIMULATION_FINGERPRINT_MATCH'), 'baseline fingerprint match is detected');

    const mismatch = compatible({ sessionId: 'different-baseline', simulationFingerprint: 'a'.repeat(64) });
    check(mismatch.fingerprintStatus === 'MISMATCH'
      && mismatch.lineageEligibility === LINEAGE_ELIGIBILITY.VALIDATION_ONLY
      && mismatch.lineageReasons.some(reason => reason.startsWith('SIMULATION_FINGERPRINT_MISMATCH_BASELINE_DIFFERENT')),
    'fingerprint mismatch is preserved as a different baseline requiring explicit analysis');

    const invalid = analyzeSamples([sample(0, 1000, { carState: { speed: Number.NaN } })]);
    check(invalid.structuralIntegrity.invalidNumeric === 1, 'NaN/Infinity detection traverses sample payloads');

    const timestampGap = analyzeSamples([sample(0, 1000), sample(1, 1300), sample(2, 2501)]);
    check(timestampGap.temporalIntegrity.timestampGaps.above150ms === 2
      && timestampGap.temporalIntegrity.timestampGaps.above250ms === 2
      && timestampGap.temporalIntegrity.timestampGaps.above500ms === 1
      && timestampGap.temporalIntegrity.timestampGaps.above1s === 1,
    'timestamp gaps are counted at every diagnostic threshold');

    const indexGap = analyzeSamples([sample(0), sample(3, 1100)]);
    check(indexGap.temporalIntegrity.sampleIndexGaps === 2, 'missing sample indexes are counted');

    const duplicate = analyzeSamples([sample(0), sample(0)]);
    check(duplicate.temporalIntegrity.duplicateSamples === 1
      && duplicate.temporalIntegrity.sampleIndexMonotonicityViolations === 1,
    'duplicate identity and non-monotonic sample index are detected');

    const batchGap = analyzeSamples([sample(0), sample(1)], { batchSequences: [0, 2] });
    check(batchGap.temporalIntegrity.batchGaps === 1, 'missing batch sequences are counted');

    check(timestampGap.temporalIntegrity.deltaTimestampMs.p50 === 750.5
      && timestampGap.temporalIntegrity.deltaTimestampMs.p99 !== null,
    'deltaTimestamp distribution includes required median/p95/p99/max data');

    const actionSignals = analyzeSamples([sample(0), sample(1, 1100, { driverAction: { brake: 1 } }), sample(2)]);
    check(actionSignals.actions.steering.std !== null
      && actionSignals.actions.steering.p25 !== null
      && actionSignals.actions.steering.p75 !== null
      && actionSignals.actions.steering.saturationNegativePercent > 0
      && actionSignals.actions.steering.absoluteAtLeast095Percent > 0
      && actionSignals.actions.steering.approximatelyZeroPercent >= 0
      && actionSignals.actions.throttle.zeroPercent > 0
      && actionSignals.actions.throttle.betweenZeroAnd095Percent >= 0
      && actionSignals.actions.simultaneousPedals.count === 1
      && actionSignals.actions.brake.positivePercent > 0,
    'action distributions, pedal overlap and saturation/zero rates are measured');

    check(['forwardVelocity', 'lateralVelocity', 'steeringAngle', 'futureCurvature5m',
      'futureCurvature10m', 'futureCurvature20m', 'trackProgress']
      .every(key => actionSignals.state[key]?.count === 3)
      && actionSignals.surfaces.TARMAC.count === 3
      && actionSignals.surfaces.KERB.count === 0,
    'required state and surface distributions are measured explicitly');

    const lapSignals = analyzeSamples([
      sample(0, 1000), sample(1, 1100, { eventState: { offTrack: true } }),
      sample(2, 1200, { metadata: { lapNumber: 2 }, eventState: { spin: true } })
    ]);
    check(lapSignals.laps.count === 2 && lapSignals.laps.invalid === 2
      && lapSignals.problemRegions.OFF_TRACK === 1 && lapSignals.problemRegions.SPIN === 1
      && lapSignals.eventLocalization.OFF_TRACK[0].startSampleIndex === 1
      && lapSignals.eventLocalization.SPIN[0].lapNumber === 2
      && lapSignals.cleanCandidateEstimate.EVENT_FLAGGED_SAMPLES === 2
      && lapSignals.cleanCandidateEstimate.UNFLAGGED_SAMPLES === 1,
    'lap boundaries, localized events and conservative unflagged estimate are diagnosed');

    const gapClean = analyzeSamples([sample(0, 1000), sample(1, 1100), sample(2, 1400), sample(3, 1500)]);
    check(gapClean.cleanCandidateEstimate.TEMPORAL_GAP_ADJACENT_SAMPLES === 2
      && gapClean.cleanCandidateEstimate.UNFLAGGED_SAMPLES === 2,
    'samples adjacent to a temporal gap are excluded from the diagnostic unflagged estimate');

    const unknownProvenance = compatible({ sessionId: 'unknown-provenance', collectionKind: 'UNKNOWN' });
    check(unknownProvenance.lineageEligibility === LINEAGE_ELIGIBILITY.COMPATIBLE
      && unknownProvenance.qualityEligibility === QUALITY_ELIGIBILITY.REVIEW,
    'unknown collection provenance never becomes an automatic quality candidate');

    const reconciled = mergeSessions([
      compatible({ source: 'VALIDATION_ARTIFACTS', sessionId: 'local-collector', sampleCount: 86 }),
      compatible({ source: 'CLOUD_POSTGRES', sessionId: 'a7ccea2d-c83b-4abb-b0db-188d20d4e439',
        localCollectionSessionId: 'local-collector', sampleCount: 87, batchCount: 2,
        qualitySignals: analyzeSamples([sample(0), sample(1), sample(2)]) })
    ]);
    check(reconciled.length === 1
      && reconciled[0].sessionId === 'a7ccea2d-c83b-4abb-b0db-188d20d4e439'
      && reconciled[0].sampleCount === 87
      && reconciled[0].source === 'CLOUD_POSTGRES+VALIDATION_ARTIFACTS',
    'cloud UUID/counts override a uniquely linked local collector without double counting');

    const first = buildInventory({ sessions: [compatible({ sessionId: 'z' }), compatible({ sessionId: 'a', gameBuildVersion: '0.2.0-ml2' })],
      sourceStatus: [{ source: 'TEST', status: 'AVAILABLE' }] });
    const second = buildInventory({ sessions: [compatible({ sessionId: 'a', gameBuildVersion: '0.2.0-ml2' }), compatible({ sessionId: 'z' })],
      sourceStatus: [{ status: 'AVAILABLE', source: 'TEST' }] });
    check(first.canonicalSha256 === second.canonicalSha256
      && canonicalJson(first) === canonicalJson(second), 'same logical input produces identical sorted canonical inventory and hash');

    check(Object.keys(first.canonicalInventory.summary.byGameBuildVersion).join(',') === '0.2.0-ml2,0.3.0-ml2',
      'game-build distributions remain explicitly stratified');

    const noHuman03 = buildInventory({ sessions: [human, infrastructure], sourceStatus: [] });
    check(noHuman03.canonicalInventory.summary.humanReferenceStatus['0.3.0-ml2'] === 'HUMAN_REFERENCE_0_3_INSUFFICIENT',
      'missing 0.3 human coverage is reported explicitly');

    check(assertNoCredentials(first) && !/generatedAt/.test(canonicalJson(first)),
      'canonical output contains neither credential fields nor volatile generatedAt');
    let credentialRejected = false;
    try { assertNoCredentials({ refreshCredential: 'forbidden' }); } catch { credentialRejected = true; }
    check(credentialRejected, 'credential-like fields are rejected before serialization');

    const cloudBlocked = await inventoryCloud({ databaseUrl: '' });
    check(cloudBlocked.status.code === 'CLOUD_FULL_INVENTORY_BLOCKED'
      && cloudBlocked.status.reason === 'DATABASE_URL_MISSING'
      && !JSON.stringify(cloudBlocked).includes('postgres://'),
    'missing DATABASE_URL blocks only full cloud inventory and emits a safe reproduction command');

    const queries = Object.values(CLOUD_QUERIES).join('\n').toUpperCase();
    check(!/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/.test(queries)
      && Object.values(CLOUD_QUERIES).every(query => query.trim().toUpperCase().startsWith('SELECT')),
    'cloud inventory data queries are SELECT-only');

    const cloudSessionId = '0d127bd9-1781-4315-8eb0-4eb81731b224';
    const cloudSamples = [sample(0), sample(1)];
    const { gzipSync } = await import('node:zlib');
    class FakePool {
      async connect() {
        return {
          query: async query => {
            if (query === CLOUD_QUERIES.sessions) return { rows: [{
              id: cloudSessionId, schema_version: 2, track_id: 21, sample_rate_hz: '10',
              game_build_version: '0.3.0-ml2', track_geometry_version: '1.5.0-centripetal',
              physics_version: '1.5.0-gt3', feature_manifest_version: '2.1.0',
              scope: 'PLAYER_ONLY', status: 'COMPLETED', received_samples: 2,
              received_batches: 1, completed_laps: 0, client_info: {}
            }] };
            if (query === CLOUD_QUERIES.batches) return { rows: [{
              session_id: cloudSessionId, batch_sequence: 0, sample_count: 2,
              first_sample_index: 0, last_sample_index: 1,
              first_timestamp: '1000.000', last_timestamp: '1100.000',
              payload_compressed: gzipSync(JSON.stringify(cloudSamples))
            }] };
            if (query === CLOUD_QUERIES.laps) return { rows: [] };
            return { rows: [] };
          },
          release() {}
        };
      }
      async end() {}
    }
    const cloudMeasured = await inventoryCloud({ databaseUrl: 'redacted', Pool: FakePool });
    check(cloudMeasured.status.status === 'AVAILABLE_FULL'
      && cloudMeasured.status.payloadIntegrity.gzipValid === 1
      && cloudMeasured.status.payloadIntegrity.countMismatch === 0
      && cloudMeasured.status.payloadIntegrity.firstLastMetadataMatch === 1
      && cloudMeasured.sessions[0].localCollectionSessionId === 'fixture'
      && cloudMeasured.sessions[0].qualitySignals.batchIntegrity.sequenceGaps === 0,
    'cloud inventory validates GZIP, JSON, counts, boundaries and local lineage identity');

    class CountMismatchPool extends FakePool {
      async connect() {
        const client = await super.connect();
        const query = client.query;
        client.query = async sql => {
          const result = await query(sql);
          if (sql === CLOUD_QUERIES.batches) result.rows[0].sample_count = 3;
          return result;
        };
        return client;
      }
    }
    const cloudCountMismatch = await inventoryCloud({ databaseUrl: 'redacted', Pool: CountMismatchPool });
    check(cloudCountMismatch.status.payloadIntegrity.countMismatch === 1
      && cloudCountMismatch.sessions[0].payloadCorrupt === true
      && cloudCountMismatch.sessions[0].lineageEligibility === LINEAGE_ELIGIBILITY.REJECT,
    'cloud count mismatches are explicit and reject the corrupt payload');

    class InvalidGzipPool extends FakePool {
      async connect() {
        const client = await super.connect();
        const query = client.query;
        client.query = async sql => {
          const result = await query(sql);
          if (sql === CLOUD_QUERIES.batches) result.rows[0].payload_compressed = Buffer.from('not-gzip');
          return result;
        };
        return client;
      }
    }
    const cloudInvalidGzip = await inventoryCloud({ databaseUrl: 'redacted', Pool: InvalidGzipPool });
    check(cloudInvalidGzip.status.payloadIntegrity.gzipInvalid === 1
      && cloudInvalidGzip.sessions[0].payloadCorrupt === true,
    'invalid GZIP batches are counted without exposing database details');

    const publicResult = await fetchPublicSessionMetadata(Object.keys(KNOWN_SESSIONS).slice(0, 1), {
      fetchImpl: async () => ({ ok: true, json: async () => ({
        id: 'ad759118-4386-481f-9d34-f3d496eb1854', schema_version: 2, track_id: 21,
        sample_rate_hz: '10.00', scope: 'PLAYER_ONLY', game_build_version: '0.2.0-ml2',
        track_geometry_version: '1.5.0-centripetal', physics_version: '1.5.0-gt3',
        feature_manifest_version: '2.1.0', status: 'COMPLETED', received_samples: 1940,
        received_batches: 41, completed_laps: 3, client_info: {}
      }) })
    });
    check(publicResult.sessions[0].sampleCount === 1940 && publicResult.status.status === 'AVAILABLE_PARTIAL',
      'public read-only metadata enrichment is explicitly partial');

    const parsed = parseArgs(['--source', 'local', '--session', 'fixture', '--output', 'out.json', '--no-public-api']);
    check(parsed.source === 'local' && parsed.session === 'fixture' && parsed.output === 'out.json' && !parsed.publicApi,
      'CLI accepts source, session, output and offline metadata options');

    const assembled = await createInventory({ source: 'all', publicApi: false }, {
      cwd: process.cwd(),
      inventoryLocalJsonl: () => ({ sessions: [compatible()], status: { source: 'LOCAL_JSONL', status: 'AVAILABLE' } }),
      inventoryValidationArtifacts: () => ({ sessions: [], status: { source: 'VALIDATION_ARTIFACTS', status: 'NOT_FOUND' } }),
      documentedKnownSessions: () => [],
      inventoryCloud: async () => ({ sessions: [], status: { source: 'CLOUD_POSTGRES', status: 'BLOCKED', code: 'CLOUD_FULL_INVENTORY_BLOCKED' } })
    });
    check(assembled.canonicalInventory.summary.sessionCount === 1
      && assembled.canonicalInventory.sourceStatus.some(source => source.code === 'CLOUD_FULL_INVENTORY_BLOCKED'),
    'all-source inventory remains usable when cloud credentials are absent');
  } catch (error) {
    if (!failed) failed++;
    console.error(`FAIL: ${error.message}`);
  }
  console.log(`ML3_INVENTORY_CHECKS: ${passed} total, ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main();
