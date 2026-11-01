import { NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { query } from '@/lib/db';
import { getJwtSecret, sessionProof } from '@/lib/auth';
import { recordLoginAttempt, clearLoginAttempts } from '@/lib/login-rate-limit';
import { hashPassword, verifyPassword } from '@/lib/password';

export async function POST(request) {
  try {
    const { username, password } = await request.json();
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || username.length > 255 || !password || password.length > 128) {
      return NextResponse.json({ error: 'Username dan password wajib diisi.' }, { status: 422 });
    }
    const secret = getJwtSecret();
    if (!secret) return NextResponse.json({ error: 'Konfigurasi sesi server belum aman.' }, { status: 503 });

    let attemptKey;
    try {
      const [account] = await query('SELECT id FROM admins WHERE username = ?', [username]);
      const identity = account ? `account:${account.id}` : `unknown:${username.trim().toLowerCase()}`;
      const attempt = await recordLoginAttempt(identity, secret);
      attemptKey = attempt.key;
      if (!attempt.allowed) return NextResponse.json({ error: 'Terlalu banyak percobaan. Coba lagi setelah 15 menit.' }, { status: 429, headers: { 'Retry-After': '900' } });
    } catch {
      return NextResponse.json({ error: 'Proteksi login belum siap. Hubungi administrator.' }, { status: 503 });
    }

    const payload = { username };

    // Cek database untuk admin
    let isValid = false;
    try {
      const admins = await query(`SELECT * FROM admins WHERE username = ?`, [username]);
      if (admins.length > 0) {
        const verification = await verifyPassword(password, admins[0].password);
        if (verification.valid) {
          isValid = true;
          payload.adminId = admins[0].id;
          let currentHash = admins[0].password;
          if (verification.upgrade) {
            currentHash = await hashPassword(password);
            await query('UPDATE admins SET password = ? WHERE id = ? AND password = ?', [currentHash, admins[0].id, admins[0].password]);
            const [current] = await query('SELECT password FROM admins WHERE id = ?', [admins[0].id]);
            if (!current || current.password !== currentHash) return NextResponse.json({ error: 'Sesi login berubah. Silakan coba lagi.' }, { status: 401 });
          }
          payload.sessionProof = sessionProof(secret, currentHash);
        }
      } else {
        // Akun bootstrap hanya berlaku saat database admin benar-benar kosong.
        const totalAdmins = await query(`SELECT COUNT(*) as count FROM admins`);
        if (totalAdmins[0].count === 0) {
          const validUser = process.env.ADMIN_USER;
          const validPass = process.env.ADMIN_PASSWORD;
          if (validUser && validPass && username === validUser && password === validPass) {
            isValid = true;
            payload.bootstrap = true;
            payload.sessionProof = sessionProof(secret, validPass);
          }
        }
      }
    } catch {
      return NextResponse.json({ error: 'Layanan autentikasi sedang tidak tersedia.' }, { status: 503 });
    }

    if (!isValid) {
      return NextResponse.json({ error: 'Username atau password salah.' }, { status: 401 });
    }

    try {
      await clearLoginAttempts(attemptKey);
    } catch {
      return NextResponse.json({ error: 'Proteksi login belum siap. Hubungi administrator.' }, { status: 503 });
    }

    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('8h')
      .sign(secret);

    const response = NextResponse.json({ message: 'Login berhasil' });
    response.cookies.set('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 8, // 8 jam
      path: '/',
    });

    return response;
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
