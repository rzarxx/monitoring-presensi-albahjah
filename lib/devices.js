import { query } from '@/lib/db';

export function parseDeviceId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function listDevices(includeConnection = false) {
  const connectionFields = includeConnection ? ', d.host, d.port, d.connection_driver, d.sync_profile, d.sync_lookback_hours, d.firmware_note' : '';
  return query(`
    SELECT d.id, d.code, d.name, d.model, d.segment_id, d.is_active,
           s.code AS segment_code, s.name AS segment_name${connectionFields}
    FROM devices d
    LEFT JOIN segments s ON s.id = d.segment_id
    WHERE d.is_active = 1
    ORDER BY d.code = 'LEGACY-01' ASC, s.name ASC, d.name ASC
  `);
}

export async function findDevice(deviceId) {
  const rows = await query(`
    SELECT d.*, s.code AS segment_code, s.name AS segment_name
    FROM devices d
    LEFT JOIN segments s ON s.id = d.segment_id
    WHERE d.id = ? AND d.is_active = 1
    LIMIT 1
  `, [deviceId]);
  return rows[0] || null;
}

export async function requireDevice(searchParams) {
  const deviceId = parseDeviceId(searchParams.get('device_id'));
  if (!deviceId) {
    const error = new Error('Pilih mesin terlebih dahulu.');
    error.status = 400;
    throw error;
  }

  const device = await findDevice(deviceId);
  if (!device) {
    const error = new Error('Mesin tidak ditemukan atau tidak aktif.');
    error.status = 404;
    throw error;
  }

  return device;
}
