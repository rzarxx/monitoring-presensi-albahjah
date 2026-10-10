import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';
import { requireDevice } from '@/lib/devices';

export async function GET(request) {
  try {
    const user = await getUserSession(request);
    if (!user) return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
    const searchParams = new URL(request.url).searchParams;
    const device = await requireDevice(searchParams);
    const uid = searchParams.get('uid');
    const dates = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      return date.toISOString().slice(0, 10);
    });
    const where = uid ? `WHERE a.device_id = ? AND a.uid = ? AND DATE(a.timestamp) >= ?` : `WHERE a.device_id = ? AND DATE(a.timestamp) >= ?`;
    const params = uid ? [device.id, uid, dates[0]] : [device.id, dates[0]];
    const rows = await query(`SELECT DATE(a.timestamp) AS date, ${uid ? 'COUNT(a.uid)' : 'COUNT(DISTINCT a.uid)'} AS hadir FROM attendance_logs a ${where} GROUP BY DATE(a.timestamp)`, params);
    return NextResponse.json({ data: dates.map((date) => ({ date, hadir: Number(rows.find((row) => String(row.date).slice(0, 10) === date)?.hadir || 0), izin: 0, sakit: 0, cuti: 0 })) });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Gagal memuat statistik.' }, { status: error.status || 500 });
  }
}
