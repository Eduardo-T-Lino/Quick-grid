import assert from 'node:assert/strict';
import express from 'express';
import { createHash } from 'node:crypto';
import { createAuthRouter } from '../server/src/auth/router.js';
import { MemoryAccountStore, PostgresAccountStore } from '../server/src/auth/accountStore.js';
import { hashPassword, verifyPassword } from '../server/src/auth/passwords.js';
const store = new MemoryAccountStore();
const app = express(); app.use(express.json({ limit: '8kb' }));
app.use('/api/v1/auth', createAuthRouter({ getStore: () => store, production: true, allowedOrigins: ['https://game.example'] }));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/api/v1/auth`;
let passed = 0;
async function test(label, fn) { await fn(); passed++; console.log(`PASS ${label}`); }
async function request(path, body, cookie = '', headers = {}) {
  const response = await fetch(`${base}/${path}`, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Origin: 'https://game.example', 'X-Quick-Grid-Auth': '1', Cookie: cookie, ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, headers: response.headers, data: await response.json() };
}
const credentials = { username: 'Piloto_Teste', pilotName: 'Piloto de Teste', password: '739182' }; // Six-digit synthetic fixture.
let cookie, oldCookie;
try {
  await test('password hashes are salted and checked with the real scrypt policy', async () => {
    const a = await hashPassword(credentials.password), b = await hashPassword(credentials.password);
    assert.notEqual(a, b); assert.ok(!a.includes(credentials.password));
    assert.equal(await verifyPassword(credentials.password, a), true);
    assert.equal(await verifyPassword('senha incorreta', a), false);
    assert.equal(await verifyPassword(credentials.password, null), false);
  });
  await test('guest session remains optional and uncached', async () => {
    const result = await request('me'); assert.equal(result.status, 200); assert.equal(result.data.user, null);
    assert.equal(result.headers.get('cache-control'), 'no-store');
  });
  await test('cross-site registration is rejected before password work', async () => {
    assert.equal((await request('register', credentials, '', { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await request('register', credentials, '', { 'X-Quick-Grid-Auth': '' })).status, 403);
  });
  await test('invalid username, pilot HTML and short passwords are rejected', async () => {
    for (const change of [{ username: '../admin' }, { pilotName: '<img src=x>' }, { password: 'short' }]) {
      assert.equal((await request('register', { ...credentials, ...change })).status, 400);
    }
  });
  await test('six-digit registration creates a protected cookie and never returns password/hash/token', async () => {
    const result = await request('register', credentials);
    assert.equal(result.status, 201); assert.equal(result.data.user.username, 'piloto_teste');
    assert.equal(result.data.user.pilotName, credentials.pilotName);
    assert.deepEqual(Object.keys(result.data.user).sort(), ['id', 'pilotName', 'username']);
    const setCookie = result.headers.get('set-cookie');
    for (const flag of ['__Host-qg_session=', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(setCookie.includes(flag));
    cookie = setCookie.split(';')[0]; oldCookie = cookie;
    assert.ok(!JSON.stringify(result.data).includes(credentials.password));
    const token = cookie.split('=')[1];
    assert.equal(store.sessions.has(token), false);
    assert.equal(store.sessions.has(createHash('sha256').update(token).digest('hex')), true);
  });
  await test('duplicate usernames are case-insensitive', async () => {
    assert.equal((await request('register', { ...credentials, username: 'PILOTO_TESTE' })).status, 409);
  });
  await test('wrong password and unknown user produce the same response', async () => {
    const a = await request('login', { ...credentials, password: 'invalid password' });
    const b = await request('login', { username: 'unknown_user', password: 'invalid password' });
    assert.equal(a.status, 401); assert.equal(b.status, 401); assert.deepEqual(a.data, b.data);
  });
  await test('login rotates the session and invalidates the previous token', async () => {
    const result = await request('login', credentials, cookie); assert.equal(result.status, 200);
    cookie = result.headers.get('set-cookie').split(';')[0]; assert.notEqual(cookie, oldCookie);
    assert.equal((await request('me', null, oldCookie)).data.user, null);
    assert.equal((await request('me', null, cookie)).data.user.username, 'piloto_teste');
  });
  await test('tampered and expired sessions cannot authenticate', async () => {
    assert.equal((await request('me', null, '__Host-qg_session=' + 'f'.repeat(64))).data.user, null);
    for (const session of store.sessions.values()) session.expiresAt = 0;
    assert.equal((await request('me', null, cookie)).data.user, null);
  });
  await test('logout revokes the server session', async () => {
    const login = await request('login', credentials);
    cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('logout', {}, cookie)).status, 200);
    assert.equal((await request('me', null, cookie)).data.user, null);
  });
  await test('login has bounded rate limiting', async () => {
    let limited = false;
    for (let i = 0; i < 16; i++) {
      const result = await request('login', { username: 'bad', password: 'x' });
      if (result.status === 429) { limited = true; break; }
    }
    assert.equal(limited, true);
  });
  await test('PostgreSQL registration uses a transaction and parameterized queries', async () => {
    const queries = []; let released = false;
    const database = { getClient: async () => ({ query: async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; }, release() { released = true; } }) };
    const pg = new PostgresAccountStore(database);
    await pg.register({ username: 'safe_user', pilotName: 'Piloto', passwordHash: 'fixture-hash' }, { hash: 'a'.repeat(64), expiresAt: Date.now() + 1000 });
    assert.equal(queries[0].sql, 'BEGIN'); assert.equal(queries.at(-1).sql, 'COMMIT'); assert.ok(released);
    assert.ok(queries[1].sql.includes('$4')); assert.ok(!queries[1].sql.includes('safe_user'));
  });
  await test('PostgreSQL failed registration rolls back and releases the client', async () => {
    const queries = []; let released = false;
    const pg = new PostgresAccountStore({ getClient: async () => ({ query: async sql => { queries.push(sql); if (sql.startsWith('INSERT')) throw Error('fixture'); }, release() { released = true; } }) });
    await assert.rejects(pg.register({ username: 'safe_user' }, { hash: 'a', expiresAt: Date.now() }));
    assert.equal(queries.at(-1), 'ROLLBACK'); assert.ok(released);
  });
} finally { await new Promise(resolve => server.close(resolve)); }
console.log(`${passed} auth checks passed`);
