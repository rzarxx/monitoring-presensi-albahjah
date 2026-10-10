import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';

export async function GET(request) {
  try {
    const user = await getUserSession(request);
    if (!user) {
      return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const date    = searchParams.get('date');
    const search  = searchParams.get('search');
    const sortCol = searchParams.get('sortCol') || 'date';
    const sortDir = (searchParams.get('sortDir') || 'desc').toUpperCase();

    const page   = parseInt(searchParams.get('page') || '1', 10);
    const limit  = parseInt(searchParams.get('limit') || '5', 10);
    const offset = (page - 1) * limit;

    const departmentFilter = (user && user.role === 'manager' && user.department) ? user.department : null;

    // ── Live feed ────────────────────────────────────────────────────────────
    let liveWhereParts = [];
    let liveParams = [];
    
    if (departmentFilter) {
      liveWhereParts.push('e.department = ?');
      liveParams.push(departmentFilter);
    }
    
    if (search) {
      liveWhereParts.push('(e.name LIKE ? OR CAST(a.uid AS CHAR) = ?)');
      liveParams.push(`%${search}%`, search);
    }
    
    const liveWhere = liveWhereParts.length > 0 ? `WHERE ${liveWhereParts.join(' AND ')}` : '';
    
    // limit if explicitly requested for live feed
    const liveLimit = searchParams.get('limit') ? parseInt(searchParams.get('limit'), 10) : 100;

    const rawLogs = await query(`
      SELECT a.id, a.timestamp, a.state, e.name, e.department, a.uid AS device_uid
      FROM attendance_logs a
      LEFT JOIN employees e ON a.uid = e.uid
      ${liveWhere}
      ORDER BY a.timestamp DESC
      LIMIT ?
    `, [...liveParams, liveLimit]);

    // ── Report (check-in / check-out per orang per hari) ────────────────────
    const conditions = [];
    const params = [];

    if (departmentFilter) {
      conditions.push(`e.department = ?`);
      params.push(departmentFilter);
    }

    if (date) {
      conditions.push(`DATE(a.timestamp) = ?`);
      params.push(date);
    } else {
      conditions.push(`DATE(a.timestamp) = CURDATE()`);
    }

    if (search) {
      conditions.push(`(e.name LIKE ? OR CAST(a.uid AS CHAR) = ?)`);
      params.push(`%${search}%`, search);
    }

    const where   = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    let orderColumn = 'MIN(a.timestamp)';
    if (sortCol === 'name') orderColumn = 'e.name';
    if (sortCol === 'department') orderColumn = 'e.department';
    if (sortCol === 'check_in') orderColumn = 'MIN(a.timestamp)';
    if (sortCol === 'check_out') orderColumn = 'MAX(a.timestamp)';
    if (sortCol === 'scan_count') orderColumn = 'COUNT(a.id)';
    // Date is MIN(a.timestamp) technically since we group by DATE(a.timestamp)
    
    const validSortDir = sortDir === 'ASC' ? 'ASC' : 'DESC';
    const orderBy = `ORDER BY ${orderColumn} ${validSortDir}, e.name ASC`;

    // Ambil total data untuk pagination
    const countParams = [...params, ...params]; // Params dipanggil 2 kali (1 untuk attendance, 1 untuk leaves)
    
    // Ganti 'DATE(a.timestamp)' dengan 'date' pada kondisi untuk UNION
    const baseWhere = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const attWhere = baseWhere.replace(/date/g, 'DATE(a.timestamp)');
    const leaveWhere = baseWhere.replace(/DATE\(a\.timestamp\)/g, 'l.date').replace(/a\.uid/g, 'l.uid');

    const totalQuery = await query(`
      SELECT COUNT(*) as count FROM (
        SELECT date, device_uid FROM (
          SELECT DATE(a.timestamp) as date, a.uid as device_uid
          FROM attendance_logs a
          LEFT JOIN employees e ON a.uid = e.uid
          ${attWhere}
          
          UNION ALL
          
          SELECT l.date as date, l.uid as device_uid
          FROM leaves l
          LEFT JOIN employees e ON l.uid = e.uid
          ${leaveWhere}
        ) combined
        GROUP BY date, device_uid
      ) as grouped_table
    `, countParams);
    const totalItems = totalQuery[0].count;
    const totalPages = Math.ceil(totalItems / limit);

    // Ambil data untuk halaman ini
    const reportParams = [...params, ...params, limit, offset];
    
    // Sesuaikan order column
    let reportOrderColumn = 'MIN(combined.check_in)';
    if (sortCol === 'name') reportOrderColumn = 'e.name';
    if (sortCol === 'department') reportOrderColumn = 'e.department';
    if (sortCol === 'check_in') reportOrderColumn = 'MIN(combined.check_in)';
    if (sortCol === 'check_out') reportOrderColumn = 'MAX(combined.check_out)';
    if (sortCol === 'scan_count') reportOrderColumn = 'SUM(combined.scan_count)';
    
    const reportValidSortDir = sortDir === 'ASC' ? 'ASC' : 'DESC';
    const reportOrderBy = `ORDER BY ${reportOrderColumn} ${reportValidSortDir}, e.name ASC`;

    const reportLogs = await query(`
      SELECT
        combined.date,
        combined.device_uid,
        e.name,
        e.department,
        MIN(combined.check_in) AS check_in,
        MAX(combined.check_out) AS check_out,
        SUM(combined.scan_count) AS scan_count,
        MAX(combined.leave_type) AS leave_type
      FROM (
        SELECT DATE(a.timestamp) as date, a.uid as device_uid, MIN(a.timestamp) as check_in, MAX(a.timestamp) as check_out, COUNT(a.id) as scan_count, NULL as leave_type
        FROM attendance_logs a
        LEFT JOIN employees e ON a.uid = e.uid
        ${attWhere}
        GROUP BY DATE(a.timestamp), a.uid
        
        UNION ALL
        
        SELECT l.date as date, l.uid as device_uid, NULL as check_in, NULL as check_out, 0 as scan_count, l.type as leave_type
        FROM leaves l
        LEFT JOIN employees e ON l.uid = e.uid
        ${leaveWhere}
      ) combined
      LEFT JOIN employees e ON combined.device_uid = e.uid
      GROUP BY combined.date, combined.device_uid
      ${reportOrderBy}
      LIMIT ? OFFSET ?
    `, reportParams);

    // ── Metrics ─────────────────────────────────────────────────────────────
    let totalRowsWhere = `WHERE DATE(timestamp) = CURDATE()`;
    let totalRowsParams = [];
    let authRowsWhere = `WHERE DATE(a.timestamp) = CURDATE()`;
    let authRowsParams = [];
    
    if (departmentFilter) {
      // Need a JOIN for totalRows to filter by department
      totalRowsWhere = `LEFT JOIN employees e ON attendance_logs.uid = e.uid WHERE DATE(timestamp) = CURDATE() AND e.department = ?`;
      totalRowsParams.push(departmentFilter);
      authRowsWhere += ` AND e.department = ?`;
      authRowsParams.push(departmentFilter);
    }
    
    const totalRows = await query(`SELECT COUNT(*) AS total FROM attendance_logs ${totalRowsWhere}`, totalRowsParams);
    const authRows  = await query(`
      SELECT
        SUM(CASE WHEN e.id IS NOT NULL THEN 1 ELSE 0 END) AS authorized,
        SUM(CASE WHEN e.id IS NULL     THEN 1 ELSE 0 END) AS unauthorized
      FROM attendance_logs a
      LEFT JOIN employees e ON a.uid = e.uid
      ${authRowsWhere}
    `, authRowsParams);

    return NextResponse.json({
      data:    rawLogs,
      report:  reportLogs,
      pagination: {
        page,
        totalPages,
        totalItems,
      },
      metrics: {
        totalScansToday: totalRows[0].total,
        authorized:      parseInt(authRows[0].authorized   || 0, 10),
        unauthorized:    parseInt(authRows[0].unauthorized || 0, 10),
      },
    });
  } catch (error) {
    console.error('[API/logs]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
