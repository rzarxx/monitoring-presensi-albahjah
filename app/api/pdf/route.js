import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';

export async function GET(request) {
  try {
    const user = await getUserSession(request);
    if (!user) {
      return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const date_from  = searchParams.get('date_from');
    const date_to    = searchParams.get('date_to');
    const search     = searchParams.get('search');
    const department = searchParams.get('department');

    const conditions = [];
    const params = [];
    if (date_from)  { conditions.push(`DATE(a.timestamp) >= ?`); params.push(date_from); }
    if (date_to)    { conditions.push(`DATE(a.timestamp) <= ?`); params.push(date_to); }
    if (search)     { conditions.push(`(e.name LIKE ? OR CAST(a.uid AS CHAR) = ?)`); params.push(`%${search}%`, search); }
    if (department) { conditions.push(`e.department LIKE ?`); params.push(`%${department}%`); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await query(`
      SELECT
        DATE(a.timestamp)        AS tgl,
        COALESCE(e.name, CONCAT('UID_', a.uid)) AS nama,
        COALESCE(e.department, '-')              AS dept,
        MIN(a.timestamp)         AS jam_masuk,
        MAX(a.timestamp)         AS jam_keluar,
        COUNT(a.id)              AS total_scan
      FROM attendance_logs a
      LEFT JOIN employees e ON a.uid = e.uid
      ${where}
      GROUP BY DATE(a.timestamp), a.uid
      ORDER BY DATE(a.timestamp) ASC, e.name ASC
    `, params);

    const pad = (n) => String(n).padStart(2, '0');
    const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    const DAYS   = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];

    const formatDate = (d) => {
      const dt = new Date(d);
      return `${DAYS[dt.getDay()]}, ${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
    };
    const formatTime = (d) => {
      if (!d) return '-';
      const dt = new Date(d);
      return `${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
    };

    const now = new Date();
    const printedAt   = `${formatDate(now)}, ${pad(now.getHours())}:${pad(now.getMinutes())} WIB`;
    const periodLabel = date_from && date_to
      ? `${date_from} s/d ${date_to}`
      : date_from ? `Mulai ${date_from}`
      : date_to   ? `Sampai ${date_to}`
      : 'Semua Periode';

    const totalHadir    = rows.filter(r => { const ci = new Date(r.jam_masuk), co = new Date(r.jam_keluar); return !isNaN(ci) && !isNaN(co) && ci.getTime() !== co.getTime() && (co - ci) >= 7*3600000; }).length;
    const totalMasukSaja= rows.filter(r => { const ci = new Date(r.jam_masuk), co = new Date(r.jam_keluar); return !isNaN(ci) && !isNaN(co) && ci.getTime() === co.getTime(); }).length;
    const totalKurang   = rows.filter(r => { const ci = new Date(r.jam_masuk), co = new Date(r.jam_keluar); return !isNaN(ci) && !isNaN(co) && ci.getTime() !== co.getTime() && (co - ci) < 7*3600000; }).length;

    const tableRows = rows.map((r, i) => {
      const checkIn  = r.jam_masuk  ? new Date(r.jam_masuk)  : null;
      const checkOut = r.jam_keluar ? new Date(r.jam_keluar) : null;
      const isSame   = checkIn && checkOut && checkIn.getTime() === checkOut.getTime();
      const durMs    = checkIn && checkOut && !isSame ? checkOut - checkIn : 0;
      const durHr    = Math.floor(durMs / 3600000);
      const durMin   = Math.floor((durMs % 3600000) / 60000);
      const durStr   = isSame || !checkIn ? '-' : `${durHr}j ${durMin}m`;
      const status   = isSame ? 'Masuk Saja' : durHr >= 7 ? 'Hadir Penuh' : durHr > 0 ? 'Kurang Jam' : '-';
      const sBg      = isSame ? '#fef9c3' : durHr >= 7 ? '#dcfce7' : durHr > 0 ? '#fee2e2' : '#f1f5f9';
      const sColor   = isSame ? '#854d0e' : durHr >= 7 ? '#166534' : durHr > 0 ? '#991b1b' : '#64748b';
      const rowBg    = i % 2 === 0 ? '#ffffff' : '#f8fdf9';

      return `
        <tr style="background:${rowBg};">
          <td class="td">${formatDate(r.tgl)}</td>
          <td class="td" style="font-weight:700;color:#0f172a;">${r.nama}</td>
          <td class="td" style="color:#64748b;">${r.dept}</td>
          <td class="td tc" style="font-weight:700;color:#059669;">${formatTime(r.jam_masuk)}</td>
          <td class="td tc">${isSame || !checkOut ? '<span style="color:#94a3b8;font-style:italic;font-size:10px;">Belum Absen</span>' : formatTime(r.jam_keluar)}</td>
          <td class="td tc" style="color:#475569;">${durStr}</td>
          <td class="td tc">
            <span style="background:${sBg};color:${sColor};padding:3px 8px;border-radius:4px;font-size:10px;font-weight:700;white-space:nowrap;">${status}</span>
          </td>
        </tr>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Laporan Kehadiran — Absensi-AB</title>

  <!-- Font Awesome 6 -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" crossorigin="anonymous"/>
  <!-- Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>

  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    @page {
      size: A4 landscape;
      margin: 14mm 12mm 14mm 12mm;
    }

    body {
      font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
      font-size: 12px;
      color: #1e293b;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ── Toolbar (hanya tampil di layar, hilang saat print) ── */
    .toolbar {
      position: fixed;
      top: 0; left: 0; right: 0;
      z-index: 100;
      background: #059669;
      padding: 10px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      box-shadow: 0 2px 12px rgba(5,150,105,0.3);
    }
    .toolbar-title {
      color: #fff;
      font-size: 14px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .toolbar-title i { opacity: 0.85; }
    .toolbar-hint {
      color: #d1fae5;
      font-size: 11px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .btn-print {
      background: #fff;
      color: #059669;
      border: none;
      padding: 9px 20px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.15s;
      box-shadow: 0 2px 8px rgba(0,0,0,0.12);
    }
    .btn-print:hover {
      background: #d1fae5;
      transform: translateY(-1px);
    }

    /* ── Konten utama (dorong ke bawah toolbar) ── */
    .page-content {
      padding-top: 56px; /* tinggi toolbar */
      padding-bottom: 20px;
    }

    /* ── Header dokumen ── */
    .doc-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 14px;
      border-bottom: 3px solid #059669;
      margin-bottom: 16px;
    }
    .doc-header-left { display: flex; align-items: flex-start; gap: 12px; }
    .doc-icon {
      width: 44px; height: 44px;
      background: linear-gradient(135deg, #059669, #10b981);
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-size: 20px;
      flex-shrink: 0;
    }
    .doc-title h1 {
      font-size: 18px; font-weight: 800;
      color: #059669; letter-spacing: -0.02em;
      line-height: 1.2;
    }
    .doc-title p {
      font-size: 10px; color: #64748b; margin-top: 3px;
      display: flex; align-items: center; gap: 5px;
    }
    .doc-meta {
      text-align: right;
      font-size: 10px;
      color: #64748b;
      line-height: 2;
    }
    .doc-meta strong { color: #0f172a; }

    /* ── Kartu info periode ── */
    .info-bar {
      display: flex;
      gap: 10px;
      margin-bottom: 14px;
      flex-wrap: wrap;
      align-items: center;
    }
    .info-chip {
      display: flex; align-items: center; gap: 6px;
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 6px;
      padding: 5px 12px;
      font-size: 11px;
      color: #065f46;
      font-weight: 500;
    }
    .info-chip i { color: #059669; font-size: 11px; }

    /* ── Summary cards ── */
    .summary-row {
      display: flex; gap: 10px; margin-bottom: 16px;
    }
    .summary-card {
      flex: 1;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 10px 14px;
      text-align: center;
      position: relative;
      overflow: hidden;
    }
    .summary-card::before {
      content: '';
      position: absolute; top: 0; left: 0; right: 0;
      height: 3px;
    }
    .summary-card.total::before  { background: #059669; }
    .summary-card.hadir::before  { background: #16a34a; }
    .summary-card.kurang::before { background: #ca8a04; }
    .summary-card.masuk::before  { background: #dc2626; }
    .summary-card .s-icon {
      font-size: 18px; margin-bottom: 4px;
    }
    .summary-card.total  .s-icon { color: #059669; }
    .summary-card.hadir  .s-icon { color: #16a34a; }
    .summary-card.kurang .s-icon { color: #ca8a04; }
    .summary-card.masuk  .s-icon { color: #dc2626; }
    .summary-card .s-val {
      font-size: 24px; font-weight: 800; color: #0f172a; line-height: 1;
    }
    .summary-card .s-lbl {
      font-size: 9px; color: #94a3b8; margin-top: 4px;
      text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;
    }

    /* ── Tabel ── */
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    col.c1 { width: 18%; }
    col.c2 { width: 20%; }
    col.c3 { width: 12%; }
    col.c4 { width: 11%; }
    col.c5 { width: 11%; }
    col.c6 { width: 10%; }
    col.c7 { width: 18%; }

    thead tr { background: #059669; }
    thead th {
      padding: 9px 10px;
      text-align: left;
      font-size: 9px;
      font-weight: 700;
      color: #fff;
      text-transform: uppercase;
      letter-spacing: 0.07em;
    }
    thead th.tc { text-align: center; }

    .td {
      padding: 8px 10px;
      border-bottom: 1px solid #e8f4ee;
      font-size: 11px;
      color: #334155;
      word-wrap: break-word;
    }
    .tc { text-align: center; }

    tbody tr { page-break-inside: avoid; }

    /* ── Footer ── */
    .doc-footer {
      margin-top: 16px;
      padding-top: 10px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 9px;
      color: #94a3b8;
    }
    .doc-footer i { color: #059669; margin-right: 4px; }

    /* ── Print rules ── */
    @media print {
      .toolbar    { display: none !important; }
      .page-content { padding-top: 0 !important; }
      body { font-size: 11px; }
    }
  </style>
</head>
<body>

  <!-- ── Toolbar Layar (hilang saat print) ── -->
  <div class="toolbar">
    <div class="toolbar-title">
      <i class="fa-solid fa-file-lines"></i>
      Pratinjau Laporan Kehadiran — Absensi-AB
    </div>
    <div class="toolbar-hint">
      <i class="fa-solid fa-circle-info"></i>
      Pastikan orientasi kertas diset ke <strong style="color:#fff;">Landscape</strong> sebelum mencetak
    </div>
    <button class="btn-print" onclick="window.print()">
      <i class="fa-solid fa-print"></i>
      Cetak / Simpan PDF
    </button>
  </div>

  <!-- ── Konten Dokumen ── -->
  <div class="page-content">

    <!-- Header -->
    <div class="doc-header">
      <div class="doc-header-left">
        <img src="/logo.png" alt="Absensi-AB" style="width:52px;height:52px;object-fit:contain;filter:drop-shadow(0 4px 8px rgba(5,150,105,0.25));flex-shrink:0;"/>
        <div class="doc-title">
          <h1>Laporan Kehadiran Karyawan</h1>
          <p>
            <i class="fa-solid fa-fingerprint"></i>
            Absensi-AB &mdash; Sistem Monitoring Kehadiran Biometrik
          </p>
        </div>
      </div>
      <div class="doc-meta">
        <div><i class="fa-regular fa-clock"></i> <strong>Dicetak:</strong> ${printedAt}</div>
        <div><i class="fa-regular fa-calendar"></i> <strong>Periode:</strong> ${periodLabel}</div>
        ${department ? `<div><i class="fa-solid fa-building"></i> <strong>Departemen:</strong> ${department}</div>` : ''}
        ${search ? `<div><i class="fa-solid fa-magnifying-glass"></i> <strong>Pencarian:</strong> ${search}</div>` : ''}
      </div>
    </div>

    <!-- Info Bar -->
    <div class="info-bar">
      <div class="info-chip">
        <i class="fa-solid fa-calendar-range"></i>
        Periode: <strong>${periodLabel}</strong>
      </div>
      ${department ? `<div class="info-chip"><i class="fa-solid fa-building"></i> Departemen: <strong>${department}</strong></div>` : ''}
      <div class="info-chip">
        <i class="fa-solid fa-user"></i>
        Dicetak oleh: <strong>${user.username}</strong>
      </div>
    </div>

    <!-- Summary Cards -->
    <div class="summary-row">
      <div class="summary-card total">
        <div class="s-icon"><i class="fa-solid fa-list-check"></i></div>
        <div class="s-val">${rows.length}</div>
        <div class="s-lbl">Total Rekaman</div>
      </div>
      <div class="summary-card hadir">
        <div class="s-icon"><i class="fa-solid fa-circle-check"></i></div>
        <div class="s-val">${totalHadir}</div>
        <div class="s-lbl">Hadir Penuh (&ge;7 Jam)</div>
      </div>
      <div class="summary-card kurang">
        <div class="s-icon"><i class="fa-solid fa-clock-rotate-left"></i></div>
        <div class="s-val">${totalKurang}</div>
        <div class="s-lbl">Kurang dari 7 Jam</div>
      </div>
      <div class="summary-card masuk">
        <div class="s-icon"><i class="fa-solid fa-right-to-bracket"></i></div>
        <div class="s-val">${totalMasukSaja}</div>
        <div class="s-lbl">Masuk Saja (Tanpa Keluar)</div>
      </div>
    </div>

    <!-- Tabel -->
    <table>
      <colgroup>
        <col class="c1"/><col class="c2"/><col class="c3"/>
        <col class="c4"/><col class="c5"/><col class="c6"/><col class="c7"/>
      </colgroup>
      <thead>
        <tr>
          <th><i class="fa-regular fa-calendar" style="margin-right:5px;"></i>Tanggal</th>
          <th><i class="fa-solid fa-user" style="margin-right:5px;"></i>Nama Karyawan</th>
          <th><i class="fa-solid fa-building" style="margin-right:5px;"></i>Departemen</th>
          <th class="tc"><i class="fa-solid fa-sign-in-alt" style="margin-right:4px;"></i>Masuk</th>
          <th class="tc"><i class="fa-solid fa-sign-out-alt" style="margin-right:4px;"></i>Keluar</th>
          <th class="tc"><i class="fa-regular fa-clock" style="margin-right:4px;"></i>Durasi</th>
          <th class="tc"><i class="fa-solid fa-chart-simple" style="margin-right:4px;"></i>Status</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows || `<tr><td colspan="7" style="text-align:center;padding:32px;color:#94a3b8;font-style:italic;"><i class="fa-solid fa-inbox" style="font-size:20px;display:block;margin-bottom:8px;opacity:0.4;"></i>Tidak ada data untuk periode ini.</td></tr>`}
      </tbody>
    </table>

    <!-- Footer -->
    <div class="doc-footer">
      <span><i class="fa-solid fa-shield-halved"></i> Dokumen ini dibuat secara otomatis oleh sistem Absensi-AB &copy; ${now.getFullYear()}. Bersifat rahasia.</span>
      <span><i class="fa-solid fa-table-list"></i> Total ${rows.length} rekaman kehadiran tercatat.</span>
    </div>

  </div>
</body>
</html>`;

    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });

  } catch (error) {
    console.error('[API/pdf]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
