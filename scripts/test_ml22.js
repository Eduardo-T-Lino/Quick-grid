import http from 'http';
import { spawnSync } from 'child_process';
import { createApp } from '../server/src/app.js';
import { OnlineTelemetryUploader } from '../src/ml/telemetry/telemetryUploader.js';
import { telemetryIndexedDB } from '../src/ml/telemetry/telemetryIndexedDB.js';

let passed = 0;
let failed = 0;
const assert = (condition, label) => {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
};

function request(server, path, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method,
      headers: { 'Content-Type': 'application/json', ...headers } }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const sessionPayload = {
  schemaVersion: 2, trackId: 21, sampleRateHz: 10, scope: 'PLAYER_ONLY', consentVersion: '1.0.0',
  client: { gameBuildVersion: '0.2.0-ml2', trackGeometryVersion: '1.5.0-centripetal',
    physicsVersion: '1.5.0-gt3', featureManifestVersion: '2.1.0' }
};

async function run() {
  console.log('ML2.2 production-hardening tests');
  const server = http.createServer(createApp());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const created = await request(server, '/api/v1/telemetry/sessions', 'POST', sessionPayload);
  assert(created.status === 201 && created.body.refreshCredential, 'criação emite refresh credential separada');
  const id = created.body.sessionId;
  const noProof = await request(server, `/api/v1/telemetry/sessions/${id}/refresh-token`, 'POST');
  assert(noProof.status === 401, 'sessionId sozinho não renova token');
  const tampered = await request(server, `/api/v1/telemetry/sessions/${id}/refresh-token`, 'POST', null,
    { 'x-refresh-credential': `${created.body.refreshCredential}x` });
  assert(tampered.status === 401, 'credencial adulterada é rejeitada');
  const refreshed = await request(server, `/api/v1/telemetry/sessions/${id}/refresh-token`, 'POST', null,
    { 'x-refresh-credential': created.body.refreshCredential });
  assert(refreshed.status === 200 && refreshed.body.ingestToken, 'proof correto renova ingest token');
  const ready = await request(server, '/ready');
  assert(ready.status === 200, 'readiness consulta storage');
  await new Promise(resolve => server.close(resolve));

  const prodCheck = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import('./server/src/config.js').then(m=>m.validateProductionConfig())"],
    { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: '', INGEST_TOKEN_SECRET: '' } });
  assert(prodCheck.status !== 0, 'produção recusa banco/secret ausentes');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  const pending = new OnlineTelemetryUploader({ consentEnabled: true, autoRestore: false, completionDrainTimeoutMs: 20 });
  pending.serverSessionId = 'session-pending';
  pending.ingestToken = 'ingest';
  pending.refreshCredential = 'refresh';
  pending.pendingQueue.push({ sessionId: 'session-pending', batchSequence: 0, samples: [{}], nextRetryAt: Date.now() + 60000 });
  const completion = await pending.endSession({ completedLaps: 1 });
  assert(completion.completed === false && pending.sessionStatus === 'FINALIZATION_PENDING', 'pending batch impede COMPLETED');
  assert(pending.serverSessionId === 'session-pending', 'autoridade é preservada enquanto finalização está pendente');
  pending.dispose();

  await telemetryIndexedDB.clearAll();
  await telemetryIndexedDB.saveBatch({ sessionId: 'reload-session', batchSequence: 4, samples: [{}], createdAt: Date.now() });
  await telemetryIndexedDB.saveSessionCredentials({ serverSessionId: 'reload-session', ingestToken: 'i', refreshCredential: 'r', nextBatchSequence: 5 });
  const restored = new OnlineTelemetryUploader({ consentEnabled: false, autoRestore: false });
  await restored.restorePendingFromIndexedDB();
  assert(restored.serverSessionId === 'reload-session' && restored.refreshCredential === 'r', 'reload restaura sessão e proof');
  assert(restored.nextBatchSequence === 5, 'reload preserva sequência seguinte');
  restored.dispose();
  await telemetryIndexedDB.clearAll();
  globalThis.fetch = originalFetch;

  console.log(`\n${passed} passou | ${failed} falhou`);
  if (failed) process.exitCode = 1;
}

run().catch(err => { console.error(err); process.exit(1); });
