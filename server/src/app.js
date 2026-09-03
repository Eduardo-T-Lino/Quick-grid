// ========== EXPRESS APP INSTANCE (FASE ML2.0) ==========
// Configura middlewares, segurança CORS, rotas de telemetria e tratamento de erros

import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { telemetrySessionsRouter } from './routes/telemetrySessions.js';
import { telemetryBatchesRouter } from './routes/telemetryBatches.js';
import { telemetryLapsRouter } from './routes/telemetryLaps.js';

export function createApp() {
  const app = express();
  if (config.isProduction) app.set('trust proxy', 1);

  // 1. Configuração Segura de CORS
  const corsOptions = {
    origin: (origin, callback) => {
      // Permitir requisições sem origin (como curl, testes locais ou apps nativos)
      if (!origin) return callback(null, true);

      if (!config.isProduction) {
        // Em desenvolvimento, permitir localhost e origens de teste
        return callback(null, true);
      }

      // Em produção, restringir estritamente às origens configuradas (Vercel)
      if (config.CORS_ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, true);
      }

      callback(Object.assign(new Error('Origin not allowed'), { statusCode: 403, code: 'CORS_ORIGIN_DENIED' }));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-ingest-token', 'x-refresh-credential'],
    maxAge: 86400
  };

  app.use(cors(corsOptions));

  // 2. Parser compatível com batch nominal ~41KB, com margem para schema.
  app.use(express.json({ limit: config.MAX_BODY_SIZE }));

  // 3. Rotas de Health & Monitoramento
  app.use(healthRouter);

  // 4. Rotas da API de Telemetria ML (v1)
  app.use('/api/v1/telemetry', telemetrySessionsRouter);
  app.use('/api/v1/telemetry', telemetryBatchesRouter);
  app.use('/api/v1/telemetry', telemetryLapsRouter);

  // 5. Handler para rotas não encontradas (404)
  app.use((req, res) => {
    res.status(404).json({
      error: 'NOT_FOUND',
      message: `Rota ${req.method} ${req.originalUrl} não encontrada.`
    });
  });

  // 6. Central Error Handler
  app.use((err, req, res, next) => {
    console.error('[SERVER ERROR]', { code: err.code || err.type || 'INTERNAL_ERROR', status: err.statusCode || err.status || 500 });
    res.status(err.statusCode || err.status || 500).json({
      error: err.code || 'INTERNAL_SERVER_ERROR',
      message: config.isProduction ? 'Request failed' : (err.message || 'Ocorreu um erro interno no servidor.')
    });
  });

  return app;
}
