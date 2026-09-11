import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const options = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
// Bound concurrent memory-hard jobs on the Free instance; reject overload, never weaken hashing.
let active = 0;
async function derive(password, salt) {
  if (active >= 2) throw Object.assign(new Error('AUTH_BUSY'), { code: 'AUTH_BUSY', status: 503 });
  active++;
  try { return await scrypt(password, salt, 64, options); } finally { active--; }
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt);
  return `scrypt-v1$${salt}$${hash.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  const valid = parts.length === 3 && parts[0] === 'scrypt-v1'
    && /^[a-f0-9]{32}$/.test(parts[1]) && /^[a-f0-9]{128}$/.test(parts[2]);
  // Unknown accounts still incur the same KDF work; never return a user-existence hint.
  const hash = await derive(password, valid ? parts[1] : '0'.repeat(32));
  const expected = Buffer.from(valid ? parts[2] : '0'.repeat(128), 'hex');
  return timingSafeEqual(hash, expected) && valid;
}
