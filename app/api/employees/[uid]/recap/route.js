import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';
import { requireDevice } from '@/lib/devices';

const jakartaFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
});

function jakartaToday() {
  const parts = jakartaFormatter.formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function dateRange(period) {
  const today = jakartaToday();
  const [year, month, day] = today.split('-').map(Number);
  const end = new Date(Date.UTC(year, month - 1, day));
  const start = period === 'monthly'
    ? new Date(Date.UTC(year, month - 1, 1))
    : new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
  const dates = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return { from: dates[0], to: today, dates };
}

export async function GET(request, context) {
  try {
    const user = await getUserSession(request);
    if (!user) return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });

    const { uid: rawUid } = await context.params;
    const uid = Number.parseInt(rawUid, 10);
    if (!Number.isInteger(uid) || uid < 1) return NextResponse.json({ error: 'Pejuang tidak valid.' }, { status: 400 });

    const params = new URL(request.url).searchParams;
    const period = params.get('period') === 'monthly' ? 'monthly' : 'weekly';
    const device = await requireDevice(params);
    const employees = await query(
      `SELECT uid, name, COALESCE(department, '') AS department FROM employees WHERE uid = ?${user.role === 'manager' && user.department ? ' AND department = ?' : ''}`,
      user.role === 'manager' && user.department ? [uid, user.department] : [uid]
    );
    if (!employees[0]) return NextResponse.json({ error: 'Pejuang tidak ditemukan atau di luar akses Anda.' }, { status: 404 });

    const range = dateRange(period);
    const attendance = await query(`
      SELECT DATE(a.timestamp) AS date, COUNT(*) AS scan_count
      FROM attendance_logs a
      JOIN device_enrollments de ON de.device_id = a.device_id AND de.device_uid = a.uid
      WHERE a.device_id = ? AND de.employee_uid = ? AND DATE(a.timestamp) BETWEEN ? AND ?
      GROUP BY DATE(a.timestamp)
    `, [device.id, uid, range.from, range.to]);
    const leaves = await query(`
      SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date, type, reason
      FROM leaves
      WHERE device_id = ? AND uid = ? AND date BETWEEN ? AND ?
    `, [device.id, uid, range.from, range.to]);

    const byDate = new Map(attendance.map((row) => [String(row.date).slice(0, 10), Number(row.scan_count)]));
    const leaveByDate = new Map(leaves.map((row) => [String(row.date).slice(0, 10), row]));
    const daily = range.dates.map((date) => {
      const scanCount = byDate.get(date) || 0;
      const leave = leaveByDate.get(date);
      return {
        date,
        status: scanCount ? 'Hadir' : leave?.type || 'Belum tercatat',
        scan_count: scanCount,
        reason: scanCount ? '' : leave?.reason || '',
      };
    });
    const summary = daily.reduce((total, day) => {
      if (day.status === 'Hadir') total.hadir++;
      else if (day.status === 'Izin') total.izin++;
      else if (day.status === 'Sakit') total.sakit++;
      else if (day.status === 'Alfa') total.alfa++;
      else if (day.status === 'Cuti') total.cuti++;
      else total.belum_tercatat++;
      return total;
    }, { hadir: 0, izin: 0, sakit: 0, alfa: 0, cuti: 0, belum_tercatat: 0 });

    return NextResponse.json({ employee: employees[0], device: { id: device.id, name: device.name }, period, range: { from: range.from, to: range.to }, summary, daily });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Gagal membuat rekap kehadiran.' }, { status: error.status || 500 });
  }
}
