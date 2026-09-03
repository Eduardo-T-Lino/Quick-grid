// ========== ML TELEMETRY COLLECTOR ==========
// Coleta amostras de telemetria a 10 Hz (100 ms) independente do FPS de renderização

import { createTelemetrySample } from './telemetrySchema.js';
import { TelemetrySession } from './telemetrySession.js';
import { exportTelemetrySession } from './telemetryExport.js';
import { onlineUploader } from './telemetryUploader.js';

export class TelemetryCollector {
  constructor(options = {}) {
    this.enabled = options.enabled || false;
    this.sampleRateHz = options.sampleRateHz || 10;
    this.sampleIntervalMs = 1000 / this.sampleRateHz; // 100 ms
    this.scope = options.scope || 'PLAYER_ONLY'; // 'PLAYER_ONLY' | 'BOT_ONLY' | 'ALL'

    this.session = new TelemetrySession({
      sampleRateHz: this.sampleRateHz,
      scope: this.scope,
      maxBufferSize: options.maxBufferSize || 30000
    });

    this.lastSampleTime = 0;
    this.sampleCounter = 0;
    this.lapStats = new Map();
    this.onlineSessionReady = false;
  }

  /**
   * Inicia a coleta de telemetria criando uma nova sessão.
   */
  start(options = {}) {
    this.enabled = true;
    this.onlineOnly = Boolean(options.onlineOnly);
    if (options.scope) this.scope = options.scope;
    this.session = new TelemetrySession({
      sampleRateHz: this.sampleRateHz,
      scope: this.scope,
      maxBufferSize: options.maxBufferSize || 30000
    });
    this.lastSampleTime = 0;
    this.sampleCounter = 0;
    this.lapStats.clear();
    this.onlineSessionReady = false;
    console.log(`[ML-TELEMETRY] Coleta INICIADA. Session: ${this.session.sessionId} | Rate: ${this.sampleRateHz}Hz | Scope: ${this.scope}`);

    if (onlineUploader && onlineUploader.consentEnabled && options.trackId) {
      const session = this.session;
      onlineUploader.beginRace(options.trackId, {
        sampleRateHz: this.sampleRateHz,
        scope: this.scope,
        onCollectionReady: () => { if (session === this.session) this.onlineSessionReady = this.enabled; }
      });
    }
  }

  /**
   * Para a coleta de telemetria.
   */
  stop() {
    this.enabled = false;
    console.log(`[ML-TELEMETRY] Coleta PARADA. Total de samples gravados: ${this.session.samples.length}`);
    if (onlineUploader && onlineUploader.consentEnabled) {
      onlineUploader.endSession({
        totalSamples: this.session.samples.length
      });
    }
  }

  /**
   * Limpa o buffer de telemetria.
   */
  clear() {
    this.session.clear();
    this.lastSampleTime = 0;
    this.sampleCounter = 0;
    this.lapStats.clear();
    console.log('[ML-TELEMETRY] Buffer de telemetria LIMPO.');
  }

  /**
   * Exporta a sessão atual para JSONL.
   */
  export(trackId = 'track') {
    return exportTelemetrySession(this.session, trackId);
  }

  /**
   * Retorna estatísticas da coleta ativa.
   */
  getStats() {
    return {
      enabled: this.enabled,
      ...this.session.getStats()
    };
  }

  recordCompletedLap(car) {
    if (!this.enabled || car.isBot) return;
    const key = `${car.participantId}:${car.currentLap}`;
    const lap = this.lapStats.get(key);
    if (!lap || !(car.currentLapTime > 0)) return;
    this.lapStats.delete(key);
    if (this.onlineSessionReady && onlineUploader.consentEnabled) {
      onlineUploader.recordLap({
        participantId: car.participantId, lapNumber: car.currentLap,
        lapTime: car.currentLapTime, sampleCount: lap.count,
        offTrackCount: lap.offTrack, collisionCount: lap.collision, spinCount: lap.spin,
        averageSpeed: lap.speedSum / lap.count, maxSpeed: lap.maxSpeed,
        validLap: lap.offTrack === 0 && lap.collision === 0 && lap.spin === 0
      });
    }
  }

  /**
   * Método de atualização chamado no loop do jogo (a cada frame ou tick de física).
   * O timer interno garante amostragem a 10 Hz fixos independente do frame rate.
   * 
   * @param {number} currentTimeMs - Timestamp em milissegundos (ex: performance.now())
   * @param {Object} gameState - Estado global do jogo (cars, trackPath, etc.)
   */
  update(currentTimeMs, gameState) {
    if (!this.enabled) return;
    if (!gameState || !gameState.trackPath || gameState.trackPath.length === 0 || !gameState.cars) return;

    // Controle de frequência fixo a 10 Hz com acumulador temporal (drift zero em 30, 60 e 144 FPS)
    if (this.lastSampleTime === 0) {
      this.lastSampleTime = currentTimeMs;
    } else {
      const elapsed = currentTimeMs - this.lastSampleTime;
      if (elapsed < this.sampleIntervalMs) {
        return;
      }
      this.lastSampleTime += this.sampleIntervalMs;
      // Prevenção de burst após pausa/aba em segundo plano
      if (currentTimeMs - this.lastSampleTime > this.sampleIntervalMs * 2) {
        this.lastSampleTime = currentTimeMs;
      }
    }

    const { trackPath, selectedTrackId, selectedTrack, selectedTrackData, cars } = gameState;
    const trackWidth = (selectedTrackData && selectedTrackData.trackWidth) || 24;
    const halfW = trackWidth * 0.5;
    const trackLength = gameState.totalTrackLength || this.estimateTrackLength(trackPath);

    for (let car of cars) {
      if (!car || car.finished) continue;

      const isPlayer = !car.isBot;
      if (this.scope === 'PLAYER_ONLY' && !isPlayer) continue;
      if (this.scope === 'BOT_ONLY' && isPlayer) continue;

      this.sampleCar(car, trackPath, halfW, trackLength, selectedTrackId || selectedTrack || selectedTrackData?.id || 'track', currentTimeMs);
    }
  }

  /**
   * sampleCar — ML1.2 Causal Alignment
   *
   * Consome car.mlObservation (snapshot pré-física gravada em car.update() ANTES da
   * integração de vx/vy/angle) + action(t) (last*Input gravado APÓS filtros e ANTES da física).
   * Isso garante { observation(t), action(t) } e NÃO { observation(t+1), action(t) }.
   *
   * futureCurvature é computado aqui a partir do pathIndex da snapshot pré-física,
   * pois depende de trackPath (não do Car) e não precisa de pre-cálculo no car.update().
   *
   * handleCarCollisions() (chamado após car.update()) NÃO contamina esta amostra:
   * a observation já foi capturada, e a colisão aparece no PRÓXIMO tick como observation(t+1).
   */
  sampleCar(car, trackPath, halfW, totalTrackLength, trackId, timestamp) {
    // ── Garantir que o carro passou pelo ciclo de update neste tick ──────────
    let obs = car.mlObservation;
    if (!obs) {
      // Fallback gracioso para mocks de teste ou carros sem ciclo de update
      const totalPoints = trackPath.length;
      const pathIdxFallback = Math.max(0, Math.min(totalPoints - 1, car.pathIndex || 0));
      const cpFallback = trackPath[pathIdxFallback] || { x: 0, y: 0, normalX: 0, normalY: 1, angle: 0, curvature: 0 };
      const headingX = Math.cos(car.angle || 0);
      const headingY = Math.sin(car.angle || 0);
      const rightX = -headingY;
      const rightY = headingX;
      const fwdVel = (car.vx || 0) * headingX + (car.vy || 0) * headingY;
      const latVel = (car.vx || 0) * rightX + (car.vy || 0) * rightY;
      const carCenterOffset = ((car.x || 0) - cpFallback.x) * (cpFallback.normalX || 0) + ((car.y || 0) - cpFallback.y) * (cpFallback.normalY || 1);
      let headingError = (car.angle || 0) - (cpFallback.angle || 0);
      while (headingError < -Math.PI) headingError += Math.PI * 2;
      while (headingError > Math.PI) headingError -= Math.PI * 2;

      obs = {
        speed: Math.hypot(car.vx || 0, car.vy || 0),
        forwardVelocity: fwdVel,
        lateralVelocity: latVel,
        heading: car.angle || 0,
        yawRate: car.yawRate || 0,
        slipAngle: Math.atan2(latVel, Math.abs(fwdVel) + 0.001),
        steeringAngle: car.steerAmount || 0,
        pathIndex: pathIdxFallback,
        trackProgress: (cpFallback.cumulativeDistance !== undefined && totalTrackLength > 0)
          ? Math.min(1.0, Math.max(0, cpFallback.cumulativeDistance / totalTrackLength))
          : (totalPoints > 0 ? (pathIdxFallback / totalPoints) : 0),
        currentCurvature: cpFallback.effectiveCurvature !== undefined ? cpFallback.effectiveCurvature : (cpFallback.curvature || 0),
        targetSpeed: cpFallback.safeBrakingLimit || cpFallback.targetSpeed || 1.35,
        distanceToLeftEdge: halfW - carCenterOffset,
        distanceToRightEdge: halfW + carCenterOffset,
        surface: car.currentSurface || 'TARMAC',
        headingError,
        crossTrackError: carCenterOffset - (car.currentLaneOffset || 0),
        offTrack: (car.currentSurface === 'GRAVEL' || car.currentSurface === 'RUNOFF'),
        collision: Boolean(car.hasContact),
        spin: Math.abs(Math.atan2(latVel, Math.abs(fwdVel) + 0.001)) > 0.40,
        isRecovering: (car.currentSurface === 'GRAVEL' || car.currentSurface === 'RUNOFF')
      };
    }

    // ── Curvaturas Futuras: baseadas no pathIndex da snapshot pré-física ─────
    // Calculadas aqui pois dependem apenas de trackPath (sem estado do Car).
    const pathIdx = obs.pathIndex;
    const futureCurvatures = this.getFutureCurvaturesInMeters(trackPath, pathIdx, [5, 10, 20, 40]);

    // ── Action(t): gravada em car.update() após filtros/rampa, ANTES da física ─
    // Para PLAYER: após steering ramp (steerAmount) + clamping.
    // Para BOT: após BotBrain.computeInputs() (safety/stability já aplicados internamente).
    const steering = typeof car.lastSteerInput === 'number' ? car.lastSteerInput : 0;
    const throttle = typeof car.lastThrottleInput === 'number' ? car.lastThrottleInput : 0;
    const brake = typeof car.lastBrakeInput === 'number' ? car.lastBrakeInput : 0;

    // ── Construção da amostra com observation(t) pré-física + action(t) ──────
    const sample = createTelemetrySample({
      sessionId: this.session.sessionId,
      sampleIndex: this.sampleCounter++,
      timestamp,
      trackId,
      lapNumber: car.currentLap || 1,
      driverType: car.isBot ? 'BOT' : 'PLAYER',
      participantId: car.participantId || (car.isBot ? 'p_bot' : 'p_player'),

      // TRACK GEOMETRY — da snapshot pré-física (pathIndex, trackProgress, curvatures)
      trackProgress: obs.trackProgress,
      pathIndex: pathIdx,
      currentCurvature: obs.currentCurvature,
      futureCurvature5m: futureCurvatures[0],
      futureCurvature10m: futureCurvatures[1],
      futureCurvature20m: futureCurvatures[2],
      futureCurvature40m: futureCurvatures[3],
      targetSpeed: obs.targetSpeed,
      distanceToLeftEdge: obs.distanceToLeftEdge,
      distanceToRightEdge: obs.distanceToRightEdge,
      surface: obs.surface,

      // RAW PHYSICS — todos da snapshot pré-física
      speed: obs.speed,
      forwardVelocity: obs.forwardVelocity,
      lateralVelocity: obs.lateralVelocity,
      heading: obs.heading,
      headingError: obs.headingError,
      yawRate: obs.yawRate,
      slipAngle: obs.slipAngle,
      crossTrackError: obs.crossTrackError,
      steeringAngle: obs.steeringAngle,

      // DRIVER ACTION — gravada após filtros, antes da física (action_t causal)
      steering,
      throttle,
      brake,

      // EVENT FLAGS — pertencem ao observation_t (estado no instante da decisão).
      // Colisões causadas por handleCarCollisions() neste mesmo tick aparecerão
      // no PRÓXIMO observation como car.hasContact e mlObservation.collision = true.
      offTrack: obs.offTrack,
      collision: obs.collision,
      spin: obs.spin,
      isRecovering: obs.isRecovering
    });

    this.session.addSample(sample);

    if (this.onlineSessionReady && onlineUploader.consentEnabled) {
    const key = `${sample.metadata.participantId}:${sample.metadata.lapNumber}`;
    const lap = this.lapStats.get(key) || { count: 0, speedSum: 0, maxSpeed: 0, offTrack: 0, collision: 0, spin: 0 };
    lap.count++;
    lap.speedSum += sample.carState.speed;
    lap.maxSpeed = Math.max(lap.maxSpeed, sample.carState.speed);
    lap.offTrack += Number(sample.eventState.offTrack);
    lap.collision += Number(sample.eventState.collision);
    lap.spin += Number(sample.eventState.spin);
    this.lapStats.set(key, lap);
    }

    // Se consentimento online estiver ativo, enfileirar sample no uploader (assíncrono / non-blocking)
    if (this.onlineSessionReady && onlineUploader.consentEnabled) {
      onlineUploader.queueSample(sample);
    }
  }

  /**
   * Calcula a curvatura nos pontos correspondentes às distâncias físicas requeridas em metros.
   * Acumula o segmentLength de cada ponto e trata wrap da linha de chegada.
   */
  getFutureCurvaturesInMeters(trackPath, startIdx, targetDistancesMeters) {
    const totalPoints = trackPath.length;
    const results = [];
    let currentTargetIdx = 0;
    let accumulatedDist = 0;

    for (let step = 1; step <= 150; step++) {
      if (currentTargetIdx >= targetDistancesMeters.length) break;

      const idx = (startIdx + step) % totalPoints;
      accumulatedDist += (trackPath[idx].segmentLength || 1.5);

      while (currentTargetIdx < targetDistancesMeters.length && accumulatedDist >= targetDistancesMeters[currentTargetIdx]) {
        results.push(trackPath[idx].effectiveCurvature || trackPath[idx].curvature || 0);
        currentTargetIdx++;
      }
    }

    // Preencher eventuais distâncias restantes caso a pista seja muito curta
    while (results.length < targetDistancesMeters.length) {
      results.push(trackPath[(startIdx + 20) % totalPoints].curvature || 0);
    }

    return results;
  }

  estimateTrackLength(trackPath) {
    let total = 0;
    for (let p of trackPath) {
      total += (p.segmentLength || 1.5);
    }
    return total || 1000;
  }
}
