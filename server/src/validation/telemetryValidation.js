// ========== SERVER-SIDE TELEMETRY VALIDATION (FASE ML2.0) ==========
// Validação estrita de limites numéricos, versionamento semântico e integridade de schema

import { config } from '../config.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isFiniteNumber(val) {
  return typeof val === 'number' && Number.isFinite(val);
}

export function validateSessionCreation(body) {
  const errors = [];
  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Body da requisição inválido'] };
  }

  // 1. Schema Version obrigatório = 2
  if (body.schemaVersion !== 2) {
    errors.push(`schemaVersion inválido (${body.schemaVersion}). O pipeline requer estritamente schemaVersion = 2.`);
  }

  // 2. Track ID
  if (!isFiniteNumber(body.trackId) || body.trackId < 1 || body.trackId > 24) {
    errors.push(`trackId inválido (${body.trackId}). Esperado número inteiro entre 1 e 24.`);
  }

  // 3. Sample Rate
  const sampleRate = body.sampleRateHz !== undefined ? body.sampleRateHz : 10.0;
  if (!isFiniteNumber(sampleRate) || sampleRate <= 0 || sampleRate > 100) {
    errors.push(`sampleRateHz inválido (${sampleRate}).`);
  }

  // 4. Scope
  const validScopes = ['PLAYER_ONLY', 'BOT_ONLY', 'ALL'];
  const scope = body.scope || 'PLAYER_ONLY';
  if (!validScopes.includes(scope)) {
    errors.push(`scope inválido (${scope}). Valores permitidos: ${validScopes.join(', ')}.`);
  }

  // 5. Version Metadata do Client
  const client = body.client || {};
  const gameBuildVersion = client.gameBuildVersion || client.buildVersion;
  const trackGeometryVersion = client.trackGeometryVersion;
  const physicsVersion = client.physicsVersion;
  const featureManifestVersion = client.featureManifestVersion;

  if (!gameBuildVersion || typeof gameBuildVersion !== 'string') {
    errors.push('client.gameBuildVersion é obrigatório.');
  }
  if (!trackGeometryVersion || typeof trackGeometryVersion !== 'string') {
    errors.push('client.trackGeometryVersion é obrigatório.');
  }
  if (!physicsVersion || typeof physicsVersion !== 'string') {
    errors.push('client.physicsVersion é obrigatório.');
  }
  if (!featureManifestVersion || typeof featureManifestVersion !== 'string') {
    errors.push('client.featureManifestVersion é obrigatório.');
  }

  // 6. Consent Version
  const consentVersion = body.consentVersion || '1.0.0';
  if (typeof consentVersion !== 'string') {
    errors.push('consentVersion deve ser uma string.');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      schemaVersion: 2,
      trackId: Math.floor(body.trackId),
      sampleRateHz: sampleRate,
      scope,
      gameBuildVersion,
      trackGeometryVersion,
      physicsVersion,
      featureManifestVersion,
      consentVersion,
      clientInfo: body.clientInfo || {}
    }
  };
}

export function validateTelemetrySample(sample, idx = 0) {
  if (!sample || typeof sample !== 'object') {
    return `Sample #${idx}: objeto inválido`;
  }

  if (sample.schemaVersion !== 2) {
    return `Sample #${idx}: schemaVersion inválido (${sample.schemaVersion}). Requer schemaVersion = 2 (Causal S_t -> A_t).`;
  }

  const meta = sample.metadata;
  if (!meta || !meta.sessionId || !isFiniteNumber(meta.timestamp)) {
    return `Sample #${idx}: metadados obrigatórios ausentes ou timestamp inválido`;
  }

  const cs = sample.carState;
  if (!cs ||
      !isFiniteNumber(cs.speed) ||
      !isFiniteNumber(cs.forwardVelocity) ||
      !isFiniteNumber(cs.lateralVelocity) ||
      !isFiniteNumber(cs.heading) ||
      !isFiniteNumber(cs.headingError) ||
      !isFiniteNumber(cs.yawRate) ||
      !isFiniteNumber(cs.slipAngle) ||
      !isFiniteNumber(cs.crossTrackError) ||
      !isFiniteNumber(cs.steeringAngle)) {
    return `Sample #${idx}: carState contém valores ausentes, NaN ou Infinity`;
  }

  const ts = sample.trackState;
  if (!ts ||
      !isFiniteNumber(ts.trackProgress) ||
      ts.trackProgress < 0 || ts.trackProgress >= 1.0001 ||
      !isFiniteNumber(ts.currentCurvature) ||
      !isFiniteNumber(ts.targetSpeed) ||
      !isFiniteNumber(ts.distanceToLeftEdge) ||
      !isFiniteNumber(ts.distanceToRightEdge)) {
    return `Sample #${idx}: trackState contém valores ausentes, NaN ou trackProgress fora de [0, 1)`;
  }

  const da = sample.driverAction;
  if (!da ||
      !isFiniteNumber(da.steering) || da.steering < -1.0001 || da.steering > 1.0001 ||
      !isFiniteNumber(da.throttle) || da.throttle < -0.0001 || da.throttle > 1.0001 ||
      !isFiniteNumber(da.brake) || da.brake < -0.0001 || da.brake > 1.0001) {
    return `Sample #${idx}: driverAction fora dos limites normalizados (steering=[-1,1], throttle=[0,1], brake=[0,1])`;
  }

  return null;
}

export function validateBatchSubmission(body) {
  const errors = [];
  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Body da requisição inválido'] };
  }

  const sessionId = body.sessionId;
  if (!sessionId || typeof sessionId !== 'string') {
    errors.push('sessionId obrigatório');
  }

  const batchSequence = body.batchSequence;
  if (!Number.isInteger(batchSequence) || batchSequence < 0) {
    errors.push(`batchSequence inválido (${batchSequence}). Esperado inteiro não-negativo >= 0.`);
  }

  const samples = body.samples;
  if (!Array.isArray(samples) || samples.length === 0) {
    errors.push('samples deve ser um array não-vazio');
  } else if (samples.length > config.MAX_BATCH_SAMPLES) {
    errors.push(`Quantidade de samples no batch (${samples.length}) excede o limite máximo permitido de ${config.MAX_BATCH_SAMPLES}.`);
  } else {
    // Validar amostras individuais
    for (let i = 0; i < samples.length; i++) {
      const err = validateTelemetrySample(samples[i], i);
      if (err) {
        errors.push(err);
        break; // Interromper no primeiro erro para performance
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      sessionId,
      batchSequence,
      samples
    }
  };
}

export function validateLapSummary(body) {
  const errors = [];
  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Body da requisição inválido'] };
  }

  if (!body.sessionId || typeof body.sessionId !== 'string') {
    errors.push('sessionId obrigatório');
  }
  if (!body.participantId || typeof body.participantId !== 'string') {
    errors.push('participantId obrigatório');
  }
  if (!Number.isInteger(body.lapNumber) || body.lapNumber < 1) {
    errors.push(`lapNumber inválido (${body.lapNumber}). Esperado inteiro >= 1.`);
  }
  if (!isFiniteNumber(body.lapTime) || body.lapTime <= 0) {
    errors.push(`lapTime inválido (${body.lapTime}). Esperado número positivo em segundos.`);
  }
  if (!Number.isInteger(body.sampleCount) || body.sampleCount < 1) {
    errors.push(`sampleCount inválido (${body.sampleCount}). Esperado inteiro >= 1.`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      sessionId: body.sessionId,
      participantId: body.participantId,
      lapNumber: body.lapNumber,
      lapTime: body.lapTime,
      sampleCount: body.sampleCount,
      offTrackCount: body.offTrackCount || 0,
      collisionCount: body.collisionCount || 0,
      spinCount: body.spinCount || 0,
      averageSpeed: body.averageSpeed != null ? body.averageSpeed : null,
      maxSpeed: body.maxSpeed != null ? body.maxSpeed : null,
      validLap: body.validLap !== false
    }
  };
}
