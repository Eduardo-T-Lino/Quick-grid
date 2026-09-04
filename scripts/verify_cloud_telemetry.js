// ML2.2-E: read-only diagnostics. Never import the application pool or run migrations.
import pg from 'pg';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { validateTelemetrySample } from '../src/ml/telemetry/telemetrySchema.js';

export const EXPECTED = Object.freeze({ samples: 1940, batches: 41, schema: 2,
  geometry: '1.5.0-centripetal', physics: '1.5.0-gt3', features: '2.1.0' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BATCHES = 1000, MAX_BYTES = 32 * 1024 * 1024, MAX_RAW_BATCH = 1024 * 1024;
const SESSION_COLUMNS = `id, status, schema_version, track_id, sample_rate_hz, scope,
  received_samples, received_batches, completed_laps, game_build_version,
  track_geometry_version, physics_version, feature_manifest_version, consent_version,
  created_at, finished_at`;
export const QUERIES = Object.freeze({
  sessionById: `SELECT ${SESSION_COLUMNS}, pg_column_size(ROW(${SESSION_COLUMNS})) AS metadata_bytes
    FROM public.telemetry_sessions WHERE id = $1::uuid`,
  latestSession: `SELECT ${SESSION_COLUMNS}, pg_column_size(ROW(${SESSION_COLUMNS})) AS metadata_bytes
    FROM public.telemetry_sessions WHERE status = 'COMPLETED'
    ORDER BY finished_at DESC NULLS LAST, created_at DESC, id DESC LIMIT 1`,
  counts: `SELECT COUNT(*) AS batch_count, COALESCE(SUM(sample_count), 0) AS sample_count,
    MIN(batch_sequence) AS min_sequence, MAX(batch_sequence) AS max_sequence,
    COUNT(DISTINCT batch_sequence) AS distinct_sequences,
    COALESCE(SUM(octet_length(payload_compressed)), 0) AS compressed_bytes
    FROM public.telemetry_batches WHERE session_id = $1::uuid`,
  batches: `SELECT session_id, batch_sequence, sample_count, first_sample_index, last_sample_index,
    first_timestamp, last_timestamp, raw_bytes_size, compressed_bytes_size, payload_compressed,
    pg_column_size(ROW(id, session_id, batch_sequence, sample_count, first_sample_index,
      last_sample_index, first_timestamp, last_timestamp, raw_bytes_size, compressed_bytes_size,
      created_at)) AS metadata_bytes
    FROM public.telemetry_batches WHERE session_id = $1::uuid ORDER BY batch_sequence LIMIT 1001`,
  laps: `SELECT participant_id, lap_number, lap_time, sample_count, off_track_count, collision_count,
    spin_count, average_speed, max_speed, valid_lap, pg_column_size(l) AS metadata_bytes
    FROM public.telemetry_laps l WHERE session_id = $1::uuid
    ORDER BY participant_id, lap_number LIMIT 1001`
});

function fault(code) { return Object.assign(new Error(code), { diagnosticCode: code }); }
function number(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return NaN;
  return Number(value);
}
const integer = value => Number.isSafeInteger(number(value)) && number(value) >= 0;
const sum = (rows, field) => rows.reduce((total, row) => total + number(row[field]), 0);
const maskedId = value => typeof value === 'string' && UUID.test(value)
  ? `${value.slice(0, 8)}…${value.slice(-4)}` : '[MASKED]';
const version = value => typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[a-z0-9.]{1,24})?$/i.test(value)
  ? value : '[INVALID_OR_REDACTED]';
const finiteOutput = value => Number.isFinite(number(value)) ? number(value) : null;
function iso(value) {
  if (value == null) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function noNonfinite(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  return !value || typeof value !== 'object' || Object.values(value).every(noNonfinite);
}
function timestampMatches(stored, sample) {
  // PostgreSQL NUMERIC(16,3) rounds the millisecond value to three decimal places.
  return Number.isFinite(number(stored)) && Number.isFinite(sample)
    && Math.abs(number(stored) - sample) <= 0.0005 + Math.max(1e-9, Math.abs(sample) * Number.EPSILON);
}

export function poolOptions(databaseUrl) {
  if (!databaseUrl) throw fault('DATABASE_URL_MISSING');
  let url;
  try { url = new URL(databaseUrl); } catch { throw fault('DATABASE_URL_INVALID'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2)
    throw fault('DATABASE_URL_INVALID');
  // SSL parameters, including sslmode=require, are interpreted by pg itself.
  return { connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 1000, statement_timeout: 15000, query_timeout: 20000,
    application_name: 'quick-grid-readonly-verification' };
}

export async function readSnapshot(pool, sessionId) {
  if (sessionId !== undefined && !UUID.test(sessionId)) throw fault('SESSION_ID_INVALID');
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
    const session = (await client.query(sessionId === undefined ? QUERIES.latestSession : QUERIES.sessionById,
      sessionId === undefined ? [] : [sessionId])).rows[0];
    if (!session) throw fault('SESSION_NOT_FOUND');
    const params = [session.id];
    const counts = (await client.query(QUERIES.counts, params)).rows[0];
    if (number(counts.batch_count) > MAX_BATCHES || number(counts.compressed_bytes) > MAX_BYTES)
      throw fault('DIAGNOSTIC_SIZE_LIMIT');
    const batches = (await client.query(QUERIES.batches, params)).rows;
    const laps = (await client.query(QUERIES.laps, params)).rows;
    if (batches.length > MAX_BATCHES || laps.length > MAX_BATCHES) throw fault('DIAGNOSTIC_SIZE_LIMIT');
    await client.query('ROLLBACK'); // This tool never commits or modifies dataset rows.
    return { session, counts, batches, laps, requestedSessionId: sessionId };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* Keep only sanitized diagnostics at CLI boundary. */ }
    throw error;
  } finally { client.release(); }
}

export function analyzeSnapshot({ session: s, counts: c, batches, laps, requestedSessionId }) {
  const checks = [];
  function check(section, valid, code, details = {}, severity = 'FAIL') {
    checks.push({ section, status: valid ? 'PASS' : severity, code, ...details });
  }
  check('SESSION', s.status === 'COMPLETED' && s.scope === 'PLAYER_ONLY'
    && s.schema_version === EXPECTED.schema && UUID.test(s.id)
    && (requestedSessionId === undefined || s.id.toLowerCase() === requestedSessionId.toLowerCase())
    && iso(s.created_at) !== null && iso(s.finished_at) !== null
    && new Date(s.finished_at) >= new Date(s.created_at), 'SESSION_MATCH', {
    selection: requestedSessionId === undefined ? 'LATEST_COMPLETED_NOT_ASSUMED_CLIENT_SESSION' : 'EXACT_REQUESTED_ID',
    id: maskedId(s.id), statusObserved: ['ACTIVE', 'COMPLETED', 'ABANDONED'].includes(s.status) ? s.status : 'INVALID',
    schema_version: finiteOutput(s.schema_version), track_id: finiteOutput(s.track_id),
    sample_rate_hz: finiteOutput(s.sample_rate_hz), scope: s.scope === 'PLAYER_ONLY' ? s.scope : 'INVALID',
    received_samples: finiteOutput(s.received_samples), received_batches: finiteOutput(s.received_batches),
    completed_laps: finiteOutput(s.completed_laps), game_build_version: version(s.game_build_version),
    track_geometry_version: version(s.track_geometry_version), physics_version: version(s.physics_version),
    feature_manifest_version: version(s.feature_manifest_version), consent_version: version(s.consent_version),
    created_at: iso(s.created_at), finished_at: iso(s.finished_at) });
  check('BATCH COUNTS', number(c.batch_count) === EXPECTED.batches && s.received_batches === EXPECTED.batches
    && batches.length === EXPECTED.batches, 'BATCH_COUNTS_MATCH',
  { expected: EXPECTED.batches, session: finiteOutput(s.received_batches), rows: finiteOutput(c.batch_count) });
  check('SAMPLE COUNTS', number(c.sample_count) === EXPECTED.samples && s.received_samples === EXPECTED.samples
    && sum(batches, 'sample_count') === EXPECTED.samples, 'SAMPLE_COUNTS_MATCH',
  { expected: EXPECTED.samples, session: finiteOutput(s.received_samples), rows: finiteOutput(c.sample_count) });
  const sequences = batches.map(row => number(row.batch_sequence)).sort((a, b) => a - b);
  const duplicates = sequences.length - new Set(sequences).size;
  const gaps = sequences.slice(1).flatMap((value, i) => value > sequences[i] + 1
    ? [{ after: sequences[i], before: value }] : []);
  check('SEQUENCES', sequences.length > 0 && sequences.every(integer) && duplicates === 0 && gaps.length === 0
    && number(c.distinct_sequences) === sequences.length && number(c.min_sequence) === sequences[0]
    && number(c.max_sequence) === sequences.at(-1), 'CONTINUITY',
  { min: finiteOutput(c.min_sequence), max: finiteOutput(c.max_sequence), duplicates, gaps });
  check('SEQUENCES', sequences[0] === 0, 'STARTS_AT_ZERO', {}, 'WARNING');

  const participants = new Map();
  const lapRows = laps.map(lap => {
    if (!participants.has(lap.participant_id)) participants.set(lap.participant_id, `participant-${participants.size + 1}`);
    const row = { participant_id: participants.get(lap.participant_id) };
    for (const field of ['lap_number', 'lap_time', 'sample_count', 'off_track_count', 'collision_count',
      'spin_count', 'average_speed', 'max_speed']) row[field] = finiteOutput(lap[field]);
    row.valid_lap = typeof lap.valid_lap === 'boolean' ? lap.valid_lap : null;
    return row;
  });
  check('LAPS', laps.length > 0, laps.length ? 'LAP_SUMMARIES_PRESENT' : 'LAP_SUMMARY_MISSING',
    { rows: laps.length, sessionCompletedLaps: finiteOutput(s.completed_laps), laps: lapRows }, 'WARNING');
  check('LAPS', integer(s.completed_laps) && s.completed_laps === laps.length, 'LAP_COUNTER_MATCH');
  check('LAPS', laps.every(lap => typeof lap.participant_id === 'string' && lap.participant_id.length > 0
    && integer(lap.lap_number) && lap.lap_number > 0 && number(lap.lap_time) > 0 && Number.isFinite(number(lap.lap_time))
    && integer(lap.sample_count) && lap.sample_count > 0
    && ['off_track_count', 'collision_count', 'spin_count'].every(key => integer(lap[key]))
    && ['average_speed', 'max_speed'].every(key => lap[key] == null || Number.isFinite(number(lap[key])))
    && typeof lap.valid_lap === 'boolean')
    && new Set(laps.map(lap => JSON.stringify([lap.participant_id, lap.lap_number]))).size === laps.length,
  'LAP_ROWS_VALID');

  const lineageMatches = s.schema_version === EXPECTED.schema && s.track_geometry_version === EXPECTED.geometry
    && s.physics_version === EXPECTED.physics && s.feature_manifest_version === EXPECTED.features;
  check('VERSION LINEAGE', lineageMatches, 'SESSION_LINEAGE', { source: 'telemetry_sessions; versions are not stored in each sample' });
  const measurements = [];
  const localSessionIds = new Set();
  for (const row of batches) {
    const detail = { batchSequence: finiteOutput(row.batch_sequence) };
    let raw, payload;
    try {
      if (!Buffer.isBuffer(row.payload_compressed) || row.payload_compressed.length > MAX_RAW_BATCH) throw fault('GZIP_INVALID');
      raw = gunzipSync(row.payload_compressed, { maxOutputLength: MAX_RAW_BATCH });
      payload = JSON.parse(raw.toString('utf8'));
      check('GZIP', true, 'GZIP_JSON_VALID', detail);
    } catch { check('GZIP', false, 'GZIP_JSON_INVALID_OR_LIMIT', detail); continue; }
    const arrayOnly = Array.isArray(payload);
    const samples = arrayOnly ? payload : payload?.samples;
    check('PAYLOAD IDENTITY', row.session_id === s.id, 'ROW_SESSION_MATCH', detail);
    check('PAYLOAD IDENTITY', !arrayOnly, arrayOnly ? 'PAYLOAD_ENVELOPE_NOT_STORED' : 'PAYLOAD_ENVELOPE_PRESENT', detail, 'WARNING');
    if (!arrayOnly) check('PAYLOAD IDENTITY', payload?.sessionId === s.id
      && payload?.batchSequence === row.batch_sequence, 'ENVELOPE_ID_SEQUENCE_MATCH', detail);
    check('SAMPLE COUNTS', Array.isArray(samples) && samples.length > 0 && samples.length === row.sample_count,
      'PAYLOAD_COUNT_MATCH', detail);
    if (!Array.isArray(samples) || samples.length === 0) continue;
    check('SCHEMA', samples.every(sample => validateTelemetrySample(sample)
      && Number.isFinite(sample.carState?.steeringAngle) && noNonfinite(sample)
      && sample.metadata.driverType === 'PLAYER' && Number.isInteger(sample.metadata.sampleIndex)
      && sample.metadata.trackId === s.track_id), 'ALL_SAMPLES_SCHEMA_V2_PLAYER_FINITE', detail);
    for (const sample of samples) if (typeof sample?.metadata?.sessionId === 'string') localSessionIds.add(sample.metadata.sessionId);
    const sampleSessionMatches = samples.every(sample => sample?.metadata?.sessionId === s.id);
    check('PAYLOAD IDENTITY', sampleSessionMatches,
      sampleSessionMatches ? 'SAMPLE_SESSION_ID_MATCH' : 'SAMPLE_SESSION_ID_DIFFERS_DB_SESSION', detail, 'WARNING');
    const first = samples[0]?.metadata, last = samples.at(-1)?.metadata;
    check('BATCH METADATA', first && last && integer(row.first_sample_index) && integer(row.last_sample_index)
      && number(row.first_sample_index) === first.sampleIndex && number(row.last_sample_index) === last.sampleIndex
      && timestampMatches(row.first_timestamp, first.timestamp) && timestampMatches(row.last_timestamp, last.timestamp),
    'FIRST_LAST_METADATA_MATCH', detail);
    const compressedBytes = row.payload_compressed.length;
    check('COMPRESSION', raw.length === number(row.raw_bytes_size)
      && compressedBytes === number(row.compressed_bytes_size), 'STORED_BYTE_LENGTHS_MATCH', detail);
    measurements.push({ ...detail, sampleCount: samples.length, rawBytes: raw.length, compressedBytes,
      compressionRatio: raw.length / compressedBytes });
  }
  check('GZIP', batches.length > 0 && measurements.length === batches.length, 'ALL_BATCHES_MEASURED');
  check('PAYLOAD IDENTITY', localSessionIds.size === 1, 'ONE_CONSISTENT_SAMPLE_SESSION',
    { distinctSampleSessionIds: localSessionIds.size });
  const rawTotal = sum(measurements, 'rawBytes'), compressedTotal = sum(measurements, 'compressedBytes');
  check('COMPRESSION', compressedTotal === number(c.compressed_bytes), 'AGGREGATE_BYTES_MATCH');
  const compression = measurements.length ? {
    measuredBatches: measurements.length, expectedBatches: batches.length,
    selectedBatch: measurements.find(row => row.sampleCount === 50) || measurements[0],
    totalRawBytes: rawTotal, totalCompressedBytes: compressedTotal,
    averageRawBytes: rawTotal / measurements.length, averageCompressedBytes: compressedTotal / measurements.length,
    averageCompressionRatio: sum(measurements, 'compressionRatio') / measurements.length,
    aggregateCompressionRatio: rawTotal / compressedTotal, ratioDefinition: 'rawBytes / compressedBytes'
  } : null;
  const metadataBytes = number(s.metadata_bytes) + sum(batches, 'metadata_bytes') + sum(laps, 'metadata_bytes');
  const rate = number(s.sample_rate_hz), sampleCount = number(c.sample_count);
  const storageEligible = measurements.length === batches.length && sampleCount > 0 && Number.isFinite(rate) && rate > 0
    && Number.isFinite(metadataBytes) && metadataBytes >= 0 && lineageMatches
    && !checks.some(item => item.status === 'FAIL');
  const storage = storageEligible ? { basis: 'nominal active sampling time = samples / sample_rate_hz; one PLAYER',
    activeSampleSeconds: sampleCount / rate, wallClockSeconds: (new Date(s.finished_at) - new Date(s.created_at)) / 1000,
    measuredPayloadBytes: compressedTotal, sqlMetadataRowProxyBytes: metadataBytes,
    caveat: 'SQL proxy excludes indexes, TOAST overhead, free pages, client_info and WAL; repeats observed session/lap mix. Not billing.',
    estimates: [1, 100, 1000, 10000].map(players => ({ players, hours: 1,
      compressedPayloadBytes: compressedTotal / sampleCount * rate * 3600 * players,
      sqlMetadataOverheadApproxBytes: metadataBytes / sampleCount * rate * 3600 * players }))
  } : null;
  check('STORAGE', storageEligible, 'STORAGE_ESTIMATE_AVAILABLE', {}, 'WARNING');
  const result = checks.some(item => item.status === 'FAIL') ? 'FAIL'
    : checks.some(item => item.status === 'WARNING') ? 'WARNING' : 'PASS';
  return { checks, compression, storage, result };
}

export function formatReport(report) {
  const lines = [];
  for (const section of new Set(report.checks.map(item => item.section))) {
    const items = report.checks.filter(item => item.section === section);
    const status = items.some(item => item.status === 'FAIL') ? 'FAIL' : items.some(item => item.status === 'WARNING') ? 'WARNING' : 'PASS';
    lines.push(`${section}: ${status}`);
    // Group repetitive batch checks; never print payloads, local IDs or raw error messages.
    for (const code of new Set(items.map(item => item.code))) {
      const group = items.filter(item => item.code === code);
      lines.push(`  ${code}: ${group.filter(item => item.status === 'PASS').length}/${group.length} PASS`);
      if (group.length === 1) lines.push(`  ${JSON.stringify(group[0])}`);
      else {
        const issues = group.filter(item => item.status !== 'PASS').map(item => item.batchSequence);
        if (issues.length) lines.push(`  affectedBatchSequences: ${JSON.stringify(issues)}`);
      }
    }
  }
  lines.push(`COMPRESSION METRICS: ${JSON.stringify(report.compression)}`);
  lines.push(`STORAGE ESTIMATE: ${JSON.stringify(report.storage)}`);
  lines.push(`CLOUD DATA INTEGRITY = ${report.result}`);
  return lines.join('\n');
}

const SAFE_ERRORS = new Set(['DATABASE_URL_MISSING', 'DATABASE_URL_INVALID', 'SESSION_ID_INVALID',
  'SESSION_NOT_FOUND', 'DIAGNOSTIC_SIZE_LIMIT', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', '28P01', '42501', '42P01', '57014']);
export async function main({ argv = process.argv.slice(2), env = process.env, Pool = pg.Pool, write = console.log } = {}) {
  let pool;
  try {
    if (argv.length > 1 || (argv.length === 1 && !UUID.test(argv[0]))) throw fault('SESSION_ID_INVALID');
    pool = new Pool(poolOptions(env.DATABASE_URL));
    // Avoid an unhandled idle-client error printing connection details.
    pool.on('error', () => {});
    const report = analyzeSnapshot(await readSnapshot(pool, argv[0]));
    write(formatReport(report));
    return report.result === 'FAIL' ? 1 : report.result === 'WARNING' ? 2 : 0;
  } catch (error) {
    const code = error.diagnosticCode || error.code;
    write(`DIAGNOSTIC: ${SAFE_ERRORS.has(code) ? code : 'CLOUD_VERIFICATION_ERROR'}`);
    write('CLOUD DATA INTEGRITY = FAIL (verification incomplete)');
    return 1;
  } finally {
    if (pool) { try { await pool.end(); } catch { /* No raw error output. */ } }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  process.exitCode = await main();
