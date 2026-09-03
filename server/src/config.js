// ========== SERVER CONFIGURATION (FASE ML2.0) ==========
// Centraliza todas as variáveis de ambiente com defaults seguros para dev e produção

export const config = {
  // Ambiente de execução
  NODE_ENV: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',

  // Rede & Porta (Render compatível via process.env.PORT)
  PORT: parseInt(process.env.PORT || '3001', 10),
  HOST: process.env.HOST || '0.0.0.0',

  // Banco de Dados PostgreSQL
  DATABASE_URL: process.env.DATABASE_URL || '',

  // CORS: origens permitidas
  CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:3000',
        'http://localhost:3001'
      ],

  // Segurança de Ingestão: Chave secreta para assinatura HMAC-SHA256 dos tokens temporários
  INGEST_TOKEN_SECRET: process.env.INGEST_TOKEN_SECRET || 'quick-grid-ml2-ingest-secret-dev-only-change-in-prod',
  INGEST_TOKEN_TTL_HOURS: parseInt(process.env.INGEST_TOKEN_TTL_HOURS || '4', 10),

  // Limites de Telemetria
  MAX_BATCH_SAMPLES: parseInt(process.env.MAX_BATCH_SAMPLES || '100', 10), // Limite máximo aceito
  RECOMMENDED_BATCH_SAMPLES: 50,                                          // Recomendação nominal (~5s @ 10Hz)
  MAX_BODY_SIZE: process.env.MAX_BODY_SIZE || '256kb',                    // margem ampla sobre batch real ~41KB
  MAX_ACTIVE_SESSION_HOURS: 4,

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: 60 * 1000, // 1 minuto
  RATE_LIMIT_MAX_PER_WINDOW: parseInt(process.env.RATE_LIMIT_MAX_PER_WINDOW || '120', 10), // Até 120 requisições/minuto por sessão/IP
  SESSION_CREATE_RATE_LIMIT: parseInt(process.env.SESSION_CREATE_RATE_LIMIT || '20', 10),
  RATE_LIMIT_MODE: 'SINGLE_INSTANCE_MEMORY',

  DB_POOL_MAX: parseInt(process.env.DB_POOL_MAX || '10', 10),
  DB_IDLE_TIMEOUT_MS: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
  DB_CONNECTION_TIMEOUT_MS: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '5000', 10),

  // Metadados Oficiais Homologados (Fase ML2.0)
  VERSIONS: {
    SCHEMA_VERSION: 2,
    GAME_BUILD_VERSION: '0.2.0-ml2',
    TRACK_GEOMETRY_VERSION: '1.5.0-centripetal',
    PHYSICS_VERSION: '1.5.0-gt3',
    FEATURE_MANIFEST_VERSION: '2.1.0',
    CONSENT_VERSION: '1.0.0'
  }
};

export function validateProductionConfig() {
  if (!config.isProduction) return;
  if (!/^postgres(ql)?:\/\//.test(config.DATABASE_URL)) {
    throw new Error('DATABASE_URL válida é obrigatória em produção.');
  }
  if (!config.INGEST_TOKEN_SECRET || config.INGEST_TOKEN_SECRET.length < 32 || config.INGEST_TOKEN_SECRET.includes('dev-only')) {
    throw new Error('INGEST_TOKEN_SECRET de produção deve ter pelo menos 32 caracteres aleatórios.');
  }
  if (!process.env.CORS_ALLOWED_ORIGINS || config.CORS_ALLOWED_ORIGINS.some(origin => {
    try { const url = new URL(origin); return url.protocol !== 'https:' || url.origin !== origin; }
    catch { return true; }
  })) {
    throw new Error('CORS_ALLOWED_ORIGINS deve listar origens explícitas em produção.');
  }
}
