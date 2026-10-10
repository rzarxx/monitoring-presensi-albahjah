import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';
import crypto from 'crypto';

// GET - Hanya superadmin yang bisa melihat daftar akun
export async function GET(request) {
  try {
    const user = await getUserSession(request);
    if (!user || user.role !== 'superadmin') {
      return NextResponse.json({ error: 'Akses ditolak.' }, { status: 403 });
    }
    const admins = await query(`SELECT id, username, role, department, created_at FROM admins ORDER BY created_at DESC`);
    return NextResponse.json(admins);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Hanya superadmin yang bisa membuat akun baru, password otomatis di-hash
export async function POST(request) {
  try {
    const user = await getUserSession(request);
    if (!user || user.role !== 'superadmin') {
      return NextResponse.json({ error: 'Akses ditolak. Hanya superadmin yang dapat membuat akun.' }, { status: 403 });
    }

    const { username, password, role, department } = await request.json();

    if (!username || !password) {
      return NextResponse.json({ error: 'Username dan password wajib diisi.' }, { status: 400 });
    }

    // Validasi role yang diperbolehkan
    const allowedRoles = ['admin', 'superadmin', 'sdm'];
    const finalRole = allowedRoles.includes(role) ? role : 'admin';
    
    const check = await query(`SELECT id FROM admins WHERE username = ?`, [username]);
    if (check.length > 0) {
      return NextResponse.json({ error: 'Username sudah digunakan.' }, { status: 400 });
    }

    // Hash password sebelum disimpan
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');

    const result = await query(
      `INSERT INTO admins (username, password, role, department) VALUES (?, ?, ?, ?)`,
      [username, hashedPassword, finalRole, department || '']
    );

    return NextResponse.json({ message: 'Akun berhasil ditambahkan.', id: result.insertId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

