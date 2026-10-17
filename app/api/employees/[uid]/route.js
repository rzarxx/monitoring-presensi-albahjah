import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';

export async function PUT(request, { params }) {
  try {
    const user = await getUserSession(request);
    if (!user || (user.role !== 'superadmin' && user.role !== 'sdm')) {
      return NextResponse.json({ error: 'Akses ditolak. Hanya superadmin dan SDM yang dapat mengubah data.' }, { status: 403 });
    }

    const resolvedParams = await params;
    const uid = parseInt(resolvedParams?.uid, 10);

    if (!uid) {
      return NextResponse.json({ error: 'UID tidak valid' }, { status: 400 });
    }

    const { name, department } = await request.json();
    await query(
      `UPDATE employees SET name = ?, department = ? WHERE uid = ?`,
      [name, department, uid]
    );
    return NextResponse.json({ message: 'Employee updated successfully' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const user = await getUserSession(request);
    if (!user || (user.role !== 'superadmin' && user.role !== 'sdm')) {
      return NextResponse.json({ error: 'Akses ditolak. Hanya superadmin dan SDM yang dapat menghapus data.' }, { status: 403 });
    }

    const resolvedParams = await params;
    const uid = parseInt(resolvedParams?.uid, 10);

    if (!uid) {
      return NextResponse.json({ error: 'UID tidak valid' }, { status: 400 });
    }

    await query(`DELETE FROM employees WHERE uid = ?`, [uid]);
    // User mesinnya kembali ke daftar "belum terdaftar"; nomor Pejuang yang sama
    // bisa dipakai orang lain nanti, jadi pemetaan lama tidak boleh tertinggal.
    await query(`UPDATE device_enrollments SET employee_uid = NULL, link_locked = 0 WHERE employee_uid = ?`, [uid]);
    return NextResponse.json({ message: 'Employee deleted' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
