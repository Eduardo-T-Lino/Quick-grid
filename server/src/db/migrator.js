// ========== DATABASE MIGRATION RUNNER (FASE ML2.0) ==========
// Executa migrations SQL versionadas em ordem sequencial no banco PostgreSQL

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
  console.log('[MIGRATOR] Iniciando verificação de schema...');

  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.log('[MIGRATOR] Diretório de migrations não encontrado, ignorando.');
    return;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const client = await db.getClient();
  try {
    await client.query('SELECT pg_advisory_lock(71624022);');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`);

  for (const file of files) {
    const applied = await client.query('SELECT filename FROM schema_migrations WHERE filename = $1;', [file]);
    if (applied.rowCount > 0) continue;
    const fullPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(fullPath, 'utf-8');
    console.log(`[MIGRATOR] Executando migration: ${file}`);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1);', [file]);
      await client.query('COMMIT');
      console.log(`[MIGRATOR] ✓ Migration ${file} concluída.`);
    } catch (err) {
      console.error(`[MIGRATOR] Erro ao executar ${file}:`, { code: err.code || 'MIGRATION_ERROR' });
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  }

  } finally {
    await client.query('SELECT pg_advisory_unlock(71624022);').catch(() => {});
    client.release?.();
  }

  console.log('[MIGRATOR] Todas as migrations foram processadas.');
}

if (process.argv[1] && process.argv[1].endsWith('migrator.js')) {
  runMigrations().then(() => db.end()).catch(err => { console.error({ code: err.code || 'MIGRATION_ERROR' }); process.exit(1); });
}
