import { NextResponse } from 'next/server';
import pool, { query } from '@/lib/db';
import { getZkData } from '@/lib/zkteco';
import { getUserSession } from '@/lib/auth';

export async function POST(request) {
  try {
    // Hanya user yang sudah login yang bisa memicu sinkronisasi
    const user = await getUserSession(request);
    if (!user) {
      return NextResponse.json({ error: 'Akses ditolak. Silakan login terlebih dahulu.' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const fullSync = body?.full === true;

    const { users, logs } = await getZkData();

    if (!logs || logs.length === 0) {
      return NextResponse.json({ message: 'No attendance data from machine', synced: 0 });
    }

    // ── STEP 1: Tambah unique constraint bila belum ada ──────────────────────
    try {
      await query(`ALTER TABLE attendance_logs ADD UNIQUE KEY unique_scan (uid, timestamp)`);
    } catch (e) { /* Sudah ada — abaikan */ }

    // ── STEP 2: Sinkronisasi karyawan dari mesin ────────────────────────────
    if (users && users.length > 0) {
      for (const user of users) {
        const uid = parseInt(user.userId, 10);
        let name = (user.name || '').trim();
        const department = (user.department || '').trim(); // Try to get department if available

        // Abaikan user yang berawalan UID_ (sesuai request: jangan diambil karena data lama)
        if (name.startsWith('UID_')) continue;
        
        if (!name) name = `User_${uid}`;
        if (!uid || isNaN(uid)) continue;
        
        await query(
          `INSERT INTO employees (uid, name, department) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name), department = IF(VALUES(department) != '', VALUES(department), department)`,
          [uid, name, department]
        );
      }
    }

    // ── STEP 3: Filter log ──────────────────────────────────────────────────
    let newLogs = logs;
    if (!fullSync) {
      const rows = await query(`SELECT MAX(timestamp) as last_time FROM attendance_logs`);
      const lastTime = rows[0].last_time;
      if (lastTime) {
        const lastTimeMs = new Date(lastTime).getTime();
        newLogs = logs.filter(log => new Date(log.recordTime).getTime() > lastTimeMs);
      }
    }

    if (newLogs.length === 0) {
      return NextResponse.json({ message: 'Already up to date', synced: 0, users_synced: users?.length || 0 });
    }

    // ── STEP 4: Pastikan semua UID ada di employees ─────────────────────────
    const allUids = [...new Set(newLogs.map(l => parseInt(l.deviceUserId, 10)).filter(u => !isNaN(u)))];
    for (const uid of allUids) {
      await query(
        `INSERT IGNORE INTO employees (uid, name, department) VALUES (?, ?, '')`,
        [uid, `UID_${uid}`]
      );
    }

    // ── STEP 5: Bulk insert (INSERT IGNORE skip duplikat) ───────────────────
    const values = newLogs.map(log => {
      const uid = parseInt(log.deviceUserId, 10);
      if (isNaN(uid)) return null;
      const dt = new Date(log.recordTime);
      const pad = (n) => String(n).padStart(2, '0');
      const sqlTime = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
      return [uid, sqlTime, log.state || 0];
    }).filter(Boolean);

    const chunkSize = 5000;
    let totalInserted = 0;
    for (let i = 0; i < values.length; i += chunkSize) {
      const chunk = values.slice(i, i + chunkSize);
      const result = await query(`INSERT IGNORE INTO attendance_logs (uid, timestamp, state) VALUES ?`, [chunk]);
      totalInserted += result.affectedRows || 0;
    }

    return NextResponse.json({
      message: 'Sync berhasil',
      synced: totalInserted,
      users_synced: users?.length || 0,
    });

  } catch (error) {
    console.error('Sync Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
