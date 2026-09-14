import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import pg from 'pg';
import { analyzeSamples, completeSession, distribution, KNOWN_SESSIONS } from './inventoryCore.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_API_DEFAULT = 'https://quick-grid-telemetry-api.onrender.com/api/v1/telemetry';
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'coverage', 'artifacts', 'playwright-report', 'test-results']);

function safeIso(value) {
  if (value == null) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function finite(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function fingerprintFromClientInfo(clientInfo) {
  if (!clientInfo || typeof clientInfo !== 'object') return null;
  const value = clientInfo.simulationFingerprintSha256;
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function fromSessionRow(row, overrides = {}) {
  const sessionId = row.id ?? row.sessionId;
  const sampleCount = row.received_samples ?? row.receivedSamples ?? overrides.sampleCount;
  const sampleRateHz = row.sample_rate_hz ?? row.sampleRateHz ?? overrides.sampleRateHz;
  return completeSession({
    source: overrides.source ?? 'CLOUD_POSTGRES',
    sessionId,
    localCollectionSessionId: overrides.localCollectionSessionId ?? null,
    collectionKind: overrides.collectionKind,
    schemaVersion: row.schema_version ?? row.schemaVersion,
    gameBuildVersion: row.game_build_version ?? row.gameBuildVersion,
    physicsVersion: row.physics_version ?? row.physicsVersion,
    trackGeometryVersion: row.track_geometry_version ?? row.trackGeometryVersion,
    featureManifestVersion: row.feature_manifest_version ?? row.featureManifestVersion,
    simulationFingerprint: fingerprintFromClientInfo(row.client_info ?? row.clientInfo)
      ?? row.simulationFingerprintSha256 ?? row.simulationFingerprint ?? null,
    trackId: row.track_id ?? row.trackId ?? overrides.trackId,
    sampleRateHz,
    scope: row.scope,
    status: row.status,
    driverTypes: overrides.driverTypes,
    batchCount: row.received_batches ?? row.receivedBatches ?? overrides.batchCount,
    sampleCount,
    lapCount: row.completed_laps ?? row.completedLaps ?? overrides.lapCount,
    durationSeconds: overrides.durationSeconds ?? ((finite(sampleCount) !== null && finite(sampleRateHz) > 0)
      ? finite(sampleCount) / finite(sampleRateHz) : null),
    createdAt: safeIso(row.created_at ?? row.createdAt),
    finishedAt: safeIso(row.finished_at ?? row.finishedAt),
    rawPayloadAvailable: overrides.rawPayloadAvailable,
    evidence: overrides.evidence ?? []
  });
}

function walkForJsonl(root, files, depth = 0) {
  if (depth > 3 || !fs.existsSync(root)) return;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) walkForJsonl(fullPath, files, depth + 1);
    } else if (entry.isFile() && /telemetry.*\.jsonl$/i.test(entry.name)) files.add(path.resolve(fullPath));
  }
}

export function discoverJsonlFiles({ cwd = process.cwd(), roots } = {}) {
  const home = os.homedir();
  const scanRoots = roots ?? [cwd, path.join(home, 'Downloads'), path.join(home, 'Documents'), path.join(home, 'Desktop')];
  const files = new Set();
  for (const root of scanRoots) walkForJsonl(path.resolve(root), files);
  return [...files].sort((a, b) => a.localeCompare(b, 'en'));
}

export function readJsonlFile(filePath) {
  const bytes = fs.readFileSync(filePath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const samples = [];
  let corruptLines = 0;
  for (const line of bytes.toString('utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { samples.push(JSON.parse(line)); } catch { corruptLines++; }
  }
  const groups = new Map();
  for (const sample of samples) {
    const id = typeof sample?.metadata?.sessionId === 'string'
      ? sample.metadata.sessionId : `unknown-${sha256.slice(0, 12)}`;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(sample);
  }
  if (!groups.size) groups.set(`unknown-${sha256.slice(0, 12)}`, []);
  return [...groups.entries()].map(([localCollectionSessionId, group]) => {
    const qualitySignals = analyzeSamples(group);
    const schemaVersions = [...new Set(group.map(sample => sample?.schemaVersion).filter(Number.isFinite))];
    const trackIds = [...new Set(group.map(sample => sample?.metadata?.trackId).filter(value => value !== undefined))];
    const driverTypes = [...new Set(group.map(sample => sample?.metadata?.driverType).filter(value => typeof value === 'string'))];
    return completeSession({
      source: 'LOCAL_JSONL',
      sessionId: localCollectionSessionId,
      localCollectionSessionId,
      collectionKind: driverTypes.length === 1 && driverTypes[0] === 'BOT' ? 'AUTOMATIC' : 'UNKNOWN',
      schemaVersion: schemaVersions.length === 1 ? schemaVersions[0] : null,
      trackId: trackIds.length === 1 ? trackIds[0] : null,
      sampleRateHz: 10,
      scope: driverTypes.includes('BOT') ? 'MIXED_OR_BOT' : 'PLAYER_ONLY',
      status: corruptLines ? 'CORRUPT_LINES' : 'LOCAL_CAPTURE',
      driverTypes,
      batchCount: null,
      sampleCount: group.length,
      lapCount: qualitySignals.laps.count,
      durationSeconds: qualitySignals.durationSeconds,
      rawPayloadAvailable: true,
      payloadCorrupt: corruptLines > 0,
      qualitySignals,
      evidence: [`jsonl:${path.basename(filePath)}`, `sha256:${sha256}`, `corruptLines:${corruptLines}`]
    });
  });
}

export function inventoryLocalJsonl(options = {}) {
  const files = options.files ?? discoverJsonlFiles(options);
  const byHash = new Map();
  for (const file of files) {
    let bytes;
    try { bytes = fs.readFileSync(file); } catch { continue; }
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (!byHash.has(hash)) byHash.set(hash, []);
    byHash.get(hash).push(file);
  }
  const sessions = [];
  for (const copies of byHash.values()) {
    for (const session of readJsonlFile(copies[0])) {
      session.evidence = [...new Set([
        ...session.evidence,
        `identicalFileCopies:${copies.length}`,
        ...copies.map(file => `file:${path.basename(file)}`)
      ])].sort();
      sessions.push(session);
    }
  }
  return {
    sessions,
    status: {
      source: 'LOCAL_JSONL',
      status: files.length ? 'AVAILABLE' : 'NOT_FOUND',
      filesDiscovered: files.length,
      distinctPayloads: byHash.size,
      note: files.length ? 'Raw JSONL analyzed; identical files deduplicated by SHA-256.' : 'No telemetry JSONL was found in scoped machine roots.'
    }
  };
}

function parseBenchmarkArtifact(filePath) {
  const artifact = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const result = [];
  for (const run of artifact.runs ?? []) {
    if (!(run.collector?.totalSamples > 0)) continue;
    const serverId = run.onlineAtMeasurementEnd?.serverSessionId;
    const localId = run.collector?.sessionId;
    const rate = finite(run.collector?.sampleRateHz) ?? 10;
    const online = run.onlineFinal ?? {};
    result.push(completeSession({
      source: 'VALIDATION_ARTIFACT',
      sessionId: serverId || localId,
      localCollectionSessionId: localId ?? null,
      collectionKind: 'AUTOMATIC',
      trackId: artifact.config?.trackId ?? null,
      sampleRateHz: rate,
      scope: run.collector?.scope ?? 'PLAYER_ONLY',
      status: serverId ? online.sessionStatus : 'ARTIFACT_BUFFER_ONLY',
      driverTypes: run.collector?.playerSamples > 0 ? ['PLAYER'] : [],
      batchCount: serverId ? (online.acknowledgedBatches ?? online.sentBatches ?? null) : null,
      sampleCount: run.collector.totalSamples,
      lapCount: run.collector.lapsRecorded ?? 0,
      durationSeconds: run.collector.totalSamples / rate,
      rawPayloadAvailable: false,
      evidence: [`artifact:${path.basename(filePath)}`, `run:${run.id}`, `scenario:${run.scenario}`]
    }));
  }
  return result;
}

function parseTokenRefreshArtifact(filePath) {
  const artifact = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return fromSessionRow(artifact.apiSession ?? {}, {
    source: 'VALIDATION_ARTIFACT',
    collectionKind: 'AUTOMATIC',
    trackId: artifact.controlledScenario?.trackId,
    sampleRateHz: 10,
    driverTypes: ['PLAYER'],
    durationSeconds: finite(artifact.apiSession?.receivedSamples) / 10,
    evidence: [`artifact:${path.basename(filePath)}`, 'proof:TOKEN_REFRESH_I']
  });
}

function parseLineageArtifact(filePath) {
  const artifact = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const session = artifact.apiSession ?? artifact.session ?? {};
  const sessionId = session.sessionId ?? artifact.sessionId ?? 'd2d44255-6487-4210-9daa-2e19f2df5ff3';
  return completeSession({
    source: 'VALIDATION_ARTIFACT',
    sessionId,
    collectionKind: 'AUTOMATIC',
    schemaVersion: session.schemaVersion,
    gameBuildVersion: session.gameBuildVersion,
    physicsVersion: session.physicsVersion,
    trackGeometryVersion: session.trackGeometryVersion,
    featureManifestVersion: session.featureManifestVersion,
    simulationFingerprint: session.simulationFingerprintSha256,
    trackId: session.trackId ?? 21,
    sampleRateHz: session.sampleRateHz,
    scope: session.scope ?? 'PLAYER_ONLY',
    status: session.status,
    driverTypes: ['PLAYER'],
    batchCount: session.receivedBatches,
    sampleCount: session.receivedSamples,
    lapCount: session.completedLaps ?? 0,
    durationSeconds: finite(session.receivedSamples) / (finite(session.sampleRateHz) || 10),
    rawPayloadAvailable: false,
    evidence: [`artifact:${path.basename(filePath)}`, 'proof:LINEAGE_SMOKE_J']
  });
}

export function inventoryValidationArtifacts({ cwd = process.cwd() } = {}) {
  const specs = [
    ['artifacts/ml22_browser_benchmark.json', parseBenchmarkArtifact],
    ['artifacts/ml22_browser_benchmark_vercel_quick.json', parseBenchmarkArtifact],
    ['artifacts/ml22_browser_benchmark_vercel.json', parseBenchmarkArtifact],
    ['artifacts/ml22_token_refresh_verification.json', file => [parseTokenRefreshArtifact(file)]],
    ['artifacts/ml22_lineage_smoke.json', file => [parseLineageArtifact(file)]]
  ];
  const sessions = [];
  const found = [];
  for (const [relative, parser] of specs) {
    const file = path.join(cwd, relative);
    if (!fs.existsSync(file)) continue;
    found.push(relative.replaceAll('\\', '/'));
    try { sessions.push(...parser(file)); } catch { /* A malformed artifact is listed but never treated as session evidence. */ }
  }
  return {
    sessions,
    status: {
      source: 'VALIDATION_ARTIFACTS', status: found.length ? 'AVAILABLE' : 'NOT_FOUND',
      filesDiscovered: found.length, files: found.sort(),
      note: 'Artifacts provide summaries only; raw samples are not reconstructed from them.'
    }
  };
}

export function documentedKnownSessions() {
  return Object.entries(KNOWN_SESSIONS).map(([sessionId, known]) => completeSession({
    source: 'DOCUMENTED_KNOWN_SESSION',
    sessionId,
    collectionKind: known.kind,
    gameBuildVersion: known.gameBuildVersion,
    driverTypes: known.driverTypes,
    status: 'DOCUMENTED',
    rawPayloadAvailable: false,
    evidence: [`knownGroup:${known.group}`]
  }));
}

export async function fetchPublicSessionMetadata(sessionIds, { baseUrl = PUBLIC_API_DEFAULT, fetchImpl = globalThis.fetch } = {}) {
  const unique = [...new Set(sessionIds.filter(id => UUID.test(id)))].sort();
  const sessions = [];
  const failures = [];
  for (const sessionId of unique) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetchImpl(`${baseUrl}/sessions/${sessionId}`, { signal: controller.signal });
      if (!response.ok) { failures.push({ sessionId, status: response.status }); continue; }
      const row = await response.json();
      sessions.push(fromSessionRow(row, {
        source: 'PUBLIC_SESSION_API', rawPayloadAvailable: false,
        driverTypes: ['PLAYER'], evidence: ['public-api:GET_SESSION_METADATA_ONLY']
      }));
    } catch { failures.push({ sessionId, status: 'UNAVAILABLE' }); }
    finally { clearTimeout(timeout); }
  }
  return {
    sessions,
    status: {
      source: 'PUBLIC_SESSION_API',
      status: sessions.length === unique.length ? 'AVAILABLE_PARTIAL' : sessions.length ? 'PARTIAL' : 'UNAVAILABLE',
      requestedSessions: unique.length,
      returnedSessions: sessions.length,
      failedSessions: failures.length,
      note: 'Read-only public GET exposes session metadata only, not full session discovery, batches, laps or raw GZIP payloads.'
    }
  };
}

export const CLOUD_QUERIES = Object.freeze({
  sessions: `SELECT id, created_at, finished_at, schema_version, track_id, sample_rate_hz, scope,
    game_build_version, track_geometry_version, physics_version, feature_manifest_version,
    status, received_samples, received_batches, completed_laps, client_info
    FROM public.telemetry_sessions ORDER BY id`,
  sessionById: `SELECT id, created_at, finished_at, schema_version, track_id, sample_rate_hz, scope,
    game_build_version, track_geometry_version, physics_version, feature_manifest_version,
    status, received_samples, received_batches, completed_laps, client_info
    FROM public.telemetry_sessions WHERE id = $1::uuid ORDER BY id`,
  batches: `SELECT session_id, batch_sequence, sample_count, first_sample_index, last_sample_index,
    first_timestamp, last_timestamp, payload_compressed
    FROM public.telemetry_batches ORDER BY session_id, batch_sequence`,
  batchesBySession: `SELECT session_id, batch_sequence, sample_count, first_sample_index, last_sample_index,
    first_timestamp, last_timestamp, payload_compressed
    FROM public.telemetry_batches WHERE session_id = $1::uuid ORDER BY session_id, batch_sequence`,
  laps: `SELECT session_id, lap_number, lap_time, sample_count, off_track_count, collision_count,
    spin_count, average_speed, max_speed, valid_lap FROM public.telemetry_laps ORDER BY session_id, lap_number`,
  lapsBySession: `SELECT session_id, lap_number, lap_time, sample_count, off_track_count, collision_count,
    spin_count, average_speed, max_speed, valid_lap FROM public.telemetry_laps
    WHERE session_id = $1::uuid ORDER BY session_id, lap_number`
});

function safeDatabaseCode(error) {
  const allowed = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', '28P01', '42501', '42P01', '57014']);
  return allowed.has(error?.code) ? error.code : 'CLOUD_QUERY_FAILED';
}

export async function inventoryCloud({ databaseUrl = process.env.DATABASE_URL, sessionId, Pool = pg.Pool } = {}) {
  const reproduce = sessionId
    ? `npm run ml3:inventory -- --source cloud --session ${sessionId} --output artifacts/ml3_dataset_inventory.json`
    : 'npm run ml3:inventory -- --source cloud --output artifacts/ml3_dataset_inventory.json';
  if (!databaseUrl) return { sessions: [], status: {
    source: 'CLOUD_POSTGRES', status: 'BLOCKED', code: 'CLOUD_FULL_INVENTORY_BLOCKED',
    reason: 'DATABASE_URL_MISSING', reproductionCommand: reproduce,
    note: 'Set DATABASE_URL only in the execution environment; never pass or record it as an argument.'
  } };
  if (sessionId && !UUID.test(sessionId)) throw new Error('SESSION_ID_INVALID');
  let pool, client;
  try {
    pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10000,
      statement_timeout: 30000, query_timeout: 35000, application_name: 'quick-grid-ml3-readonly-inventory' });
    client = await pool.connect();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '30s'");
    const params = sessionId ? [sessionId] : [];
    const sessionRows = (await client.query(sessionId ? CLOUD_QUERIES.sessionById : CLOUD_QUERIES.sessions, params)).rows;
    const batchRows = (await client.query(sessionId ? CLOUD_QUERIES.batchesBySession : CLOUD_QUERIES.batches, params)).rows;
    const lapRows = (await client.query(sessionId ? CLOUD_QUERIES.lapsBySession : CLOUD_QUERIES.laps, params)).rows;
    await client.query('ROLLBACK');
    const batchesBySession = new Map(), lapsBySession = new Map();
    for (const row of batchRows) {
      const id = String(row.session_id);
      if (!batchesBySession.has(id)) batchesBySession.set(id, []);
      batchesBySession.get(id).push(row);
    }
    for (const row of lapRows) {
      const id = String(row.session_id);
      if (!lapsBySession.has(id)) lapsBySession.set(id, []);
      lapsBySession.get(id).push(row);
    }
    const sessions = sessionRows.map(row => {
      const batchRowsForSession = batchesBySession.get(String(row.id)) ?? [];
      const samples = [];
      const payloadIntegrity = {
        batchesTotal: batchRowsForSession.length,
        gzipValid: 0, gzipInvalid: 0,
        jsonValid: 0, jsonInvalid: 0,
        arrayValid: 0, arrayInvalid: 0,
        countMatch: 0, countMismatch: 0,
        firstLastMetadataMatch: 0, firstLastMetadataMismatch: 0
      };
      const batchDetails = [];
      let payloadCorrupt = false;
      for (const batch of batchRowsForSession) {
        const detail = {
          batchSequence: finite(batch.batch_sequence),
          declaredSampleCount: finite(batch.sample_count),
          decodedSampleCount: null,
          gzip: 'INVALID', json: 'NOT_EVALUATED', array: 'NOT_EVALUATED',
          count: 'NOT_EVALUATED', firstLastMetadata: 'NOT_EVALUATED'
        };
        let raw, decoded;
        try {
          raw = gunzipSync(batch.payload_compressed);
          payloadIntegrity.gzipValid++;
          detail.gzip = 'VALID';
        } catch {
          payloadIntegrity.gzipInvalid++;
          payloadCorrupt = true;
          batchDetails.push(detail);
          continue;
        }
        try {
          decoded = JSON.parse(raw.toString('utf8'));
          payloadIntegrity.jsonValid++;
          detail.json = 'VALID';
        } catch {
          payloadIntegrity.jsonInvalid++;
          payloadCorrupt = true;
          detail.json = 'INVALID';
          batchDetails.push(detail);
          continue;
        }
        if (!Array.isArray(decoded)) {
          payloadIntegrity.arrayInvalid++;
          payloadCorrupt = true;
          detail.array = 'INVALID';
          batchDetails.push(detail);
          continue;
        }
        payloadIntegrity.arrayValid++;
        detail.array = 'VALID';
        detail.decodedSampleCount = decoded.length;
        if (decoded.length !== finite(batch.sample_count)) {
          payloadIntegrity.countMismatch++;
          payloadCorrupt = true;
          detail.count = 'MISMATCH';
        } else {
          payloadIntegrity.countMatch++;
          detail.count = 'MATCH';
        }
        const first = decoded[0]?.metadata;
        const last = decoded.at(-1)?.metadata;
        const timestampMatches = (stored, actual) => finite(stored) !== null && finite(actual) !== null
          && Math.abs(finite(stored) - finite(actual)) <= 0.0005 + Math.max(1e-9, Math.abs(finite(actual)) * Number.EPSILON);
        const metadataMatches = first && last
          && finite(batch.first_sample_index) === finite(first.sampleIndex)
          && finite(batch.last_sample_index) === finite(last.sampleIndex)
          && timestampMatches(batch.first_timestamp, first.timestamp)
          && timestampMatches(batch.last_timestamp, last.timestamp);
        if (metadataMatches) {
          payloadIntegrity.firstLastMetadataMatch++;
          detail.firstLastMetadata = 'MATCH';
        } else {
          payloadIntegrity.firstLastMetadataMismatch++;
          payloadCorrupt = true;
          detail.firstLastMetadata = 'MISMATCH';
        }
        samples.push(...decoded);
        batchDetails.push(detail);
      }
      const relationalLaps = lapsBySession.get(String(row.id)) ?? [];
      const qualitySignals = analyzeSamples(samples, {
        batchSequences: batchRowsForSession.map(batch => batch.batch_sequence), relationalLaps,
        sampleRateHz: finite(row.sample_rate_hz) || 10
      });
      const declaredSamples = finite(row.received_samples);
      const declaredBatches = finite(row.received_batches);
      qualitySignals.structuralIntegrity.declaredSampleCount = declaredSamples;
      qualitySignals.structuralIntegrity.decodedSampleCount = samples.length;
      qualitySignals.structuralIntegrity.sampleCountMismatch = declaredSamples !== samples.length;
      qualitySignals.structuralIntegrity.declaredBatchCount = declaredBatches;
      qualitySignals.structuralIntegrity.queriedBatchCount = batchRowsForSession.length;
      qualitySignals.structuralIntegrity.batchCountMismatch = declaredBatches !== batchRowsForSession.length;
      qualitySignals.structuralIntegrity.schemaVersionMismatch = samples.filter(sample => sample?.schemaVersion !== finite(row.schema_version)).length;
      qualitySignals.structuralIntegrity.trackIdMismatch = samples.filter(sample => sample?.metadata?.trackId !== finite(row.track_id)).length;
      qualitySignals.structuralIntegrity.driverTypeInvalid = samples.filter(sample => !['PLAYER', 'BOT'].includes(sample?.metadata?.driverType)).length;
      qualitySignals.payloadIntegrity = payloadIntegrity;
      const batchSequences = batchRowsForSession.map(batch => finite(batch.batch_sequence)).filter(value => value !== null).sort((a, b) => a - b);
      qualitySignals.batchIntegrity = {
        sequenceMin: batchSequences.length ? batchSequences[0] : null,
        sequenceMax: batchSequences.length ? batchSequences.at(-1) : null,
        sequenceGaps: qualitySignals.temporalIntegrity.batchGaps,
        sequenceDuplicates: qualitySignals.temporalIntegrity.batchSequenceDuplicates,
        sampleCountDistribution: distribution(batchRowsForSession.map(batch => batch.sample_count)),
        batches: batchDetails
      };
      payloadCorrupt ||= qualitySignals.structuralIntegrity.sampleCountMismatch
        || qualitySignals.structuralIntegrity.batchCountMismatch
        || qualitySignals.structuralIntegrity.schemaVersionMismatch > 0
        || qualitySignals.structuralIntegrity.trackIdMismatch > 0
        || qualitySignals.structuralIntegrity.driverTypeInvalid > 0;
      const localIds = [...new Set(samples.map(sample => sample?.metadata?.sessionId)
        .filter(value => typeof value === 'string' && value))];
      return completeSession({
        ...fromSessionRow(row),
        source: 'CLOUD_POSTGRES',
        collectionKind: KNOWN_SESSIONS[row.id]?.kind ?? 'UNKNOWN',
        localCollectionSessionId: localIds.length === 1 ? localIds[0] : null,
        driverTypes: [...new Set(samples.map(sample => sample?.metadata?.driverType).filter(Boolean))],
        batchCount: batchRowsForSession.length,
        sampleCount: declaredSamples,
        lapCount: relationalLaps.length,
        durationSeconds: qualitySignals.durationSeconds,
        rawPayloadAvailable: true,
        payloadCorrupt,
        qualitySignals,
        evidence: ['postgres:READ_ONLY_REPEATABLE_READ', 'payload:GZIP_DECOMPRESSED_LOCALLY']
      });
    });
    const integrityTotals = sessions.reduce((totals, session) => {
      const integrity = session.qualitySignals?.payloadIntegrity;
      if (!integrity) return totals;
      for (const key of Object.keys(totals)) totals[key] += integrity[key] ?? 0;
      return totals;
    }, { gzipValid: 0, gzipInvalid: 0, jsonValid: 0, jsonInvalid: 0,
      arrayValid: 0, arrayInvalid: 0, countMatch: 0, countMismatch: 0,
      firstLastMetadataMatch: 0, firstLastMetadataMismatch: 0 });
    return { sessions, status: {
      source: 'CLOUD_POSTGRES', status: 'AVAILABLE_FULL', sessions: sessions.length,
      batches: batchRows.length, samples: sessions.reduce((sum, item) => sum + (item.sampleCount ?? 0), 0),
      payloadIntegrity: integrityTotals,
      note: 'telemetry_sessions, telemetry_batches and telemetry_laps read in one read-only repeatable-read snapshot.'
    } };
  } catch (error) {
    try { await client?.query('ROLLBACK'); } catch { /* sanitized status below */ }
    return { sessions: [], status: {
      source: 'CLOUD_POSTGRES', status: 'BLOCKED', code: 'CLOUD_FULL_INVENTORY_BLOCKED',
      reason: safeDatabaseCode(error), reproductionCommand: reproduce,
      note: 'Database errors are sanitized; credentials are never emitted.'
    } };
  } finally {
    client?.release?.();
    await pool?.end?.().catch(() => {});
  }
}

export { PUBLIC_API_DEFAULT };
