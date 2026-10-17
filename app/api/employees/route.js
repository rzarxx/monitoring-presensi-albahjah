import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';
import { findDevice, parseDeviceId } from '@/lib/devices';

// UID yang tercatat di mesin: dari daftar user mesin (sinkronisasi) maupun dari
// log scan, karena mesin lama (LEGACY-01) hanya punya log tanpa daftar user.
async function listDevicePresence(deviceId) {
  const deviceFilter = deviceId ? 'WHERE device_id = ?' : '';
  const params = deviceId ? [deviceId, deviceId] : [];
  return query(`
    SELECT x.device_id, x.device_uid, COALESCE(de.employee_uid, x.device_uid) AS uid,
           COALESCE(de.display_name, '') AS display_name, d.name AS device_name
    FROM (
      SELECT device_id, device_uid FROM device_enrollments ${deviceFilter}
      UNION
      SELECT DISTINCT device_id, uid FROM attendance_logs ${deviceFilter}
    ) x
    JOIN devices d ON d.id = x.device_id AND d.is_active = 1
    LEFT JOIN device_enrollments de ON de.device_id = x.device_id AND de.device_uid = x.device_uid
    ORDER BY d.name ASC
  `, params);
}

export async function GET(request) {
  try {
    const user = await getUserSession(request);
    if (!user) return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
    const departmentFilter = (user.role === 'manager' && user.department) ? user.department : null;

    // Tanpa device_id (atau "all") semua Pejuang dikembalikan, seperti sebelumnya.
    const requestedDevice = new URL(request.url).searchParams.get('device_id');
    let device = null;
    if (requestedDevice && requestedDevice !== 'all') {
      device = await findDevice(parseDeviceId(requestedDevice));
      if (!device) return NextResponse.json({ error: 'Mesin tidak ditemukan atau tidak aktif.' }, { status: 404 });
    }

    let sql = `SELECT * FROM employees`;
    const params = [];
    if (departmentFilter) {
      sql += ` WHERE department = ?`;
      params.push(departmentFilter);
    }
    sql += ` ORDER BY name ASC`;

    const [rows, presence] = await Promise.all([query(sql, params), listDevicePresence(device?.id)]);

    const devicesByUid = new Map();
    for (const row of presence) {
      const list = devicesByUid.get(row.uid) || [];
      if (!list.some((item) => item.id === row.device_id)) list.push({ id: row.device_id, name: row.device_name });
      devicesByUid.set(row.uid, list);
    }

    const employees = rows
      .map((employee) => ({ ...employee, devices: devicesByUid.get(employee.uid) || [] }))
      .filter((employee) => !device || employee.devices.length > 0);

    // User mesin yang belum punya data Pejuang. Departemennya belum diketahui,
    // jadi tidak ditampilkan untuk akun yang dibatasi per departemen.
    const knownUids = new Set((departmentFilter ? await query('SELECT uid FROM employees') : rows).map((row) => row.uid));
    const unregisteredByUid = new Map();
    if (!departmentFilter) {
      for (const row of presence) {
        if (knownUids.has(row.uid)) continue;
        const entry = unregisteredByUid.get(row.uid) || { uid: row.uid, name: '', devices: [] };
        if (!entry.name && row.display_name) entry.name = row.display_name;
        if (!entry.devices.some((item) => item.id === row.device_id)) entry.devices.push({ id: row.device_id, name: row.device_name });
        unregisteredByUid.set(row.uid, entry);
      }
    }
    const unregistered = [...unregisteredByUid.values()].sort((a, b) => a.uid - b.uid);

    return NextResponse.json({
      data: employees,
      unregistered,
      device: device ? { id: device.id, name: device.name } : null,
    });
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
    if (error.code === 'ER_DUP_ENTRY') return NextResponse.json({ error: 'UID ini sudah terdaftar sebagai Pejuang.' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
