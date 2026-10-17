import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';
import { parseDeviceId } from '@/lib/devices';
import { setEnrollmentLink } from '@/lib/enrollments';

// Menghubungkan user mesin ke Pejuang (employee_uid berisi nomor Pejuang) atau
// melepasnya (employee_uid null). Keputusan ini dikunci agar tidak diubah oleh
// penghubungan otomatis saat sinkronisasi.
export async function PUT(request) {
  try {
    const user = await getUserSession(request);
    if (!user || !['superadmin', 'sdm'].includes(user.role)) {
      return NextResponse.json({ error: 'Akses ditolak. Hanya superadmin dan SDM yang dapat mengatur pemetaan.' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const deviceId = parseDeviceId(body.device_id);
    const deviceUid = Number.parseInt(body.device_uid, 10);
    const employeeUid = body.employee_uid === null ? null : Number.parseInt(body.employee_uid, 10);
    if (!deviceId || !Number.isInteger(deviceUid) || (employeeUid !== null && !Number.isInteger(employeeUid))) {
      return NextResponse.json({ error: 'Data pemetaan tidak valid.' }, { status: 422 });
    }

    if (employeeUid !== null) {
      const [employee] = await query(`SELECT name FROM employees WHERE uid = ?`, [employeeUid]);
      if (!employee) return NextResponse.json({ error: 'Pejuang tidak ditemukan.' }, { status: 404 });
    }
    if (!(await setEnrollmentLink(deviceId, deviceUid, employeeUid))) {
      return NextResponse.json({ error: 'User mesin tidak ditemukan. Sinkronkan mesin terlebih dahulu.' }, { status: 404 });
    }
    return NextResponse.json({ message: employeeUid === null ? 'User mesin dilepas dari Pejuang.' : 'User mesin dihubungkan ke Pejuang.' });
  } catch (error) {
    console.error('[API/enrollments]', error);
    return NextResponse.json({ error: 'Gagal menyimpan pemetaan.' }, { status: 500 });
  }
}
