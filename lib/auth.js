import { jwtVerify } from 'jose';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { query } from '@/lib/db';

export const isDepartmentManager = (role) => ['manager', 'kepala_divisi', 'kepala_subdivisi'].includes(role);

export function getJwtSecret() {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) return null;
  return new TextEncoder().encode(value);
}

export function sessionProof(secret, credential) {
  return createHmac('sha256', secret).update('attendance-session-v1\0').update(credential).digest('hex');
}

function matchesProof(secret, credential, proof) {
  if (typeof credential !== 'string' || typeof proof !== 'string' || !/^[a-f0-9]{64}$/.test(proof)) return false;
  return timingSafeEqual(Buffer.from(proof, 'hex'), Buffer.from(sessionProof(secret, credential), 'hex'));
}

export async function getUserSession(request) {
  const token = request.cookies.get('auth_token')?.value;
  if (!token) return null;

  const secret = getJwtSecret();
  if (!secret) return null;
  let payload;
  try {
    ({ payload } = await jwtVerify(token, secret));
  } catch {
    return null;
  }
  if (payload.bootstrap === true) {
    const [row] = await query('SELECT COUNT(*) AS count FROM admins');
    const credential = process.env.ADMIN_PASSWORD;
    return Number(row.count) === 0 && payload.username === process.env.ADMIN_USER && matchesProof(secret, credential, payload.sessionProof)
      ? { username: payload.username, role: 'superadmin', department: '' } : null;
  }
  if (!Number.isInteger(payload.adminId)) return null;
  const [admin] = await query('SELECT id, username, role, department, password FROM admins WHERE id = ?', [payload.adminId]);
  if (!admin || !matchesProof(secret, admin.password, payload.sessionProof) || (!['admin', 'sdm', 'superadmin'].includes(admin.role) && !isDepartmentManager(admin.role))) return null;
  return { id: admin.id, username: admin.username, role: admin.role, department: admin.department };
}
