// ========== TELEMETRY BATCHES ROUTE (FASE ML2.0) ==========
// Endpoint principal para ingestão de batches compactados a 10 Hz com garantia de idempotência

import { Router } from 'express';
import { validateBatchSubmission } from '../validation/telemetryValidation.js';
import { telemetryService } from '../services/telemetryService.js';
import { requireIngestToken } from '../security/ingestToken.js';
import { rateLimitMiddleware } from '../security/rateLimit.js';

export const telemetryBatchesRouter = Router();

// POST /api/v1/telemetry/batches — Ingestão de batch com autenticação por ingestToken
telemetryBatchesRouter.post('/batches', rateLimitMiddleware, requireIngestToken, async (req, res, next) => {
  try {
    const validation = validateBatchSubmission(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'INVALID_BATCH_DATA',
        messages: validation.errors
      });
    }

    const { sessionId, batchSequence, samples } = validation.data;

    const result = await telemetryService.ingestBatch(sessionId, batchSequence, samples);

    // Retornar 200 OK para processamento bem-sucedido ou reprocessamento idempotente
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
