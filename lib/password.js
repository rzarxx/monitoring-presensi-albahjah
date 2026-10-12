import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const LEGACY_SHA256 = /^[a-f0-9]{64}$/i;

export function isValidPassword(value) {
  return typeof value === 'string' && value.length >= 12 && value.length <= 128;
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt}$${Buffer.from(hash).toString('hex')}`;
}

export async function verifyPassword(password, storedPassword) {
  if (typeof password !== 'string' || typeof storedPassword !== 'string') return { valid: false, upgrade: false };

  if (storedPassword.startsWith('scrypt$')) {
    const [, salt, storedHash] = storedPassword.split('$');
    if (!salt || !storedHash) return { valid: false, upgrade: false };
    const derivedHash = Buffer.from(await scrypt(password, salt, KEY_LENGTH));
    const expectedHash = Buffer.from(storedHash, 'hex');
    return {
      valid: expectedHash.length === derivedHash.length && crypto.timingSafeEqual(expectedHash, derivedHash),
      upgrade: false,
    };
  }

  // Akun lama di-upgrade otomatis sesudah login yang valid.
  const candidate = LEGACY_SHA256.test(storedPassword)
    ? crypto.createHash('sha256').update(password).digest('hex')
    : password;
  const left = Buffer.from(candidate);
  const right = Buffer.from(storedPassword);
  return { valid: left.length === right.length && crypto.timingSafeEqual(left, right), upgrade: true };
}
