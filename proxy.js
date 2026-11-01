import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/cron/sync'];

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  // Cookie sesi tidak boleh dipakai oleh halaman domain lain untuk memodifikasi data.
  // The scheduler authenticates using its own bearer token, rather than a browser cookie.
  if (pathname.startsWith('/api/') && pathname !== '/api/cron/sync' && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin');
    const configuredUrl = process.env.APP_ORIGIN || process.env.NEXT_PUBLIC_APP_URL;
    let configuredOrigin;
    try { configuredOrigin = configuredUrl ? new URL(configuredUrl).origin : null; } catch { configuredOrigin = null; }
    if (!configuredOrigin && process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Konfigurasi URL aplikasi belum siap.' }, { status: 503 });
    }
    if (!origin || (origin !== configuredOrigin && !(process.env.NODE_ENV !== 'production' && origin === request.nextUrl.origin))) {
      return NextResponse.json({ error: 'Permintaan lintas-domain ditolak.' }, { status: 403 });
    }
  }

  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();

  const token = request.cookies.get('auth_token')?.value;

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Autentikasi diperlukan.' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  const secretValue = process.env.JWT_SECRET;
  if (!secretValue || secretValue.length < 32) {
    return NextResponse.json({ error: 'Konfigurasi sesi server belum aman.' }, { status: 503 });
  }

  try {
    const secret = new TextEncoder().encode(secretValue);
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.sessionProof !== 'string' || !/^[a-f0-9]{64}$/.test(payload.sessionProof)) throw new Error('Invalid session');
    return NextResponse.next();
  } catch (e) {
    if (pathname.startsWith('/api/')) {
      const response = NextResponse.json({ error: 'Sesi tidak valid atau telah berakhir.' }, { status: 401 });
      response.cookies.delete('auth_token');
      return response;
    }
    const loginUrl = new URL('/login', request.url);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete('auth_token');
    return response;
  }
}

export const config = {
  matcher: ['/api/:path*', '/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)'],
};
