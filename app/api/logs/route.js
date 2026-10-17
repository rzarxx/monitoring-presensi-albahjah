import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';
import { requireDevice } from '@/lib/devices';

const sortableColumns = {
  date: 'date',
  name: 'name',
  department: 'department',
  check_in: 'check_in',
  check_out: 'check_out',
  scan_count: 'scan_count',
};

export async function GET(request) {
  try {
    const user = await getUserSession(request);
    if (!user) return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });

    const searchParams = new URL(request.url).searchParams;
    const device = await requireDevice(searchParams);
    const date = searchParams.get('date');
    const search = searchParams.get('search');
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('limit') || '5', 10)));
    const offset = (page - 1) * limit;
    const orderColumn = sortableColumns[searchParams.get('sortCol')] || sortableColumns.date;
    const orderDirection = String(searchParams.get('sortDir') || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const department = user.role === 'manager' && user.department ? user.department : null;
    // Profil Pejuang memfilter lewat pemetaan, bukan nomor UID mesin.
    const employeeUid = Number.parseInt(searchParams.get('employee_uid') || '', 10);

    const conditions = ['a.device_id = ?'];
    const params = [device.id];
    if (date) { conditions.push('DATE(a.timestamp) = ?'); params.push(date); }
    else conditions.push('DATE(a.timestamp) = CURDATE()');
    if (department) { conditions.push('e.department = ?'); params.push(department); }
    if (search) { conditions.push('(e.name LIKE ? OR de.display_name LIKE ? OR CAST(a.uid AS CHAR) = ?)'); params.push(`%${search}%`, `%${search}%`, search); }
    if (Number.isInteger(employeeUid)) { conditions.push('de.employee_uid = ?'); params.push(employeeUid); }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const rawConditions = ['a.device_id = ?'];
    const rawParams = [device.id];
    if (department) { rawConditions.push('e.department = ?'); rawParams.push(department); }
    if (search) { rawConditions.push('(e.name LIKE ? OR de.display_name LIKE ? OR CAST(a.uid AS CHAR) = ?)'); rawParams.push(`%${search}%`, `%${search}%`, search); }
    if (Number.isInteger(employeeUid)) { rawConditions.push('de.employee_uid = ?'); rawParams.push(employeeUid); }
    const rawLogs = await query(`
      SELECT a.id, a.uid AS device_uid, a.timestamp, a.state, COALESCE(e.name, de.display_name, CONCAT('UID_', a.uid)) AS name, e.department
      FROM attendance_logs a
      LEFT JOIN device_enrollments de ON de.device_id = a.device_id AND de.device_uid = a.uid
      LEFT JOIN employees e ON e.uid = de.employee_uid
      WHERE ${rawConditions.join(' AND ')}
      ORDER BY a.timestamp DESC LIMIT 100
    `, rawParams);

    const report = await query(`
      SELECT DATE(a.timestamp) AS date, a.uid AS device_uid,
             COALESCE(e.name, de.display_name, CONCAT('UID_', a.uid)) AS name,
             COALESCE(e.department, '') AS department,
             MIN(a.timestamp) AS check_in, MAX(a.timestamp) AS check_out,
             COUNT(a.id) AS scan_count, NULL AS leave_type
      FROM attendance_logs a
      LEFT JOIN device_enrollments de ON de.device_id = a.device_id AND de.device_uid = a.uid
      LEFT JOIN employees e ON e.uid = de.employee_uid
      ${where}
      GROUP BY DATE(a.timestamp), a.uid, e.name, de.display_name, e.department
      ORDER BY ${orderColumn} ${orderDirection}, name ASC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const [{ count }] = await query(`
      SELECT COUNT(*) AS count FROM (
        SELECT DATE(a.timestamp), a.uid FROM attendance_logs a
        LEFT JOIN device_enrollments de ON de.device_id = a.device_id AND de.device_uid = a.uid
        LEFT JOIN employees e ON e.uid = de.employee_uid
        ${where}
        GROUP BY DATE(a.timestamp), a.uid
      ) grouped
    `, params);

    const [metrics] = await query(`
      SELECT COUNT(*) AS totalScansToday,
             SUM(CASE WHEN e.uid IS NOT NULL THEN 1 ELSE 0 END) AS authorized,
             SUM(CASE WHEN e.uid IS NULL THEN 1 ELSE 0 END) AS unauthorized
      FROM attendance_logs a
      LEFT JOIN device_enrollments de ON de.device_id = a.device_id AND de.device_uid = a.uid
      LEFT JOIN employees e ON e.uid = de.employee_uid
      WHERE a.device_id = ? AND DATE(a.timestamp) = CURDATE()
    `, [device.id]);

    return NextResponse.json({
      device: { id: device.id, code: device.code, name: device.name, segment: device.segment_name },
      data: rawLogs,
      report,
      pagination: { page, totalPages: Math.max(1, Math.ceil(Number(count) / limit)), totalItems: Number(count) },
      metrics: {
        totalScansToday: Number(metrics.totalScansToday || 0),
        authorized: Number(metrics.authorized || 0),
        unauthorized: Number(metrics.unauthorized || 0),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Gagal memuat data presensi.' }, { status: error.status || 500 });
  }
}
