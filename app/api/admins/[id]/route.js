import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';
import crypto from 'crypto';

export async function PUT(request, { params }) {
  try {
    const user = await getUserSession(request);
    if (!user || user.role !== 'superadmin') {
      return NextResponse.json({ error: 'Akses ditolak. Hanya superadmin yang dapat mengubah admin.' }, { status: 403 });
    }

    const resolvedParams = await params;
    const id = resolvedParams?.id;
    const { username, password, role, department } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'ID admin tidak valid' }, { status: 400 });
    }

    if (!username) {
      return NextResponse.json({ error: 'Username wajib diisi' }, { status: 400 });
    }

    const check = await query(`SELECT id FROM admins WHERE username = ? AND id != ?`, [username, id]);
    if (check.length > 0) {
      return NextResponse.json({ error: 'Username sudah digunakan' }, { status: 400 });
    }

    const finalRole = ['admin', 'superadmin', 'sdm'].includes(role) ? role : 'admin';

    if (password) {
      const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
      await query(
        `UPDATE admins SET username = ?, password = ?, role = ?, department = ? WHERE id = ?`,
        [username, hashedPassword, finalRole, department || '', id]
      );
    } else {
      await query(
        `UPDATE admins SET username = ?, role = ?, department = ? WHERE id = ?`,
        [username, finalRole, department || '', id]
      );
    }

    return NextResponse.json({ message: 'Admin berhasil diperbarui' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const user = await getUserSession(request);
    if (!user || user.role !== 'superadmin') {
      return NextResponse.json({ error: 'Akses ditolak. Hanya superadmin yang dapat menghapus admin.' }, { status: 403 });
    }

    const resolvedParams = await params;
    const id = resolvedParams?.id;

    if (!id) {
      return NextResponse.json({ error: 'ID admin tidak valid' }, { status: 400 });
    }

    // Pastikan tidak menghapus admin terakhir
    const totalAdmins = await query(`SELECT COUNT(*) as count FROM admins`);
    if (totalAdmins[0].count <= 1) {
      return NextResponse.json({ error: 'Tidak dapat menghapus admin terakhir' }, { status: 400 });
    }

    const result = await query(`DELETE FROM admins WHERE id = ?`, [id]);

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: 'Admin tidak ditemukan' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Admin berhasil dihapus' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
