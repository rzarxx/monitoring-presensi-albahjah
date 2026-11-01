import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession, isDepartmentManager } from '@/lib/auth';
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
    if (isDepartmentManager(user.role) && !user.department?.trim()) return NextResponse.json({ error: 'Akun belum memiliki departemen.' }, { status: 403 });

    const searchParams = new URL(request.url).searchParams;
    const device = await requireDevice(searchParams);
    const date = searchParams.get('date');
    const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('date_from') || '') ? searchParams.get('date_from') : null;
    const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('date_to') || '') ? searchParams.get('date_to') : null;
    const search = searchParams.get('search');
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('limit') || '5', 10)));
    const offset = (page - 1) * limit;
    const orderColumn = sortableColumns[searchParams.get('sortCol')] || sortableColumns.date;
    const orderDirection = String(searchParams.get('sortDir') || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const department = isDepartmentManager(user.role) ? user.department : null;
    const employeeUid = Number.parseInt(searchParams.get('employee_uid') || '', 10);

    // 1. Kondisi untuk attendance_logs
    const attConditions = ['a.device_id = ?'];
    const attParams = [device.id];
    if (date) { attConditions.push('DATE(a.timestamp) = ?'); attParams.push(date); }
    else if (dateFrom && dateTo) { attConditions.push('DATE(a.timestamp) BETWEEN ? AND ?'); attParams.push(dateFrom, dateTo); }
    else attConditions.push('DATE(a.timestamp) = DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)');
    if (department) { attConditions.push('e.department = ?'); attParams.push(department); }
    if (search) {
      attConditions.push('(e.name LIKE ? OR de.display_name LIKE ? OR CAST(a.uid AS CHAR) = ?)');
      attParams.push(`%${search}%`, `%${search}%`, search);
    }
    if (Number.isInteger(employeeUid)) { attConditions.push('de.employee_uid = ?'); attParams.push(employeeUid); }
    const attWhere = `WHERE ${attConditions.join(' AND ')}`;

    // 2. Kondisi untuk leaves (izin/sakit/cuti yang belum ada scan kehadiran di hari tersebut)
    const leaveConditions = ['l.device_id = ?'];
    const leaveParams = [device.id];
    if (date) { leaveConditions.push('l.date = ?'); leaveParams.push(date); }
    else if (dateFrom && dateTo) { leaveConditions.push('l.date BETWEEN ? AND ?'); leaveParams.push(dateFrom, dateTo); }
    else leaveConditions.push('l.date = DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)');
    if (department) { leaveConditions.push('e.department = ?'); leaveParams.push(department); }
    if (search) {
      leaveConditions.push('(e.name LIKE ? OR CAST(l.uid AS CHAR) = ? OR l.type LIKE ?)');
      leaveParams.push(`%${search}%`, search, `%${search}%`);
    }
    if (Number.isInteger(employeeUid)) { leaveConditions.push('l.uid = ?'); leaveParams.push(employeeUid); }
    const leaveWhere = `WHERE ${leaveConditions.join(' AND ')}`;

    // Raw logs untuk panel "Aktivitas Terkini"
    const rawConditions = ['a.device_id = ?'];
    const rawParams = [device.id];
    if (date) { rawConditions.push('DATE(a.timestamp) = ?'); rawParams.push(date); }
    else if (dateFrom && dateTo) { rawConditions.push('DATE(a.timestamp) BETWEEN ? AND ?'); rawParams.push(dateFrom, dateTo); }
    if (department) { rawConditions.push('e.department = ?'); rawParams.push(department); }
    if (search) {
      rawConditions.push('(e.name LIKE ? OR de.display_name LIKE ? OR CAST(a.uid AS CHAR) = ?)');
      rawParams.push(`%${search}%`, `%${search}%`, search);
    }
    if (Number.isInteger(employeeUid)) { rawConditions.push('de.employee_uid = ?'); rawParams.push(employeeUid); }
    const rawLogs = await query(`
      SELECT a.id, a.uid AS device_uid, a.timestamp, a.state,
             COALESCE(e.name, de.display_name) AS name, e.department
      FROM attendance_logs a
      LEFT JOIN device_enrollments de ON de.device_id = a.device_id AND de.device_uid = a.uid
      LEFT JOIN employees e ON e.uid = de.employee_uid
      WHERE ${rawConditions.join(' AND ')}
      ORDER BY a.timestamp DESC LIMIT 100
    `, rawParams);

    const combinedSubquery = `
      SELECT DATE(a.timestamp) AS date,
             MIN(a.uid) AS device_uid,
             MAX(de.employee_uid) AS employee_uid,
             COALESCE(MAX(e.name), MAX(de.display_name)) AS name,
             COALESCE(e.department, '') AS department,
             MIN(a.timestamp) AS check_in,
             MAX(a.timestamp) AS check_out,
             COUNT(a.id) AS scan_count,
             NULL AS leave_type,
             NULL AS leave_reason
      FROM attendance_logs a
      LEFT JOIN device_enrollments de ON de.device_id = a.device_id AND de.device_uid = a.uid
      LEFT JOIN employees e ON e.uid = de.employee_uid
      ${attWhere}
      GROUP BY DATE(a.timestamp), COALESCE(CAST(de.employee_uid AS CHAR), CONCAT('device:', a.uid)), e.name, e.department

      UNION ALL

      SELECT l.date AS date,
             l.uid AS device_uid,
             l.uid AS employee_uid,
             COALESCE(e.name, CONCAT('UID_', l.uid)) AS name,
             COALESCE(e.department, '') AS department,
             CASE WHEN l.type = 'Hadir' AND l.manual_check_in IS NOT NULL THEN TIMESTAMP(l.date, l.manual_check_in) END AS check_in,
             CASE WHEN l.type = 'Hadir' AND l.manual_check_out IS NOT NULL THEN TIMESTAMP(l.date, l.manual_check_out) END AS check_out,
             0 AS scan_count,
             l.type AS leave_type,
             l.reason AS leave_reason
      FROM leaves l
      LEFT JOIN employees e ON e.uid = l.uid
      ${leaveWhere}
      AND l.id = (SELECT MAX(l2.id) FROM leaves l2 WHERE l2.device_id = l.device_id AND l2.uid = l.uid AND l2.date = l.date)
      AND NOT EXISTS (
        SELECT 1 FROM attendance_logs a2
        LEFT JOIN device_enrollments de2 ON de2.device_id = a2.device_id AND de2.device_uid = a2.uid
        WHERE a2.device_id = l.device_id
          AND DATE(a2.timestamp) = l.date
          AND de2.employee_uid = l.uid
      )
    `;

    const unionParams = [...attParams, ...leaveParams];

    const report = await query(`
      SELECT * FROM (${combinedSubquery}) AS combined_report
      ORDER BY ${orderColumn} ${orderDirection}, name ASC
      LIMIT ? OFFSET ?
    `, [...unionParams, limit, offset]);

    const [{ count }] = await query(`
      SELECT COUNT(*) AS count FROM (${combinedSubquery}) AS grouped
    `, unionParams);

    const [metrics] = await query(`
      SELECT COUNT(*) AS totalScansToday,
             SUM(CASE WHEN e.uid IS NOT NULL THEN 1 ELSE 0 END) AS authorized,
             SUM(CASE WHEN e.uid IS NULL THEN 1 ELSE 0 END) AS unauthorized
      FROM attendance_logs a
      LEFT JOIN device_enrollments de ON de.device_id = a.device_id AND de.device_uid = a.uid
      LEFT JOIN employees e ON e.uid = de.employee_uid
      WHERE a.device_id = ? AND DATE(a.timestamp) = DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)${department ? ' AND e.department = ?' : ''}
    `, department ? [device.id, department] : [device.id]);

    const missingDepartment = department ? 'AND e.department = ?' : '';
    const missingParams = [date || null, date || null, device.id];
    if (department) missingParams.push(department);
    const missingAttendance = await query(`
      SELECT e.uid, e.name, COALESCE(e.department, '') AS department,
             MAX(l.id) AS status_id,
             MAX(l.type) AS status_type,
             MAX(l.reason) AS status_reason,
             MAX(DATE_FORMAT(l.manual_check_in, '%H:%i')) AS manual_check_in,
             MAX(DATE_FORMAT(l.manual_check_out, '%H:%i')) AS manual_check_out
      FROM device_enrollments de
      JOIN employees e ON e.uid = de.employee_uid
      LEFT JOIN leaves l
        ON l.device_id = de.device_id
       AND l.uid = e.uid
       AND l.date = COALESCE(?, DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR))
       AND l.id = (SELECT MAX(l2.id) FROM leaves l2 WHERE l2.device_id = l.device_id AND l2.uid = l.uid AND l2.date = l.date)
      LEFT JOIN attendance_logs a2
        ON a2.device_id = de.device_id
       AND a2.uid = de.device_uid
       AND DATE(a2.timestamp) = COALESCE(?, DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR))
      WHERE de.device_id = ?
        AND de.employee_uid IS NOT NULL
        ${missingDepartment}
      GROUP BY e.uid, e.name, e.department
      HAVING COUNT(a2.id) = 0
      ORDER BY e.name ASC
    `, missingParams);

    return NextResponse.json({
      device: { id: device.id, code: device.code, name: device.name, segment: device.segment_name },
      data: rawLogs,
      report,
      missingAttendance,
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
