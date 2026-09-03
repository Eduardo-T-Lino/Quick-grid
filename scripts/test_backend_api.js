// ========== ML TELEMETRY BACKEND API TEST SUITE (FASE ML2.0) ==========
// Validação automatizada de endpoints, segurança HMAC, idempotência, compressão e integridade

import http from 'http';
import { createApp } from '../server/src/app.js';
import { db } from '../server/src/db/pool.js';
import { config } from '../server/src/config.js';
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

// Helper para efetuar requisições HTTP locais no app Express
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
          headers: res.headers,
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

// Helper para gerar um mock sample válido de telemetria
function createMockSample(sessionId, sampleIdx, timestampMs = 1000) {
  return createTelemetrySample({
    sessionId,
    sampleIndex: sampleIdx,
    timestamp: timestampMs,
    trackId: 21,
    lapNumber: 1,
    driverType: 'PLAYER',
    participantId: 'p_0_test',
    trackProgress: 0.15,
    pathIndex: 50,
    currentCurvature: 0.005,
    futureCurvature5m: 0.008,
    futureCurvature10m: 0.012,
    futureCurvature20m: 0.015,
    futureCurvature40m: 0.020,
    targetSpeed: 1.35,
    distanceToLeftEdge: 12.0,
    distanceToRightEdge: 12.0,
    surface: 'TARMAC',
    speed: 1.25,
    forwardVelocity: 1.25,
    lateralVelocity: 0.0,
    heading: 0.5,
    headingError: 0.01,
    yawRate: 0.0,
    slipAngle: 0.0,
    crossTrackError: 0.0,
    steeringAngle: 0.0,
    steering: 0.0,
    throttle: 1.0,
    brake: 0.0,
    offTrack: false,
    collision: false,
    spin: false,
    isRecovering: false
  });
}

console.log('====================================================');
console.log('🚀 EXECUTANDO TESTES DE INTEGRAÇÃO DA API DE TELEMETRIA (ML2.0)');
console.log('====================================================\n');

const app = createApp();
const server = http.createServer(app);

server.listen(0, '127.0.0.1', async () => {
  try {
    // ----------------------------------------------------
    // TESTE 1: GET /health e GET /api/health
    // ----------------------------------------------------
    console.log('[TEST 1] Health Check Endpoint:');
    const resHealth = await makeRequest(server, { path: '/health', method: 'GET' });
    assert(resHealth.status === 200, 'GET /health retorna status 200');
    assert(resHealth.body.status === 'ok', 'GET /health payload status é "ok"');
    assert(resHealth.body.service === 'quick-grid-telemetry-api', 'Serviço identificado como quick-grid-telemetry-api');

    const resApiHealth = await makeRequest(server, { path: '/api/health', method: 'GET' });
    assert(resApiHealth.status === 200, 'GET /api/health também retorna status 200');


    // ----------------------------------------------------
    // TESTE 2: POST /api/v1/telemetry/sessions (Sessão Válida)
    // ----------------------------------------------------
    console.log('\n[TEST 2] Session Creation & Ingest Token Issuance:');
    const validSessionPayload = {
      schemaVersion: 2,
      trackId: 21,
      sampleRateHz: 10,
      scope: 'PLAYER_ONLY',
      client: {
        gameBuildVersion: '0.2.0-ml2',
        trackGeometryVersion: '1.5.0-centripetal',
        physicsVersion: '1.5.0-gt3',
        featureManifestVersion: '2.1.0'
      },
      consentVersion: '1.0.0'
    };

    const resCreateSession = await makeRequest(server, {
      path: '/api/v1/telemetry/sessions',
      method: 'POST'
    }, validSessionPayload);

    assert(resCreateSession.status === 201, 'POST /sessions retorna status 201 Created');
    assert(typeof resCreateSession.body.sessionId === 'string', 'Retorna sessionId UUID válido');
    assert(typeof resCreateSession.body.ingestToken === 'string', 'Retorna ingestToken HMAC assinado');
    assert(typeof resCreateSession.body.expiresAt === 'string', 'Retorna timestamp expiresAt válido');

    const activeSessionId = resCreateSession.body.sessionId;
    const activeIngestToken = resCreateSession.body.ingestToken;


    // ----------------------------------------------------
    // TESTE 3: Rejeição de Sessão Inválida (Metadata / Schema)
    // ----------------------------------------------------
    console.log('\n[TEST 3] Rejection of Invalid Session Data:');

    // Schema V1 rejeitado
    const resBadSchema = await makeRequest(server, {
      path: '/api/v1/telemetry/sessions',
      method: 'POST'
    }, { ...validSessionPayload, schemaVersion: 1 });
    assert(resBadSchema.status === 400, 'Sessão com schemaVersion = 1 é rejeitada com 400');

    // Metadados de versão do cliente ausentes
    const resMissingClient = await makeRequest(server, {
      path: '/api/v1/telemetry/sessions',
      method: 'POST'
    }, { ...validSessionPayload, client: {} });
    assert(resMissingClient.status === 400, 'Sessão sem metadados obrigatórios do client é rejeitada com 400');


    // ----------------------------------------------------
    // TESTE 4: POST /api/v1/telemetry/batches (Batch Válido & GZIP)
    // ----------------------------------------------------
    console.log('\n[TEST 4] Batch Ingestion & Server-Side Compression:');

    // Gerar 50 samples para o batch #0
    const batch0Samples = [];
    for (let i = 0; i < 50; i++) {
      batch0Samples.push(createMockSample(activeSessionId, i, 1000 + i * 100));
    }

    const resBatch0 = await makeRequest(server, {
      path: '/api/v1/telemetry/batches',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${activeIngestToken}` }
    }, {
      sessionId: activeSessionId,
      batchSequence: 0,
      samples: batch0Samples
    });

    assert(resBatch0.status === 200, 'POST /batches retorna status 200 OK');
    assert(resBatch0.body.status === 'PROCESSED', 'Batch #0 processado com status PROCESSED');
    assert(resBatch0.body.sampleCount === 50, 'sampleCount registrado é 50');
    assert(resBatch0.body.compressedBytesSize < resBatch0.body.rawBytesSize, `GZIP comprimiu o batch (${resBatch0.body.rawBytesSize}B -> ${resBatch0.body.compressedBytesSize}B, economia de ${resBatch0.body.compressionRatio})`);


    // ----------------------------------------------------
    // TESTE 5: Idempotência de Batches (Reenvio do Mesmo Sequence)
    // ----------------------------------------------------
    console.log('\n[TEST 5] Batch Idempotency (Duplicate Prevention):');

    const resDuplicateBatch = await makeRequest(server, {
      path: '/api/v1/telemetry/batches',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${activeIngestToken}` }
    }, {
      sessionId: activeSessionId,
      batchSequence: 0, // Mesmo sequence 0 reenviado
      samples: batch0Samples
    });

    assert(resDuplicateBatch.status === 200, 'Reenvio de batch duplicado retorna 200 OK seguro');
    assert(resDuplicateBatch.body.status === 'ALREADY_PROCESSED', 'Status retornado é ALREADY_PROCESSED');
    assert(resDuplicateBatch.body.isDuplicate === true, 'Flag isDuplicate confirmada como true');

    // Verificar se contadores na sessão não foram duplicados
    const resSessionCheck = await makeRequest(server, {
      path: `/api/v1/telemetry/sessions/${activeSessionId}`,
      method: 'GET'
    });
    assert(resSessionCheck.body.received_samples === 50, 'Contador received_samples não foi duplicado (permaneceu 50)');
    assert(resSessionCheck.body.received_batches === 1, 'Contador received_batches não foi duplicado (permaneceu 1)');


    // ----------------------------------------------------
    // TESTE 6: Rejeição de Batch com Schema V1
    // ----------------------------------------------------
    console.log('\n[TEST 6] Rejection of Schema V1 Batches:');
    const legacySamples = batch0Samples.map(s => ({ ...s, schemaVersion: 1 }));

    const resLegacyBatch = await makeRequest(server, {
      path: '/api/v1/telemetry/batches',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${activeIngestToken}` }
    }, {
      sessionId: activeSessionId,
      batchSequence: 1,
      samples: legacySamples
    });

    assert(resLegacyBatch.status === 400, 'Batch contendo schemaVersion = 1 é rejeitado com 400 Bad Request');


    // ----------------------------------------------------
    // TESTE 7: Rejeição de Valores NaN / Fora de Escala
    // ----------------------------------------------------
    console.log('\n[TEST 7] Rejection of NaN / Corrupted Values in Batch:');
    const corruptedSamples = [
      createMockSample(activeSessionId, 100),
      {
        ...createMockSample(activeSessionId, 101),
        driverAction: { steering: 2.5, throttle: 1.0, brake: 0.0 } // steering fora de [-1, 1]
      }
    ];

    const resCorruptedBatch = await makeRequest(server, {
      path: '/api/v1/telemetry/batches',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${activeIngestToken}` }
    }, {
      sessionId: activeSessionId,
      batchSequence: 1,
      samples: corruptedSamples
    });

    assert(resCorruptedBatch.status === 400, 'Batch com steering fora de limite normalizado é rejeitado com 400');


    // ----------------------------------------------------
    // TESTE 8: Rejeição de Batch com Tamanho Excessivo (> MAX_BATCH_SAMPLES)
    // ----------------------------------------------------
    console.log('\n[TEST 8] Rejection of Oversized Batches (> 100 samples):');
    const oversizedSamples = [];
    for (let i = 0; i < 105; i++) {
      oversizedSamples.push(createMockSample(activeSessionId, i));
    }

    const resOversized = await makeRequest(server, {
      path: '/api/v1/telemetry/batches',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${activeIngestToken}` }
    }, {
      sessionId: activeSessionId,
      batchSequence: 1,
      samples: oversizedSamples
    });

    assert(resOversized.status === 400, 'Batch com 105 samples (>100) é rejeitado com 400');


    // ----------------------------------------------------
    // TESTE 9: Rejeição de Token de Ingestão Inválido ou Adulterado
    // ----------------------------------------------------
    console.log('\n[TEST 9] Ingest Token Authentication & Tampering Protection:');

    // Token adulterado
    const tamperedToken = activeIngestToken.slice(0, -5) + 'xxxxx';
    const resTampered = await makeRequest(server, {
      path: '/api/v1/telemetry/batches',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tamperedToken}` }
    }, {
      sessionId: activeSessionId,
      batchSequence: 1,
      samples: [createMockSample(activeSessionId, 50)]
    });

    assert(resTampered.status === 401, 'Requisição com token adulterado é rejeitada com 401 Unauthorized');

    // Sem token
    const resNoToken = await makeRequest(server, {
      path: '/api/v1/telemetry/batches',
      method: 'POST'
    }, {
      sessionId: activeSessionId,
      batchSequence: 1,
      samples: [createMockSample(activeSessionId, 50)]
    });

    assert(resNoToken.status === 401, 'Requisição sem token de ingestão é rejeitada com 401 Unauthorized');


    // ----------------------------------------------------
    // TESTE 10: Rejeição para Sessão Inexistente
    // ----------------------------------------------------
    console.log('\n[TEST 10] Non-Existent Session Handling:');
    const fakeSessionId = '00000000-0000-0000-0000-000000000000';
    const { ingestToken: fakeToken } = (await import('../server/src/security/ingestToken.js')).createIngestToken(fakeSessionId);

    const resFakeSession = await makeRequest(server, {
      path: '/api/v1/telemetry/batches',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${fakeToken}` }
    }, {
      sessionId: fakeSessionId,
      batchSequence: 0,
      samples: [createMockSample(fakeSessionId, 0)]
    });

    assert(resFakeSession.status === 404, 'Envio para sessão inexistente retorna 404 Not Found');


    // ----------------------------------------------------
    // TESTE 11: Lap Summary Registration (POST /laps)
    // ----------------------------------------------------
    console.log('\n[TEST 11] Lap Summary Registration:');
    const lapPayload = {
      sessionId: activeSessionId,
      participantId: 'p_0_test',
      lapNumber: 1,
      lapTime: 92.450,
      sampleCount: 920,
      offTrackCount: 0,
      collisionCount: 0,
      spinCount: 0,
      averageSpeed: 1.28,
      maxSpeed: 1.35,
      validLap: true
    };

    const resLap = await makeRequest(server, {
      path: '/api/v1/telemetry/laps',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${activeIngestToken}` }
    }, lapPayload);

    assert(resLap.status === 201, 'POST /laps retorna status 201 Created');
    assert(resLap.body.lapNumber === 1, 'lapNumber = 1 registrado com sucesso');
    assert(resLap.body.lapTime === 92.450, 'lapTime = 92.450s registrado');


    // ----------------------------------------------------
    // TESTE 12: Session Completion (POST /sessions/:id/complete)
    // ----------------------------------------------------
    console.log('\n[TEST 12] Session Completion & Post-Completion Lockdown:');
    const resComplete = await makeRequest(server, {
      path: `/api/v1/telemetry/sessions/${activeSessionId}/complete`,
      method: 'POST',
      headers: { 'Authorization': `Bearer ${activeIngestToken}` }
    }, {
      completedLaps: 1,
      qualityStatus: 'PASS'
    });

    assert(resComplete.status === 200, 'POST /sessions/:id/complete retorna status 200 OK');
    assert(resComplete.body.status === 'COMPLETED', 'Status da sessão atualizado para COMPLETED');

    // Tentar enviar novo batch após a sessão estar finalizada deve ser rejeitado (409 Conflict)
    const resPostCompleteBatch = await makeRequest(server, {
      path: '/api/v1/telemetry/batches',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${activeIngestToken}` }
    }, {
      sessionId: activeSessionId,
      batchSequence: 1,
      samples: [createMockSample(activeSessionId, 50)]
    });

    assert(resPostCompleteBatch.status === 409, 'Novo batch enviado para sessão finalizada (COMPLETED) é rejeitado com 409 Conflict');

  } catch (err) {
    console.error('❌ Erro inesperado durante os testes:', err);
    failed++;
  } finally {
    server.close();
    await db.end();

    console.log('\n====================================================');
    console.log(`📊 RESULTADO DOS TESTES DE API: ${passed} PASSOU | ${failed} FALHOU`);
    console.log('====================================================\n');

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
});
