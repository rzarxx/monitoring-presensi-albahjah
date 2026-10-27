import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';
import { requireDevice } from '@/lib/devices';
import { emitRealtimeEvent } from '@/lib/events';

const leaveTypes = new Set(['Izin', 'Sakit', 'Cuti', 'Alfa']);

export async function GET(request) {
  try {
    const user = await getUserSession(request);
    if (!user) {
      return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
    }
    const device = await requireDevice(new URL(request.url).searchParams);
    const department = user.role === 'manager' ? user.department : null;
    if (user.role === 'manager' && !department) return NextResponse.json({ error: 'Akun manager belum memiliki departemen.' }, { status: 403 });
    const leaves = await query(`
      SELECT l.*, e.name, e.department 
      FROM leaves l 
      LEFT JOIN employees e ON l.uid = e.uid
      WHERE l.device_id = ?${department ? ' AND e.department = ?' : ''}
      ORDER BY l.date DESC
    `, department ? [device.id, department] : [device.id]);
    return NextResponse.json({ data: leaves });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const user = await getUserSession(request);
    if (!user || !['superadmin', 'sdm'].includes(user.role)) return NextResponse.json({ error: 'Akses ditolak.' }, { status: 403 });

    const body = await request.json();
    const device = await requireDevice(new URL(request.url).searchParams);
    const uid = Number.parseInt(body.uid, 10);
    const date = String(body.date || '');
    const type = String(body.type || '');
    const reason = String(body.reason || '').trim();
    if (!Number.isInteger(uid) || uid < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !leaveTypes.has(type) || reason.length > 1000) {
      return NextResponse.json({ error: 'Data keterangan ketidakhadiran tidak valid.' }, { status: 422 });
    }

    const emp = await query(`SELECT * FROM employees WHERE uid = ?`, [uid]);
    if (emp.length === 0) {
      return NextResponse.json({ error: 'Karyawan tidak ditemukan.' }, { status: 404 });
    }

    const existing = await query(`SELECT id FROM leaves WHERE device_id = ? AND uid = ? AND date = ?`, [device.id, uid, date]);
    if (existing.length > 0) {
      await query(`UPDATE leaves SET type = ?, reason = ? WHERE id = ?`, [type, reason, existing[0].id]);
    } else {
      await query(`INSERT INTO leaves (device_id, uid, date, type, reason) VALUES (?, ?, ?, ?, ?)`, [device.id, uid, date, type, reason]);
    }

    emitRealtimeEvent('leaves', { action: 'save', device_id: device.id, uid, date, type });

    return NextResponse.json({ success: true, message: 'Keterangan ketidakhadiran berhasil disimpan.' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const user = await getUserSession(request);
    if (!user || user.role !== 'superadmin') {
      return NextResponse.json({ error: 'Akses ditolak. Hanya superadmin yang dapat menghapus data.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const device = await requireDevice(searchParams);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID wajib disertakan.' }, { status: 400 });
    }

    await query(`DELETE FROM leaves WHERE id = ? AND device_id = ?`, [id, device.id]);
    emitRealtimeEvent('leaves', { action: 'delete', device_id: device.id, id: Number(id) });
    return NextResponse.json({ success: true, message: 'Data berhasil dihapus.' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
