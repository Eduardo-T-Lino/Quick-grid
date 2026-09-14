import { randomUUID } from 'node:crypto';
import { db } from '../db/pool.js';
import { config } from '../config.js';

export class MemoryAccountStore {
  constructor() { this.users = new Map(); this.sessions = new Map(); this.temporary = true; }
  async findUser(username) { return this.users.get(username) || null; }
  async register(user, session) {
    if (this.users.has(user.username)) throw Object.assign(new Error('duplicate'), { code: '23505' });
    const stored = { ...user, id: randomUUID() };
    this.users.set(user.username, stored);
    await this.createSession(stored.id, session);
    return stored;
  }
  async createSession(userId, session) {
    for (const [key, value] of this.sessions) if (value.expiresAt <= Date.now()) this.sessions.delete(key);
    this.sessions.set(session.hash, { ...session, userId });
  }
  async sessionUser(hash) {
    const session = this.sessions.get(hash);
    if (!session || session.expiresAt <= Date.now()) { this.sessions.delete(hash); return null; }
    const user = [...this.users.values()].find(u => u.id === session.userId);
    return user ? { ...user, expiresAt: session.expiresAt } : null;
  }
  async deleteSession(hash) { this.sessions.delete(hash); }
}

export class PostgresAccountStore {
  constructor(database) { this.db = database; this.temporary = false; }
  async findUser(username) {
    const result = await this.db.query('SELECT id, username, pilot_name AS "pilotName", password_hash AS "passwordHash" FROM player_accounts WHERE username = $1', [username]);
    return result.rows[0] || null;
  }
  async register(user, session) {
    const client = await this.db.getClient();
    try {
      await client.query('BEGIN');
      const id = randomUUID();
      await client.query('INSERT INTO player_accounts (id, username, pilot_name, password_hash) VALUES ($1, $2, $3, $4)', [id, user.username, user.pilotName, user.passwordHash]);
      await client.query('INSERT INTO player_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [session.hash, id, new Date(session.expiresAt)]);
      await client.query('COMMIT');
      return { id, ...user };
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async createSession(userId, session) {
    await this.db.query('DELETE FROM player_sessions WHERE expires_at <= NOW()');
    await this.db.query('INSERT INTO player_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [session.hash, userId, new Date(session.expiresAt)]);
  }
  async sessionUser(hash) {
    const result = await this.db.query(`SELECT u.id, u.username, u.pilot_name AS "pilotName", s.expires_at AS "expiresAt"
      FROM player_sessions s JOIN player_accounts u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW()`, [hash]);
    return result.rows[0] || null;
  }
  async deleteSession(hash) { await this.db.query('DELETE FROM player_sessions WHERE token_hash = $1', [hash]); }
}

export function accountStoreProvider(database = db) {
  const memory = new MemoryAccountStore(), postgres = new PostgresAccountStore(database);
  return () => {
    if (!database.isMemory()) return postgres;
    if (config.isProduction) throw Object.assign(new Error('AUTH_DATABASE_REQUIRED'), { code: 'AUTH_DATABASE_REQUIRED' });
    return memory;
  };
}
