import assert from 'node:assert/strict';

// Local test accounts only. Passwords/cookies/tickets stay in RAM and are never logged.
export async function registerBrowserAccount(page, pilotName = 'Piloto Teste') {
  if (!['localhost', '127.0.0.1'].includes(new URL(page.url()).hostname)) throw Error('LOCAL_ONLY');
  await page.click('#account-open');
  await page.locator('#auth-register-tab').waitFor({ state: 'visible' });
  await page.click('#auth-register-tab');
  await page.fill('#auth-username', `test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`);
  await page.fill('#auth-pilot', pilotName); await page.fill('#auth-password', '123456');
  await page.click('#auth-submit'); await page.locator('#auth-account').waitFor({ state: 'visible' });
  await page.click('#auth-guest');
}

export async function protocolAccountTicket(browser, target, pilotName = 'Piloto Protocolo') {
  const origin = new URL(target).origin;
  if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw Error('LOCAL_ONLY');
  const context = await browser.newContext();
  try {
    const headers = { origin, 'x-quick-grid-auth': '1' };
    const response = await context.request.post(`${origin}/api/v1/auth/register`, { headers,
      data: { username: `test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`, pilotName, password: '123456' } });
    assert.equal(response.status(), 201);
    const access = await context.request.post(`${origin}/api/v1/auth/online-ticket`, { headers, data: {} });
    assert.equal(access.status(), 200); return (await access.json()).ticket;
  } finally { await context.close(); }
}
