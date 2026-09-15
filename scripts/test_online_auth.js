import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import express from 'express';
import { WebSocket } from 'ws';
import { createAuthRouter } from '../server/src/auth/router.js';
import { createOnlineAccess } from '../server/src/auth/onlineAccess.js';
import { MemoryAccountStore } from '../server/src/auth/accountStore.js';
import { RoomHub } from '../server/src/online/rooms.js';
import { attachOnline } from '../server/src/online/socket.js';
import { ONLINE_VERSION } from '../src/online/protocol.js';

let passed = 0;
const test = async (name, run) => { await run(); passed++; console.log(`PASS ${name}`); };
const store = new MemoryAccountStore(), raw = randomBytes(32).toString('hex');
const hash = createHash('sha256').update(raw).digest('hex'), origin = 'http://127.0.0.1:5185';
const session = { hash, expiresAt: Date.now() + 60000 };
const user = await store.register({ username: 'test_account', pilotName: 'Nome Verificado', passwordHash: 'test-only' }, session);
let now = Date.now();
const access = createOnlineAccess({ getStore: () => store, clock: () => now });
const cookie = `qg_session=${raw}`;
await test('anonymous and forged session cookies cannot obtain tickets', async () => {
  for (const value of ['', 'qg_session=fake', `qg_session=${'0'.repeat(64)}`]) await assert.rejects(access.issue(value, origin), /AUTH_REQUIRED/);
});
await test('ticket is single-use and yields the database identity', async () => {
  const ticket = await access.issue(cookie, origin), identity = await access.consume(ticket, origin);
  assert.equal(identity.accountId, user.id); assert.equal(identity.pilotName, user.pilotName);
  await assert.rejects(access.consume(ticket, origin), /AUTH_REQUIRED/);
});
await test('ticket cannot be used by a different origin', async () => {
  await assert.rejects(access.consume(await access.issue(cookie, origin), 'https://other.invalid'), /AUTH_REQUIRED/);
});
await test('issuing a replacement invalidates a pending ticket and expired tickets fail', async () => {
  const old = await access.issue(cookie, origin), latest = await access.issue(cookie, origin);
  await assert.rejects(access.consume(old, origin), /AUTH_REQUIRED/);
  now += 30001; await assert.rejects(access.consume(latest, origin), /AUTH_REQUIRED/); now = Date.now();
});
await test('production only accepts the secure production session cookie', async () => {
  const secure = createOnlineAccess({ getStore: () => store, production: true });
  await assert.rejects(secure.issue(cookie, origin), /AUTH_REQUIRED/);
  assert.ok(await secure.consume(await secure.issue(`__Host-qg_session=${raw}`, origin), origin));
});
const identity = await access.consume(await access.issue(cookie, origin), origin);
await test('room creation, joining and resuming require a trusted identity', () => {
  const hub = new RoomHub();
  for (const type of ['create', 'join', 'resume']) assert.throws(() => hub.attach(() => {}, { type, version: ONLINE_VERSION }), /AUTH_REQUIRED/);
  assert.equal(hub.rooms.size, 0);
});
await test('server ignores forged pilot names and blocks duplicate account participants', () => {
  const hub = new RoomHub(), request = { type: 'create', version: ONLINE_VERSION, name: 'Impostor', auto: true,
    settings: { laps: 3, rounds: 1, weather: 'dry', trackId: 21 } };
  const player = hub.attach(() => {}, request, identity);
  assert.equal(player.name, user.pilotName);
  assert.throws(() => hub.attach(() => {}, request, identity), /ACCOUNT_IN_ROOM/);
  assert.equal(hub.rooms.size, 1);
  hub.disconnect(player);
  const resume = { type: 'resume', version: ONLINE_VERSION, token: player.token };
  assert.throws(() => hub.attach(() => {}, resume, { ...identity, accountId: 'other' }), /AUTH_REQUIRED/);
  assert.equal(hub.attach(() => {}, resume, identity), player);
  const publicText = JSON.stringify(hub.publicRoom(player.room));
  assert.ok(!publicText.includes(identity.accountId) && !publicText.includes(hash) && !publicText.includes(player.token));
});
await test('session revocation invalidates issued tickets and connected identities', async () => {
  const ticket = await access.issue(cookie, origin);
  await store.deleteSession(hash);
  assert.equal(await access.validate(identity), false);
  await assert.rejects(access.consume(ticket, origin), /AUTH_REQUIRED/);
});
await test('real HTTP ticket guard and WebSocket logout revocation fail closed', async () => {
  const app = express(), auth = createAuthRouter({ getStore: () => store, production: false });
  app.use(express.json()); app.use('/api/v1/auth', auth);
  const server = createServer(app), online = attachOnline(server, { onlineAccess: auth.onlineAccess });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { origin: base, 'content-type': 'application/json', 'x-quick-grid-auth': '1' };
  let ws;
  try {
    const post = (route, body = {}, extra = {}) => fetch(`${base}/api/v1/auth/${route}`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    assert.equal((await post('online-ticket')).status, 401);
    assert.equal((await post('online-ticket', {}, { origin: 'https://foreign.invalid' })).status, 403);
    const registration = await post('register', { username: 'socket_account', pilotName: 'Piloto Real', password: '123456' });
    assert.equal(registration.status, 201);
    const sessionCookie = registration.headers.get('set-cookie').split(';')[0];
    const response = await post('online-ticket', {}, { cookie: sessionCookie });
    assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
    const { ticket } = await response.json();
    ws = new WebSocket(base.replace('http:', 'ws:') + '/online', { origin: base });
    const messages = []; ws.on('message', data => messages.push(JSON.parse(data)));
    await new Promise(resolve => ws.once('open', resolve));
    ws.send(JSON.stringify({ type: 'create', version: ONLINE_VERSION, ticket, auto: true, settings: { laps: 3, rounds: 1, weather: 'dry', trackId: 21 } }));
    const wait = async (fn, ms) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw Error('WS_TIMEOUT'); await new Promise(r => setTimeout(r, 20)); } };
    await wait(() => messages.some(m => m.type === 'welcome'), 3000);
    assert.equal((await post('logout', {}, { cookie: sessionCookie })).status, 200);
    await wait(() => messages.some(m => m.code === 'AUTH_REQUIRED'), 12000);
    assert.equal(online.hub.sessions.size, 0);
    assert.equal((await post('online-ticket', {}, { cookie: sessionCookie })).status, 401);
  } finally { ws?.terminate(); online.close(); await new Promise(resolve => server.close(resolve)); }
});
console.log(`${passed} PASSOU | 0 FALHOU`);
