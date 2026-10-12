import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getZkData } from '@/lib/zkteco';
import { getUserSession } from '@/lib/auth';
import { findDevice, parseDeviceId } from '@/lib/devices';

export async function POST(request) {
  try {
    const user = await getUserSession(request);
    if (!user) return NextResponse.json({ error: 'Akses ditolak. Silakan login terlebih dahulu.' }, { status: 401 });
    if (!['superadmin', 'sdm'].includes(user.role)) return NextResponse.json({ error: 'Akses ditolak. Hanya Super Admin dan SDM yang dapat menjalankan sinkronisasi.' }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const deviceId = parseDeviceId(body.device_id);
    if (!deviceId) return NextResponse.json({ error: 'Pilih mesin untuk disinkronkan.' }, { status: 400 });
    const device = await findDevice(deviceId);
    if (!device) return NextResponse.json({ error: 'Mesin tidak ditemukan atau tidak aktif.' }, { status: 404 });

    const { users, logs } = await getZkData(device);
    if (!logs?.length) return NextResponse.json({ message: 'Tidak ada data absensi dari mesin.', synced: 0, users_synced: 0 });

    for (const machineUser of users || []) {
      const uid = Number.parseInt(machineUser.userId, 10);
      if (!Number.isInteger(uid)) continue;
      await query(
        `INSERT INTO device_enrollments (device_id, device_uid, display_name) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)`,
        [device.id, uid, String(machineUser.name || '').trim()]
      );
    }

    let logsToSave = logs;
    if (body.full !== true) {
      const rows = await query(`SELECT MAX(timestamp) AS last_time FROM attendance_logs WHERE device_id = ?`, [device.id]);
      if (rows[0]?.last_time) {
        const lastTime = new Date(rows[0].last_time).getTime();
        logsToSave = logs.filter((log) => new Date(log.recordTime).getTime() > lastTime);
      }
    }

    const values = logsToSave.map((log) => {
      const uid = Number.parseInt(log.deviceUserId, 10);
      if (!Number.isInteger(uid)) return null;
      const date = new Date(log.recordTime);
      const pad = (value) => String(value).padStart(2, '0');
      const timestamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
      return [device.id, uid, timestamp, log.state || 0];
    }).filter(Boolean);

    let totalInserted = 0;
    for (let index = 0; index < values.length; index += 5000) {
      const result = await query(`INSERT IGNORE INTO attendance_logs (device_id, uid, timestamp, state) VALUES ?`, [values.slice(index, index + 5000)]);
      totalInserted += result.affectedRows || 0;
    }

    return NextResponse.json({ message: 'Sinkronisasi berhasil.', synced: totalInserted, users_synced: users?.length || 0, device: { id: device.id, code: device.code, name: device.name } });
  } catch (error) {
    console.error('Sync Error:', error);
    return NextResponse.json({ error: error.message || 'Sinkronisasi gagal.' }, { status: 500 });
  }
}
