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
  QUALITY_ELIGIBILITY
} from './ml3/inventoryCore.js';
import { CLOUD_QUERIES, fetchPublicSessionMetadata, inventoryCloud } from './ml3/inventorySources.js';
import { createInventory, parseArgs } from './ml3_inventory.js';
import { SIMULATION_FINGERPRINT_SHA256, TELEMETRY_LINEAGE_VERSIONS } from '../src/ml/lineage/acceptedBaseline.js';
import { TELEMETRY_LINEAGE_VERSIONS as RUNTIME_VERSIONS, SIMULATION_FINGERPRINT_SHA256 as RUNTIME_FINGERPRINT } from '../src/ml/lineage/baselineManifest.js';

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

    const revisedPhysics = compatible({ gameBuildVersion: RUNTIME_VERSIONS.GAME_BUILD_VERSION,
      physicsVersion: RUNTIME_VERSIONS.PHYSICS_VERSION, simulationFingerprint: RUNTIME_FINGERPRINT });
    check(revisedPhysics.lineageEligibility !== LINEAGE_ELIGIBILITY.COMPATIBLE
      && revisedPhysics.finalTrainingDataset === false,
    'new corner-traction physics is not silently accepted into the historical dataset baseline');

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
    check(mismatch.fingerprintStatus === 'MISMATCH_BASELINE_DIFFERENT'
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

    const actionSignals = analyzeSamples([sample(0), sample(1), sample(2)]);
    check(actionSignals.actions.steering.std !== null
      && actionSignals.actions.steering.saturationNegativePercent > 0
      && actionSignals.actions.throttle.zeroPercent > 0
      && actionSignals.actions.brake.positivePercent > 0,
    'action distributions and saturation/zero rates are measured');

    const lapSignals = analyzeSamples([
      sample(0, 1000), sample(1, 1100, { eventState: { offTrack: true } }),
      sample(2, 1200, { metadata: { lapNumber: 2 }, eventState: { spin: true } })
    ]);
    check(lapSignals.laps.count === 2 && lapSignals.laps.invalid === 2
      && lapSignals.problemRegions.OFF_TRACK === 1 && lapSignals.problemRegions.SPIN === 1,
    'lap boundaries and candidate problem regions are diagnosed');

    const first = buildInventory({ sessions: [compatible({ sessionId: 'z' }), compatible({ sessionId: 'a', gameBuildVersion: '0.2.0-ml2' })],
      sourceStatus: [{ source: 'TEST', status: 'AVAILABLE' }] });
    const second = buildInventory({ sessions: [compatible({ sessionId: 'a', gameBuildVersion: '0.2.0-ml2' }), compatible({ sessionId: 'z' })],
      sourceStatus: [{ status: 'AVAILABLE', source: 'TEST' }] });
    check(first.canonicalSha256 === second.canonicalSha256
      && canonicalJson(first) === canonicalJson(second), 'same logical input produces identical sorted canonical inventory and hash');

    check(Object.keys(first.canonicalInventory.summary.byGameBuildVersion).join(',') === '0.2.0-ml2,0.3.0-ml2',
      'game-build distributions remain explicitly stratified');

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
