import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getZkData, runDeviceJob } from '@/lib/zkteco';
import { getUserSession } from '@/lib/auth';
import { findDevice, parseDeviceId } from '@/lib/devices';
import { autoLinkEnrollments, ensureEnrollments } from '@/lib/enrollments';

const pad = (value) => String(value).padStart(2, '0');
const formatLocal = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

function latestRecordTime(logs) {
  let latest = null;
  for (const log of logs) {
    const time = new Date(log.recordTime);
    if (!Number.isNaN(time.getTime()) && (!latest || time > latest)) latest = time;
  }
  return latest;
}

// Membandingkan apa yang dilaporkan mesin, yang terbaca, dan yang tersimpan,
// supaya pembacaan yang tidak lengkap terlihat di hasil sinkronisasi.
async function buildDiagnostics(device, { logs, machine, partial }) {
  const [row] = await query(`SELECT COUNT(*) AS total, MAX(timestamp) AS latest FROM attendance_logs WHERE device_id = ?`, [device.id]);
  const latestMachine = latestRecordTime(logs);
  const latestDatabase = row?.latest ? new Date(row.latest) : null;
  const warnings = [];
  if (partial) warnings.push(`Pembacaan log terhenti sebelum selesai: ${partial}`);
  if (machine && logs.length < machine.logCount) {
    warnings.push(`Mesin melaporkan ${machine.logCount} log, tetapi hanya ${logs.length} yang terbaca. Coba sinkronkan ulang.`);
  }
  if (latestMachine && (!latestDatabase || latestMachine > latestDatabase)) {
    warnings.push('Scan terakhir di mesin belum tersimpan di database. Coba "Sinkronkan Semua Data".');
  }
  return {
    machine_log_count: machine?.logCount ?? null,
    read_log_count: logs.length,
    database_log_count: Number(row?.total || 0),
    latest_machine_log: latestMachine ? formatLocal(latestMachine) : null,
    latest_database_log: latestDatabase ? formatLocal(latestDatabase) : null,
    warnings,
  };
}

async function syncDevice(device, full) {
  const pulled = await getZkData(device);
  const { users } = pulled;
  const logs = pulled.logs || [];

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
  if (!full) {
    const rows = await query(`SELECT MAX(timestamp) AS last_time FROM attendance_logs WHERE device_id = ?`, [device.id]);
    if (rows[0]?.last_time) {
      const lastTime = new Date(rows[0].last_time).getTime();
      logsToSave = logs.filter((log) => new Date(log.recordTime).getTime() > lastTime);
    }
  }

  const values = logsToSave.map((log) => {
    const uid = Number.parseInt(log.deviceUserId, 10);
    if (!Number.isInteger(uid)) return null;
    return [device.id, uid, formatLocal(new Date(log.recordTime)), log.state || 0];
  }).filter(Boolean);

  let totalInserted = 0;
  for (let index = 0; index < values.length; index += 5000) {
    const result = await query(`INSERT IGNORE INTO attendance_logs (device_id, uid, timestamp, state) VALUES ?`, [values.slice(index, index + 5000)]);
    totalInserted += result.affectedRows || 0;
  }

  // Setiap UID yang scan butuh baris pemetaan (juga user yang sudah dihapus dari
  // mesin), lalu yang nomor dan namanya cocok dengan Pejuang dihubungkan otomatis.
  await ensureEnrollments(device.id, values.map((value) => value[1]));
  await autoLinkEnrollments(device.id);

  return {
    message: logs.length ? 'Sinkronisasi berhasil.' : 'Tidak ada data absensi dari mesin.',
    synced: totalInserted,
    users_synced: users?.length || 0,
    diagnostics: await buildDiagnostics(device, pulled),
  };
}

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

    const full = body.full === true;
    // Sinkronisasi yang sedang berjalan untuk mesin yang sama dipakai bersama;
    // sinkronisasi penuh hanya boleh menumpang pada sinkronisasi penuh lain.
    const result = await runDeviceJob(device, full ? 'full' : 'incremental', () => syncDevice(device, full),
      (runningMode) => runningMode === 'full' || !full);

    return NextResponse.json({ ...result, device: { id: device.id, code: device.code, name: device.name } });
  } catch (error) {
    console.error('Sync Error:', error);
    return NextResponse.json({ error: error.message || 'Sinkronisasi gagal.' }, { status: 502 });
  }
}
