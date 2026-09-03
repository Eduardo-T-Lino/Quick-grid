// Deterministic LOCAL checks. Real HTTP, but IN-MEMORY storage and generated fixtures.
// These are not PostgreSQL, browser IndexedDB reload, human laps, or browser performance proof.
import http from 'node:http';
import zlib from 'node:zlib';
import { createApp } from '../server/src/app.js';
import { config } from '../server/src/config.js';
import { db, getPool } from '../server/src/db/pool.js';
import { createIngestToken } from '../server/src/security/ingestToken.js';
import { OnlineTelemetryUploader, onlineUploader } from '../src/ml/telemetry/telemetryUploader.js';
import { telemetryIndexedDB } from '../src/ml/telemetry/telemetryIndexedDB.js';
import { TelemetryCollector } from '../src/ml/telemetry/telemetryCollector.js';
import { PerformanceMetrics } from '../src/ml/telemetry/performanceMetrics.js';
import { createTelemetrySample, validateTelemetrySample } from '../src/ml/telemetry/telemetrySchema.js';

let passed = 0, failed = 0;
function check(condition, label) {
  if (!condition) { failed++; throw new Error(label); }
  passed++; console.log(`  PASS: ${label}`);
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (!predicate() && Date.now() < deadline) await delay(10);
  check(predicate(), label);
}
function sample(index) {
  return createTelemetrySample({
    sessionId: 'local-generated-fixture', sampleIndex: index, timestamp: 1000 + index * 100,
    trackId: 21, lapNumber: 1, driverType: 'PLAYER', participantId: 'p_anonymous_test',
    trackProgress: .2, pathIndex: 1, currentCurvature: .001,
    futureCurvature5m: .002, futureCurvature10m: .003, futureCurvature20m: .004, futureCurvature40m: .005,
    targetSpeed: 1.3, distanceToLeftEdge: 10, distanceToRightEdge: 10, surface: 'TARMAC',
    speed: 1, forwardVelocity: 1, lateralVelocity: 0, heading: 0, headingError: 0,
    yawRate: 0, slipAngle: 0, crossTrackError: 0, steeringAngle: 0,
    steering: 0, throttle: .5, brake: 0, offTrack: false, collision: false, spin: false, isRecovering: false
  });
}
const instances = [];
const originalFetch = globalThis.fetch;
let baseUrl;
function uploader(options = {}) {
  const instance = new OnlineTelemetryUploader({ baseUrl, autoRestore: false, consentEnabled: true,
    completionDrainTimeoutMs: 60, ...options });
  instances.push(instance);
  return instance;
}
async function post(path, body, headers = {}) {
  const response = await originalFetch(`${baseUrl}${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function main() {
  console.log('ML2.2-B LOCAL completion/security regression (not production E2E)');
  const server = http.createServer(createApp());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  baseUrl = `${origin}/api/v1/telemetry`;
  try {
    check(db.isMemory() && !telemetryIndexedDB.isSupported(), 'explicit local memory test mode');
    const fps = new PerformanceMetrics();
    for (let i = 0; i <= 120; i++) fps.recordFrame(.15, i * 1000 / 60);
    const metrics = fps.getStats();
    check(Math.abs(metrics.averageFps - 60) < 1e-9, 'FPS derives from RAF intervals, not callback CPU');
    check(Math.abs(metrics.frame.p95Ms - 1000 / 60) < 1e-9 && metrics.frameCpu.meanMs < .16,
      '16.67ms frame interval remains separate from 0.15ms CPU');
    check(metrics.wireKBPerMinute === null, 'wire traffic is not fabricated from raw JSON bytes');

    const wasProduction = config.isProduction;
    const allowed = config.CORS_ALLOWED_ORIGINS;
    config.isProduction = true;
    config.CORS_ALLOWED_ORIGINS = ['https://production.example'];
    try {
      const preflight = await originalFetch(`${origin}/api/v1/telemetry/sessions/test/refresh-token`, {
        method: 'OPTIONS', headers: { Origin: 'https://production.example',
          'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-refresh-credential' } });
      check(preflight.status === 204 && preflight.headers.get('access-control-allow-origin') === 'https://production.example'
        && preflight.headers.get('access-control-allow-headers').includes('x-refresh-credential'), 'CORS preflight permits refresh proof header');
      const denied = await originalFetch(`${origin}/health`, { headers: { Origin: 'https://false.example' } });
      check(denied.status === 403 && !denied.headers.has('access-control-allow-origin'), 'CORS rejects false origin without wildcard');
    } finally { config.isProduction = wasProduction; config.CORS_ALLOWED_ORIGINS = allowed; }
    const originalQuery = db.query;
    db.query = async () => { throw new Error('controlled unavailable database'); };
    try { check((await originalFetch(`${origin}/ready`)).status === 503, 'readiness fails on controlled storage outage'); }
    finally { db.query = originalQuery; }

    await telemetryIndexedDB.clearAll();
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('must not call'); };
    const off = uploader({ consentEnabled: false });
    for (let i = 0; i < 200; i++) off.queueSample(sample(i));
    await off.initSession(21);
    check(calls === 0 && off.activeBuffer.length === 0, 'OFF makes zero requests and buffers zero online samples');
    const preview = uploader({ deploymentAllowed: false });
    await preview.setConsent(true); await preview.initSession(21); preview.queueSample(sample(0));
    check(calls === 0 && !preview.consentEnabled, 'preview deployment guard cannot be enabled by consent');
    globalThis.fetch = originalFetch;

    const offline = uploader();
    const sessionId = await offline.initSession(21);
    check(Boolean(sessionId), 'HTTP session created in local adapter');
    globalThis.fetch = async () => { throw new TypeError('controlled offline'); };
    for (let i = 0; i < 150; i++) offline.queueSample(sample(i));
    const ending = await offline.endSession({});
    check(ending.completed === false && getPool().sessions.get(sessionId).status === 'ACTIVE'
      && offline.pendingQueue.length === 3, 'three offline batches prevent COMPLETED');
    check(await telemetryIndexedDB.getCount() === 3, 'three batches persisted in memory storage adapter');
    const expectedSequence = offline.nextBatchSequence;
    offline.dispose();
    const restored = uploader({ consentEnabled: false });
    await restored.restorePendingFromIndexedDB();
    check(restored.serverSessionId === sessionId && restored.nextBatchSequence === expectedSequence
      && Boolean(restored.refreshCredential), 'object recreation restores original session, sequence and proof');
    check(restored.pendingCompletionStats !== null, 'completion intent restored');
    let extraSessions = 0;
    globalThis.fetch = (url, opts) => { if (url.endsWith('/sessions')) extraSessions++; return originalFetch(url, opts); };
    await restored.setConsent(true);
    await until(() => restored.sessionStatus === 'COMPLETED', 'restored offline session drains and completes');
    check(extraSessions === 0 && getPool().sessions.get(sessionId).received_samples === 150
      && getPool().sessions.get(sessionId).received_batches === 3, 'no replacement session and exact server counters');
    check(await telemetryIndexedDB.getCount() === 0 && (await telemetryIndexedDB.getAllSessionCredentials()).length === 0,
      'ACK plus completion clears batches and continuity record');
    restored.dispose(); globalThis.fetch = originalFetch;

    const expiry = uploader();
    const expiryId = await expiry.initSession(21);
    expiry.ingestToken = createIngestToken(expiryId, .02 / 3600).ingestToken;
    await delay(30);
    let unauthorized = 0, refreshCalls = 0;
    const sequences = [];
    globalThis.fetch = async (url, opts) => {
      if (url.endsWith('/refresh-token')) refreshCalls++;
      if (url.endsWith('/batches')) sequences.push(JSON.parse(opts.body).batchSequence);
      const res = await originalFetch(url, opts);
      if (res.status === 401) unauthorized++;
      return res;
    };
    for (let i = 0; i < 50; i++) expiry.queueSample(sample(i));
    await until(() => expiry.stats.acknowledgedBatches === 1, 'expired HMAC token recovered over real local HTTP');
    check(unauthorized === 1 && refreshCalls === 1 && sequences.length === 2 && sequences.every(s => s === 0),
      '401 then proof refresh retries the same sequence');
    const lap = { sessionId: expiryId, participantId: 'p_anonymous_test', lapNumber: 1, lapTime: 5,
      sampleCount: 50, offTrackCount: 0, collisionCount: 0, spinCount: 0, averageSpeed: 1, maxSpeed: 1, validLap: true };
    const auth = { Authorization: `Bearer ${expiry.ingestToken}` };
    check((await post('/laps', lap, auth)).status === 201 && (await post('/laps', lap, auth)).status === 201,
      'lap POST accepts idempotent retry');
    check(getPool().sessions.get(expiryId).completed_laps === 1 && [...getPool().laps.values()].filter(l => l.session_id === expiryId).length === 1,
      'lap row and completed_laps count increment exactly once');
    const stored = getPool().batches.get(`${expiryId}:0`);
    const decoded = JSON.parse(zlib.gunzipSync(stored.payload_compressed).toString('utf8'));
    check(decoded.length === 50 && decoded.every(s => validateTelemetrySample(s)), 'generated gzip payload passes frontend schema validator');
    check(decoded.every(s => s.schemaVersion === 2 && s.metadata.driverType === 'PLAYER' && s.metadata.trackId === 21)
      && decoded[0].metadata.sampleIndex === stored.first_sample_index
      && decoded.at(-1).metadata.sampleIndex === stored.last_sample_index
      && decoded[0].metadata.timestamp === stored.first_timestamp
      && decoded.at(-1).metadata.timestamp === stored.last_timestamp, 'generated payload bounds and metadata match stored batch');
    await expiry.endSession({ completedLaps: 999 });
    check(getPool().sessions.get(expiryId).completed_laps === 1, 'complete cannot overwrite persisted lap count with client estimate');
    expiry.dispose(); globalThis.fetch = originalFetch;

    const lost = uploader();
    const lostId = await lost.initSession(21);
    let lostOnce = false;
    globalThis.fetch = async (url, opts) => {
      const response = await originalFetch(url, opts);
      if (url.endsWith('/batches') && !lostOnce) { lostOnce = true; await response.text(); throw new TypeError('controlled lost ACK'); }
      return response;
    };
    for (let i = 0; i < 50; i++) lost.queueSample(sample(i));
    await until(() => lost.stats.retryCount === 1, 'lost ACK leaves persisted batch pending');
    lost.pendingQueue[0].nextRetryAt = 0; lost.processQueue();
    await until(() => lost.stats.idempotentDuplicates === 1, 'retry receives ALREADY_PROCESSED');
    check(getPool().sessions.get(lostId).received_samples === 50 && getPool().sessions.get(lostId).received_batches === 1,
      'lost response does not double server counters');
    await lost.endSession(); lost.dispose(); globalThis.fetch = originalFetch;

    const owner = uploader(), other = uploader();
    await owner.initSession(21); const otherId = await other.initSession(21);
    check((await post(`/sessions/${otherId}/complete`, { sessionId: owner.serverSessionId },
      { Authorization: `Bearer ${owner.ingestToken}` })).status === 401, 'body cannot override route session authorization');
    check((await post(`/sessions/${otherId}/refresh-token`, {},
      { 'x-refresh-credential': owner.refreshCredential })).status === 401, 'refresh proof is scoped to original session');
    await owner.setConsent(false); await other.setConsent(false); owner.dispose(); other.dispose();

    let resolveLate, aborted = false;
    globalThis.fetch = async (url, opts) => new Promise(resolve => {
      resolveLate = resolve; opts.signal.addEventListener('abort', () => { aborted = true; });
    });
    const revoked = uploader();
    const initializing = revoked.initSession(21);
    await until(() => Boolean(resolveLate), 'controlled session request started');
    await revoked.setConsent(false);
    resolveLate({ ok: true, json: async () => ({ sessionId: 'late-session', ingestToken: 'test-only', refreshCredential: 'test-only' }) });
    await initializing;
    check(aborted && revoked.serverSessionId === null && revoked.timers.size === 0
      && (await telemetryIndexedDB.getAllSessionCredentials()).length === 0, 'opt-out aborts request and discards late credentials');
    revoked.dispose(); globalThis.fetch = originalFetch;

    let releaseCreation, creationCount = 0;
    globalThis.fetch = async (url, opts) => {
      if (url.endsWith('/sessions')) {
        creationCount++;
        await new Promise(resolve => { releaseCreation = resolve; });
      }
      return originalFetch(url, opts);
    };
    const slow = uploader();
    const starting = slow.beginRace(21);
    await until(() => Boolean(releaseCreation), 'slow creation HTTP request pending');
    for (let i = 0; i < 51; i++) slow.queueSample(sample(i));
    const endingEarly = await slow.endSession();
    check(!endingEarly.completed && slow.pendingQueue.length === 2 && slow.nextBatchSequence === 2,
      'race ending during creation preserves full and partial batch');
    releaseCreation(); const slowId = await starting;
    for (const batch of slow.pendingQueue) batch.nextRetryAt = 0;
    slow.processQueue();
    await until(() => slow.sessionStatus === 'COMPLETED', 'late creation drains previously reserved batches and completes');
    check(creationCount === 1 && getPool().sessions.get(slowId).received_samples === 51
      && getPool().sessions.get(slowId).received_batches === 2, 'creation coalesces requests without resetting samples or sequence');
    slow.dispose(); globalThis.fetch = originalFetch;

    const collector = new TelemetryCollector({ enabled: true });
    collector.onlineSessionReady = true;
    collector.lapStats.set('p_anon:1', { count: 50, speedSum: 50, maxSpeed: 1.2, offTrack: 1, collision: 0, spin: 0 });
    let summary;
    const originalRecord = onlineUploader.recordLap;
    onlineUploader.consentEnabled = true; onlineUploader.recordLap = value => { summary = value; };
    try { collector.recordCompletedLap({ participantId: 'p_anon', currentLap: 1, currentLapTime: 10, isBot: false }); }
    finally { onlineUploader.recordLap = originalRecord; onlineUploader.consentEnabled = false; }
    check(summary.sampleCount === 50 && summary.averageSpeed === 1 && summary.validLap === false
      && summary.lapTime === 10 && !('name' in summary), 'human lap hook emits anonymous numeric summary');
  } catch (error) {
    if (!failed) failed++;
    console.error('FAIL:', error.message);
  } finally {
    globalThis.fetch = originalFetch;
    for (const instance of instances) instance.dispose();
    onlineUploader.dispose();
    await telemetryIndexedDB.clearAll();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await db.end();
    console.log(`${passed} PASSOU | ${failed} FALHOU`);
    process.exitCode = failed ? 1 : 0;
  }
}
main();
