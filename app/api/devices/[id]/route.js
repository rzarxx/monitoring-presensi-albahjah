import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';
import { parseDeviceId } from '@/lib/devices';

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
    if (!name || !host || !Number.isInteger(port) || port < 1 || port > 65535) return NextResponse.json({ error: 'Data mesin tidak valid.' }, { status: 422 });
    await query(`UPDATE devices SET segment_id = ?, name = ?, host = ?, port = ?, is_active = ? WHERE id = ?`, [segmentId, name, host, port, isActive, deviceId]);
    return NextResponse.json({ message: 'Mesin diperbarui.' });
  } catch {
    return NextResponse.json({ error: 'Gagal memperbarui mesin.' }, { status: 500 });
  }
}
