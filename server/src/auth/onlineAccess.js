import { createHash, randomBytes } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
const denied = () => { throw Error('AUTH_REQUIRED'); };

// One-use, origin-bound tickets bridge the same-origin auth proxy and direct WebSocket.
// Raw session cookies never leave the HTTP auth endpoint or enter a WebSocket URL.
export function createOnlineAccess({ getStore, production = false, clock = Date.now }) {
  const tickets = new Map(), cookieName = production ? '__Host-qg_session' : 'qg_session';
  async function validate(identity) {
    if (!identity || identity.expiresAt <= clock()) return false;
    const user = await getStore().sessionUser(identity.sessionHash);
    return Boolean(user && user.id === identity.accountId && new Date(user.expiresAt).getTime() > clock());
  }
  return {
    validate,
    async issue(cookie, origin) {
      const raw = (cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
      if (!origin || !/^[a-f0-9]{64}$/.test(raw || '')) denied();
      const sessionHash = digest(raw), user = await getStore().sessionUser(sessionHash);
      if (!user || new Date(user.expiresAt).getTime() <= clock()) denied();
      for (const [key, entry] of tickets) if (entry.until <= clock() || entry.identity.sessionHash === sessionHash) tickets.delete(key);
      if (tickets.size >= 4096) denied();
      const ticket = randomBytes(32).toString('hex');
      tickets.set(digest(ticket), { origin, until: clock() + 30000,
        identity: { accountId: user.id, pilotName: user.pilotName, sessionHash, expiresAt: new Date(user.expiresAt).getTime() } });
      return ticket;
    },
    async consume(ticket, origin) {
      if (typeof ticket !== 'string' || !/^[a-f0-9]{64}$/.test(ticket)) denied();
      const key = digest(ticket), entry = tickets.get(key);
      tickets.delete(key);
      if (!entry || entry.until <= clock() || entry.origin !== origin || !await validate(entry.identity)) denied();
      return entry.identity;
    }
  };
}
