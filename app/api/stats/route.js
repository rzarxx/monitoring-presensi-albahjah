import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';
import { requireDevice } from '@/lib/devices';

const pad = (n) => String(n).padStart(2, '0');
const jakartaDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const toJakartaDateKey = (value) => {
  const parts = jakartaDateFormatter.formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
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
    const dates = Array.from({ length: 7 }, (_, index) =>
      toJakartaDateKey(new Date(Date.now() - (6 - index) * 24 * 60 * 60 * 1000))
    );

    const conditions = ['a.device_id = ?', 'DATE(a.timestamp) >= ?'];
    const params = [device.id, dates[0]];
    if (Number.isInteger(employeeUid)) {
      conditions.push('a.uid IN (SELECT device_uid FROM device_enrollments WHERE device_id = ? AND employee_uid = ?)');
      params.push(device.id, employeeUid);
    } else if (uid) {
      conditions.push('a.uid = ?');
      params.push(uid);
    }
    if (user.role === 'manager' && user.department) {
      conditions.push('e.department = ?');
      params.push(user.department);
    }
    const perPerson = Number.isInteger(employeeUid) || Boolean(uid);
    const rows = await query(
      `SELECT DATE_FORMAT(a.timestamp, '%Y-%m-%d') AS date,
              ${perPerson ? 'COUNT(a.uid)' : "COUNT(DISTINCT COALESCE(CAST(de.employee_uid AS CHAR), CONCAT('device:', a.uid)))"} AS hadir
       FROM attendance_logs a
       LEFT JOIN device_enrollments de ON de.device_id = a.device_id AND de.device_uid = a.uid
       LEFT JOIN employees e ON e.uid = de.employee_uid
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
    if (user.role === 'manager' && user.department) {
      leaveConditions.push('e.department = ?');
      leaveParams.push(user.department);
    }
    const leaveRows = await query(
      `SELECT DATE_FORMAT(l.date, '%Y-%m-%d') AS date,
              SUM(CASE WHEN l.type = 'Izin' THEN 1 ELSE 0 END) AS izin,
              SUM(CASE WHEN l.type = 'Sakit' THEN 1 ELSE 0 END) AS sakit,
              SUM(CASE WHEN l.type = 'Cuti' THEN 1 ELSE 0 END) AS cuti,
              SUM(CASE WHEN l.type = 'Alfa' THEN 1 ELSE 0 END) AS alfa
       FROM leaves l
       JOIN employees e ON e.uid = l.uid
       WHERE ${leaveConditions.join(' AND ')}
         AND NOT EXISTS (
           SELECT 1
           FROM attendance_logs a2
           JOIN device_enrollments de2
             ON de2.device_id = a2.device_id
            AND de2.device_uid = a2.uid
            AND de2.employee_uid = l.uid
           WHERE a2.device_id = l.device_id
             AND DATE(a2.timestamp) = l.date
         )
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
          alfa: Number(lv?.alfa || 0),
        };
      }),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Gagal memuat statistik.' }, { status: error.status || 500 });
  }
}
