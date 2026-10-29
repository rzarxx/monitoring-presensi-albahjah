import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { beginSync } from '@/app/api/sync/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function validSchedulerToken(request) {
  const expected = process.env.SYNC_CRON_TOKEN;
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function POST(request) {
  if (!validSchedulerToken(request)) {
    return NextResponse.json({ error: 'Token scheduler tidak valid.' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { job, joined } = await beginSync({ ...body, all: true, full: false }, { source: 'scheduler', requestedBy: 'server-cron' });
    return NextResponse.json({ message: joined ? 'Bergabung ke sinkronisasi terjadwal yang aktif.' : 'Sinkronisasi terjadwal dimulai.', job }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Sinkronisasi terjadwal gagal dimulai.' }, { status: error.status || 502 });
  }
}
