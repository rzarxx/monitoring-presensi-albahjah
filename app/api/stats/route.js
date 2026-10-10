import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';

export async function GET(request) {
  try {
    const user = await getUserSession(request);
    if (!user) return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const uidParam = searchParams.get('uid');
    
    const departmentFilter = (user.role === 'manager' && user.department) ? user.department : null;
    
    // Generate last 7 days
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().split('T')[0]);
    }

    let attWhere = `WHERE DATE(a.timestamp) >= ?`;
    let attParams = [dates[6]];
    let leaveWhere = `WHERE l.date >= ?`;
    let leaveParams = [dates[6]];

    if (departmentFilter) {
      attWhere += ` AND e.department = ?`;
      attParams.push(departmentFilter);
      leaveWhere += ` AND e.department = ?`;
      leaveParams.push(departmentFilter);
    }
    
    if (uidParam) {
      attWhere += ` AND a.uid = ?`;
      attParams.push(uidParam);
      leaveWhere += ` AND l.uid = ?`;
      leaveParams.push(uidParam);
    }

    // Jika filter uid dipakai, kita hitung jumlah scan (COUNT(a.uid)). Jika global, hitung karyawan unik (COUNT(DISTINCT a.uid))
    const countQuery = uidParam ? 'COUNT(a.uid)' : 'COUNT(DISTINCT a.uid)';

    const attendanceCounts = await query(`
      SELECT DATE(a.timestamp) as date, ${countQuery} as count
      FROM attendance_logs a
      LEFT JOIN employees e ON a.uid = e.uid
      ${attWhere}
      GROUP BY DATE(a.timestamp)
    `, attParams);

    const leaveCounts = await query(`
      SELECT l.date, l.type, COUNT(DISTINCT l.uid) as count
      FROM leaves l
      LEFT JOIN employees e ON l.uid = e.uid
      ${leaveWhere}
      GROUP BY l.date, l.type
    `, leaveParams);

    // Merge data
    const chartData = dates.map(dateStr => {
      const att = attendanceCounts.find(a => a.date === dateStr || new Date(a.date).toISOString().split('T')[0] === dateStr);
      const lvIzin = leaveCounts.find(l => (l.date === dateStr || new Date(l.date).toISOString().split('T')[0] === dateStr) && l.type === 'Izin');
      const lvSakit = leaveCounts.find(l => (l.date === dateStr || new Date(l.date).toISOString().split('T')[0] === dateStr) && l.type === 'Sakit');
      const lvCuti = leaveCounts.find(l => (l.date === dateStr || new Date(l.date).toISOString().split('T')[0] === dateStr) && l.type === 'Cuti');

      return {
        date: dateStr,
        hadir: att ? parseInt(att.count, 10) : 0,
        izin: lvIzin ? parseInt(lvIzin.count, 10) : 0,
        sakit: lvSakit ? parseInt(lvSakit.count, 10) : 0,
        cuti: lvCuti ? parseInt(lvCuti.count, 10) : 0,
      };
    });

    return NextResponse.json({ data: chartData });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
