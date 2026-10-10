import { NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { query } from '@/lib/db';
import crypto from 'crypto';

export async function POST(request) {
  try {
    const { username, password } = await request.json();

    let payload = { username, role: 'superadmin', department: '' };

    // Cek database untuk admin
    let isValid = false;
    try {
      const admins = await query(`SELECT * FROM admins WHERE username = ?`, [username]);
      if (admins.length > 0) {
        // Hash password menggunakan SHA256
        const hash = crypto.createHash('sha256').update(password).digest('hex');
        
        // Cek password hash atau plain text (sebagai transisi/fallback)
        if (admins[0].password === hash || admins[0].password === password) {
          isValid = true;
          payload.role = admins[0].role || 'superadmin';
          payload.department = admins[0].department || '';
        }
      } else {
        // Fallback ke .env jika tabel admin kosong
        const totalAdmins = await query(`SELECT COUNT(*) as count FROM admins`);
        if (totalAdmins[0].count === 0) {
          const validUser = process.env.ADMIN_USER || 'admin';
          const validPass = process.env.ADMIN_PASSWORD || 'admin123';
          const hash = crypto.createHash('sha256').update(password).digest('hex');
          if (username === validUser && (validPass === hash || validPass === password)) {
            isValid = true;
          }
        }
      }
    } catch (dbError) {
      // Fallback jika database error
      const validUser = process.env.ADMIN_USER || 'admin';
      const validPass = process.env.ADMIN_PASSWORD || 'admin123';
      const hash = crypto.createHash('sha256').update(password).digest('hex');
      if (username === validUser && (validPass === hash || validPass === password)) {
        isValid = true;
      }
    }

    if (!isValid) {
      return NextResponse.json({ error: 'Username atau password salah.' }, { status: 401 });
    }

    const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret');
    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('8h')
      .sign(secret);

    const response = NextResponse.json({ message: 'Login berhasil' });
    response.cookies.set('auth_token', token, {
      httpOnly: true,
      secure: false, // set true jika sudah HTTPS
      sameSite: 'lax',
      maxAge: 60 * 60 * 8, // 8 jam
      path: '/',
    });

    return response;
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
