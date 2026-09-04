// Pure synthetic fixtures and injected pg mocks. No real PostgreSQL/network access.
import { gzipSync, gunzipSync } from 'node:zlib';
import { createTelemetrySample } from '../src/ml/telemetry/telemetrySchema.js';
import { analyzeSnapshot, formatReport, readSnapshot, poolOptions, main, QUERIES } from './verify_cloud_telemetry.js';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ID = '00000000-0000-4000-8000-000000000002';
let passed = 0, failed = 0;
function check(condition, label) {
  if (!condition) { failed++; throw new Error(label); }
  passed++; console.log(`PASS: ${label}`);
}
const has = (report, section, status) => report.checks.some(item => item.section === section && item.status === status);
function encode(row, payload) {
  const raw = Buffer.from(JSON.stringify(payload));
  row.payload_compressed = gzipSync(raw);
  row.raw_bytes_size = raw.length;
  row.compressed_bytes_size = row.payload_compressed.length;
}
function mutatePayload(snapshot, mutate) {
  const row = snapshot.batches[0];
  const payload = JSON.parse(gunzipSync(row.payload_compressed));
  mutate(payload);
  encode(row, payload);
  snapshot.counts.compressed_bytes = String(snapshot.batches.reduce((total, item) => total + item.compressed_bytes_size, 0));
}
function fixture(arrayOnly = false) {
  const session = { id: SESSION_ID, status: 'COMPLETED', schema_version: 2, track_id: 21,
    sample_rate_hz: '10.00', scope: 'PLAYER_ONLY', received_samples: 1940, received_batches: 41,
    completed_laps: 1, game_build_version: '0.2.0-ml2', track_geometry_version: '1.5.0-centripetal',
    physics_version: '1.5.0-gt3', feature_manifest_version: '2.1.0', consent_version: '1.0.0',
    created_at: new Date('2026-09-04T12:00:00Z'), finished_at: new Date('2026-09-04T12:03:20Z'), metadata_bytes: 220 };
  let sampleIndex = 0;
  const batches = Array.from({ length: 41 }, (_, sequence) => {
    const count = sequence < 38 ? 50 : sequence === 38 ? 10 : 15;
    const samples = Array.from({ length: count }, () => {
      const index = sampleIndex++;
      return createTelemetrySample({ sessionId: arrayOnly ? 'sess_local_fixture' : SESSION_ID,
        sampleIndex: index, timestamp: index * 100 + 0.1234, trackId: 21, lapNumber: 1,
        driverType: 'PLAYER', participantId: 'private-player-fixture', trackProgress: .2, pathIndex: 1,
        currentCurvature: 0, futureCurvature5m: 0, futureCurvature10m: 0, futureCurvature20m: 0,
        futureCurvature40m: 0, targetSpeed: 1, distanceToLeftEdge: 5, distanceToRightEdge: 5,
        speed: 1, forwardVelocity: 1, lateralVelocity: 0, heading: 0, headingError: 0,
        yawRate: 0, slipAngle: 0, crossTrackError: 0, steeringAngle: 0,
        steering: 0, throttle: .5, brake: 0, offTrack: false, collision: false, spin: false });
    });
    const row = { session_id: SESSION_ID, batch_sequence: sequence, sample_count: count,
      first_sample_index: samples[0].metadata.sampleIndex, last_sample_index: samples.at(-1).metadata.sampleIndex,
      first_timestamp: samples[0].metadata.timestamp.toFixed(3), last_timestamp: samples.at(-1).metadata.timestamp.toFixed(3),
      metadata_bytes: 96 };
    encode(row, arrayOnly ? samples : { sessionId: SESSION_ID, batchSequence: sequence, samples });
    return row;
  });
  return { session, counts: { batch_count: '41', sample_count: '1940', min_sequence: 0, max_sequence: 40,
    distinct_sequences: '41', compressed_bytes: String(batches.reduce((total, row) => total + row.compressed_bytes_size, 0)) },
  batches, laps: [{ participant_id: 'private-player-fixture', lap_number: 1, lap_time: '150.123', sample_count: 1500,
    off_track_count: 0, collision_count: 0, spin_count: 0, average_speed: '1.0000', max_speed: '1.2000',
    valid_lap: true, metadata_bytes: 120 }], requestedSessionId: SESSION_ID };
}

function mockedPool(snapshot, { missing = false, queryError = false } = {}) {
  const calls = [];
  let released = false, ended = false;
  const client = { release() { released = true; }, async query(sql, params) {
    calls.push({ sql, params });
    if (sql === QUERIES.sessionById || sql === QUERIES.latestSession) {
      if (queryError) throw Object.assign(new Error('private connection message'), { code: 'XX000' });
      return { rows: missing ? [] : [snapshot.session] };
    }
    if (sql === QUERIES.counts) return { rows: [snapshot.counts] };
    if (sql === QUERIES.batches) return { rows: snapshot.batches };
    if (sql === QUERIES.laps) return { rows: snapshot.laps };
    if (/^(BEGIN|SET LOCAL|ROLLBACK)/.test(sql)) return { rows: [] };
    throw new Error('Unexpected query');
  } };
  return { calls, get released() { return released; }, get ended() { return ended; },
    async connect() { return client; }, on() {}, async end() { ended = true; } };
}

try {
  let snapshot = fixture();
  const good = analyzeSnapshot(snapshot);
  check(good.result === 'PASS', 'counts, envelope, lineage, laps and gzip match');
  check(good.compression.measuredBatches === 41 && good.compression.selectedBatch.sampleCount === 50,
    'all 41 batches measured and a 50-sample batch selected');
  check(good.compression.averageRawBytes === good.compression.totalRawBytes / 41
    && good.compression.averageCompressedBytes === good.compression.totalCompressedBytes / 41,
  'compression averages use measured decompressed and compressed bytes');
  check(good.storage.activeSampleSeconds === 194 && good.storage.wallClockSeconds === 200
    && good.storage.estimates[3].compressedPayloadBytes === good.storage.estimates[0].compressedPayloadBytes * 10000,
  'storage separates nominal active sampling time, wall clock and player scaling');
  check(good.storage.estimates[0].sqlMetadataOverheadApproxBytes > 0, 'SQL metadata proxy separate from payload');
  const safe = formatReport(good);
  check(!safe.includes(SESSION_ID) && !safe.includes('private-player-fixture') && !safe.includes('trackState'),
    'output masks session, aliases participant and never dumps samples');
  const actual = analyzeSnapshot(fixture(true));
  check(actual.result === 'WARNING' && has(actual, 'GZIP', 'PASS') && has(actual, 'PAYLOAD IDENTITY', 'WARNING'),
    'actual array-only format with local sample IDs reports identity evidence gap, never false PASS');
  check(actual.checks.some(item => item.code === 'PAYLOAD_ENVELOPE_NOT_STORED' && item.status === 'WARNING'),
    'missing envelope is explicitly reported');

  for (const [label, change, section] of [
    ['session batch counter mismatch', s => { s.session.received_batches = 40; }, 'BATCH COUNTS'],
    ['aggregate sample counter mismatch', s => { s.counts.sample_count = '1939'; }, 'SAMPLE COUNTS'],
    ['sequence gap', s => { s.batches[20].batch_sequence = 100; }, 'SEQUENCES'],
    ['duplicate sequence', s => { s.batches[20].batch_sequence = 19; }, 'SEQUENCES'],
    ['corrupt gzip', s => { s.batches[0].payload_compressed = Buffer.from('not gzip'); }, 'GZIP'],
    ['payload sample count mismatch', s => mutatePayload(s, p => p.samples.pop()), 'SAMPLE COUNTS'],
    ['geometry version mismatch', s => { s.session.track_geometry_version = '0.0.0'; }, 'VERSION LINEAGE'],
    ['physics version mismatch', s => { s.session.physics_version = '0.0.0'; }, 'VERSION LINEAGE'],
    ['feature version mismatch', s => { s.session.feature_manifest_version = '0.0.0'; }, 'VERSION LINEAGE'],
    ['sample schema mismatch', s => mutatePayload(s, p => { p.samples[0].schemaVersion = 1; }), 'SCHEMA'],
    ['bot sample', s => mutatePayload(s, p => { p.samples[0].metadata.driverType = 'BOT'; }), 'SCHEMA'],
    ['NaN serialized as null', s => mutatePayload(s, p => { p.samples[0].carState.speed = NaN; }), 'SCHEMA'],
    ['Infinity serialized as null', s => mutatePayload(s, p => { p.samples[0].trackState.futureCurvature5m = Infinity; }), 'SCHEMA'],
    ['first index mismatch', s => { s.batches[0].first_sample_index = 5; }, 'BATCH METADATA'],
    ['timestamp beyond SQL rounding tolerance', s => { s.batches[0].first_timestamp = '0.130'; }, 'BATCH METADATA'],
    ['envelope session mismatch', s => mutatePayload(s, p => { p.sessionId = OTHER_ID; }), 'PAYLOAD IDENTITY'],
    ['envelope sequence mismatch', s => mutatePayload(s, p => { p.batchSequence = 99; }), 'PAYLOAD IDENTITY'],
    ['SQL row session mismatch', s => { s.batches[0].session_id = OTHER_ID; }, 'PAYLOAD IDENTITY'],
    ['raw byte counter mismatch', s => { s.batches[0].raw_bytes_size++; }, 'COMPRESSION'],
    ['lap counter mismatch', s => { s.session.completed_laps = 2; }, 'LAPS'],
    ['multiple local session IDs', s => mutatePayload(s, p => { p.samples[0].metadata.sessionId = 'sess_other_fixture'; }), 'PAYLOAD IDENTITY']
  ]) {
    snapshot = fixture(); change(snapshot);
    const report = analyzeSnapshot(snapshot);
    check(report.result === 'FAIL' && has(report, section, 'FAIL'), label);
  }
  snapshot = fixture(); snapshot.laps = []; snapshot.session.completed_laps = 0;
  const noLaps = analyzeSnapshot(snapshot);
  check(noLaps.result === 'WARNING' && noLaps.checks.some(item => item.code === 'LAP_SUMMARY_MISSING'
    && item.status === 'WARNING') && has(noLaps, 'GZIP', 'PASS'), 'missing laps warn without blocking other checks');
  snapshot = fixture(); snapshot.batches[0].payload_compressed = gzipSync(Buffer.alloc(1024 * 1024 + 1));
  check(has(analyzeSnapshot(snapshot), 'GZIP', 'FAIL'), 'gzip decompression output is bounded');

  const db = mockedPool(fixture());
  await readSnapshot(db, SESSION_ID);
  check(db.calls[0].sql.includes('REPEATABLE READ READ ONLY') && db.calls.at(-1).sql === 'ROLLBACK'
    && db.released, 'read-only snapshot rolled back and client released');
  check(db.calls.find(call => call.sql === QUERIES.sessionById).params[0] === SESSION_ID
    && !db.calls.some(call => call.sql === QUERIES.latestSession), 'exact requested ID, no fallback to latest');
  check(db.calls.filter(call => [QUERIES.counts, QUERIES.batches, QUERIES.laps].includes(call.sql))
    .every(call => call.params[0] === SESSION_ID && call.sql.includes('$1::uuid')),
  'all three table queries use bound session parameters');
  const latest = mockedPool(fixture());
  await readSnapshot(latest);
  check(latest.calls.some(call => call.sql === QUERIES.latestSession && call.params.length === 0)
    && QUERIES.latestSession.includes("status = 'COMPLETED'") && QUERIES.latestSession.includes('finished_at DESC'),
  'no ID selects latest completed session deterministically');
  for (const options of [{ missing: true }, { queryError: true }]) {
    const broken = mockedPool(fixture(), options);
    let rejected = false;
    try { await readSnapshot(broken, SESSION_ID); } catch { rejected = true; }
    check(rejected && broken.released && broken.calls.at(-1).sql === 'ROLLBACK', 'failed query/missing session closes read-only transaction');
  }
  const bounded = fixture(); bounded.counts.batch_count = '1001';
  const oversized = mockedPool(bounded);
  let limited = false;
  try { await readSnapshot(oversized); } catch (error) { limited = error.diagnosticCode === 'DIAGNOSTIC_SIZE_LIMIT'; }
  check(limited && !oversized.calls.some(call => call.sql === QUERIES.batches), 'oversized dataset stops before downloading payloads');
  const url = 'postgres://local_test@db.invalid/test_only?sslmode=require';
  const config = poolOptions(url);
  check(config.connectionString === url && !Object.hasOwn(config, 'ssl') && config.max === 1,
    'URL controls TLS; no manual SSL or extra connections');
  let constructed = false;
  const output = [];
  class MustNotConnect { constructor() { constructed = true; } }
  check(await main({ argv: [], env: {}, Pool: MustNotConnect, write: line => output.push(line) }) === 1
    && !constructed && output.join('\n').includes('DATABASE_URL_MISSING'), 'absent env never opens a connection');
  check(await main({ argv: ['not-a-uuid'], env: { DATABASE_URL: url }, Pool: MustNotConnect, write: () => {} }) === 1
    && !constructed, 'invalid session argument rejected before connection');
  const brokenPool = mockedPool(fixture(), { queryError: true });
  class FailingPool { constructor() { return brokenPool; } }
  const errorOutput = [];
  check(await main({ argv: [], env: { DATABASE_URL: url }, Pool: FailingPool, write: line => errorOutput.push(line) }) === 1
    && brokenPool.ended && !errorOutput.join('\n').includes('private connection message')
    && !errorOutput.join('\n').includes(url), 'errors sanitized and pool closed');
  snapshot = fixture();
  snapshot.session.client_info = { password: 'test_only_not_for_output' };
  snapshot.laps[0].participant_id = 'test_only_not_for_output';
  snapshot.session.game_build_version = 'test_only_not_for_output';
  check(!formatReport(analyzeSnapshot(snapshot)).includes('test_only_not_for_output'),
    'unexpected metadata strings cannot leak secrets through reports');
  const warningPool = mockedPool(fixture(true));
  class WarningPool { constructor() { return warningPool; } }
  check(await main({ argv: [], env: { DATABASE_URL: url }, Pool: WarningPool, write: () => {} }) === 2
    && warningPool.ended, 'WARNING has distinct exit code and closes pool');
} catch {
  if (!failed) failed++;
  console.error('FAIL: CLOUD_VERIFICATION_TEST_FAILED');
}
console.log(`${passed} PASSOU | ${failed} FALHOU`);
process.exitCode = failed ? 1 : 0;
