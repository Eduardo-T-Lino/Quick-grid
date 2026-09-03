// ========== BACKEND ENTRYPOINT FORWARDER (FASE ML2.0) ==========
// Redireciona para o módulo principal em server/src/server.js

import { startServer } from './src/server.js';

startServer().catch(err => {
  console.error('❌ Falha fatal ao iniciar servidor:', err);
  process.exit(1);
});
