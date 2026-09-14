// Isolated local preview + local backend, never run against production.
(async () => {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) throw Error('LOCAL_ONLY');
  const el = id => document.getElementById(id);
  const url = path => performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === path)?.name || path;
  const { state, startGame, backToMenu } = await import(url('/src/game.js'));
  const { onlineUploader } = await import(url('/src/ml/telemetry/index.js'));
  const waitUntil = async fn => { const until = performance.now() + 15000; while (!fn()) { if (performance.now() > until) throw Error('UI_TIMEOUT: ' + el('auth-status').textContent); await new Promise(r => setTimeout(r, 40)); } };
  const checks = [], assert = (ok, name) => { if (!ok) throw Error(name); checks.push(name); };
  const originalFetch = window.fetch;
  window.fetch = (url, opts) => String(url).startsWith('http://localhost:3001/api/')
    ? Promise.resolve(new Response('{}', { status: 200 })) : originalFetch(url, opts);
  const username = `test_${crypto.randomUUID().slice(0, 8)}`, password = '739182'; // Synthetic six-digit fixture.
  async function ready() { await waitUntil(() => !el('auth-submit').disabled); }
  async function login() {
    el('auth-username').value = username; el('auth-password').value = password;
    el('auth-form').requestSubmit(); await waitUntil(() => !el('auth-account').hidden); await ready();
  }
  try {
    assert(!onlineUploader.consentEnabled, 'Auth testing does not enable telemetry');
    el('account-open').click(); await ready();
    assert(el('auth-dialog').open && !el('auth-guest').hidden, 'Account dialog keeps guest access available');
    el('auth-register-tab').click();
    el('auth-username').value = username; el('auth-pilot').value = 'Piloto de Teste'; el('auth-password').value = password;
    el('auth-form').requestSubmit(); await waitUntil(() => !el('auth-account').hidden); await ready();
    assert(el('auth-greeting').textContent === 'Piloto de Teste', 'Registration displays the pilot name');
    assert(el('auth-password').value === '', 'Password input is cleared after registration');
    assert(!document.cookie.includes('qg_session'), 'Session cookie is inaccessible to browser JavaScript');
    const me = await (await originalFetch('/api/v1/auth/me')).json();
    assert(me.user.username === username && me.temporary, 'Real local API confirms session and temporary development storage');
    assert(!Object.values(localStorage).some(value => value.includes(password)), 'Password is not persisted in localStorage');
    el('auth-guest').click(); await startGame();
    assert(state.cars[0].name === 'Piloto de Teste', 'Race uses the authenticated pilot display name');
    backToMenu(); el('account-open').click(); await ready(); el('auth-logout').click();
    await waitUntil(() => el('auth-account').hidden); await ready();
    assert((await (await originalFetch('/api/v1/auth/me')).json()).user === null, 'Logout revokes the server session');
    el('auth-guest').click(); await startGame();
    assert(state.cars[0].name === 'Você (P1)', 'Guest can still start a race after logout');
    backToMenu(); el('account-open').click(); await ready();
    el('auth-username').value = username; el('auth-password').value = 'incorrect password'; el('auth-form').requestSubmit();
    await waitUntil(() => el('auth-status').textContent.includes('incorretos')); await ready();
    assert(el('auth-account').hidden, 'Invalid password never signs in');
    await login();
    assert(el('account-open').textContent.includes('Piloto de Teste'), 'Existing account can sign in again');
    return { passed: checks.length, checks };
  } finally { backToMenu(); window.fetch = originalFetch; }
})()
