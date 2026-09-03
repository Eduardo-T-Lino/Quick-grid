// ========== ML TELEMETRY SESSION & BUFFER MANAGEMENT ==========
// Gerencia a sessão ativa de coleta, controle de limites de memória e resumos de voltas

import { SCHEMA_VERSION, validateTelemetrySample } from './telemetrySchema.js';

export class TelemetrySession {
  constructor(options = {}) {
    this.sessionId = options.sessionId || this.generateSessionId();
    this.startTime = performance.now();
    this.maxBufferSize = options.maxBufferSize || 30000; // ~50 minutos a 10 Hz para 1 carro
    this.scope = options.scope || 'PLAYER_ONLY'; // 'PLAYER_ONLY' | 'BOT_ONLY' | 'ALL'
    this.sampleRateHz = options.sampleRateHz || 10;
    this.sampleIntervalMs = 1000 / this.sampleRateHz;

    this.samples = [];
    this.lapSummaries = [];
    this.activeLapTrackers = new Map(); // participantId -> tracker

    this.stats = {
      totalSamples: 0,
      playerSamples: 0,
      botSamples: 0,
      rejectedSamples: 0,
      lapsRecorded: 0
    };
  }

  generateSessionId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = 'sess_';
    for (let i = 0; i < 10; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `${id}_${Date.now()}`;
  }

  /**
   * Adiciona uma amostra ao buffer após validação de integridade.
   */
  addSample(sample) {
    if (!validateTelemetrySample(sample)) {
      this.stats.rejectedSamples++;
      return false;
    }

    // Gerenciamento de buffer de tamanho fixo (Ring Buffer)
    if (this.samples.length >= this.maxBufferSize) {
      this.samples.shift(); // Remove a amostra mais antiga para evitar estouro de memória
    }

    this.samples.push(sample);
    this.stats.totalSamples++;
    if (sample.metadata.driverType === 'PLAYER') {
      this.stats.playerSamples++;
    } else {
      this.stats.botSamples++;
    }

    // Atualizar métricas da volta ativa
    this.updateLapTracking(sample);
    return true;
  }

  /**
   * Acompanha métricas e gera resumos por volta para cada participante.
   */
  updateLapTracking(sample) {
    const { participantId, driverType, trackId, lapNumber, timestamp } = sample.metadata;
    const { speed } = sample.carState;
    const { offTrack, collision, spin } = sample.eventState;

    let tracker = this.activeLapTrackers.get(participantId);

    if (!tracker || tracker.lapNumber !== lapNumber) {
      // Finalizar volta anterior se existir
      if (tracker && tracker.sampleCount > 10) {
        this.finalizeLapSummary(tracker, timestamp);
      }

      // Iniciar nova volta
      tracker = {
        sessionId: this.sessionId,
        participantId,
        driverType,
        trackId,
        lapNumber,
        startTime: timestamp,
        sampleCount: 0,
        speedSum: 0,
        maxSpeed: speed,
        offTrackCount: 0,
        collisionCount: 0,
        spinCount: 0,
        validLap: true
      };
      this.activeLapTrackers.set(participantId, tracker);
    }

    // Acumular métricas
    tracker.sampleCount++;
    tracker.speedSum += speed;
    if (speed > tracker.maxSpeed) tracker.maxSpeed = speed;
    if (offTrack) {
      tracker.offTrackCount++;
      tracker.validLap = false;
    }
    if (collision) tracker.collisionCount++;
    if (spin) {
      tracker.spinCount++;
      tracker.validLap = false;
    }
  }

  finalizeLapSummary(tracker, endTime) {
    const lapTimeSec = Math.max(0, (endTime - tracker.startTime) / 1000);
    const avgSpeed = tracker.sampleCount > 0 ? (tracker.speedSum / tracker.sampleCount) : 0;

    const summary = {
      schemaVersion: SCHEMA_VERSION,
      sessionId: tracker.sessionId,
      participantId: tracker.participantId,
      driverType: tracker.driverType,
      trackId: tracker.trackId,
      lapNumber: tracker.lapNumber,
      lapTime: Number(lapTimeSec.toFixed(3)),
      sampleCount: tracker.sampleCount,
      averageSpeed: Number(avgSpeed.toFixed(4)),
      maxSpeed: Number(tracker.maxSpeed.toFixed(4)),
      offTrackCount: tracker.offTrackCount,
      collisionCount: tracker.collisionCount,
      spinCount: tracker.spinCount,
      validLap: tracker.validLap
    };

    this.lapSummaries.push(summary);
    this.stats.lapsRecorded++;
  }

  getStats() {
    const memoryEstimateBytes = this.samples.length * 280; // ~280 bytes por sample em memória
    return {
      sessionId: this.sessionId,
      scope: this.scope,
      sampleRateHz: this.sampleRateHz,
      totalSamples: this.stats.totalSamples,
      playerSamples: this.stats.playerSamples,
      botSamples: this.stats.botSamples,
      rejectedSamples: this.stats.rejectedSamples,
      currentBufferSize: this.samples.length,
      maxBufferSize: this.maxBufferSize,
      estimatedMemoryBytes: memoryEstimateBytes,
      estimatedMemoryMB: Number((memoryEstimateBytes / (1024 * 1024)).toFixed(2)),
      lapsRecorded: this.stats.lapsRecorded
    };
  }

  clear() {
    this.samples = [];
    this.lapSummaries = [];
    this.activeLapTrackers.clear();
    this.stats.totalSamples = 0;
    this.stats.playerSamples = 0;
    this.stats.botSamples = 0;
    this.stats.rejectedSamples = 0;
    this.stats.lapsRecorded = 0;
  }
}
