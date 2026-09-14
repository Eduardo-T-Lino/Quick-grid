import express from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { accountStoreProvider } from './accountStore.js';
import { hashPassword, verifyPassword } from './passwords.js';

const TTL = 7 * 24 * 60 * 60 * 1000;
const digest = token => createHash('sha256').update(token).digest('hex');
export function validUsername(value) { return typeof value === 'string' && /^[a-zA-Z0-9_]{3,24}$/.test(value); }
const publicUser = user => user ? { id: user.id, username: user.username, pilotName: user.pilotName } : null;

export function createAuthRouter({ getStore = accountStoreProvider(), production = config.isProduction, allowedOrigins = config.CORS_ALLOWED_ORIGINS } = {}) {
  const router = express.Router();
  const cookieName = production ? '__Host-qg_session' : 'qg_session';
  const cookieOptions = { httpOnly: true, secure: production, sameSite: 'lax', path: '/' };
  const attempts = new Map();
  function tokenFrom(req) {
    const item = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`));
    const token = item?.slice(cookieName.length + 1);
    return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? token : null;
  }
  function guard(req, res, next) {
    const origin = req.get('origin');
    let permitted = allowedOrigins.includes(origin);
    if (!production && origin) {
      try { const url = new URL(origin); permitted = ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname); } catch { permitted = false; }
    }
    if (!permitted || req.get('x-quick-grid-auth') !== '1' || !req.is('application/json')) return res.status(403).json({ error: 'AUTH_ORIGIN_DENIED' });
    next();
  }
  function rateLimit(req, res, next) {
    const now = Date.now();
    for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
    // IP + account limits; fixed-size map fails closed rather than growing indefinitely.
    const username = typeof req.body?.username === 'string' ? req.body.username.toLowerCase() : '';
    const keys = [`ip:${req.ip}`, `user:${digest(username)}`];
    if (attempts.size >= 10000 && keys.some(key => !attempts.has(key))) return res.status(429).json({ error: 'AUTH_RATE_LIMIT' });
    if (keys.some(key => (attempts.get(key)?.count || 0) >= 15)) {
      res.set('Retry-After', '900'); return res.status(429).json({ error: 'AUTH_RATE_LIMIT' });
    }
    for (const key of keys) {
      const entry = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
      entry.count++; attempts.set(key, entry);
    }
    next();
  }
  async function issue(req, res, store, user, session, raw) {
    const previous = tokenFrom(req);
    if (previous) await store.deleteSession(digest(previous));
    res.cookie(cookieName, raw, { ...cookieOptions, maxAge: TTL });
    return { user: publicUser(user), expiresAt: new Date(session.expiresAt).toISOString(), temporary: store.temporary };
  }
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('X-Content-Type-Options', 'nosniff'); res.vary('Cookie'); next(); });
  router.get('/me', async (req, res) => {
    const store = getStore(), token = tokenFrom(req);
    const user = token ? await store.sessionUser(digest(token)) : null;
    if (!user && token) res.clearCookie(cookieName, cookieOptions);
    res.json({ user: publicUser(user), expiresAt: user ? new Date(user.expiresAt).toISOString() : null, temporary: store.temporary });
  });
  router.post('/register', guard, rateLimit, async (req, res) => {
    const { username, pilotName, password } = req.body || {};
    if (!validUsername(username) || typeof pilotName !== 'string' || !/^[\p{L}\p{N} ._'’-]{2,32}$/u.test(pilotName.trim())
      || typeof password !== 'string' || [...password].length < 6 || [...password].length > 128 || Buffer.byteLength(password) > 512) {
      return res.status(400).json({ error: 'AUTH_INVALID_REGISTRATION' });
    }
    const store = getStore(), raw = randomBytes(32).toString('hex');
    const session = { hash: digest(raw), expiresAt: Date.now() + TTL };
    const passwordHash = await hashPassword(password);
    try {
      const user = await store.register({ username: username.toLowerCase(), pilotName: pilotName.trim(), passwordHash }, session);
      res.status(201).json(await issue(req, res, store, user, session, raw));
    } catch (error) { if (error.code === '23505') return res.status(409).json({ error: 'AUTH_USERNAME_UNAVAILABLE' }); throw error; }
  });
  router.post('/login', guard, rateLimit, async (req, res) => {
    const { username, password } = req.body || {};
    if (!validUsername(username) || typeof password !== 'string' || password.length > 256 || Buffer.byteLength(password) > 512) return res.status(400).json({ error: 'AUTH_INVALID_INPUT' });
    const store = getStore(), user = await store.findUser(username.toLowerCase());
    if (!await verifyPassword(password, user?.passwordHash)) return res.status(401).json({ error: 'AUTH_INVALID_CREDENTIALS' });
    const raw = randomBytes(32).toString('hex'), session = { hash: digest(raw), expiresAt: Date.now() + TTL };
    await store.createSession(user.id, session);
    res.json(await issue(req, res, store, user, session, raw));
  });
  router.post('/logout', guard, async (req, res) => {
    const token = tokenFrom(req);
    if (token) await getStore().deleteSession(digest(token));
    res.clearCookie(cookieName, cookieOptions); res.json({ user: null });
  });
  // Auth errors never echo a driver exception, SQL, password, username or token.
  router.use((error, req, res, next) => {
    const busy = error.code === 'AUTH_BUSY';
    res.status(503).json({ error: busy ? 'AUTH_BUSY' : 'AUTH_UNAVAILABLE' });
  });
  return router;
}
