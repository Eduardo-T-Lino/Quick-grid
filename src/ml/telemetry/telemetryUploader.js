// ========== ONLINE TELEMETRY UPLOADER (FASE ML2.1) ==========
// Fila assíncrona desacoplada, persistência IndexedDB, exponential backoff com jitter e resiliência offline

import { TELEMETRY_VERSIONS } from '../../constants.js';
import { telemetryIndexedDB } from './telemetryIndexedDB.js';
import { telemetryPerformance } from './performanceMetrics.js';

export class OnlineTelemetryUploader {
  constructor(options = {}) {
    // Configuração de endpoint com suporte a Vite env
    const defaultApi = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_TELEMETRY_API_URL)
      ? import.meta.env.VITE_TELEMETRY_API_URL
      : (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
          ? 'http://localhost:3001'
          : '');

    this.baseUrl = options.baseUrl || `${defaultApi}/api/v1/telemetry`;
    const isLocalBrowser = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
    const deployEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_DEPLOY_ENV : null;
    this.deploymentAllowed = options.deploymentAllowed ?? (typeof window === 'undefined' || isLocalBrowser || deployEnv === 'production');
    this.consentEnabled = Boolean(options.consentEnabled) && this.deploymentAllowed;
    this.batchSize = options.batchSize || 50;              // 50 samples (~5s @ 10Hz)
    this.maxPendingBatches = options.maxPendingBatches || 50; // Limite de 50 batches (~2500 samples / ~250s)
    this.maxInFlight = options.maxInFlight || 2;           // Máximo de 2 requisições HTTP concorrentes
    this.requestTimeoutMs = options.requestTimeoutMs || 8000; // Timeout de 8 segundos por request
    this.completionDrainTimeoutMs = options.completionDrainTimeoutMs || 3000;

    // Sessão Online
    this.serverSessionId = null;
    this.ingestToken = null;
    this.refreshCredential = null;
    this.expiresAt = null;
    this.sessionStatus = 'IDLE'; // IDLE, ACTIVE, COMPLETED, ERROR
    this.currentTrackId = null;
    this.nextBatchSequence = 0;

    // Buffers e Fila
    this.activeBuffer = [];     // Amostras ativas ainda não seladas em batch
    this.pendingQueue = [];      // Batches selados aguardando confirmação (FIFO)
    this.inFlightCount = 0;
    this.workerRunning = false;
    this.isFlushing = false;
    this.pendingCompletionStats = null;
    this.pendingLaps = [];
    this.flushingLaps = false;
    this.endSessionRunning = false;
    this.timers = new Set();
    this.controllers = new Set();
    this.disposed = false;
    this.consentEpoch = 0;
    this.initializing = null;
    this.retryTimer = null;
    this.sessionInitRetryAt = 0;

    // Métricas e Estatísticas
    this.stats = {
      sentBatches: 0,
      acknowledgedBatches: 0,
      uploadedSamples: 0,
      retryCount: 0,
      droppedBatches: 0,
      droppedSamples: 0,
      idempotentDuplicates: 0,
      lastError: null,
      totalLatencyMs: 0,
      latencyCount: 0
    };

    // Registrar listeners de ciclo de vida do browser
    if (typeof window !== 'undefined') {
      this.onPageHide = () => this.handlePageUnload();
      this.onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') {
          this.sealActiveBuffer();
        }
      };
      window.addEventListener('pagehide', this.onPageHide);
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }

    // Inicializar restauração do IndexedDB (se autoRestore não for false)
    this.ready = options.autoRestore !== false
      ? this.restorePendingFromIndexedDB().catch(err => {
        console.warn('[ML-UPLOADER] Erro ao restaurar fila do IndexedDB:', err);
      }) : Promise.resolve();
  }

  schedule(callback, delay) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.disposed) callback();
    }, delay);
    this.timers.add(timer);
    return timer;
  }

  cancelWork() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.retryTimer = null;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.workerRunning = false;
  }

  dispose() {
    this.disposed = true;
    this.cancelWork();
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.onPageHide);
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  async request(url, options) {
    if (!this.consentEnabled || this.disposed) throw new Error('UPLOAD_DISABLED');
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = this.schedule(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      // Consume real HTTP bodies while timeout/opt-out cancellation still applies.
      // Tests may supply lightweight response doubles without text().
      if (typeof response.text !== 'function') return response;
      const body = await response.text();
      return { ok: response.ok, status: response.status, statusText: response.statusText,
        json: async () => body ? JSON.parse(body) : {} };
    } finally {
      clearTimeout(timer);
      this.timers.delete(timer);
      this.controllers.delete(controller);
    }
  }

  /**
   * Restaura batches pendentes gravados no IndexedDB após recarregamento de página
   */
  async restorePendingFromIndexedDB() {
    const epoch = this.consentEpoch;
    try {
      const persisted = await telemetryIndexedDB.getAllPendingBatches();
      const sessions = await telemetryIndexedDB.getAllSessionCredentials();
      if (epoch !== this.consentEpoch || this.disposed) return;
      if (persisted.length > 0 || sessions.length > 0) {
        console.log(`[ML-UPLOADER] Restaurando ${persisted.length} batches pendentes do IndexedDB...`);
        for (const item of persisted) {
          if (!this.pendingQueue.some(b => b.sessionId === item.sessionId && b.batchSequence === item.batchSequence)) {
            this.pendingQueue.push({
              sessionId: item.sessionId,
              batchSequence: item.batchSequence,
              samples: item.samples,
              createdAt: item.createdAt,
              retryCount: item.retryCount || 0,
              nextRetryAt: 0
            });
          }
        }
        const sessionIds = [...new Set([...persisted.map(item => item.sessionId), ...sessions.map(s => s.serverSessionId)].filter(id => id && id !== 'pending_session'))];
        if (sessionIds.length > 0) {
          const credentials = await telemetryIndexedDB.getSessionCredentials(sessionIds[0]);
          if (epoch !== this.consentEpoch || this.disposed) return;
          if (credentials) {
            this.serverSessionId = credentials.serverSessionId;
            this.ingestToken = credentials.ingestToken;
            this.refreshCredential = credentials.refreshCredential;
            this.expiresAt = credentials.expiresAt;
            this.currentTrackId = credentials.currentTrackId;
            // A reload ends the old race. Drain its data and close it before a new race.
            this.pendingCompletionStats = credentials.pendingCompletionStats || {};
            this.pendingLaps = credentials.pendingLaps || [];
            this.sessionStatus = 'ACTIVE';
            this.nextBatchSequence = Math.max(credentials.nextBatchSequence || 0, ...persisted.map(b => b.batchSequence + 1));
          }
        }
        this.triggerQueueWorker();
        if (this.consentEnabled && this.pendingCompletionStats) this.schedule(() => this.endSession(this.pendingCompletionStats), 0);
      }
    } catch (err) {
      console.warn('[ML-UPLOADER] Falha na restauração do IndexedDB:', err);
    }
  }

  /**
   * Ativa ou desativa consentimento online
   */
  async setConsent(enabled) {
    if (!enabled) this.consentEpoch++;
    this.consentEnabled = Boolean(enabled) && this.deploymentAllowed;
    console.log(`[ML-UPLOADER] Online Telemetry Consent: ${this.consentEnabled ? 'ATIVADO (Opt-in)' : 'DESATIVADO'}`);
    if (this.consentEnabled && this.pendingQueue.length > 0) {
      this.triggerQueueWorker();
    } else if (!this.consentEnabled) {
      this.cancelWork();
      this.activeBuffer = [];
      this.pendingQueue = [];
      this.serverSessionId = null;
      this.ingestToken = null;
      this.refreshCredential = null;
      this.sessionStatus = 'IDLE';
      this.pendingCompletionStats = null;
      this.pendingLaps = [];
      this.nextBatchSequence = 0;
      this.expiresAt = null;
      this.currentTrackId = null;
      this.endSessionRunning = false;
      await telemetryIndexedDB.clearAll();
    }
    if (this.consentEnabled && this.pendingCompletionStats) this.schedule(() => this.endSession(this.pendingCompletionStats), 0);
    return this.consentEnabled;
  }

  persistSession() {
    if (!this.serverSessionId || !this.consentEnabled || this.disposed) return Promise.resolve();
    return telemetryIndexedDB.saveSessionCredentials({
      serverSessionId: this.serverSessionId,
      ingestToken: this.ingestToken,
      refreshCredential: this.refreshCredential,
      expiresAt: this.expiresAt,
      nextBatchSequence: this.nextBatchSequence,
      currentTrackId: this.currentTrackId,
      pendingCompletionStats: this.pendingCompletionStats,
      pendingLaps: structuredClone(this.pendingLaps),
      status: this.sessionStatus
    });
  }

  /**
   * Inicia sessão online no backend
   */
  async beginRace(trackId, options = {}) {
    await this.ready;
    if (!this.serverSessionId && this.pendingCompletionStats && this.pendingQueue.length) {
      await this.initSession(this.currentTrackId || trackId);
      if (!this.serverSessionId) return null;
    }
    if (this.serverSessionId) await this.endSession(this.pendingCompletionStats || {});
    if (this.serverSessionId || this.pendingQueue.some(b => b.sessionId !== 'pending_session')) {
      this.stats.lastError = 'Previous race recovery pending; online collection paused for this race';
      return null;
    }
    options.onCollectionReady?.();
    return this.initSession(trackId, options);
  }

  async initSession(trackId = 21, options = {}) {
    await this.ready;
    if (!this.consentEnabled || this.disposed || Date.now() < this.sessionInitRetryAt) {
      return null;
    }
    if (this.initializing) return this.initializing;
    if (this.serverSessionId && this.currentTrackId === trackId) return this.serverSessionId;
    this.initializing = this.createSession(trackId, options);
    try { return await this.initializing; } finally { this.initializing = null; }
  }

  async createSession(trackId, options) {
    const epoch = this.consentEpoch;

    // Se já houver sessão ativa para outra pista, encerrar anterior
    if (this.serverSessionId && this.currentTrackId !== trackId) {
      await this.endSession();
      if (this.serverSessionId) return null; // Do not replace a session with outstanding data.
    }

    this.currentTrackId = Math.floor(trackId);

    try {
      const payload = {
        schemaVersion: TELEMETRY_VERSIONS.SCHEMA_VERSION,
        trackId: this.currentTrackId,
        sampleRateHz: options.sampleRateHz || 10,
        scope: options.scope || 'PLAYER_ONLY',
        client: {
          gameBuildVersion: TELEMETRY_VERSIONS.GAME_BUILD_VERSION,
          trackGeometryVersion: TELEMETRY_VERSIONS.TRACK_GEOMETRY_VERSION,
          physicsVersion: TELEMETRY_VERSIONS.PHYSICS_VERSION,
          featureManifestVersion: TELEMETRY_VERSIONS.FEATURE_MANIFEST_VERSION
        },
        consentVersion: TELEMETRY_VERSIONS.CONSENT_VERSION
      };

      const res = await this.request(`${this.baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        this.sessionInitRetryAt = Date.now() + 5000;
        const errData = await res.json().catch(() => ({}));
        this.stats.lastError = `Init Session Failed (${res.status}): ${JSON.stringify(errData)}`;
        console.warn('[ML-UPLOADER]', this.stats.lastError);
        return null;
      }

      const data = await res.json();
      if (!this.consentEnabled || epoch !== this.consentEpoch || this.disposed) return null;
      this.serverSessionId = data.sessionId;
      this.ingestToken = data.ingestToken;
      this.refreshCredential = data.refreshCredential;
      this.expiresAt = data.expiresAt;
      this.sessionStatus = 'ACTIVE';
      this.stats.sentBatches = 0;
      this.stats.acknowledgedBatches = 0;
      this.stats.uploadedSamples = 0;
      this.stats.idempotentDuplicates = 0;
      this.stats.totalLatencyMs = 0;
      this.stats.latencyCount = 0;
      // Keep samples and reserved sequences collected while POST /sessions was pending.

      await this.persistSession();

      console.log(`[ML-UPLOADER] Sessão online iniciada: ${this.serverSessionId} (Pista #${this.currentTrackId})`);
      this.flushLaps();
      this.triggerQueueWorker();
      if (this.pendingCompletionStats) this.schedule(() => this.endSession(this.pendingCompletionStats), 0);
      return this.serverSessionId;
    } catch (err) {
      this.sessionInitRetryAt = Date.now() + 5000;
      this.stats.lastError = `Init Session Exception: ${err.message}`;
      console.warn('[ML-UPLOADER] Falha ao conectar ao backend (gameplay prossegue normal):', err.message);
      return null;
    }
  }

  /**
   * Recebe sample do TelemetryCollector (Non-blocking: entrega por referência sem await)
   */
  queueSample(sample) {
    if (!this.consentEnabled || this.disposed || this.pendingCompletionStats) return;

    // Se ainda não tem sessão criada, disparar criação em segundo plano
    if (!this.serverSessionId && this.sessionStatus !== 'ACTIVE') {
      const trackId = sample?.metadata?.trackId || this.currentTrackId || 21;
      this.initSession(trackId);
    }

    this.activeBuffer.push(sample);

    // Quando buffer ativo atinge batchSize (50), selar batch e enfileirar
    if (this.activeBuffer.length >= this.batchSize) {
      this.sealActiveBuffer();
    }
  }

  /**
   * Fecha o activeBuffer atual e move para pendingQueue + IndexedDB
   */
  sealActiveBuffer() {
    if (!this.consentEnabled || this.disposed || this.activeBuffer.length === 0) return null;

    const samples = this.activeBuffer;
    this.activeBuffer = [];

    const sessionId = this.serverSessionId || 'pending_session';
    const batchSequence = this.nextBatchSequence++;

    const sealedBatch = {
      sessionId,
      batchSequence,
      samples,
      createdAt: Date.now(),
      retryCount: 0,
      nextRetryAt: 0
    };

    // Aplicar limite de fila (descartar mais antigo se exceder)
    if (this.pendingQueue.length >= this.maxPendingBatches) {
      const dropIndex = this.pendingQueue.findIndex(b => !b.inFlight);
      const dropped = dropIndex >= 0 ? this.pendingQueue.splice(dropIndex, 1)[0] : sealedBatch;
      this.stats.droppedBatches++;
      this.stats.droppedSamples += dropped.samples.length;
      telemetryIndexedDB.removeBatch(dropped.sessionId, dropped.batchSequence).catch(() => {});
      console.warn(`[ML-UPLOADER] Fila cheia (${this.maxPendingBatches}). Batch #${dropped.batchSequence} descartado.`);
      if (dropped === sealedBatch) return null;
    }

    this.pendingQueue.push(sealedBatch);

    // Persistir no IndexedDB
    sealedBatch.persisted = telemetryIndexedDB.saveBatch(sealedBatch).catch(err => {
      console.warn('[ML-UPLOADER] Falha ao salvar no IndexedDB:', err);
    });
    if (this.serverSessionId) {
      this.persistSession().catch(() => {});
    }

    this.triggerQueueWorker();
    return sealedBatch;
  }

  /**
   * Dispara o processamento assíncrono da fila de envio
   */
  triggerQueueWorker() {
    if (this.workerRunning || this.disposed) return;
    this.workerRunning = true;
    this.schedule(() => this.processQueue(), 0);
  }

  /**
   * Processador da fila de batches com controle de concorrência e exponential backoff
   */
  async processQueue() {
    if (!this.consentEnabled || this.disposed) {
      this.workerRunning = false;
      return;
    }

    const now = Date.now();

    // Selecionar batches prontos para envio respeitando maxInFlight
    while (this.inFlightCount < this.maxInFlight) {
      const nextBatch = this.pendingQueue.find(b => !b.inFlight && (b.nextRetryAt || 0) <= now);
      if (!nextBatch) break;

      nextBatch.inFlight = true;
      this.inFlightCount++;

      this.uploadSingleBatch(nextBatch).finally(() => {
        nextBatch.inFlight = false;
        this.inFlightCount--;
        // Continuar drenando a fila
        this.processQueue();
      });
    }

    // Verificar se há itens aguardando backoff futuro
    const upcomingBatch = this.pendingQueue.find(b => !b.inFlight && (b.nextRetryAt || 0) > now);
    if (upcomingBatch) {
      const delay = Math.max(50, upcomingBatch.nextRetryAt - now);
      if (this.retryTimer) { clearTimeout(this.retryTimer); this.timers.delete(this.retryTimer); }
      this.retryTimer = this.schedule(() => this.processQueue(), delay);
    }

    if (this.inFlightCount === 0 && !upcomingBatch) {
      this.workerRunning = false;
    }
  }

  /**
   * Envio assíncrono de um único batch
   */
  async uploadSingleBatch(batch) {
    const epoch = this.consentEpoch;
    await batch.persisted;
    if (!this.consentEnabled || this.disposed || epoch !== this.consentEpoch) return;
    if (!this.serverSessionId) await this.initSession(batch.samples[0]?.metadata?.trackId || this.currentTrackId || 21);
    if (!this.consentEnabled || this.disposed || epoch !== this.consentEpoch) return;
    if (batch.sessionId !== 'pending_session' && this.serverSessionId && batch.sessionId !== this.serverSessionId) {
      this.scheduleRetry(batch, 30000, 'Waiting for the original session authority');
      return; // Never send another session's batch with the current token.
    }
    // Se o batch foi gerado antes de termos o sessionId oficial, associar agora
    if (batch.sessionId === 'pending_session' && this.serverSessionId) {
      const previousId = batch.sessionId;
      batch.sessionId = this.serverSessionId;
      await telemetryIndexedDB.saveBatch(batch);
      await telemetryIndexedDB.removeBatch(previousId, batch.batchSequence);
    }

    // Se não temos token válido, tentar inicializar ou renovar
    if (!this.ingestToken && this.serverSessionId) {
      await this.refreshIngestToken();
    }

    if (!this.ingestToken) {
      // Sem token disponível, agendar retry breve
      this.scheduleRetry(batch, 2000, 'Sem ingestToken disponível');
      return;
    }

    const payload = {
      sessionId: batch.sessionId,
      batchSequence: batch.batchSequence,
      samples: batch.samples
    };

    const mainThreadStart = performance.now();
    const payloadBody = JSON.stringify(payload);
    const payloadBytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(payloadBody).byteLength : payloadBody.length;
    telemetryPerformance.recordUploadMain(performance.now() - mainThreadStart, payloadBytes);

    const startTime = performance.now();
    this.stats.sentBatches++;

    try {
      const res = await this.request(`${this.baseUrl}/batches`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.ingestToken}`
        },
        body: payloadBody
      });
      if (!this.consentEnabled || epoch !== this.consentEpoch || this.disposed) return;

      const latencyMs = performance.now() - startTime;
      telemetryPerformance.recordNetwork(latencyMs);
      this.stats.totalLatencyMs += latencyMs;
      this.stats.latencyCount++;

      if (res.ok) {
        const resp = await res.json();
        await this.handleSuccessAck(batch, resp);
      } else {
        await this.handleHttpError(batch, res);
      }
    } catch (err) {
      if (!this.consentEnabled || this.disposed || epoch !== this.consentEpoch) return;
      // Erro de rede ou Timeout (AbortError) -> Erro Recuperável
      const isTimeout = err.name === 'AbortError';
      const reason = isTimeout ? 'Request Timeout (8s)' : `Network Error: ${err.message}`;
      this.scheduleRetry(batch, null, reason);
    }
  }

  /**
   * Trata resposta bem-sucedida (ACK: PROCESSED ou ALREADY_PROCESSED)
   */
  async handleSuccessAck(batch, response) {
    this.stats.acknowledgedBatches++;
    this.stats.uploadedSamples += batch.samples.length;
    if (response.status === 'ALREADY_PROCESSED') {
      this.stats.idempotentDuplicates++;
    }

    // Remover da memória e do IndexedDB
    const idx = this.pendingQueue.indexOf(batch);
    if (idx !== -1) {
      this.pendingQueue.splice(idx, 1);
    }

    await telemetryIndexedDB.removeBatch(batch.sessionId, batch.batchSequence);
    if (this.pendingCompletionStats && this.pendingQueue.length === 0 && !this.endSessionRunning) {
      const stats = this.pendingCompletionStats;
      this.schedule(() => this.endSession(stats), 0);
    }
  }

  /**
   * Classifica e trata erros HTTP
   */
  async handleHttpError(batch, response) {
    const status = response.status;
    let errBody = {};
    try {
      errBody = await response.json();
    } catch {}

    const errMsg = `HTTP ${status}: ${errBody.message || errBody.error || response.statusText}`;
    this.stats.lastError = errMsg;

    // 1. Erros Recuperáveis (408, 429, 500, 502, 503, 504) -> Retry com Backoff
    if (status === 408 || status === 429 || status >= 500) {
      this.scheduleRetry(batch, status === 429 ? 10000 : null, errMsg);
      return;
    }

    // 2. Token expirado / não autorizado (401) -> Tentar renovar token uma vez
    if (status === 401) {
      console.warn('[ML-UPLOADER] 401 Unauthorized recebido. Tentando refresh do ingestToken...');
      const refreshed = await this.refreshIngestToken();
      if (refreshed) {
        this.scheduleRetry(batch, 500, 'Token renovado');
        return;
      }
      this.scheduleRetry(batch, 10000, 'Authorization recovery pending');
      return;
    }

    // 3. Erros Não-Recuperáveis (400 Schema Inválido, 403, 404, 413 Payload Excessivo)
    console.error(`[ML-UPLOADER] Erro não-recuperável no Batch #${batch.batchSequence} (${errMsg}). Descartando da fila.`);
    const idx = this.pendingQueue.indexOf(batch);
    if (idx !== -1) {
      this.pendingQueue.splice(idx, 1);
    }
    this.stats.droppedBatches++;
    this.stats.droppedSamples += batch.samples.length;
    telemetryIndexedDB.removeBatch(batch.sessionId, batch.batchSequence).catch(() => {});
  }

  /**
   * Agenda retentativa com Exponential Backoff e Jitter
   */
  scheduleRetry(batch, forcedDelayMs = null, reason = '') {
    this.stats.retryCount++;
    batch.retryCount = (batch.retryCount || 0) + 1;

    let delayMs = forcedDelayMs;
    if (!delayMs) {
      // Backoff: 1s, 2s, 4s, 8s, 16s, cap 30s + Jitter aleatório (0 a 500ms)
      const baseDelay = Math.min(30000, 1000 * Math.pow(2, Math.min(batch.retryCount - 1, 5)));
      const jitter = Math.floor(Math.random() * 500);
      delayMs = baseDelay + jitter;
    }

    batch.nextRetryAt = Date.now() + delayMs;
    console.warn(`[ML-UPLOADER] Retry #${batch.retryCount} para Batch #${batch.batchSequence} em ${(delayMs/1000).toFixed(1)}s (${reason})`);
  }

  /**
   * Tenta renovar o token de ingestão para a sessão ativa
   */
  async refreshIngestToken() {
    if (!this.serverSessionId || !this.refreshCredential) return false;
    const epoch = this.consentEpoch;

    try {
      const res = await this.request(`${this.baseUrl}/sessions/${this.serverSessionId}/refresh-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-refresh-credential': this.refreshCredential
        }
      });

      if (res.ok) {
        const data = await res.json();
        if (epoch !== this.consentEpoch || !this.consentEnabled || this.disposed) return false;
        this.ingestToken = data.ingestToken;
        this.expiresAt = data.expiresAt;
        await this.persistSession();
        console.log(`[ML-UPLOADER] IngestToken renovado com sucesso (expira em ${this.expiresAt})`);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Registra o resumo de uma volta completada com retry assíncrono
   */
  async recordLap(lapSummary) {
    if (!this.consentEnabled || this.disposed) return;
    if (!this.pendingLaps.some(l => l.participantId === lapSummary.participantId && l.lapNumber === lapSummary.lapNumber)) {
      this.pendingLaps.push(lapSummary);
    }
    await this.persistSession();
    await this.flushLaps();
  }

  async flushLaps() {
    if (this.flushingLaps || !this.serverSessionId || !this.consentEnabled || this.disposed) return;
    this.flushingLaps = true;
    try {
      while (this.pendingLaps.length && this.consentEnabled && !this.disposed) {
        const lap = this.pendingLaps[0];
        const options = () => ({ method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.ingestToken}` },
          body: JSON.stringify({ ...lap, sessionId: this.serverSessionId }) });
        let res = await this.request(`${this.baseUrl}/laps`, options());
        if (res.status === 401 && await this.refreshIngestToken()) res = await this.request(`${this.baseUrl}/laps`, options());
        if (!res.ok) throw new Error(`LAP_HTTP_${res.status}`);
        this.pendingLaps.shift();
        await this.persistSession();
      }
    } catch {
      if (this.consentEnabled && !this.disposed) this.schedule(() => this.flushLaps(), 5000);
    } finally {
      this.flushingLaps = false;
    }
  }

  /**
   * Trata descarregamento da página (pagehide / unload)
   */
  handlePageUnload() {
    this.sealActiveBuffer();
    // IndexedDB mantém os batches armazenados para envio no próximo carregamento
  }

  /**
   * Finaliza sessão online: sela buffer ativo, aguarda drenagem da fila com limite de tempo e envia complete
   */
  async endSession(completionStats = {}) {
    if (!this.consentEnabled || this.disposed) return;
    if (!this.serverSessionId) {
      this.pendingCompletionStats = completionStats;
      this.sealActiveBuffer();
      return { completed: false, pendingBatches: this.pendingQueue.length };
    }
    if (this.endSessionRunning) return { completed: false, pendingBatches: this.pendingQueue.length };
    this.endSessionRunning = true;

    const sessionId = this.serverSessionId;
    const epoch = this.consentEpoch;
    this.pendingCompletionStats = completionStats;
    await this.persistSession();

    // 1. Selar buffer restante
    this.sealActiveBuffer();
    await this.flushLaps();

    // 2. Tentar drenar fila com timeout de até 3 segundos
    const maxWaitMs = this.completionDrainTimeoutMs;
    const startWait = Date.now();
    while (this.pendingQueue.length > 0 && Date.now() - startWait < maxWaitMs) {
      this.triggerQueueWorker();
      await new Promise(r => setTimeout(r, Math.min(50, maxWaitMs)));
      if (!this.consentEnabled || this.disposed || epoch !== this.consentEpoch) { this.endSessionRunning = false; return { completed: false }; }
    }

    // 3. Nunca completar enquanto houver batches sem ACK. A fila permanece recuperável.
    if (this.pendingQueue.length > 0 || this.inFlightCount > 0 || this.pendingLaps.length > 0 || this.flushingLaps) {
      this.sessionStatus = 'FINALIZATION_PENDING';
      this.endSessionRunning = false;
      await this.persistSession();
      if (this.pendingLaps.length) this.schedule(() => this.endSession(completionStats), 5000);
      return { completed: false, pendingBatches: this.pendingQueue.length };
    }

    // 4. Chamar POST /sessions/:id/complete
    try {
      if (this.expiresAt && Date.parse(this.expiresAt) <= Date.now()) await this.refreshIngestToken();
      const complete = () => this.request(`${this.baseUrl}/sessions/${sessionId}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.ingestToken}`
        },
        body: JSON.stringify(completionStats)
      });
      let res = await complete();
      if (res.status === 401 && await this.refreshIngestToken()) res = await complete();
      if (!this.consentEnabled || this.disposed || epoch !== this.consentEpoch) { this.endSessionRunning = false; return { completed: false }; }
      if (!res.ok) throw new Error(`Complete falhou com HTTP ${res.status}`);
      console.log(`[ML-UPLOADER] Sessão ${sessionId} finalizada como COMPLETED.`);
      await telemetryIndexedDB.removeSessionCredentials(sessionId);
      this.serverSessionId = null;
      this.ingestToken = null;
      this.refreshCredential = null;
      this.expiresAt = null;
      this.nextBatchSequence = 0;
      this.currentTrackId = null;
      this.pendingCompletionStats = null;
      this.sessionStatus = 'COMPLETED';
      this.endSessionRunning = false;
      return { completed: true, pendingBatches: 0 };
    } catch (err) {
      if (!this.consentEnabled || this.disposed || epoch !== this.consentEpoch) { this.endSessionRunning = false; return { completed: false }; }
      console.warn('[ML-UPLOADER] Erro ao finalizar sessão no backend:', err.message);
      this.sessionStatus = 'FINALIZATION_PENDING';
      this.endSessionRunning = false;
      await this.persistSession();
      if (this.consentEnabled && !this.disposed) this.schedule(() => this.endSession(completionStats), 5000);
      return { completed: false, pendingBatches: this.pendingQueue.length };
    }
  }

  /**
   * Retorna estatísticas públicas do uploader (sem expor segredos/tokens)
   */
  getStats() {
    const avgLatency = this.stats.latencyCount > 0
      ? Math.round(this.stats.totalLatencyMs / this.stats.latencyCount)
      : 0;

    return {
      consentEnabled: this.consentEnabled,
      apiUrl: this.baseUrl,
      sessionStatus: this.sessionStatus,
      serverSessionId: this.serverSessionId,
      activeBufferSamples: this.activeBuffer.length,
      pendingBatches: this.pendingQueue.length,
      persistedBatches: this.pendingQueue.length,
      persistedBatchesIsEstimate: true,
      inFlightRequests: this.inFlightCount,
      sentBatches: this.stats.sentBatches,
      acknowledgedBatches: this.stats.acknowledgedBatches,
      retryCount: this.stats.retryCount,
      droppedBatches: this.stats.droppedBatches,
      droppedSamples: this.stats.droppedSamples,
      uploadedSamples: this.stats.uploadedSamples,
      idempotentDuplicates: this.stats.idempotentDuplicates,
      lastError: this.stats.lastError,
      averageUploadLatencyMs: avgLatency
    };
  }
}

export const onlineUploader = new OnlineTelemetryUploader();
