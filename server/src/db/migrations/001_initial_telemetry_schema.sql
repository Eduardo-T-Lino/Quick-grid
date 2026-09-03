-- ========== QUICK-GRID TELEMETRY SCHEMA (FASE ML2.0) ==========
-- Criação das tabelas relacionais de sessões, batches comprimidos e resumos de voltas

CREATE TABLE IF NOT EXISTS telemetry_sessions (
    id UUID PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    schema_version INT NOT NULL,
    track_id INT NOT NULL,
    sample_rate_hz NUMERIC(5, 2) NOT NULL DEFAULT 10.00,
    scope VARCHAR(32) NOT NULL DEFAULT 'PLAYER_ONLY',
    game_build_version VARCHAR(64) NOT NULL,
    track_geometry_version VARCHAR(64) NOT NULL,
    physics_version VARCHAR(64) NOT NULL,
    feature_manifest_version VARCHAR(64) NOT NULL,
    consent_version VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    received_samples INT NOT NULL DEFAULT 0,
    received_batches INT NOT NULL DEFAULT 0,
    completed_laps INT NOT NULL DEFAULT 0,
    quality_status VARCHAR(32),
    client_info JSONB
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON telemetry_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_track_id ON telemetry_sessions(track_id);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON telemetry_sessions(created_at DESC);

-- Batches de telemetria bruta comprimidos via GZIP (BYTEA) com restrição de unicidade para idempotência
CREATE TABLE IF NOT EXISTS telemetry_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES telemetry_sessions(id) ON DELETE CASCADE,
    batch_sequence INT NOT NULL,
    sample_count INT NOT NULL,
    first_sample_index INT,
    last_sample_index INT,
    first_timestamp NUMERIC(16, 3),
    last_timestamp NUMERIC(16, 3),
    raw_bytes_size INT NOT NULL,
    compressed_bytes_size INT NOT NULL,
    payload_compressed BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_session_batch_seq UNIQUE (session_id, batch_sequence)
);

CREATE INDEX IF NOT EXISTS idx_batches_session_id ON telemetry_batches(session_id);
CREATE INDEX IF NOT EXISTS idx_batches_created_at ON telemetry_batches(created_at DESC);

-- Resumos relacionais de voltas concluídas
CREATE TABLE IF NOT EXISTS telemetry_laps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES telemetry_sessions(id) ON DELETE CASCADE,
    participant_id VARCHAR(64) NOT NULL,
    lap_number INT NOT NULL,
    lap_time NUMERIC(10, 3) NOT NULL,
    sample_count INT NOT NULL,
    off_track_count INT NOT NULL DEFAULT 0,
    collision_count INT NOT NULL DEFAULT 0,
    spin_count INT NOT NULL DEFAULT 0,
    average_speed NUMERIC(8, 4),
    max_speed NUMERIC(8, 4),
    valid_lap BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_session_lap UNIQUE (session_id, participant_id, lap_number)
);

CREATE INDEX IF NOT EXISTS idx_laps_session_id ON telemetry_laps(session_id);
