import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';

export async function GET(request) {
  try {
    const user = await getUserSession(request);
    if (!user) {
      return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
    }
    const leaves = await query(`
      SELECT l.*, e.name, e.department 
      FROM leaves l 
      LEFT JOIN employees e ON l.uid = e.uid
      ORDER BY l.date DESC
    `);
    return NextResponse.json({ data: leaves });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const user = await getUserSession(request);
    if (!user) {
      return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
    }

    const { uid, date, type, reason } = await request.json();
    if (!uid || !date || !type) {
      return NextResponse.json({ error: 'UID, Tanggal, dan Tipe wajib diisi.' }, { status: 400 });
    }

    const emp = await query(`SELECT * FROM employees WHERE uid = ?`, [uid]);
    if (emp.length === 0) {
      return NextResponse.json({ error: 'Karyawan tidak ditemukan.' }, { status: 404 });
    }

    const existing = await query(`SELECT * FROM leaves WHERE uid = ? AND date = ?`, [uid, date]);
    if (existing.length > 0) {
      await query(`UPDATE leaves SET type = ?, reason = ? WHERE uid = ? AND date = ?`, [type, reason || '', uid, date]);
    } else {
      await query(`INSERT INTO leaves (uid, date, type, reason) VALUES (?, ?, ?, ?)`, [uid, date, type, reason || '']);
    }

    return NextResponse.json({ success: true, message: 'Izin/Cuti berhasil disimpan.' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    // Hanya superadmin yang bisa menghapus data izin
    const user = await getUserSession(request);
    if (!user || user.role !== 'superadmin') {
      return NextResponse.json({ error: 'Akses ditolak. Hanya superadmin yang dapat menghapus data.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID wajib disertakan.' }, { status: 400 });
    }

    await query(`DELETE FROM leaves WHERE id = ?`, [id]);
    return NextResponse.json({ success: true, message: 'Data berhasil dihapus.' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

