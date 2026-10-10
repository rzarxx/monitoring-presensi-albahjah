import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';

export async function GET(request) {
  try {
    const user = await getUserSession(request);
    if (!user) return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
    const departmentFilter = (user.role === 'manager' && user.department) ? user.department : null;

    let sql = `SELECT * FROM employees`;
    const params = [];
    if (departmentFilter) {
      sql += ` WHERE department = ?`;
      params.push(departmentFilter);
    }
    sql += ` ORDER BY name ASC`;

    const rows = await query(sql, params);
    return NextResponse.json({ data: rows });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const user = await getUserSession(request);
    if (!user || (user.role !== 'superadmin' && user.role !== 'sdm')) {
      return NextResponse.json({ error: 'Akses ditolak. Hanya superadmin dan SDM yang dapat menambah data.' }, { status: 403 });
    }

    const { uid, name, department } = await request.json();
    await query(
      `INSERT INTO employees (uid, name, department) VALUES (?, ?, ?)`,
      [uid, name, department]
    );
    return NextResponse.json({ message: 'Employee added successfully' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
