import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';
import { listDevices } from '@/lib/devices';

const models = new Set(['X105', 'X103', 'OTHER']);

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
    const segmentId = body.segment_id ? Number.parseInt(body.segment_id, 10) : null;
    if (!name || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
      return NextResponse.json({ error: 'Nama lokasi fingerprint, IP/host, dan port wajib valid.' }, { status: 422 });
    }
    // Kode dipakai sistem sebagai ID internal dan tidak perlu diisi operator.
    const code = `LOC-${randomUUID().toUpperCase()}`;
    const result = await query(
      `INSERT INTO devices (segment_id, code, name, model, host, port) VALUES (?, ?, ?, ?, ?, ?)`,
      [segmentId, code, name, model, host, port]
    );
    return NextResponse.json({ id: result.insertId, message: 'Mesin ditambahkan.' }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Gagal menambah mesin.' }, { status: 500 });
  }
}
