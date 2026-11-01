import { NextResponse } from 'next/server';
import { getPool, query } from '@/lib/db';
import { getUserSession, isDepartmentManager } from '@/lib/auth';
import { requireDevice } from '@/lib/devices';
import { emitRealtimeEvent } from '@/lib/events';

const leaveTypes = new Set(['Hadir', 'Izin', 'Sakit', 'Cuti', 'Alfa']);

export async function GET(request) {
  try {
    const user = await getUserSession(request);
    if (!user) {
      return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
    }
    const device = await requireDevice(new URL(request.url).searchParams);
    const department = isDepartmentManager(user.role) ? user.department : null;
    if (isDepartmentManager(user.role) && !department?.trim()) return NextResponse.json({ error: 'Akun belum memiliki departemen.' }, { status: 403 });
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
  let connection;
  try {
    const user = await getUserSession(request);
    if (!user || (!['superadmin', 'sdm'].includes(user.role) && !isDepartmentManager(user.role))) return NextResponse.json({ error: 'Akses ditolak.' }, { status: 403 });
    if (isDepartmentManager(user.role) && !user.department?.trim()) return NextResponse.json({ error: 'Akun belum memiliki departemen.' }, { status: 403 });

    const body = await request.json();
    const device = await requireDevice(new URL(request.url).searchParams);
    const uidText = String(body.uid ?? '');
    const uid = /^\d+$/.test(uidText) ? Number(uidText) : NaN;
    const date = String(body.date || '');
    const type = String(body.type || '');
    const reason = String(body.reason || '').trim();
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
    if (!Number.isSafeInteger(uid) || uid < 1 || !parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date || !leaveTypes.has(type) || reason.length > 1000) {
      return NextResponse.json({ error: 'Data keterangan ketidakhadiran tidak valid.' }, { status: 422 });
    }

    connection = await getPool().getConnection();
    await connection.beginTransaction();
    const [emp] = await connection.query(`SELECT e.uid FROM employees e WHERE e.uid = ?${isDepartmentManager(user.role) ? ' AND e.department = ?' : ''} AND EXISTS (SELECT 1 FROM device_enrollments de WHERE de.employee_uid = e.uid AND de.device_id = ?) FOR UPDATE`, isDepartmentManager(user.role) ? [uid, user.department, device.id] : [uid, device.id]);
    if (emp.length === 0) {
      await connection.rollback();
      return NextResponse.json({ error: 'Karyawan tidak ditemukan.' }, { status: 404 });
    }

    const [scans] = await connection.query(`SELECT a.id FROM attendance_logs a JOIN device_enrollments de ON de.device_id = a.device_id AND de.device_uid = a.uid WHERE de.device_id = ? AND de.employee_uid = ? AND DATE(a.timestamp) = ? LIMIT 1`, [device.id, uid, date]);
    if (scans.length) {
      await connection.rollback();
      return NextResponse.json({ error: 'Pejuang sudah melakukan tap pada tanggal tersebut.' }, { status: 409 });
    }

    const [existing] = await connection.query(`SELECT id FROM leaves WHERE device_id = ? AND uid = ? AND date = ?`, [device.id, uid, date]);
    if (existing.length > 0) {
      await connection.query(`UPDATE leaves SET type = ?, reason = ? WHERE device_id = ? AND uid = ? AND date = ?`, [type, reason, device.id, uid, date]);
    } else {
      await connection.query(`INSERT INTO leaves (device_id, uid, date, type, reason) VALUES (?, ?, ?, ?, ?)`, [device.id, uid, date, type, reason]);
    }
    await connection.commit();

    emitRealtimeEvent('leaves', { action: 'save', device_id: device.id, uid, date, type });

    return NextResponse.json({ success: true, message: 'Keterangan ketidakhadiran berhasil disimpan.' });
  } catch (error) {
    if (connection) await connection.rollback();
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    if (connection) connection.release();
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
