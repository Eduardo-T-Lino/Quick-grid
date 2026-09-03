// ========== ML TELEMETRY CONCURRENCY & STRESS TEST (FASE ML2.0) ==========
// Simula 20 sessões simultâneas enviando múltiplos batches concorrentes com retries duplicados

import http from 'http';
import { createApp } from '../server/src/app.js';
import { db } from '../server/src/db/pool.js';
import { createTelemetrySample } from '../src/ml/telemetry/telemetrySchema.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function makeRequest(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const reqOptions = {
      hostname: '127.0.0.1',
      port: address.port,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = data ? JSON.parse(data) : {};
        } catch {
          json = { raw: data };
        }
        resolve({
          status: res.statusCode,
          body: json
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function createMockSample(sessionId, participantId, sampleIdx, timestampMs) {
  return createTelemetrySample({
    sessionId,
    sampleIndex: sampleIdx,
    timestamp: timestampMs,
    trackId: 21,
    lapNumber: 1,
    driverType: 'PLAYER',
    participantId,
    trackProgress: 0.25,
    pathIndex: 120,
    currentCurvature: 0.012,
    futureCurvature5m: 0.014,
    futureCurvature10m: 0.018,
    futureCurvature20m: 0.035,
    futureCurvature40m: 0.010,
    targetSpeed: 1.15,
    distanceToLeftEdge: 12.0,
    distanceToRightEdge: 12.0,
    surface: 'TARMAC',
    speed: 1.12,
    forwardVelocity: 1.11,
    lateralVelocity: 0.04,
    heading: 1.57,
    headingError: 0.02,
    yawRate: 0.015,
    slipAngle: 0.036,
    crossTrackError: 0.15,
    steeringAngle: 0.12,
    steering: 0.45,
    throttle: 0.95,
    brake: 0.0,
    offTrack: false,
    collision: false,
    spin: false,
    isRecovering: false
  });
}

console.log('====================================================');
console.log('🚀 EXECUTANDO TESTE DE CONCORRÊNCIA (20 SESSÕES SIMULTÂNEAS)');
console.log('====================================================\n');

const NUM_CONCURRENT_SESSIONS = 20;
const BATCHES_PER_SESSION = 5;
const SAMPLES_PER_BATCH = 50;

const app = createApp();
const server = http.createServer(app);

server.listen(0, '127.0.0.1', async () => {
  try {
    console.log(`[CONCORRÊNCIA] Criando ${NUM_CONCURRENT_SESSIONS} sessões em paralelo...`);
    const sessionPromises = [];

    for (let i = 0; i < NUM_CONCURRENT_SESSIONS; i++) {
      const trackId = (i % 24) + 1;
      sessionPromises.push(
        makeRequest(server, {
          path: '/api/v1/telemetry/sessions',
          method: 'POST'
        }, {
          schemaVersion: 2,
          trackId,
          sampleRateHz: 10,
          scope: 'PLAYER_ONLY',
          client: {
            gameBuildVersion: '0.2.0-ml2',
            trackGeometryVersion: '1.5.0-centripetal',
            physicsVersion: '1.5.0-gt3',
            featureManifestVersion: '2.1.0'
          },
          consentVersion: '1.0.0'
        })
      );
    }

    const sessionResponses = await Promise.all(sessionPromises);
    const sessions = sessionResponses.map((r, idx) => ({
      index: idx,
      sessionId: r.body.sessionId,
      ingestToken: r.body.ingestToken,
      participantId: `p_${idx}_concurrent`
    }));

    assert(sessions.length === NUM_CONCURRENT_SESSIONS, `${NUM_CONCURRENT_SESSIONS} sessões criadas com sucesso em paralelo`);
    assert(new Set(sessions.map(s => s.sessionId)).size === NUM_CONCURRENT_SESSIONS, 'Todas as 20 sessões possuem UUIDs únicos');

    console.log(`\n[CONCORRÊNCIA] Disparando ${NUM_CONCURRENT_SESSIONS * BATCHES_PER_SESSION} batches simultâneos (+ retries duplicados)...`);

    const batchPromises = [];
    for (const session of sessions) {
      for (let b = 0; b < BATCHES_PER_SESSION; b++) {
        const samples = [];
        for (let s = 0; s < SAMPLES_PER_BATCH; s++) {
          const sampleIdx = b * SAMPLES_PER_BATCH + s;
          samples.push(createMockSample(session.sessionId, session.participantId, sampleIdx, 1000 + sampleIdx * 100));
        }

        // Requisição normal do batch
        batchPromises.push(
          makeRequest(server, {
            path: '/api/v1/telemetry/batches',
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session.ingestToken}` }
          }, {
            sessionId: session.sessionId,
            batchSequence: b,
            samples
          })
        );

        // Inserir deliberadamente um retry duplicado para testar concorrência de idempotência
        if (b === 2) {
          batchPromises.push(
            makeRequest(server, {
              path: '/api/v1/telemetry/batches',
              method: 'POST',
              headers: { 'Authorization': `Bearer ${session.ingestToken}` }
            }, {
              sessionId: session.sessionId,
              batchSequence: b,
              samples
            })
          );
        }
      }
    }

    const batchResults = await Promise.all(batchPromises);
    const successCount = batchResults.filter(r => r.status === 200).length;
    const processedCount = batchResults.filter(r => r.body.status === 'PROCESSED').length;
    const duplicateCount = batchResults.filter(r => r.body.status === 'ALREADY_PROCESSED').length;

    assert(successCount === batchPromises.length, `100% das ${batchPromises.length} requisições concorrentes responderam 200 OK`);
    assert(processedCount === NUM_CONCURRENT_SESSIONS * BATCHES_PER_SESSION, `Exatamente ${NUM_CONCURRENT_SESSIONS * BATCHES_PER_SESSION} batches foram processados como novos`);
    assert(duplicateCount === NUM_CONCURRENT_SESSIONS, `Exatamente ${NUM_CONCURRENT_SESSIONS} batches duplicados foram detectados e tratados de forma idempotente`);

    console.log('\n[CONCORRÊNCIA] Verificando integridade dos contadores de cada sessão...');
    let allCountersExact = true;

    for (const session of sessions) {
      const res = await makeRequest(server, {
        path: `/api/v1/telemetry/sessions/${session.sessionId}`,
        method: 'GET'
      });

      const expectedSamples = BATCHES_PER_SESSION * SAMPLES_PER_BATCH; // 5 * 50 = 250
      const expectedBatches = BATCHES_PER_SESSION;                    // 5
      if (res.body.received_samples !== expectedSamples || res.body.received_batches !== expectedBatches) {
        allCountersExact = false;
        console.error(`❌ Discrepância na sessão ${session.sessionId}: samples=${res.body.received_samples} (esperado ${expectedSamples}), batches=${res.body.received_batches} (esperado ${expectedBatches})`);
      }
    }

    assert(allCountersExact === true, `Todos os contadores de samples (${BATCHES_PER_SESSION * SAMPLES_PER_BATCH}/sessão) e batches (${BATCHES_PER_SESSION}/sessão) estão perfeitamente consistentes`);

    console.log('\n[CONCORRÊNCIA] Finalizando todas as 20 sessões concorrentes...');
    const completePromises = sessions.map(s =>
      makeRequest(server, {
        path: `/api/v1/telemetry/sessions/${s.sessionId}/complete`,
        method: 'POST',
        headers: { 'Authorization': `Bearer ${s.ingestToken}` }
      }, {
        completedLaps: 2,
        qualityStatus: 'PASS'
      })
    );

    const completeResults = await Promise.all(completePromises);
    assert(completeResults.every(r => r.status === 200 && r.body.status === 'COMPLETED'), 'Todas as 20 sessões foram finalizadas como COMPLETED sem conflitos');

  } catch (err) {
    console.error('❌ Erro no teste de concorrência:', err);
    failed++;
  } finally {
    server.close();
    await db.end();

    console.log('\n====================================================');
    console.log(`📊 RESULTADO DO TESTE DE CONCORRÊNCIA: ${passed} PASSOU | ${failed} FALHOU`);
    console.log('====================================================\n');

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
});
