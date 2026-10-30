import { randomUUID } from 'node:crypto';
import { emitRealtimeEvent } from '@/lib/events';
import { logActivity } from '@/lib/activity-log';

const state = globalThis.__attendanceSyncJobs || (globalThis.__attendanceSyncJobs = {
  activeJobId: null,
  jobs: new Map(),
});

function snapshot(job) {
  return {
    id: job.id,
    status: job.status,
    total: job.total,
    completed: job.completed,
    succeeded: job.succeeded,
    failed: job.failed,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    results: job.results,
    source: job.source,
  };
}

function pruneJobs() {
  if (state.jobs.size <= 20) return;
  const removable = [...state.jobs.values()]
    .filter((job) => job.status !== 'running')
    .sort((a, b) => a.finishedAt - b.finishedAt);
  while (state.jobs.size > 20 && removable.length) state.jobs.delete(removable.shift().id);
}

/**
 * Menjalankan sinkronisasi di proses Node setelah respons 202 dikirim ke browser.
 * Satu master job dipakai bersama agar login/tab lain tidak membuka koneksi ganda
 * ke seluruh mesin fingerprint pada waktu yang sama.
 */
export function startMasterSync(devices, execute, metadata = {}) {
  const active = state.activeJobId ? state.jobs.get(state.activeJobId) : null;
  if (active?.status === 'running') return { job: snapshot(active), joined: true };

  const job = {
    id: randomUUID(),
    status: 'running',
    total: devices.length,
    completed: 0,
    succeeded: 0,
    failed: 0,
    startedAt: Date.now(),
    finishedAt: null,
    results: [],
    source: metadata.source || 'manual',
    requestedBy: metadata.requestedBy || null,
  };
  state.activeJobId = job.id;
  state.jobs.set(job.id, job);

  // Jalankan berurutan: pembaca ZKTeco pada satu mesin tidak pernah berbagi socket,
  // dan server tidak dibebani banyak dump log besar secara bersamaan.
  void (async () => {
    await logActivity({
      eventType: 'sync_started',
      source: job.source,
      jobId: job.id,
      message: `Sinkronisasi ${job.source === 'scheduler' ? 'terjadwal' : 'manual'} dimulai untuk ${job.total} mesin.`,
      context: { requested_by: job.requestedBy, total_devices: job.total },
    });
    for (const device of devices) {
      try {
        const result = await execute(device);
        job.succeeded++;
        const usersWithoutName = Number(result.users_without_name || 0);
        const syncContext = {
          synced: result.synced ?? 0,
          users_synced: result.users_synced ?? 0,
          users_without_name: usersWithoutName,
          diagnostics: result.diagnostics ?? null,
        };
        job.results.push({ device: { id: device.id, code: device.code, name: device.name }, ok: true, ...syncContext });
        await logActivity({
          level: usersWithoutName ? 'warning' : 'info',
          eventType: 'sync_device_completed', source: job.source, jobId: job.id, deviceId: device.id,
          message: `${device.name}: sinkronisasi selesai, ${result.synced ?? 0} log baru tersimpan.${usersWithoutName ? ` ${usersWithoutName} user di mesin tidak memiliki nama.` : ''}`,
          context: syncContext,
        });
      } catch (error) {
        job.failed++;
        job.results.push({ device: { id: device.id, code: device.code, name: device.name }, ok: false, error: error?.message || 'Sinkronisasi gagal.' });
        await logActivity({
          level: 'error', eventType: 'sync_device_failed', source: job.source, jobId: job.id, deviceId: device.id,
          message: `${device.name}: ${error?.message || 'Sinkronisasi gagal.'}`,
        });
      } finally {
        job.completed++;
      }
    }
    job.status = job.failed ? (job.succeeded ? 'completed_with_errors' : 'failed') : 'completed';
    job.finishedAt = Date.now();
    if (state.activeJobId === job.id) state.activeJobId = null;
    emitRealtimeEvent('sync_job', { job: snapshot(job) });
    await logActivity({
      level: job.failed ? 'warning' : 'info', eventType: 'sync_completed', source: job.source, jobId: job.id,
      message: `Sinkronisasi selesai: ${job.succeeded}/${job.total} mesin berhasil, ${job.failed} gagal.`,
      context: { succeeded: job.succeeded, failed: job.failed, total: job.total, duration_ms: job.finishedAt - job.startedAt },
    });
    pruneJobs();
  })();

  return { job: snapshot(job), joined: false };
}

export function getSyncJob(jobId) {
  const job = state.jobs.get(jobId);
  return job ? snapshot(job) : null;
}
