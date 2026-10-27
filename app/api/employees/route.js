import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';
import { findDevice, parseDeviceId } from '@/lib/devices';
import { allocateEmployeeUids, autoLinkEnrollments, setEnrollmentLink } from '@/lib/enrollments';
import { sameName } from '@/lib/names';
import { emitRealtimeEvent } from '@/lib/events';

async function listEnrollments(deviceId) {
  return query(`
    SELECT de.device_id, de.device_uid, de.employee_uid, de.display_name, d.name AS device_name
    FROM device_enrollments de
    JOIN devices d ON d.id = de.device_id AND d.is_active = 1
    ${deviceId ? 'WHERE de.device_id = ?' : ''}
    ORDER BY d.name ASC, de.device_uid ASC
  `, deviceId ? [deviceId] : []);
}

export async function GET(request) {
  try {
    const user = await getUserSession(request);
    if (!user) return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
    const departmentFilter = (user.role === 'manager' && user.department) ? user.department : null;

    const requestedDevice = new URL(request.url).searchParams.get('device_id');
    let device = null;
    if (requestedDevice && requestedDevice !== 'all') {
      device = await findDevice(parseDeviceId(requestedDevice));
      if (!device) return NextResponse.json({ error: 'Mesin tidak ditemukan atau tidak aktif.' }, { status: 404 });
    }

    const [allEmployees, enrollments] = await Promise.all([
      query(`SELECT * FROM employees ORDER BY name ASC`),
      listEnrollments(device?.id),
    ]);
    const employeesByUid = new Map(allEmployees.map((employee) => [employee.uid, employee]));

    const devicesByEmployee = new Map();
    const unregistered = [];
    for (const row of enrollments) {
      if (row.employee_uid !== null && employeesByUid.has(row.employee_uid)) {
        const list = devicesByEmployee.get(row.employee_uid) || [];
        list.push({ id: row.device_id, name: row.device_name, device_uid: row.device_uid, machine_name: row.display_name });
        devicesByEmployee.set(row.employee_uid, list);
        continue;
      }
      if (departmentFilter) continue;
      const suggestion = row.display_name ? allEmployees.find((employee) => sameName(employee.name, row.display_name)) : null;
      unregistered.push({
        device_id: row.device_id,
        device_name: row.device_name,
        device_uid: row.device_uid,
        name: row.display_name,
        suggestion: suggestion ? { uid: suggestion.uid, name: suggestion.name } : null,
      });
    }

    const employees = allEmployees
      .filter((employee) => !departmentFilter || employee.department === departmentFilter)
      .map((employee) => ({ ...employee, devices: devicesByEmployee.get(employee.uid) || [] }))
      .filter((employee) => !device || employee.devices.length > 0);

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

    const body = await request.json().catch(() => ({}));
    const name = String(body.name || '').trim();
    const department = String(body.department || '').trim();
    const link = body.link ? { deviceId: parseDeviceId(body.link.device_id), deviceUid: Number.parseInt(body.link.device_uid, 10) } : null;
    const defaultDeviceId = parseDeviceId(body.device_id);
    const hasUid = body.uid !== undefined && body.uid !== null && String(body.uid).trim() !== '';
    let uid = hasUid ? Number.parseInt(body.uid, 10) : null;

    if (!name || name.length > 255 || department.length > 255 || (hasUid && (!Number.isInteger(uid) || uid < 1))) {
      return NextResponse.json({ error: 'Nama wajib diisi dan nomor Pejuang harus angka positif.' }, { status: 422 });
    }
    if (!hasUid && !link) return NextResponse.json({ error: 'Nomor Pejuang wajib diisi.' }, { status: 422 });
    if (link && (!link.deviceId || !Number.isInteger(link.deviceUid))) {
      return NextResponse.json({ error: 'User mesin yang akan dihubungkan tidak valid.' }, { status: 422 });
    }

    if (!hasUid) [uid] = await allocateEmployeeUids([link.deviceUid]);
    await query(`INSERT INTO employees (uid, name, department) VALUES (?, ?, ?)`, [uid, name, department]);

    if (link) {
      await setEnrollmentLink(link.deviceId, link.deviceUid, uid);
    } else {
      // Jika ditambahkan dari halaman Pejuang saat suatu mesin sedang dipilih,
      // pastikan baris enrollment tersedia dan langsung terhubung agar langsung tampil di tabel.
      if (defaultDeviceId) {
        await query(
          `INSERT INTO device_enrollments (device_id, device_uid, employee_uid, display_name, link_locked)
           VALUES (?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE
             employee_uid = IF(employee_uid IS NULL AND link_locked = 0, VALUES(employee_uid), employee_uid),
             display_name = IF(display_name = '', VALUES(display_name), display_name)`,
          [defaultDeviceId, uid, uid, name]
        );
      }
      await autoLinkEnrollments();
    }

    emitRealtimeEvent('employees', { action: 'create', uid, device_id: link?.deviceId || defaultDeviceId || null });

    return NextResponse.json({ message: 'Pejuang berhasil ditambahkan.', uid });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return NextResponse.json({ error: 'Nomor Pejuang ini sudah dipakai.' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
