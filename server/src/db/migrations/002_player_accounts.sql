CREATE TABLE IF NOT EXISTS player_accounts (
  id UUID PRIMARY KEY,
  username VARCHAR(24) NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,24}$'),
  pilot_name VARCHAR(32) NOT NULL CHECK (char_length(pilot_name) BETWEEN 2 AND 32),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS player_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES player_accounts(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS player_sessions_expiry_idx ON player_sessions(expires_at);
CREATE INDEX IF NOT EXISTS player_sessions_user_idx ON player_sessions(user_id);
