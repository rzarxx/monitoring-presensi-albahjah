import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';
import { requireDevice } from '@/lib/devices';

const pad = (n) => String(n).padStart(2, '0');
const toDateKey = (value) => {
  if (!value) return '';
  if (value instanceof Date) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value).slice(0, 10);
};

export async function GET(request) {
  try {
    const user = await getUserSession(request);
    if (!user) return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
    const searchParams = new URL(request.url).searchParams;
    const device = await requireDevice(searchParams);
    const uid = searchParams.get('uid');
    const employeeUid = Number.parseInt(searchParams.get('employee_uid') || '', 10);
    const dates = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      return toDateKey(date);
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
    const rows = await query(
      `SELECT DATE_FORMAT(a.timestamp, '%Y-%m-%d') AS date, ${perPerson ? 'COUNT(a.uid)' : 'COUNT(DISTINCT a.uid)'} AS hadir
       FROM attendance_logs a
       WHERE ${conditions.join(' AND ')}
       GROUP BY DATE_FORMAT(a.timestamp, '%Y-%m-%d')`,
      params
    );

    const leaveConditions = ['l.device_id = ?', 'l.date >= ?'];
    const leaveParams = [device.id, dates[0]];
    if (Number.isInteger(employeeUid)) {
      leaveConditions.push('l.uid = ?');
      leaveParams.push(employeeUid);
    } else if (uid) {
      leaveConditions.push('l.uid = ?');
      leaveParams.push(uid);
    }
    const leaveRows = await query(
      `SELECT DATE_FORMAT(l.date, '%Y-%m-%d') AS date,
              SUM(CASE WHEN l.type = 'Izin' THEN 1 ELSE 0 END) AS izin,
              SUM(CASE WHEN l.type = 'Sakit' THEN 1 ELSE 0 END) AS sakit,
              SUM(CASE WHEN l.type = 'Cuti' THEN 1 ELSE 0 END) AS cuti
       FROM leaves l
       WHERE ${leaveConditions.join(' AND ')}
       GROUP BY DATE_FORMAT(l.date, '%Y-%m-%d')`,
      leaveParams
    );

    return NextResponse.json({
      data: dates.map((date) => {
        const att = rows.find((row) => toDateKey(row.date) === date);
        const lv = leaveRows.find((row) => toDateKey(row.date) === date);
        return {
          date,
          hadir: Number(att?.hadir || 0),
          izin: Number(lv?.izin || 0),
          sakit: Number(lv?.sakit || 0),
          cuti: Number(lv?.cuti || 0),
        };
      }),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Gagal memuat statistik.' }, { status: error.status || 500 });
  }
}
