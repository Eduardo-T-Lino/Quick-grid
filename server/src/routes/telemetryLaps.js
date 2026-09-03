// ========== TELEMETRY LAPS ROUTE (FASE ML2.0) ==========
// Endpoint para persistência relacional de resumos de voltas completadas

import { Router } from 'express';
import { validateLapSummary } from '../validation/telemetryValidation.js';
import { telemetryService } from '../services/telemetryService.js';
import { requireIngestToken } from '../security/ingestToken.js';
import { rateLimitMiddleware } from '../security/rateLimit.js';

export const telemetryLapsRouter = Router();

// POST /api/v1/telemetry/laps — Registra resumo de volta concluída
telemetryLapsRouter.post('/laps', rateLimitMiddleware, requireIngestToken, async (req, res, next) => {
  try {
    const validation = validateLapSummary(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'INVALID_LAP_DATA',
        messages: validation.errors
      });
    }

    const lap = await telemetryService.recordLap(validation.data);
    res.status(201).json({
      success: true,
      lapId: lap.id,
      sessionId: lap.session_id,
      lapNumber: lap.lap_number,
      lapTime: lap.lap_time
    });
  } catch (err) {
    next(err);
  }
});
