// ========== DATABASE CONNECTION POOL & STORE (FASE ML2.0) ==========
// Fornece abstração sobre PostgreSQL (pg.Pool) com fallback integrado para testes e dev local

import pg from 'pg';
import { config } from '../config.js';
import { randomUUID } from 'crypto';

const { Pool } = pg;

// Repositório em memória para testes e desenvolvimento sem servidor PostgreSQL ativo
class InMemoryStore {
  constructor() {
    this.sessions = new Map();
    this.batches = new Map(); // key: `${sessionId}:${batchSequence}`
    this.laps = new Map();    // key: `${sessionId}:${participantId}:${lapNumber}`
    this.isMemory = true;
  }

  async query(text, params = []) {
    const sql = text.trim();
    const upper = sql.toUpperCase();

    // 1. SELECT 1 / Health check
    if (upper.startsWith('SELECT 1')) {
      return { rows: [{ '?column?': 1 }], rowCount: 1 };
    }

    // 2. INSERT INTO telemetry_sessions
    if (upper.startsWith('INSERT INTO TELEMETRY_SESSIONS')) {
      const [
        id, schema_version, track_id, sample_rate_hz, scope,
        game_build_version, track_geometry_version, physics_version,
        feature_manifest_version, consent_version, status, client_info
      ] = params;

      const session = {
        id,
        created_at: new Date(),
        finished_at: null,
        schema_version,
        track_id,
        sample_rate_hz,
        scope,
        game_build_version,
        track_geometry_version,
        physics_version,
        feature_manifest_version,
        consent_version,
        status: status || 'ACTIVE',
        received_samples: 0,
        received_batches: 0,
        completed_laps: 0,
        quality_status: null,
        client_info: typeof client_info === 'string' ? JSON.parse(client_info) : (client_info || {})
      };
      this.sessions.set(id, session);
      return { rows: [session], rowCount: 1 };
    }

    // 3. SELECT FROM telemetry_sessions WHERE id = $1
    if (upper.startsWith('SELECT') && upper.includes('FROM TELEMETRY_SESSIONS') && upper.includes('WHERE ID =')) {
      const id = params[0];
      const session = this.sessions.get(id);
      return { rows: session ? [{ ...session }] : [], rowCount: session ? 1 : 0 };
    }

    // 4. UPDATE telemetry_sessions (incremental counters or status complete)
    if (upper.startsWith('UPDATE TELEMETRY_SESSIONS')) {
      if (upper.includes('STATUS = $1') || upper.includes('STATUS =') && upper.includes('COMPLETED')) {
        // Complete session
        const [status, completed_laps, quality_status, id] = params;
        const session = this.sessions.get(id);
        if (session) {
          session.status = status;
          session.finished_at = new Date();
          if (completed_laps != null) session.completed_laps = completed_laps;
          if (quality_status != null) session.quality_status = quality_status;
          return { rows: [{ ...session }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      if (upper.includes('COMPLETED_LAPS = COMPLETED_LAPS +')) {
        const session = this.sessions.get(params[0]);
        if (!session) return { rows: [], rowCount: 0 };
        session.completed_laps++;
        return { rows: [{ ...session }], rowCount: 1 };
      }
      if (upper.includes('RECEIVED_SAMPLES = RECEIVED_SAMPLES +')) {
        const [samplesCount, id] = params;
        const session = this.sessions.get(id);
        if (session) {
          session.received_samples += samplesCount;
          session.received_batches += 1;
          return { rows: [{ ...session }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
    }

    // 5. INSERT INTO telemetry_batches ON CONFLICT (session_id, batch_sequence) DO NOTHING
    if (upper.startsWith('INSERT INTO TELEMETRY_BATCHES')) {
      const [
        session_id, batch_sequence, sample_count, first_sample_index,
        last_sample_index, first_timestamp, last_timestamp,
        raw_bytes_size, compressed_bytes_size, payload_compressed
      ] = params;

      const key = `${session_id}:${batch_sequence}`;
      if (this.batches.has(key)) {
        // Idempotência: já existe -> ON CONFLICT DO NOTHING
        return { rows: [], rowCount: 0 };
      }

      const id = randomUUID();
      const batch = {
        id,
        session_id,
        batch_sequence,
        sample_count,
        first_sample_index,
        last_sample_index,
        first_timestamp,
        last_timestamp,
        raw_bytes_size,
        compressed_bytes_size,
        payload_compressed,
        created_at: new Date()
      };
      this.batches.set(key, batch);
      return { rows: [{ id, session_id, batch_sequence }], rowCount: 1 };
    }

    // 6. SELECT FROM telemetry_batches WHERE session_id = $1 AND batch_sequence = $2
    if (upper.startsWith('SELECT') && upper.includes('FROM TELEMETRY_BATCHES') && upper.includes('BATCH_SEQUENCE =')) {
      const [session_id, batch_sequence] = params;
      const key = `${session_id}:${batch_sequence}`;
      const batch = this.batches.get(key);
      return { rows: batch ? [{ ...batch }] : [], rowCount: batch ? 1 : 0 };
    }

    // 7. INSERT INTO telemetry_laps
    if (upper.startsWith('INSERT INTO TELEMETRY_LAPS')) {
      const [
        session_id, participant_id, lap_number, lap_time, sample_count,
        off_track_count, collision_count, spin_count, average_speed, max_speed, valid_lap
      ] = params;

      const key = `${session_id}:${participant_id}:${lap_number}`;
      if (this.laps.has(key)) return { rows: [], rowCount: 0 };
      const id = randomUUID();
      const lap = {
        id,
        session_id,
        participant_id,
        lap_number,
        lap_time,
        sample_count,
        off_track_count: off_track_count || 0,
        collision_count: collision_count || 0,
        spin_count: spin_count || 0,
        average_speed,
        max_speed,
        valid_lap: valid_lap !== false,
        created_at: new Date()
      };
      this.laps.set(key, lap);
      return { rows: [{ id, ...lap }], rowCount: 1 };
    }

    // 8. Transações
    if (upper === 'BEGIN' || upper === 'COMMIT' || upper === 'ROLLBACK') {
      return { rows: [], rowCount: 0 };
    }

    // DDL / Migrations silenciosas em memória
    if (upper.startsWith('CREATE TABLE') || upper.startsWith('CREATE INDEX')) {
      return { rows: [], rowCount: 0 };
    }

    return { rows: [], rowCount: 0 };
  }

  async getClient() {
    return {
      query: (text, params) => this.query(text, params),
      release: () => {}
    };
  }

  async end() {
    this.sessions.clear();
    this.batches.clear();
    this.laps.clear();
  }
}

// Criação do pool
let poolInstance = null;

export function getPool() {
  if (poolInstance) return poolInstance;

  const url = config.DATABASE_URL;
  const usePostgres = url && (url.startsWith('postgres://') || url.startsWith('postgresql://'));

  if (config.isProduction) {
    if (!usePostgres) {
      const errMsg = '[FATAL DB CONFIG] DATABASE_URL não configurada ou inválida em ambiente de PRODUÇÃO. O backend de produção não pode iniciar com In-Memory Store.';
      console.error(errMsg);
      throw new Error(errMsg);
    }
    console.log('[DB] PostgreSQL production pool initializing');
    // DATABASE_URL determina TLS (ex.: sslmode=require); não forçar SSL na URL interna.
    poolInstance = new Pool({
      connectionString: url,
      max: config.DB_POOL_MAX,
      idleTimeoutMillis: config.DB_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: config.DB_CONNECTION_TIMEOUT_MS
    });
  } else {
    if (usePostgres) {
      console.log('[DB] PostgreSQL development pool initializing');
      poolInstance = new Pool({
        connectionString: url,
        max: config.DB_POOL_MAX,
        idleTimeoutMillis: config.DB_IDLE_TIMEOUT_MS,
        connectionTimeoutMillis: config.DB_CONNECTION_TIMEOUT_MS,
        ssl: false
      });
    } else {
      console.log('[DB] Operando com In-Memory Database Store para desenvolvimento local / testes.');
      poolInstance = new InMemoryStore();
    }
  }

  return poolInstance;
}

export const db = {
  query: (text, params) => getPool().query(text, params),
  getClient: () => { const pool = getPool(); return pool.isMemory ? pool.getClient() : pool.connect(); },
  end: () => poolInstance && poolInstance.end && poolInstance.end(),
  isMemory: () => Boolean(getPool().isMemory)
};
