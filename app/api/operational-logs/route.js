import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const user = await getUserSession(request);
  if (!user || user.role !== 'superadmin') {
    return NextResponse.json({ error: 'Hanya Super Admin yang dapat melihat log operasional.' }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const requestedLimit = Number.parseInt(params.get('limit') || '100', 10);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 200) : 100;
  const level = params.get('level');
  const source = params.get('source');
  const conditions = [];
  const values = [];
  if (['info', 'warning', 'error'].includes(level)) {
    conditions.push('l.level = ?');
    values.push(level);
  }
  if (['manual', 'scheduler', 'system'].includes(source)) {
    conditions.push('l.source = ?');
    values.push(source);
  }
  values.push(limit);

  try {
    const logs = await query(
      `SELECT l.id, l.level, l.event_type, l.source, l.message, l.device_id, l.job_id, l.context_json, l.created_at,
              d.name AS device_name, d.code AS device_code
       FROM operational_logs l
       LEFT JOIN devices d ON d.id = l.device_id
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY l.id DESC LIMIT ?`,
      values
    );
    return NextResponse.json({ data: logs });
  } catch (error) {
    return NextResponse.json({ error: 'Log operasional belum siap. Jalankan npm run migrate:operations terlebih dahulu.' }, { status: 503 });
  }
}
