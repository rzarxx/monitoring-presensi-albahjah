import { jwtVerify } from 'jose';

export function getJwtSecret() {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) return null;
  return new TextEncoder().encode(value);
}

export async function getUserSession(request) {
  const token = request.cookies.get('auth_token')?.value;
  if (!token) return null;

  const secret = getJwtSecret();
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload; // { username, role, department }
  } catch (e) {
    return null;
  }
}
