import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';

const MAX_ITEMS = 500;

// Mendaftarkan banyak user mesin sebagai Pejuang sekaligus. UID yang sudah
// terdaftar dilewati, bukan ditimpa.
export async function POST(request) {
  try {
    const user = await getUserSession(request);
    if (!user || !['superadmin', 'sdm'].includes(user.role)) {
      return NextResponse.json({ error: 'Akses ditolak. Hanya superadmin dan SDM yang dapat menambah data.' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const department = String(body.department || '').trim();
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0 || items.length > MAX_ITEMS || department.length > 255) {
      return NextResponse.json({ error: `Pilih 1 sampai ${MAX_ITEMS} user mesin untuk didaftarkan.` }, { status: 422 });
    }

    const values = [];
    const seen = new Set();
    for (const item of items) {
      const uid = Number.parseInt(item?.uid, 10);
      const name = String(item?.name || '').trim();
      if (!Number.isInteger(uid) || uid < 1 || !name || name.length > 255) {
        return NextResponse.json({ error: `Data user mesin tidak valid (UID ${item?.uid ?? '-'}).` }, { status: 422 });
      }
      if (seen.has(uid)) continue;
      seen.add(uid);
      values.push([uid, name, department]);
    }

    const result = await query(`INSERT IGNORE INTO employees (uid, name, department) VALUES ?`, [values]);
    const inserted = result.affectedRows || 0;
    return NextResponse.json({
      message: `${inserted} Pejuang didaftarkan${values.length > inserted ? `, ${values.length - inserted} dilewati karena UID sudah terdaftar` : ''}.`,
      inserted,
      skipped: values.length - inserted,
    });
  } catch (error) {
    console.error('[API/employees/bulk]', error);
    return NextResponse.json({ error: 'Gagal mendaftarkan Pejuang.' }, { status: 500 });
  }
}
