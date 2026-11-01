import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';
import { hashPassword, isValidPassword } from '@/lib/password';
import { emitRealtimeEvent } from '@/lib/events';

export async function GET(request) {
  try {
    const user = await getUserSession(request);
    if (!user || user.role !== 'superadmin') {
      return NextResponse.json({ error: 'Akses ditolak.' }, { status: 403 });
    }
    const admins = await query(`SELECT id, username, role, department, created_at FROM admins ORDER BY created_at DESC, id DESC`);
    return NextResponse.json(admins, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const user = await getUserSession(request);
    if (!user || user.role !== 'superadmin') {
      return NextResponse.json({ error: 'Akses ditolak. Hanya superadmin yang dapat membuat akun.' }, { status: 403 });
    }

    const { username, password, role, department } = await request.json();

    if (!username || !isValidPassword(password)) {
      return NextResponse.json({ error: 'Username wajib diisi dan password minimal 12 karakter.' }, { status: 422 });
    }

    const allowedRoles = ['admin', 'superadmin', 'sdm', 'manager', 'kepala_divisi', 'kepala_subdivisi'];
    const finalRole = allowedRoles.includes(role) ? role : 'admin';
    if (['manager', 'kepala_divisi', 'kepala_subdivisi'].includes(finalRole) && (typeof department !== 'string' || !department.trim())) return NextResponse.json({ error: 'Departemen wajib diisi untuk kepala divisi atau subdivisi.' }, { status: 422 });
    
    const check = await query(`SELECT id FROM admins WHERE username = ?`, [username]);
    if (check.length > 0) {
      return NextResponse.json({ error: 'Username sudah digunakan.' }, { status: 400 });
    }

    const hashedPassword = await hashPassword(password);

    const result = await query(
      `INSERT INTO admins (username, password, role, department) VALUES (?, ?, ?, ?)`,
      [username, hashedPassword, finalRole, department || '']
    );

    emitRealtimeEvent('admins', { action: 'create', id: result.insertId });
    return NextResponse.json({ message: 'Akun berhasil ditambahkan.', id: result.insertId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
