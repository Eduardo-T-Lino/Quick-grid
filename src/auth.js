// Optional account UI. Credentials/session tokens are never stored in localStorage.
let user = null;
export function getPilotName() { return user?.pilotName || 'Você (P1)'; }
const messages = {
  AUTH_INVALID_CREDENTIALS: 'Usuário ou senha incorretos.',
  AUTH_USERNAME_UNAVAILABLE: 'Esse nome de usuário não está disponível.',
  AUTH_INVALID_REGISTRATION: 'Confira os campos: usuário de 3–24 caracteres, nome de piloto de 2–32 e senha de 6–128.',
  AUTH_RATE_LIMIT: 'Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.',
  AUTH_BUSY: 'Servidor ocupado. Tente novamente em instantes.',
  AUTH_ORIGIN_DENIED: 'O endereço deste jogo ainda não foi autorizado para login.',
  AUTH_UNAVAILABLE: 'Login indisponível no momento. Você pode continuar sem conta.'
};
async function request(path, body) {
  const response = await fetch(`/api/v1/auth/${path}`, { method: body ? 'POST' : 'GET',
    credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000),
    ...(body ? { headers: { 'Content-Type': 'application/json', 'X-Quick-Grid-Auth': '1' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !Object.hasOwn(data, 'user')) throw Error(messages[data.error] || messages.AUTH_UNAVAILABLE);
  return data;
}

export function initAuth() {
  const el = id => document.getElementById(id);
  const dialog = el('auth-dialog'), form = el('auth-form'), status = el('auth-status');
  let mode = 'login', busy = false;
  function setMode(next) {
    mode = next;
    el('auth-login-tab').setAttribute('aria-pressed', String(mode === 'login'));
    el('auth-register-tab').setAttribute('aria-pressed', String(mode === 'register'));
    el('auth-pilot-field').hidden = mode !== 'register';
    el('auth-pilot').required = mode === 'register';
    el('auth-password').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    el('auth-password').minLength = mode === 'register' ? 6 : 1;
    el('auth-password-hint').hidden = mode !== 'register';
    el('auth-submit').textContent = mode === 'register' ? 'CRIAR MINHA CONTA' : 'ENTRAR NO PADDOCK';
    el('auth-password').value = ''; status.textContent = '';
  }
  function render(data) {
    user = data.user;
    el('account-open').textContent = user ? `PILOTO · ${user.pilotName}` : 'ENTRAR / CRIAR CONTA';
    el('auth-account').hidden = !user;
    form.hidden = Boolean(user);
    el('auth-mode-switch').hidden = Boolean(user);
    el('auth-greeting').textContent = user ? user.pilotName : '';
    el('auth-username-display').textContent = user ? `@${user.username}` : '';
    el('auth-storage-note').hidden = !data.temporary;
    el('auth-guest').textContent = user ? 'VOLTAR AO PADDOCK' : 'CORRER SEM CONTA';
  }
  function setBusy(value) {
    busy = value;
    for (const button of dialog.querySelectorAll('button:not([data-auth-close])')) button.disabled = value;
    for (const input of form.querySelectorAll('input')) input.disabled = value;
    form.setAttribute('aria-busy', String(value));
  }
  async function refresh() {
    if (busy) return;
    setBusy(true);
    try { render(await request('me')); }
    catch (error) { user = null; render({ user: null }); status.textContent = messages.AUTH_UNAVAILABLE; }
    finally { setBusy(false); }
  }
  el('account-open').addEventListener('click', () => { dialog.showModal(); refresh(); });
  el('auth-login-tab').addEventListener('click', () => setMode('login'));
  el('auth-register-tab').addEventListener('click', () => setMode('register'));
  for (const button of dialog.querySelectorAll('[data-auth-close]')) button.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { el('auth-password').value = ''; });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    const body = { username: el('auth-username').value.trim(), password: el('auth-password').value,
      ...(mode === 'register' ? { pilotName: el('auth-pilot').value.trim() } : {}) };
    setBusy(true); status.textContent = mode === 'register' ? 'Criando sua conta…' : 'Verificando acesso…';
    try { render(await request(mode, body)); status.textContent = 'Tudo pronto. Nos vemos na pista.'; }
    catch (error) { status.textContent = error instanceof TypeError || error.name === 'TimeoutError' ? messages.AUTH_UNAVAILABLE : error.message; }
    finally { el('auth-password').value = ''; setBusy(false); }
  });
  el('auth-logout').addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    try { render(await request('logout', {})); setMode('login'); status.textContent = 'Você saiu da conta.'; }
    catch (error) { status.textContent = error instanceof TypeError || error.name === 'TimeoutError' ? messages.AUTH_UNAVAILABLE : error.message; }
    finally { setBusy(false); }
  });
  setMode('login'); refresh();
}
