import { NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { query } from '@/lib/db';
import { getJwtSecret } from '@/lib/auth';
import { hashPassword, verifyPassword } from '@/lib/password';

export async function POST(request) {
  try {
    const { username, password } = await request.json();
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      return NextResponse.json({ error: 'Username dan password wajib diisi.' }, { status: 422 });
    }
    const secret = getJwtSecret();
    if (!secret) return NextResponse.json({ error: 'Konfigurasi sesi server belum aman.' }, { status: 503 });

    let payload = { username, role: 'superadmin', department: '' };

    // Cek database untuk admin
    let isValid = false;
    try {
      const admins = await query(`SELECT * FROM admins WHERE username = ?`, [username]);
      if (admins.length > 0) {
        const verification = await verifyPassword(password, admins[0].password);
        if (verification.valid) {
          isValid = true;
          payload.role = admins[0].role || 'superadmin';
          payload.department = admins[0].department || '';
          if (verification.upgrade) {
            await query('UPDATE admins SET password = ? WHERE id = ?', [await hashPassword(password), admins[0].id]);
          }
        }
      } else {
        // Akun bootstrap hanya berlaku saat database admin benar-benar kosong.
        const totalAdmins = await query(`SELECT COUNT(*) as count FROM admins`);
        if (totalAdmins[0].count === 0) {
          const validUser = process.env.ADMIN_USER;
          const validPass = process.env.ADMIN_PASSWORD;
          if (validUser && validPass && username === validUser && password === validPass) {
            isValid = true;
          }
        }
      }
    } catch {
      return NextResponse.json({ error: 'Layanan autentikasi sedang tidak tersedia.' }, { status: 503 });
    }

    if (!isValid) {
      return NextResponse.json({ error: 'Username atau password salah.' }, { status: 401 });
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
