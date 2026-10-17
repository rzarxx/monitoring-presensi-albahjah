import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';
import { requireDevice } from '@/lib/devices';

export async function GET(request) {
  try {
    const user = await getUserSession(request);
    if (!user) return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
    const searchParams = new URL(request.url).searchParams;
    const device = await requireDevice(searchParams);
    const uid = searchParams.get('uid');
    // employee_uid: Pejuang, dipetakan ke UID mesin lewat device_enrollments.
    const employeeUid = Number.parseInt(searchParams.get('employee_uid') || '', 10);
    const dates = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      return date.toISOString().slice(0, 10);
    });
    const conditions = ['a.device_id = ?', 'DATE(a.timestamp) >= ?'];
    const params = [device.id, dates[0]];
    if (Number.isInteger(employeeUid)) {
      conditions.push('a.uid IN (SELECT device_uid FROM device_enrollments WHERE device_id = ? AND employee_uid = ?)');
      params.push(device.id, employeeUid);
    } else if (uid) {
      conditions.push('a.uid = ?');
      params.push(uid);
    }
    const perPerson = Number.isInteger(employeeUid) || Boolean(uid);
    const rows = await query(`SELECT DATE(a.timestamp) AS date, ${perPerson ? 'COUNT(a.uid)' : 'COUNT(DISTINCT a.uid)'} AS hadir FROM attendance_logs a WHERE ${conditions.join(' AND ')} GROUP BY DATE(a.timestamp)`, params);
    return NextResponse.json({ data: dates.map((date) => ({ date, hadir: Number(rows.find((row) => String(row.date).slice(0, 10) === date)?.hadir || 0), izin: 0, sakit: 0, cuti: 0 })) });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Gagal memuat statistik.' }, { status: error.status || 500 });
  }
}
