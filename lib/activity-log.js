import { query } from '@/lib/db';
import { emitRealtimeEvent } from '@/lib/events';

const MAX_MESSAGE_LENGTH = 1000;

/**
 * Audit operasional yang tahan restart proses. Kegagalan menulis audit tidak
 * boleh menggagalkan sinkronisasi presensi, tetapi tetap dilaporkan ke PM2.
 */
export async function logActivity({ level = 'info', eventType, source = 'system', message, deviceId = null, jobId = null, context = null }) {
  try {
    const result = await query(
      `INSERT INTO operational_logs (level, event_type, source, message, device_id, job_id, context_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        level,
        eventType,
        source,
        String(message || '').slice(0, MAX_MESSAGE_LENGTH),
        deviceId,
        jobId,
        context ? JSON.stringify(context) : null,
      ]
    );
    emitRealtimeEvent('operational_log', { id: result.insertId, level, event_type: eventType, source, device_id: deviceId, job_id: jobId });
  } catch (error) {
    console.warn('[OperationalLog] Tidak dapat menyimpan log:', error.message);
  }
}

export async function getLatestScheduledSyncAt() {
  try {
    const [row] = await query(
      `SELECT created_at FROM operational_logs WHERE event_type = 'sync_started' AND source = 'scheduler' ORDER BY id DESC LIMIT 1`
    );
    return row?.created_at ? new Date(row.created_at) : null;
  } catch (error) {
    console.warn('[OperationalLog] Tidak dapat membaca jadwal sync terakhir:', error.message);
    return null;
  }
}
