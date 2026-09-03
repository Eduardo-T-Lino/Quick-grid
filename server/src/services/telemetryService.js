// ========== TELEMETRY INGESTION SERVICE (FASE ML2.0) ==========
// Gerencia criação de sessões, compressão GZIP de batches, persistência transacional e idempotência

import zlib from 'zlib';
import { randomUUID } from 'crypto';
import { db } from '../db/pool.js';
import { createIngestToken, createRefreshCredential } from '../security/ingestToken.js';

export class TelemetryService {
  /**
   * Cria uma nova sessão de telemetria e emite o token HMAC de ingestão
   */
  async createSession(sessionData) {
    const sessionId = randomUUID();

    const query = `
      INSERT INTO telemetry_sessions (
        id, schema_version, track_id, sample_rate_hz, scope,
        game_build_version, track_geometry_version, physics_version,
        feature_manifest_version, consent_version, status, client_info
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *;
    `;

    const params = [
      sessionId,
      sessionData.schemaVersion,
      sessionData.trackId,
      sessionData.sampleRateHz,
      sessionData.scope,
      sessionData.gameBuildVersion,
      sessionData.trackGeometryVersion,
      sessionData.physicsVersion,
      sessionData.featureManifestVersion,
      sessionData.consentVersion,
      'ACTIVE',
      JSON.stringify(sessionData.clientInfo || {})
    ];

    await db.query(query, params);

    // Gerar token de ingestão temporário escopado exclusivamente para esta sessão
    const { ingestToken, expiresAt } = createIngestToken(sessionId);
    const { refreshCredential, refreshExpiresAt } = createRefreshCredential(sessionId);

    return {
      sessionId,
      ingestToken,
      expiresAt,
      refreshCredential,
      refreshExpiresAt,
      status: 'ACTIVE',
      schemaVersion: sessionData.schemaVersion,
      trackId: sessionData.trackId
    };
  }

  /**
   * Obtém metadados de uma sessão existente
   */
  async getSession(sessionId) {
    const res = await db.query('SELECT * FROM telemetry_sessions WHERE id = $1;', [sessionId]);
    return res.rows[0] || null;
  }

  /**
   * Processa e persiste um batch bruto com compressão GZIP e garantia de idempotência
   */
  async ingestBatch(sessionId, batchSequence, samples) {
    const session = await this.getSession(sessionId);
    if (!session) {
      const err = new Error(`Sessão ${sessionId} não encontrada`);
      err.statusCode = 404;
      err.code = 'SESSION_NOT_FOUND';
      throw err;
    }

    if (session.status !== 'ACTIVE') {
      const err = new Error(`Sessão ${sessionId} está ${session.status} e não aceita novos batches.`);
      err.statusCode = 409;
      err.code = 'SESSION_NOT_ACTIVE';
      throw err;
    }

    const sampleCount = samples.length;
    const firstSample = samples[0];
    const lastSample = samples[samples.length - 1];

    const firstSampleIndex = firstSample.metadata?.sampleIndex;
    const lastSampleIndex = lastSample.metadata?.sampleIndex;
    const firstTimestamp = firstSample.metadata?.timestamp;
    const lastTimestamp = lastSample.metadata?.timestamp;

    // 1. Serializar e Comprimir Batch Bruto via GZIP
    const rawJSON = JSON.stringify(samples);
    const rawBytesSize = Buffer.byteLength(rawJSON, 'utf8');
    const compressedBuffer = zlib.gzipSync(rawJSON, { level: 6 });
    const compressedBytesSize = compressedBuffer.length;
    const compressionRatio = rawBytesSize > 0
      ? ((1 - (compressedBytesSize / rawBytesSize)) * 100).toFixed(1)
      : '0.0';

    // 2. Persistir com Transação e ON CONFLICT DO NOTHING (Idempotência)
    const client = await db.getClient();
    let isDuplicate = false;

    try {
      await client.query('BEGIN');
      // Serialize ingestion against completion on the same session.
      const locked = await client.query('SELECT * FROM telemetry_sessions WHERE id = $1 FOR UPDATE;', [sessionId]);
      if (locked.rows[0]?.status !== 'ACTIVE') {
        throw Object.assign(new Error('Session no longer active'), { statusCode: 409, code: 'SESSION_NOT_ACTIVE' });
      }

      const insertBatchQuery = `
        INSERT INTO telemetry_batches (
          session_id, batch_sequence, sample_count, first_sample_index,
          last_sample_index, first_timestamp, last_timestamp,
          raw_bytes_size, compressed_bytes_size, payload_compressed
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (session_id, batch_sequence) DO NOTHING
        RETURNING id;
      `;

      const insertParams = [
        sessionId,
        batchSequence,
        sampleCount,
        firstSampleIndex,
        lastSampleIndex,
        firstTimestamp,
        lastTimestamp,
        rawBytesSize,
        compressedBytesSize,
        compressedBuffer
      ];

      const resBatch = await client.query(insertBatchQuery, insertParams);

      if (resBatch.rowCount === 0) {
        // Idempotência: O batch com este sequence já foi gravado anteriormente!
        isDuplicate = true;
      } else {
        // Batch novo inserido com sucesso: atualizar contadores atômicos da sessão
        const updateSessionQuery = `
          UPDATE telemetry_sessions
          SET received_samples = received_samples + $1,
              received_batches = received_batches + 1
          WHERE id = $2;
        `;
        await client.query(updateSessionQuery, [sampleCount, sessionId]);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      if (client.release) client.release();
    }

    return {
      success: true,
      status: isDuplicate ? 'ALREADY_PROCESSED' : 'PROCESSED',
      sessionId,
      batchSequence,
      sampleCount,
      isDuplicate,
      rawBytesSize,
      compressedBytesSize,
      compressionRatio: `${compressionRatio}%`
    };
  }

  /**
   * Registra o resumo de uma volta completada com garantia de idempotência
   */
  async recordLap(lapData) {
    const session = await this.getSession(lapData.sessionId);
    if (!session) {
      const err = new Error(`Sessão ${lapData.sessionId} não encontrada`);
      err.statusCode = 404;
      err.code = 'SESSION_NOT_FOUND';
      throw err;
    }

    const query = `
      INSERT INTO telemetry_laps (
        session_id, participant_id, lap_number, lap_time, sample_count,
        off_track_count, collision_count, spin_count, average_speed, max_speed, valid_lap
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (session_id, participant_id, lap_number) DO NOTHING
      RETURNING *;
    `;

    const params = [
      lapData.sessionId,
      lapData.participantId,
      lapData.lapNumber,
      lapData.lapTime,
      lapData.sampleCount,
      lapData.offTrackCount || 0,
      lapData.collisionCount || 0,
      lapData.spinCount || 0,
      lapData.averageSpeed,
      lapData.maxSpeed,
      lapData.validLap !== false
    ];

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT * FROM telemetry_sessions WHERE id = $1 FOR UPDATE;', [lapData.sessionId]);
      if (locked.rows[0]?.status !== 'ACTIVE') {
        throw Object.assign(new Error('Session no longer active'), { statusCode: 409, code: 'SESSION_NOT_ACTIVE' });
      }
      const res = await client.query(query, params);
      if (res.rowCount === 0) {
        await client.query('COMMIT');
      // Idempotência: lap já persistido anteriormente
      return {
        session_id: lapData.sessionId,
        participant_id: lapData.participantId,
        lap_number: lapData.lapNumber,
        lap_time: lapData.lapTime,
        status: 'ALREADY_PROCESSED',
        isDuplicate: true
      };
    }

    // Incrementar completed_laps na sessão apenas na primeira inserção
    await client.query(
      'UPDATE telemetry_sessions SET completed_laps = completed_laps + 1 WHERE id = $1;',
      [lapData.sessionId]
    );
    await client.query('COMMIT');

    return {
      ...res.rows[0],
      status: 'PROCESSED',
      isDuplicate: false
    };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release?.();
    }
  }

  /**
   * Renova o token de ingestão temporário para uma sessão ativa
   */
  async refreshToken(sessionId) {
    const session = await this.getSession(sessionId);
    if (!session) {
      const err = new Error(`Sessão ${sessionId} não encontrada`);
      err.statusCode = 404;
      err.code = 'SESSION_NOT_FOUND';
      throw err;
    }

    if (session.status !== 'ACTIVE') {
      const err = new Error(`Sessão ${sessionId} não está ativa (${session.status}). Impossível renovar token.`);
      err.statusCode = 409;
      err.code = 'SESSION_NOT_ACTIVE';
      throw err;
    }

    const { ingestToken, expiresAt } = createIngestToken(sessionId);
    return {
      sessionId,
      ingestToken,
      expiresAt,
      refreshed: true
    };
  }

  /**
   * Finaliza uma sessão de telemetria
   */
  async completeSession(sessionId, completionData = {}) {
    const session = await this.getSession(sessionId);
    if (!session) {
      const err = new Error(`Sessão ${sessionId} não encontrada`);
      err.statusCode = 404;
      err.code = 'SESSION_NOT_FOUND';
      throw err;
    }

    const query = `
      UPDATE telemetry_sessions
      SET status = $1,
          completed_laps = COALESCE($2, completed_laps),
          quality_status = COALESCE($3, quality_status),
          finished_at = NOW()
      WHERE id = $4
      RETURNING *;
    `;

    const params = [
      'COMPLETED',
      null, // Count only persisted laps, never overwrite with a client estimate.
      completionData.qualityStatus || null,
      sessionId
    ];

    const res = await db.query(query, params);
    return res.rows[0];
  }
}

export const telemetryService = new TelemetryService();
