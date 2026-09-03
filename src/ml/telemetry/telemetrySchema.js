// ========== ML TELEMETRY SCHEMA (VERSION 2) ==========
// Schema padronizado e imutável para datasets de Imitation Learning e telemetria de pilotagem
//
// HISTÓRICO DE VERSÕES:
// - Schema V1 (Legado / Pré-Causal): S_{t+1} -> A_t. Não usar para treinamento de Behavioral Cloning.
// - Schema V2 (Causal Padrão): Observation(t) -> Action(t). Captura atômica pré-física.

export const SCHEMA_VERSION = 2;

/**
 * Valida a integridade matemática e física de uma amostra de telemetria.
 * Rejeita valores não-finitos (NaN, Infinity, -Infinity) e verifica limites válidos.
 * Rejeita schemas legados (< 2) para garantir conformidade causal.
 * 
 * @param {Object} sample - Objeto de amostra de telemetria
 * @returns {boolean} true se a amostra for válida
 */
export function validateTelemetrySample(sample) {
  if (!sample || typeof sample !== 'object') return false;

  // 1. Validação de Metadata
  if (sample.schemaVersion !== SCHEMA_VERSION) return false;
  const meta = sample.metadata;
  if (!meta || typeof meta !== 'object') return false;
  if (!meta.sessionId || typeof meta.sessionId !== 'string') return false;
  if (typeof meta.sampleIndex !== 'number' || !Number.isFinite(meta.sampleIndex) || meta.sampleIndex < 0) return false;
  if (typeof meta.timestamp !== 'number' || !Number.isFinite(meta.timestamp)) return false;
  if (meta.driverType !== 'PLAYER' && meta.driverType !== 'BOT') return false;

  // 2. Validação de Track State
  const track = sample.trackState;
  if (!track) return false;
  if (!Number.isFinite(track.trackProgress) || track.trackProgress < 0 || track.trackProgress > 1.0001) return false;
  if (!Number.isInteger(track.pathIndex) || track.pathIndex < 0) return false;
  if (!Number.isFinite(track.currentCurvature) || track.currentCurvature < 0) return false;
  if (!Number.isFinite(track.futureCurvature5m) || !Number.isFinite(track.futureCurvature10m) ||
      !Number.isFinite(track.futureCurvature20m) || !Number.isFinite(track.futureCurvature40m)) return false;
  if (!Number.isFinite(track.targetSpeed) || track.targetSpeed < 0) return false;
  if (!Number.isFinite(track.distanceToLeftEdge) || !Number.isFinite(track.distanceToRightEdge)) return false;

  // 3. Validação de Car State
  const car = sample.carState;
  if (!car) return false;
  if (!Number.isFinite(car.speed) || car.speed < 0) return false;
  if (!Number.isFinite(car.forwardVelocity) || !Number.isFinite(car.lateralVelocity)) return false;
  if (!Number.isFinite(car.heading) || !Number.isFinite(car.headingError)) return false;
  if (!Number.isFinite(car.yawRate) || !Number.isFinite(car.slipAngle)) return false;
  if (!Number.isFinite(car.crossTrackError)) return false;

  // 4. Validação de Driver Action (Labels de ML)
  const action = sample.driverAction;
  if (!action) return false;
  if (!Number.isFinite(action.steering) || action.steering < -1.0001 || action.steering > 1.0001) return false;
  if (!Number.isFinite(action.throttle) || action.throttle < -0.0001 || action.throttle > 1.0001) return false;
  if (!Number.isFinite(action.brake) || action.brake < -0.0001 || action.brake > 1.0001) return false;

  // 5. Validação de Event State
  const events = sample.eventState;
  if (!events) return false;
  if (typeof events.offTrack !== 'boolean' || typeof events.collision !== 'boolean') return false;

  return true;
}

/**
 * Cria um objeto de amostra de telemetria formatado de acordo com o Schema V1.
 */
export function createTelemetrySample({
  sessionId,
  sampleIndex,
  timestamp,
  trackId,
  lapNumber,
  driverType,
  participantId,
  trackProgress,
  pathIndex,
  currentCurvature,
  futureCurvature5m,
  futureCurvature10m,
  futureCurvature20m,
  futureCurvature40m,
  targetSpeed,
  distanceToLeftEdge,
  distanceToRightEdge,
  surface,
  speed,
  forwardVelocity,
  lateralVelocity,
  heading,
  headingError,
  yawRate,
  slipAngle,
  crossTrackError,
  steeringAngle,
  steering,
  throttle,
  brake,
  offTrack,
  collision,
  spin,
  isRecovering
}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    metadata: {
      sessionId,
      sampleIndex,
      timestamp,
      trackId: trackId || 0,
      lapNumber: lapNumber || 1,
      driverType, // 'PLAYER' | 'BOT'
      participantId: participantId || 'anon'
    },
    trackState: {
      trackProgress: Number(trackProgress.toFixed(5)),
      pathIndex: Math.floor(pathIndex),
      currentCurvature: Number(currentCurvature.toFixed(5)),
      futureCurvature5m: Number(futureCurvature5m.toFixed(5)),
      futureCurvature10m: Number(futureCurvature10m.toFixed(5)),
      futureCurvature20m: Number(futureCurvature20m.toFixed(5)),
      futureCurvature40m: Number(futureCurvature40m.toFixed(5)),
      targetSpeed: Number(targetSpeed.toFixed(4)),
      distanceToLeftEdge: Number(distanceToLeftEdge.toFixed(3)),
      distanceToRightEdge: Number(distanceToRightEdge.toFixed(3)),
      surface: surface || 'TARMAC'
    },
    carState: {
      speed: Number(speed.toFixed(4)),
      forwardVelocity: Number(forwardVelocity.toFixed(4)),
      lateralVelocity: Number(lateralVelocity.toFixed(4)),
      heading: Number(heading.toFixed(4)),
      headingError: Number(headingError.toFixed(4)),
      yawRate: Number(yawRate.toFixed(4)),
      slipAngle: Number(slipAngle.toFixed(4)),
      crossTrackError: Number(crossTrackError.toFixed(3)),
      steeringAngle: Number((steeringAngle || 0).toFixed(4))
    },
    driverAction: {
      steering: Number(Math.max(-1, Math.min(1, steering)).toFixed(4)),
      throttle: Number(Math.max(0, Math.min(1, throttle)).toFixed(4)),
      brake: Number(Math.max(0, Math.min(1, brake)).toFixed(4))
    },
    eventState: {
      offTrack: Boolean(offTrack),
      collision: Boolean(collision),
      spin: Boolean(spin),
      isRecovering: Boolean(isRecovering)
    }
  };
}
