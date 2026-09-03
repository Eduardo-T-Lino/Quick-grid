// ========== SERVER ENTRYPOINT (FASE ML2.0 RENDER COMPATIBLE) ==========
// Inicializa banco de dados, executa migrations e inicia listener HTTP

import { config, validateProductionConfig } from './config.js';
import { createApp } from './app.js';
import { runMigrations } from './db/migrator.js';
import { db } from './db/pool.js';

async function startServer() {
  validateProductionConfig();
  console.log('====================================================');
  console.log('🚀 INICIANDO QUICK-GRID TELEMETRY BACKEND API (ML2.0)');
  console.log('====================================================');
  console.log(`Ambiente: ${config.NODE_ENV}`);
  console.log(`Porta configurada: ${config.PORT}`);
  console.log(`Banco: ${config.DATABASE_URL ? 'PostgreSQL Ativo' : 'In-Memory Store (Dev/Test)'}`);

  // Render Free: o startCommand executa migrate antes de server:start; não duplicar em produção.
  if (!config.isProduction) await runMigrations();
  await db.query('SELECT 1;'); // Fail startup instead of listening with an unreachable production DB.

  // 2. Instanciar Express App
  const app = createApp();

  // 3. Iniciar Listener HTTP
  const server = app.listen(config.PORT, config.HOST, () => {
    console.log(`\n✅ Servidor de Telemetria rodando em http://${config.HOST}:${config.PORT}`);
    console.log(`   - Health check: http://localhost:${config.PORT}/health`);
    console.log(`   - Ingestion API: http://localhost:${config.PORT}/api/v1/telemetry/sessions\n`);
  });

  // 4. Graceful Shutdown
  const shutdown = async (signal) => {
    console.log(`\n[SHUTDOWN] Sinal ${signal} recebido. Encerrando servidor graciosamente...`);
    server.close(async () => {
      console.log('[SHUTDOWN] Listener HTTP encerrado.');
      try {
        await db.end();
        console.log('[SHUTDOWN] Pool de conexões do banco encerrado.');
      } catch (e) {
        console.error('[SHUTDOWN] Erro ao fechar banco:', { code: e.code || 'DB_CLOSE_ERROR' });
      }
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return { app, server };
}

// Auto-run if executed as script
if (process.argv[1] && (process.argv[1].endsWith('server.js') || process.argv[1].endsWith('index.js'))) {
  startServer().catch(err => {
    console.error('❌ Falha fatal ao iniciar servidor:', { code: err.code || 'STARTUP_CONFIG_OR_DB_ERROR' });
    process.exit(1);
  });
}

export { startServer };
