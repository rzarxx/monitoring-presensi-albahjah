import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';
import { parseDeviceId } from '@/lib/devices';
import { emitRealtimeEvent } from '@/lib/events';
import { refreshRealtimeDevices } from '@/lib/realtime-monitor';

const models = new Set(['X105', 'X103', 'OTHER']);

export async function PUT(request, context) {
  const user = await getUserSession(request);
  if (!user || user.role !== 'superadmin') return NextResponse.json({ error: 'Hanya Super Admin yang dapat mengubah mesin.' }, { status: 403 });
  const { id } = await context.params;
  const deviceId = parseDeviceId(id);
  if (!deviceId) return NextResponse.json({ error: 'ID mesin tidak valid.' }, { status: 400 });
  try {
    const body = await request.json();
    const name = String(body.name || '').trim();
    const host = String(body.host || '').trim();
    const port = Number.parseInt(body.port, 10);
    const segmentId = body.segment_id ? Number.parseInt(body.segment_id, 10) : null;
    const isActive = body.is_active === false ? 0 : 1;
    const model = models.has(body.model) ? body.model : 'OTHER';
    if (!name || !host || !Number.isInteger(port) || port < 1 || port > 65535) return NextResponse.json({ error: 'Data mesin tidak valid.' }, { status: 422 });
    const result = await query(`UPDATE devices SET segment_id = ?, name = ?, model = ?, host = ?, port = ?, is_active = ? WHERE id = ?`, [segmentId, name, model, host, port, isActive, deviceId]);
    if (result.affectedRows === 0) return NextResponse.json({ error: 'Mesin tidak ditemukan.' }, { status: 404 });
    refreshRealtimeDevices().catch(() => {});
    emitRealtimeEvent('devices', { action: 'update', device_id: deviceId });
    return NextResponse.json({ message: 'Mesin diperbarui.' });
  } catch {
    return NextResponse.json({ error: 'Gagal memperbarui mesin.' }, { status: 500 });
  }
}

export async function DELETE(request, context) {
  const user = await getUserSession(request);
  if (!user || user.role !== 'superadmin') return NextResponse.json({ error: 'Hanya Super Admin yang dapat menonaktifkan mesin.' }, { status: 403 });
  const { id } = await context.params;
  const deviceId = parseDeviceId(id);
  if (!deviceId) return NextResponse.json({ error: 'ID mesin tidak valid.' }, { status: 400 });
  try {
    const result = await query(`UPDATE devices SET is_active = 0 WHERE id = ? AND is_active = 1`, [deviceId]);
    if (result.affectedRows === 0) return NextResponse.json({ error: 'Mesin tidak ditemukan atau sudah nonaktif.' }, { status: 404 });
    refreshRealtimeDevices().catch(() => {});
    emitRealtimeEvent('devices', { action: 'delete', device_id: deviceId });
    return NextResponse.json({ message: 'Mesin dinonaktifkan. Riwayat presensi tetap tersimpan.' });
  } catch {
    return NextResponse.json({ error: 'Gagal menonaktifkan mesin.' }, { status: 500 });
  }
}
