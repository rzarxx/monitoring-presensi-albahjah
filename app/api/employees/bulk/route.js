import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';
import { parseDeviceId } from '@/lib/devices';
import { allocateEmployeeUids, setEnrollmentLink } from '@/lib/enrollments';

const MAX_ITEMS = 500;

// Mendaftarkan banyak user mesin sebagai Pejuang sekaligus dan langsung
// menghubungkannya. Nomor Pejuang memakai UID mesin bila belum dipakai,
// selain itu nomor bebas berikutnya (UID mesin lain bisa milik orang lain).
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

    const entries = [];
    const seen = new Set();
    for (const item of items) {
      const deviceId = parseDeviceId(item?.device_id);
      const deviceUid = Number.parseInt(item?.device_uid, 10);
      const name = String(item?.name || '').trim();
      if (!deviceId || !Number.isInteger(deviceUid) || !name || name.length > 255) {
        return NextResponse.json({ error: `Data user mesin tidak valid (UID ${item?.device_uid ?? '-'}).` }, { status: 422 });
      }
      const key = `${deviceId}:${deviceUid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ deviceId, deviceUid, name });
    }

    const uids = await allocateEmployeeUids(entries.map((entry) => entry.deviceUid));
    await query(`INSERT INTO employees (uid, name, department) VALUES ?`, [entries.map((entry, index) => [uids[index], entry.name, department])]);
    for (const [index, entry] of entries.entries()) {
      await setEnrollmentLink(entry.deviceId, entry.deviceUid, uids[index]);
    }

    const renumbered = entries.filter((entry, index) => uids[index] !== entry.deviceUid).length;
    return NextResponse.json({
      message: `${entries.length} Pejuang didaftarkan${renumbered ? ` (${renumbered} mendapat nomor Pejuang baru karena nomor UID mesinnya sudah dipakai)` : ''}.`,
      inserted: entries.length,
    });
  } catch (error) {
    console.error('[API/employees/bulk]', error);
    return NextResponse.json({ error: error.code === 'ER_DUP_ENTRY' ? 'Nomor Pejuang bentrok; muat ulang halaman lalu coba lagi.' : 'Gagal mendaftarkan Pejuang.' }, { status: 500 });
  }
}
