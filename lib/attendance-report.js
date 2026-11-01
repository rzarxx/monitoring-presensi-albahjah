import { query } from '@/lib/db';
import { isDepartmentManager } from '@/lib/auth';

// Use the mapped employee UID, not the device UID or name, as the identity.
export async function getAttendanceReport({ deviceId, user, dateFrom, dateTo, search, department }) {
  const scan = ['a.device_id = ?'];
  const manual = ['l.device_id = ?'];
  const scanParams = [deviceId];
  const manualParams = [deviceId];
  if (dateFrom) { scan.push('DATE(a.timestamp) >= ?'); scanParams.push(dateFrom); manual.push('l.date >= ?'); manualParams.push(dateFrom); }
  if (dateTo) { scan.push('DATE(a.timestamp) <= ?'); scanParams.push(dateTo); manual.push('l.date <= ?'); manualParams.push(dateTo); }
  if (search) {
    scan.push('(e.name LIKE ? OR de.display_name LIKE ? OR CAST(a.uid AS CHAR) = ?)');
    scanParams.push(`%${search}%`, `%${search}%`, search);
    manual.push('(e.name LIKE ? OR CAST(l.uid AS CHAR) = ?)');
    manualParams.push(`%${search}%`, search);
  }
  if (department) {
    const exact = isDepartmentManager(user.role);
    scan.push(exact ? 'e.department = ?' : 'e.department LIKE ?');
    manual.push(exact ? 'e.department = ?' : 'e.department LIKE ?');
    scanParams.push(exact ? department : `%${department}%`);
    manualParams.push(exact ? department : `%${department}%`);
  }
  return query(`
    SELECT DATE_FORMAT(a.timestamp, '%Y-%m-%d') AS tgl,
      COALESCE(CAST(de.employee_uid AS CHAR), CONCAT('device:', a.uid)) AS employee_key,
      COALESCE(MAX(e.name), MAX(de.display_name), CONCAT('UID_', MIN(a.uid))) AS nama,
      COALESCE(MAX(e.department), '-') AS dept,
      DATE_FORMAT(MIN(a.timestamp), '%H:%i') AS jam_masuk,
      DATE_FORMAT(MAX(a.timestamp), '%H:%i') AS jam_keluar,
      TIMESTAMPDIFF(MINUTE, MIN(a.timestamp), MAX(a.timestamp)) AS dur_min,
      COUNT(a.id) AS total_scan, NULL AS leave_type, NULL AS leave_reason
    FROM attendance_logs a
    LEFT JOIN device_enrollments de ON de.device_id = a.device_id AND de.device_uid = a.uid
    LEFT JOIN employees e ON e.uid = de.employee_uid
    WHERE ${scan.join(' AND ')}
    GROUP BY DATE_FORMAT(a.timestamp, '%Y-%m-%d'), COALESCE(CAST(de.employee_uid AS CHAR), CONCAT('device:', a.uid))
    UNION ALL
    SELECT DATE_FORMAT(l.date, '%Y-%m-%d'), CAST(l.uid AS CHAR), e.name, COALESCE(e.department, '-'),
      CASE WHEN l.type = 'Hadir' THEN DATE_FORMAT(l.manual_check_in, '%H:%i') END,
      CASE WHEN l.type = 'Hadir' THEN DATE_FORMAT(l.manual_check_out, '%H:%i') END,
      CASE WHEN l.type = 'Hadir' AND l.manual_check_in IS NOT NULL AND l.manual_check_out IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, l.manual_check_in, l.manual_check_out) ELSE 0 END,
      0, l.type, l.reason
    FROM leaves l JOIN employees e ON e.uid = l.uid
    WHERE ${manual.join(' AND ')}
      AND l.id = (SELECT MAX(l2.id) FROM leaves l2 WHERE l2.device_id = l.device_id AND l2.uid = l.uid AND l2.date = l.date)
      AND NOT EXISTS (
        SELECT 1 FROM attendance_logs a2
        JOIN device_enrollments de2 ON de2.device_id = a2.device_id AND de2.device_uid = a2.uid
        WHERE a2.device_id = l.device_id AND de2.employee_uid = l.uid AND DATE(a2.timestamp) = l.date
      )
    ORDER BY nama ASC, tgl ASC
  `, [...scanParams, ...manualParams]);
}
