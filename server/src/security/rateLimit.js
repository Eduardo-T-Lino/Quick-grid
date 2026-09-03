// ========== IN-MEMORY SLIDING WINDOW RATE LIMITER (FASE ML2.0) ==========
// Previne sobrecarga e flood de requisições por IP ou sessionId

import { config } from '../config.js';

export class SlidingWindowRateLimiter {
  constructor(windowMs = config.RATE_LIMIT_WINDOW_MS, maxRequests = config.RATE_LIMIT_MAX_PER_WINDOW) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.requests = new Map(); // key: identifier -> array of timestamps
  }

  isAllowed(key) {
    const now = Date.now();
    const timestamps = this.requests.get(key) || [];

    // Remover timestamps fora da janela deslizante
    const valid = timestamps.filter(ts => now - ts < this.windowMs);

    if (valid.length >= this.maxRequests) {
      this.requests.set(key, valid);
      return false;
    }

    valid.push(now);
    this.requests.set(key, valid);

    // Limpeza periódica de chaves inativas
    if (this.requests.size > 5000) {
      this.cleanup();
    }

    return true;
  }

  cleanup() {
    const now = Date.now();
    for (const [key, tsList] of this.requests.entries()) {
      const valid = tsList.filter(ts => now - ts < this.windowMs);
      if (valid.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, valid);
      }
    }
  }

  reset() {
    this.requests.clear();
  }
}

export const rateLimiter = new SlidingWindowRateLimiter();
export const sessionCreationLimiter = new SlidingWindowRateLimiter(config.RATE_LIMIT_WINDOW_MS, config.SESSION_CREATE_RATE_LIMIT);

export function rateLimitMiddleware(req, res, next) {
  // Identificador: sessionId ou IP
  const key = req.body?.sessionId || req.ip || req.socket.remoteAddress || 'unknown';

  if (!rateLimiter.isAllowed(key)) {
    return res.status(429).json({
      error: 'TOO_MANY_REQUESTS',
      message: `Limite de requisições excedido. Máximo de ${config.RATE_LIMIT_MAX_PER_WINDOW} requisições por minuto.`
    });
  }

  next();
}

export function sessionCreationRateLimit(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  if (!sessionCreationLimiter.isAllowed(key)) {
    return res.status(429).json({ error: 'SESSION_CREATION_RATE_LIMITED', message: 'Muitas sessões criadas neste intervalo.' });
  }
  next();
}
