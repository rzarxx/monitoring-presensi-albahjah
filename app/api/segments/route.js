import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';

const codePattern = /^[A-Z0-9_-]{2,50}$/;

export async function GET(request) {
  const user = await getUserSession(request);
  if (!user) return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
  try {
    const data = await query(`SELECT id, code, name, is_active FROM segments ORDER BY name ASC`);
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: 'Skema multi-mesin belum dimigrasikan.' }, { status: 500 });
  }
}

export async function POST(request) {
  const user = await getUserSession(request);
  if (!user || user.role !== 'superadmin') return NextResponse.json({ error: 'Hanya Super Admin yang dapat mengelola segment.' }, { status: 403 });
  try {
    const body = await request.json();
    const code = String(body.code || '').trim().toUpperCase();
    const name = String(body.name || '').trim();
    if (!codePattern.test(code) || !name) return NextResponse.json({ error: 'Kode segment dan nama wajib diisi.' }, { status: 422 });
    const result = await query(`INSERT INTO segments (code, name) VALUES (?, ?)`, [code, name]);
    return NextResponse.json({ id: result.insertId, message: 'Segment ditambahkan.' }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.code === 'ER_DUP_ENTRY' ? 'Kode segment sudah digunakan.' : 'Gagal menambah segment.' }, { status: 500 });
  }
}
