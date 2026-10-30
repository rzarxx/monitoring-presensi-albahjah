import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';
import { listDevices } from '@/lib/devices';
import { emitRealtimeEvent } from '@/lib/events';
import { refreshRealtimeDevices } from '@/lib/realtime-monitor';

const models = new Set(['X105', 'X103', 'OTHER']);
const syncProfiles = new Set(['auto', 'modern', 'legacy']);

export async function GET(request) {
  const user = await getUserSession(request);
  if (!user) return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
  try {
    return NextResponse.json({ data: await listDevices(user.role === 'superadmin') });
  } catch (error) {
    return NextResponse.json({ error: 'Skema multi-mesin belum dimigrasikan. Jalankan migrasi terlebih dahulu.' }, { status: 500 });
  }
}

export async function POST(request) {
  const user = await getUserSession(request);
  if (!user || user.role !== 'superadmin') return NextResponse.json({ error: 'Hanya Super Admin yang dapat menambah mesin.' }, { status: 403 });
  try {
    const body = await request.json();
    const name = String(body.name || '').trim();
    const host = String(body.host || '').trim();
    const port = Number.parseInt(body.port, 10);
    const model = models.has(body.model) ? body.model : 'OTHER';
    const syncProfile = syncProfiles.has(body.sync_profile) ? body.sync_profile : 'auto';
    const lookbackHours = Number.parseInt(body.sync_lookback_hours ?? 72, 10);
    const firmwareNote = String(body.firmware_note || '').trim().slice(0, 255) || null;
    const segmentId = body.segment_id ? Number.parseInt(body.segment_id, 10) : null;
    if (!name || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
      return NextResponse.json({ error: 'Nama lokasi fingerprint, IP/host, dan port wajib valid.' }, { status: 422 });
    }
    const code = `LOC-${randomUUID().toUpperCase()}`;
    if (!Number.isInteger(lookbackHours) || lookbackHours < 1 || lookbackHours > 720) {
      return NextResponse.json({ error: 'Jendela pemulihan harus antara 1 sampai 720 jam.' }, { status: 422 });
    }
    const result = await query(
      `INSERT INTO devices (segment_id, code, name, model, host, port, sync_profile, sync_lookback_hours, firmware_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [segmentId, code, name, model, host, port, syncProfile, lookbackHours, firmwareNote]
    );
    refreshRealtimeDevices().catch(() => {});
    emitRealtimeEvent('devices', { action: 'create', device_id: result.insertId });
    return NextResponse.json({ id: result.insertId, message: 'Mesin ditambahkan.' }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Gagal menambah mesin.' }, { status: 500 });
  }
}
