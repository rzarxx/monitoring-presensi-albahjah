import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const PUBLIC_PATHS = ['/login', '/api/auth/login'];

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  // Izinkan akses ke path publik
  if (PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  // Cookie sesi tidak boleh dipakai oleh halaman domain lain untuk memodifikasi data.
  if (pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin');
    const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin : null;
    const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
    const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
    const forwardedOrigin = forwardedHost ? `${forwardedProto.split(',')[0].trim()}://${forwardedHost.split(',')[0].trim()}` : null;
    if (
      !origin ||
      (origin !== request.nextUrl.origin &&
        origin !== configuredOrigin &&
        origin !== forwardedOrigin &&
        `https://${forwardedHost}` !== origin &&
        `http://${forwardedHost}` !== origin)
    ) {
      return NextResponse.json({ error: 'Permintaan lintas-domain ditolak.' }, { status: 403 });
    }
  }

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
    await jwtVerify(token, secret);
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)'],
};
