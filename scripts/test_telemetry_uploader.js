// ========== FRONTEND TELEMETRY UPLOADER UNIT TEST SUITE (FASE ML2.1) ==========
// Validação de fila assíncrona, retry com backoff, tolerância a falhas, IndexedDB e limites

import { OnlineTelemetryUploader } from '../src/ml/telemetry/telemetryUploader.js';
import { createTelemetrySample } from '../src/ml/telemetry/telemetrySchema.js';
import { telemetryIndexedDB } from '../src/ml/telemetry/telemetryIndexedDB.js';

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

function createMockSample(sessionId, sampleIdx) {
  return createTelemetrySample({
    sessionId,
    sampleIndex: sampleIdx,
    timestamp: 1000 + sampleIdx * 100,
    trackId: 21,
    lapNumber: 1,
    driverType: 'PLAYER',
    participantId: 'p_uploader_test',
    trackProgress: 0.10,
    pathIndex: 30,
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
console.log('🚀 EXECUTANDO TESTES UNITÁRIOS DO TELEMETRY UPLOADER (ML2.1)');
console.log('====================================================\n');

async function runUploaderTests() {
  const originalFetch = globalThis.fetch;

  try {
    // ----------------------------------------------------
    // TESTE 1: Consentimento OFF por padrão -> 0 requisições
    // ----------------------------------------------------
    console.log('[TEST 1] Consent Gate (OFF by default):');
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return { ok: true, json: async () => ({}) };
    };

    const uploaderOff = new OnlineTelemetryUploader({ consentEnabled: false });
    assert(uploaderOff.consentEnabled === false, 'Consentimento inicia como false');

    await uploaderOff.initSession(21);
    uploaderOff.queueSample(createMockSample('sess_1', 0));
    assert(fetchCalled === false, 'Nenhuma chamada HTTP realizada quando consentEnabled = false');
    assert(uploaderOff.activeBuffer.length === 0, 'Buffer ativo permanece vazio com consent OFF');


    // ----------------------------------------------------
    // TESTE 2: Consentimento ON -> Criação de Sessão
    // ----------------------------------------------------
    console.log('\n[TEST 2] Session Initialization with Consent:');
    let sessionPayloadCaptured = null;
    globalThis.fetch = async (url, opts) => {
      if (url.endsWith('/sessions')) {
        sessionPayloadCaptured = JSON.parse(opts.body);
        return {
          ok: true,
          status: 201,
          json: async () => ({
            sessionId: 'sess_ml21_mock_123',
            ingestToken: 'eyJhbGciOiJIUzI1NiJ9.mock_token.mock_sig',
            refreshCredential: 'mock_refresh_credential',
            expiresAt: new Date(Date.now() + 14400000).toISOString()
          })
        };
      }
      return { ok: true, status: 200, json: async () => ({ status: 'PROCESSED' }) };
    };

    const uploader = new OnlineTelemetryUploader({ consentEnabled: true });
    const sId = await uploader.initSession(21);

    assert(sId === 'sess_ml21_mock_123', 'Retorna serverSessionId da API');
    assert(uploader.serverSessionId === 'sess_ml21_mock_123', 'serverSessionId armazenado no uploader');
    assert(sessionPayloadCaptured.schemaVersion === 2, 'Envia schemaVersion = 2');
    assert(sessionPayloadCaptured.client.gameBuildVersion === '0.2.0-ml2', 'Envia gameBuildVersion oficial');
    assert(sessionPayloadCaptured.client.trackGeometryVersion === '1.5.0-centripetal', 'Envia trackGeometryVersion oficial');


    // ----------------------------------------------------
    // TESTE 3: Batching (50 samples -> 1 batch selado e enviado)
    // ----------------------------------------------------
    console.log('\n[TEST 3] Batch Sealing at 50 Samples:');
    let uploadedBatchPayload = null;
    globalThis.fetch = async (url, opts) => {
      if (url.endsWith('/batches')) {
        uploadedBatchPayload = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'PROCESSED',
            sessionId: uploadedBatchPayload.sessionId,
            batchSequence: uploadedBatchPayload.batchSequence,
            sampleCount: uploadedBatchPayload.samples.length
          })
        };
      }
      return { ok: true, json: async () => ({}) };
    };

    for (let i = 0; i < 50; i++) {
      uploader.queueSample(createMockSample('sess_ml21_mock_123', i));
    }

    // Aguardar processamento assíncrono do microtask / worker
    await new Promise(r => setTimeout(r, 50));

    assert(uploadedBatchPayload !== null, 'Batch de 50 samples foi selado e enviado');
    assert(uploadedBatchPayload.batchSequence === 0, 'Primeiro batch possui batchSequence = 0');
    assert(uploadedBatchPayload.samples.length === 50, 'Batch contém exatamente 50 samples');
    assert(uploader.stats.acknowledgedBatches === 1, 'acknowledgedBatches incrementado para 1');
    assert(uploader.stats.uploadedSamples === 50, 'uploadedSamples incrementado para 50');


    // ----------------------------------------------------
    // TESTE 4: 100 Samples -> 2 Batches Consecutivos
    // ----------------------------------------------------
    console.log('\n[TEST 4] Multiple Batches (100 samples -> 2 batches):');
    const receivedSequences = [];
    globalThis.fetch = async (url, opts) => {
      if (url.endsWith('/batches')) {
        const body = JSON.parse(opts.body);
        receivedSequences.push(body.batchSequence);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'PROCESSED',
            batchSequence: body.batchSequence,
            sampleCount: body.samples.length
          })
        };
      }
      return { ok: true, json: async () => ({}) };
    };

    for (let i = 0; i < 100; i++) {
      uploader.queueSample(createMockSample('sess_ml21_mock_123', 50 + i));
    }

    await new Promise(r => setTimeout(r, 100));

    assert(receivedSequences.length === 2, '2 batches foram transmitidos');
    assert(receivedSequences[0] === 1 && receivedSequences[1] === 2, 'Sequências foram 1 e 2');
    assert(uploader.stats.acknowledgedBatches === 3, 'Total de batches confirmados é 3 (50 + 50 + 50 = 150 samples)');


    // ----------------------------------------------------
    // TESTE 5: Batch Parcial ao Finalizar Sessão (49 samples + complete)
    // ----------------------------------------------------
    console.log('\n[TEST 5] Partial Batch Flush on Session Completion:');
    let sessionCompletedCalled = false;
    let partialBatchReceived = null;

    globalThis.fetch = async (url, opts) => {
      if (url.endsWith('/batches')) {
        partialBatchReceived = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'PROCESSED', sampleCount: partialBatchReceived.samples.length })
        };
      }
      if (url.includes('/complete')) {
        sessionCompletedCalled = true;
        return { ok: true, status: 200, json: async () => ({ status: 'COMPLETED' }) };
      }
      return { ok: true, json: async () => ({}) };
    };

    for (let i = 0; i < 49; i++) {
      uploader.queueSample(createMockSample('sess_ml21_mock_123', 150 + i));
    }

    await uploader.endSession();

    assert(partialBatchReceived !== null, 'Batch parcial com <50 samples foi selado e enviado');
    assert(partialBatchReceived.samples.length === 49, 'Batch parcial continha exatamente 49 samples');
    assert(sessionCompletedCalled === true, 'POST /complete foi chamado após o envio do batch');


    // ----------------------------------------------------
    // TESTE 6: Retry com Exponential Backoff (HTTP 500 & Network Fail)
    // ----------------------------------------------------
    console.log('\n[TEST 6] Retry on Recoverable HTTP 500 / Network Errors:');
    const uploaderRetry = new OnlineTelemetryUploader({ consentEnabled: true });
    uploaderRetry.serverSessionId = 'sess_retry_test';
    uploaderRetry.ingestToken = 'mock_token';

    let attemptCount = 0;
    globalThis.fetch = async (url, opts) => {
      if (url.endsWith('/batches')) {
        attemptCount++;
        if (attemptCount === 1) {
          // 1ª tentativa: Falha de rede
          throw new TypeError('Failed to fetch (Network down)');
        }
        if (attemptCount === 2) {
          // 2ª tentativa: HTTP 500
          return {
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: async () => ({ error: 'DB_OVERLOAD' })
          };
        }
        // 3ª tentativa: Sucesso
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'PROCESSED' })
        };
      }
      return { ok: true, json: async () => ({}) };
    };

    const batch = uploaderRetry.sealActiveBuffer(); // vazio -> null
    for (let i = 0; i < 50; i++) {
      uploaderRetry.queueSample(createMockSample('sess_retry_test', i));
    }

    // 1ª tentativa ocorre imediatamente
    await new Promise(r => setTimeout(r, 50));
    assert(attemptCount >= 1, 'Primeira tentativa de envio realizada');
    assert(uploaderRetry.stats.retryCount >= 1, 'retryCount incrementado após erro');

    // Forçar aceleração do timer para o retry
    if (uploaderRetry.pendingQueue[0]) {
      uploaderRetry.pendingQueue[0].nextRetryAt = Date.now() - 10;
      uploaderRetry.processQueue();
    }
    await new Promise(r => setTimeout(r, 50));

    if (uploaderRetry.pendingQueue[0]) {
      uploaderRetry.pendingQueue[0].nextRetryAt = Date.now() - 10;
      uploaderRetry.processQueue();
    }
    await new Promise(r => setTimeout(r, 50));

    assert(attemptCount === 3, 'Batch foi reenviado com sucesso na 3ª tentativa');
    assert(uploaderRetry.stats.acknowledgedBatches === 1, 'Batch finalmente confirmado após retries');


    // ----------------------------------------------------
    // TESTE 7: Não-Retry Infinito para Erros 400 Não-Recuperáveis
    // ----------------------------------------------------
    console.log('\n[TEST 7] Non-Recoverable Errors (HTTP 400 Bad Request):');
    const uploader400 = new OnlineTelemetryUploader({ consentEnabled: true });
    uploader400.serverSessionId = 'sess_bad_req';
    uploader400.ingestToken = 'mock_token';

    let calls400 = 0;
    globalThis.fetch = async (url) => {
      if (url.endsWith('/batches')) {
        calls400++;
        return {
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: async () => ({ error: 'INVALID_SCHEMA_VERSION' })
        };
      }
      return { ok: true, json: async () => ({}) };
    };

    for (let i = 0; i < 50; i++) {
      uploader400.queueSample(createMockSample('sess_bad_req', i));
    }

    await new Promise(r => setTimeout(r, 50));

    assert(calls400 === 1, 'Erro 400 não disparou retry infinito (apenas 1 chamada)');
    assert(uploader400.pendingQueue.length === 0, 'Batch 400 foi descartado da fila');
    assert(uploader400.stats.droppedBatches === 1, 'droppedBatches contabilizou o descarte do batch');


    // ----------------------------------------------------
    // TESTE 8: Renovação de Token Expirado (401 Unauthorized)
    // ----------------------------------------------------
    console.log('\n[TEST 8] Expired Token Recovery (401 -> Refresh Token):');
    const uploader401 = new OnlineTelemetryUploader({ consentEnabled: true });
    uploader401.serverSessionId = 'sess_401_test';
    uploader401.ingestToken = 'old_expired_token';
    uploader401.refreshCredential = 'valid_refresh_credential';

    let tokenRefreshCalled = false;
    let batch401Attempts = 0;

    globalThis.fetch = async (url, opts) => {
      if (url.includes('/refresh-token')) {
        tokenRefreshCalled = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ingestToken: 'new_fresh_token_123',
            expiresAt: new Date(Date.now() + 14400000).toISOString()
          })
        };
      }
      if (url.endsWith('/batches')) {
        batch401Attempts++;
        const auth = opts.headers['Authorization'];
        if (auth.includes('old_expired_token')) {
          return {
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            json: async () => ({ error: 'TOKEN_EXPIRED' })
          };
        }
        // Aceita novo token
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'PROCESSED' })
        };
      }
      return { ok: true, json: async () => ({}) };
    };

    for (let i = 0; i < 50; i++) {
      uploader401.queueSample(createMockSample('sess_401_test', i));
    }

    await new Promise(r => setTimeout(r, 50));
    assert(tokenRefreshCalled === true, 'POST /refresh-token foi chamado automaticamente ao receber 401');
    assert(uploader401.ingestToken === 'new_fresh_token_123', 'ingestToken atualizado com sucesso');

    // Executar retry com o novo token
    if (uploader401.pendingQueue[0]) {
      uploader401.pendingQueue[0].nextRetryAt = Date.now() - 10;
      uploader401.processQueue();
    }
    await new Promise(r => setTimeout(r, 50));

    assert(batch401Attempts === 2, 'Batch foi reenviado e aceito com o novo token');
    assert(uploader401.stats.acknowledgedBatches === 1, 'Batch homologado com sucesso');


    // ----------------------------------------------------
    // TESTE 9: Política de Descarte por Limite de Fila (FIFO Drop)
    // ----------------------------------------------------
    console.log('\n[TEST 9] Queue Limit & FIFO Drop Policy:');
    const uploaderLimit = new OnlineTelemetryUploader({
      consentEnabled: true,
      maxPendingBatches: 3 // Limite de 3 batches
    });
    uploaderLimit.serverSessionId = 'sess_limit';
    uploaderLimit.ingestToken = 'mock_token';

    // Simular rede bloqueada para acumular fila
    globalThis.fetch = async () => {
      throw new Error('Network offline');
    };

    // Gerar 5 batches (250 samples)
    for (let b = 0; b < 5; b++) {
      for (let s = 0; s < 50; s++) {
        uploaderLimit.activeBuffer.push(createMockSample('sess_limit', b * 50 + s));
      }
      uploaderLimit.sealActiveBuffer();
    }

    assert(uploaderLimit.pendingQueue.length === 3, 'Tamanho da fila limitado estritamente a maxPendingBatches = 3');
    assert(uploaderLimit.stats.droppedBatches === 2, 'Exatamente 2 batches mais antigos foram descartados');
    assert(uploaderLimit.stats.droppedSamples === 100, 'Exatamente 100 samples descartados contabilizados');
    assert(uploaderLimit.pendingQueue[0].batchSequence === 2, 'Primeiro batch restante na fila é o sequence #2 (0 e 1 foram descartados)');


    // ----------------------------------------------------
    // TESTE 10: Persistência IndexedDB e Restauração
    // ----------------------------------------------------
    console.log('\n[TEST 10] IndexedDB Persistence & Recovery:');
    await telemetryIndexedDB.clearAll();

    const sampleBatch = {
      sessionId: 'sess_idb_test',
      batchSequence: 0,
      samples: [createMockSample('sess_idb_test', 0)],
      createdAt: Date.now()
    };

    await telemetryIndexedDB.saveBatch(sampleBatch);
    const countBefore = await telemetryIndexedDB.getCount();
    assert(countBefore === 1, 'Batch salvo com sucesso no IndexedDB (count = 1)');

    const uploaderRestore = new OnlineTelemetryUploader({ consentEnabled: true, autoRestore: false });
    await uploaderRestore.restorePendingFromIndexedDB();

    assert(uploaderRestore.pendingQueue.length === 1, 'Exatamente 1 batch pendente restaurado para a pendingQueue');
    assert(uploaderRestore.pendingQueue[0].sessionId === 'sess_idb_test', 'sessionId do batch restaurado coincide');

    // Confirmar remoção no ACK
    await telemetryIndexedDB.removeBatch('sess_idb_test', 0);
    const countAfter = await telemetryIndexedDB.getCount();
    assert(countAfter === 0, 'Batch removido do IndexedDB após confirmação (count = 0)');


    // ----------------------------------------------------
    // TESTE 11: getStats() sem Exposição de Segredos
    // ----------------------------------------------------
    console.log('\n[TEST 11] Public Telemetry Statistics Sanitization:');
    const stats = uploader.getStats();
    assert(stats.consentEnabled === true, 'stats.consentEnabled reportado corretamente');
    assert(typeof stats.apiUrl === 'string', 'stats.apiUrl presente');
    assert(typeof stats.activeBufferSamples === 'number', 'stats.activeBufferSamples presente');
    assert(typeof stats.acknowledgedBatches === 'number', 'stats.acknowledgedBatches presente');
    assert(stats.ingestToken === undefined, 'ingestToken NUNCA é exposto em getStats()');

  } catch (err) {
    console.error('❌ Erro inesperado nos testes do uploader:', err);
    failed++;
  } finally {
    globalThis.fetch = originalFetch;

    console.log('\n====================================================');
    console.log(`📊 RESULTADO DOS TESTES DO UPLOADER: ${passed} PASSOU | ${failed} FALHOU`);
    console.log('====================================================\n');

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

runUploaderTests();
