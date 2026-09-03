// ========== INGESTION SECURITY TOKEN (FASE ML2.0) ==========
// Gera e valida tokens temporários de ingestão assinados com HMAC-SHA256 (sem segredos estáticos no frontend)

import crypto from 'crypto';
import { config } from '../config.js';

function createSignedToken(sessionId, purpose, ttlHours) {
  const expiresAt = Date.now() + (ttlHours * 3600 * 1000);
  const payload = JSON.stringify({ sessionId, purpose, expiresAt });
  const payloadB64 = Buffer.from(payload).toString('base64url');

  const signature = crypto
    .createHmac('sha256', config.INGEST_TOKEN_SECRET)
    .update(payloadB64)
    .digest('base64url');

  return {
    token: `${payloadB64}.${signature}`,
    expiresAt: new Date(expiresAt).toISOString()
  };
}

export function createIngestToken(sessionId, ttlHours = config.INGEST_TOKEN_TTL_HOURS) {
  const result = createSignedToken(sessionId, 'ingest', ttlHours);
  return { ingestToken: result.token, expiresAt: result.expiresAt };
}

export function createRefreshCredential(sessionId, ttlHours = 24 * 7) {
  const result = createSignedToken(sessionId, 'refresh', ttlHours);
  return { refreshCredential: result.token, refreshExpiresAt: result.expiresAt };
}

function verifySignedToken(token, expectedSessionId, expectedPurpose) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token de ingestão ausente' };
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Formato de token inválido' };
  }

  const [payloadB64, providedSignature] = parts;

  // 1. Recalcular e verificar assinatura com comparação timing-safe
  const expectedSignature = crypto
    .createHmac('sha256', config.INGEST_TOKEN_SECRET)
    .update(payloadB64)
    .digest('base64url');

  const bufProvided = Buffer.from(providedSignature);
  const bufExpected = Buffer.from(expectedSignature);

  if (bufProvided.length !== bufExpected.length || !crypto.timingSafeEqual(bufProvided, bufExpected)) {
    return { valid: false, error: 'Assinatura do token de ingestão inválida' };
  }

  // 2. Decodificar payload
  let data;
  try {
    const rawJSON = Buffer.from(payloadB64, 'base64url').toString('utf8');
    data = JSON.parse(rawJSON);
  } catch {
    return { valid: false, error: 'Payload do token corrompido' };
  }

  // 3. Checar expiração temporal
  if (!data || !Number.isFinite(data.expiresAt) || typeof data.sessionId !== 'string' || Date.now() >= data.expiresAt) {
    return { valid: false, error: 'Token de ingestão expirado' };
  }

  // 4. Checar correspondência com a sessão esperada (se especificada)
  if (expectedSessionId && data.sessionId !== expectedSessionId) {
    return { valid: false, error: 'Token não pertence à sessão especificada' };
  }

  if (data.purpose !== expectedPurpose) {
    return { valid: false, error: `Credencial não autorizada para ${expectedPurpose}` };
  }

  return {
    valid: true,
    sessionId: data.sessionId,
    expiresAt: new Date(data.expiresAt).toISOString()
  };
}


export function verifyIngestToken(token, expectedSessionId = null) {
  return verifySignedToken(token, expectedSessionId, 'ingest');
}

export function verifyRefreshCredential(token, expectedSessionId = null) {
  return verifySignedToken(token, expectedSessionId, 'refresh');
}

// Middleware Express para autenticação de endpoints de ingestão
export function requireIngestToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const customHeader = req.headers['x-ingest-token'];

  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (customHeader) {
    token = customHeader.trim();
  }

  const expectedSessionId = req.params?.id || req.body?.sessionId;
  const result = verifyIngestToken(token, expectedSessionId);

  if (!result.valid) {
    return res.status(401).json({
      error: 'UNAUTHORIZED_INGESTION',
      message: result.error
    });
  }

  req.ingestSessionId = result.sessionId;
  next();
}

export function requireRefreshCredential(req, res, next) {
  const token = req.headers['x-refresh-credential'] || req.body?.refreshCredential;
  const result = verifyRefreshCredential(token, req.params?.id);
  if (!result.valid) {
    return res.status(401).json({ error: 'UNAUTHORIZED_REFRESH', message: result.error });
  }
  next();
}
