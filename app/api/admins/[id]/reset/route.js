import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';
import { hashPassword, isValidPassword } from '@/lib/password';

export async function POST(request, { params }) {
  try {
    const user = await getUserSession(request);
    if (!user || user.role !== 'superadmin') {
      return NextResponse.json({ error: 'Akses ditolak. Hanya superadmin yang dapat mereset password.' }, { status: 403 });
    }

    const resolvedParams = await params;
    const id = resolvedParams?.id;

    if (!id) {
      return NextResponse.json({ error: 'ID admin tidak valid' }, { status: 400 });
    }

    const { password } = await request.json();
    if (!isValidPassword(password)) return NextResponse.json({ error: 'Password baru minimal 12 karakter.' }, { status: 422 });
    const hashedPassword = await hashPassword(password);

    const result = await query(
      'UPDATE admins SET password = ? WHERE id = ?',
      [hashedPassword, id]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: 'Admin tidak ditemukan' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Password berhasil direset.' });
  } catch (error) {
    console.error('[API/admins/[id]/reset]', error);
    return NextResponse.json({ error: 'Gagal mereset password' }, { status: 500 });
  }
}
