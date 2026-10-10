import { jwtVerify } from 'jose';

export async function getUserSession(request) {
  const token = request.cookies.get('auth_token')?.value;
  if (!token) return null;

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret');
    const { payload } = await jwtVerify(token, secret);
    return payload; // { username, role, department }
  } catch (e) {
    return null;
  }
}
