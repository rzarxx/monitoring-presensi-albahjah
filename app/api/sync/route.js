import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getZkData, runDeviceJob } from '@/lib/zkteco';
import { getUserSession } from '@/lib/auth';
import { findDevice, listDevices, parseDeviceId } from '@/lib/devices';
import { autoLinkEnrollments, ensureEnrollments } from '@/lib/enrollments';
import { emitRealtimeEvent } from '@/lib/events';
import { refreshRealtimeDevices } from '@/lib/realtime-monitor';
import { getSyncJob, startMasterSync } from '@/lib/sync-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  // Bulk upsert seluruh user mesin dalam batch (jauh lebih cepat dibanding loop satu per satu)
  const enrollmentRows = [];
  let usersWithoutName = 0;
  for (const machineUser of users || []) {
    const uid = Number.parseInt(machineUser.userId, 10);
    if (!Number.isInteger(uid)) continue;
    const displayName = String(machineUser.name || '').trim();
    if (!displayName) usersWithoutName++;
    enrollmentRows.push([device.id, uid, displayName]);
  }
  for (let index = 0; index < enrollmentRows.length; index += 1000) {
    const batch = enrollmentRows.slice(index, index + 1000);
    await query(
      `INSERT INTO device_enrollments (device_id, device_uid, display_name) VALUES ?
       ON DUPLICATE KEY UPDATE
         display_name = IF(VALUES(display_name) <> '', VALUES(display_name), display_name)`,
      [batch]
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

  await ensureEnrollments(device.id, values.map((value) => value[1]));
  await autoLinkEnrollments(device.id);

  // Pancarkan event real-time ke seluruh tab browser yang sedang aktif
  emitRealtimeEvent('sync', {
    device_id: device.id,
    synced: totalInserted,
    users_synced: users?.length || 0,
    users_without_name: usersWithoutName,
  });

  return {
    message: logs.length ? 'Sinkronisasi berhasil.' : 'Tidak ada data absensi dari mesin.',
    synced: totalInserted,
    users_synced: users?.length || 0,
    users_without_name: usersWithoutName,
    diagnostics: await buildDiagnostics(device, pulled),
  };
}

function canSync(user) {
  return ['superadmin', 'sdm'].includes(user?.role);
}

// Dipakai route cron internal setelah tokennya tervalidasi. Seluruh pemicu sync
// tetap berbagi satu master job sehingga tidak membuka koneksi ZKTeco ganda.
export async function beginSync(body = {}, { source = 'manual', requestedBy = null } = {}) {
  const full = body.full === true;
  const deviceId = parseDeviceId(body.device_id);
  const devices = body.all === true
    ? await listDevices(true)
    : [await findDevice(deviceId)].filter(Boolean);
  if (!devices.length) {
    const error = new Error(body.all === true ? 'Tidak ada mesin aktif untuk disinkronkan.' : 'Mesin tidak ditemukan atau tidak aktif.');
    error.status = body.all === true ? 404 : 400;
    throw error;
  }

  return startMasterSync(devices, (device) => runDeviceJob(
    device,
    full ? 'full' : 'incremental',
    () => syncDevice(device, full),
    (runningMode) => runningMode === 'full' || !full
  ).finally(() => {
    refreshRealtimeDevices().catch(() => {});
  }), { source, requestedBy });
}

export async function GET(request) {
  const user = await getUserSession(request);
  if (!canSync(user)) return NextResponse.json({ error: 'Akses ditolak.' }, { status: 403 });
  const jobId = new URL(request.url).searchParams.get('job_id');
  const job = jobId && getSyncJob(jobId);
  if (!job) return NextResponse.json({ error: 'Status sinkronisasi tidak ditemukan.' }, { status: 404 });
  return NextResponse.json({ job });
}

export async function POST(request) {
  try {
    const user = await getUserSession(request);
    if (!user) return NextResponse.json({ error: 'Akses ditolak. Silakan login terlebih dahulu.' }, { status: 401 });
    if (!canSync(user)) return NextResponse.json({ error: 'Akses ditolak. Hanya Super Admin dan SDM yang dapat menjalankan sinkronisasi.' }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const { job, joined } = await beginSync(body, { source: 'manual', requestedBy: user.username || user.id || null });

    return NextResponse.json({ message: joined ? 'Bergabung ke sinkronisasi yang sedang berjalan.' : 'Sinkronisasi dimulai di latar belakang.', job }, { status: 202 });
  } catch (error) {
    console.error('Sync Error:', error);
    return NextResponse.json({ error: error.message || 'Sinkronisasi gagal.' }, { status: 502 });
  }
}
