// ========== HEALTH CHECK ROUTE (FASE ML2.0 / ML2.1) ==========
// Endpoint para monitoramento de liveness/readiness com validação estrita de banco em produção

import { Router } from 'express';
import { config } from '../config.js';
import { db } from '../db/pool.js';

export const healthRouter = Router();

healthRouter.get('/health', (req, res) => {
  const isProd = config.isProduction;
  let isMemory = false;
  try {
    isMemory = db.isMemory();
  } catch {
    isMemory = false;
  }

  if (isProd && isMemory) {
    return res.status(503).json({
      status: 'error',
      code: 'FATAL_DB_CONNECTION_REQUIRED',
      message: 'Ambiente de produção não permite persistência em memória.',
      timestamp: new Date().toISOString()
    });
  }

  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'quick-grid-telemetry-api',
    version: config.VERSIONS.GAME_BUILD_VERSION,
    environment: config.NODE_ENV,
    storage: isMemory ? 'in-memory' : 'postgresql'
  });
});

healthRouter.get('/api/health', (req, res) => {
  const isProd = config.isProduction;
  let isMemory = false;
  try {
    isMemory = db.isMemory();
  } catch {
    isMemory = false;
  }

  if (isProd && isMemory) {
    return res.status(503).json({
      status: 'error',
      code: 'FATAL_DB_CONNECTION_REQUIRED',
      message: 'Ambiente de produção não permite persistência em memória.',
      timestamp: new Date().toISOString()
    });
  }

  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'quick-grid-telemetry-api',
    version: config.VERSIONS.GAME_BUILD_VERSION,
    environment: config.NODE_ENV,
    storage: isMemory ? 'in-memory' : 'postgresql'
  });
});

healthRouter.get('/ready', async (req, res) => {
  try {
    if (config.isProduction && db.isMemory()) throw new Error('PostgreSQL obrigatório');
    await db.query('SELECT 1;');
    res.status(200).json({ status: 'ready', database: db.isMemory() ? 'memory' : 'postgresql' });
  } catch {
    res.status(503).json({ status: 'not_ready', code: 'DATABASE_UNAVAILABLE' });
  }
});
