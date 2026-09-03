// ========== TELEMETRY SESSIONS ROUTE (FASE ML2.0) ==========
// Endpoints para inicialização, consulta e finalização de sessões de telemetria

import { Router } from 'express';
import { validateSessionCreation } from '../validation/telemetryValidation.js';
import { telemetryService } from '../services/telemetryService.js';
import { requireIngestToken, requireRefreshCredential } from '../security/ingestToken.js';
import { rateLimitMiddleware, sessionCreationRateLimit } from '../security/rateLimit.js';

export const telemetrySessionsRouter = Router();

// POST /api/v1/telemetry/sessions — Inicializa nova sessão e emite ingestToken
telemetrySessionsRouter.post('/sessions', sessionCreationRateLimit, async (req, res, next) => {
  try {
    const validation = validateSessionCreation(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'INVALID_SESSION_DATA',
        messages: validation.errors
      });
    }

    const sessionResult = await telemetryService.createSession(validation.data);
    res.status(201).json(sessionResult);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/telemetry/sessions/:id — Consulta metadados da sessão
telemetrySessionsRouter.get('/sessions/:id', async (req, res, next) => {
  try {
    const session = await telemetryService.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'SESSION_NOT_FOUND', message: 'Sessão não encontrada' });
    }
    res.json(session);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/telemetry/sessions/:id/refresh-token — Renova ingestToken para sessão ativa
telemetrySessionsRouter.post('/sessions/:id/refresh-token', rateLimitMiddleware, requireRefreshCredential, async (req, res, next) => {
  try {
    const result = await telemetryService.refreshToken(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/telemetry/sessions/:id/complete — Finaliza sessão (requer ingestToken)
telemetrySessionsRouter.post('/sessions/:id/complete', requireIngestToken, async (req, res, next) => {
  try {
    const session = await telemetryService.completeSession(req.params.id, req.body || {});
    res.json({
      success: true,
      sessionId: session.id,
      status: session.status,
      receivedSamples: session.received_samples,
      receivedBatches: session.received_batches,
      completedLaps: session.completed_laps
    });
  } catch (err) {
    next(err);
  }
});
