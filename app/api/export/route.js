import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUserSession } from '@/lib/auth';

export async function GET(request) {
  try {
    const user = await getUserSession(request);
    if (!user) {
      return NextResponse.json({ error: 'Akses ditolak. Silakan login terlebih dahulu.' }, { status: 401 });
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

    // Ambil semua data attendance dikelompokkan per karyawan per hari dengan DATE_FORMAT untuk hindari issue ONLY_FULL_GROUP_BY & timezone
    const rows = await query(`
      SELECT
        DATE_FORMAT(a.timestamp, '%Y-%m-%d') AS tgl,
        a.uid                    AS uid,
        COALESCE(MAX(e.name), CONCAT('UID_', a.uid)) AS nama,
        COALESCE(MAX(e.department), '-')              AS dept,
        DATE_FORMAT(MIN(a.timestamp), '%H:%i')  AS jam_masuk,
        DATE_FORMAT(MAX(a.timestamp), '%H:%i')  AS jam_keluar,
        TIMESTAMPDIFF(MINUTE, MIN(a.timestamp), MAX(a.timestamp)) AS dur_min,
        COUNT(a.id)              AS total_scan
      FROM attendance_logs a
      LEFT JOIN employees e ON a.uid = e.uid
      ${where}
      GROUP BY DATE_FORMAT(a.timestamp, '%Y-%m-%d'), a.uid
      ORDER BY nama ASC, tgl ASC
    `, params);

    const XLSX = (await import('xlsx')).default || await import('xlsx');

    // ─── Hitung daftar tanggal ─────────────────────────────────────
    const pad = n => String(n).padStart(2, '0');
    let allDates = [];

    if (date_from && date_to) {
      let cur = new Date(date_from + 'T00:00:00');
      const end = new Date(date_to + 'T00:00:00');
      while (cur <= end) {
        allDates.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`);
        cur.setDate(cur.getDate() + 1);
      }
    } else if (rows.length > 0) {
      const dateSet = new Set(rows.map(r => String(r.tgl).substring(0, 10)));
      allDates = Array.from(dateSet).sort();
    } else {
      const today = new Date();
      allDates.push(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`);
    }

    // Kelompokkan data per karyawan
    const employeeMap = {};
    for (const r of rows) {
      const name = r.nama;
      if (!employeeMap[name]) employeeMap[name] = { nama: r.nama, dept: r.dept, byDate: {} };
      const dateStr = String(r.tgl).substring(0, 10);
      const isSame   = (r.total_scan <= 1) || (r.jam_masuk === r.jam_keluar);
      const durMin   = r.dur_min || 0;
      employeeMap[name].byDate[dateStr] = {
        masuk : r.jam_masuk,
        keluar: isSame ? '' : r.jam_keluar,
        durMs : isSame ? 0 : (durMin * 60 * 1000),
      };
    }

    const employees = Object.values(employeeMap);

    // ─── Format bulan untuk judul ────────────────────────────────────
    const MONTHS_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    let periodLabel = 'Semua Periode';
    if (date_from && date_to) {
      const d1 = new Date(date_from + 'T00:00:00');
      const d2 = new Date(date_to + 'T00:00:00');
      if (d1.getMonth() === d2.getMonth() && d1.getFullYear() === d2.getFullYear()) {
        periodLabel = `${MONTHS_ID[d1.getMonth()]} ${d1.getFullYear()}`;
      } else {
        periodLabel = `${date_from} s/d ${date_to}`;
      }
    } else if (allDates.length > 0) {
      const d1 = new Date(allDates[0] + 'T00:00:00');
      periodLabel = `${MONTHS_ID[d1.getMonth()]} ${d1.getFullYear()}`;
    }

    const wb = XLSX.utils.book_new();

    // ─── Warna ──────────────────────────────────────────────────────
    const CLR_HEADER_BG  = '1A6E46'; // hijau tua
    const CLR_DATE_BG    = '2D9E66'; // hijau medium
    const CLR_SUBHDR_BG  = 'E8F5EE'; // hijau muda
    const CLR_TITLE_FG   = '1A6E46';
    const CLR_WHITE      = 'FFFFFF';
    const CLR_BORDER     = 'BDDCCA';
    const CLR_ROW_ALT    = 'F0FAF4';
    const CLR_SUMMARY_BG = 'D4EDDA';

    // ─── Bangun worksheet ────────────────────────────────────────────
    const ws = {};
    const merges = [];
    let R = 0; // baris saat ini (0-indexed)

    const set = (r, c, v, s) => {
      const addr = XLSX.utils.encode_cell({ r, c });
      ws[addr] = { v, t: typeof v === 'number' ? 'n' : 's', s: s || {} };
    };

    const boldWhiteCenter = (bg) => ({
      font: { bold: true, color: { rgb: CLR_WHITE }, sz: 11, name: 'Calibri' },
      fill: { patternType: 'solid', fgColor: { rgb: bg } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: { top: { style: 'thin', color: { rgb: CLR_BORDER } }, bottom: { style: 'thin', color: { rgb: CLR_BORDER } }, left: { style: 'thin', color: { rgb: CLR_BORDER } }, right: { style: 'thin', color: { rgb: CLR_BORDER } } },
    });
    const normalCell = (bg, bold) => ({
      font: { bold: !!bold, sz: 10, name: 'Calibri', color: { rgb: '1a1a1a' } },
      fill: { patternType: 'solid', fgColor: { rgb: bg || CLR_WHITE } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: { top: { style: 'thin', color: { rgb: CLR_BORDER } }, bottom: { style: 'thin', color: { rgb: CLR_BORDER } }, left: { style: 'thin', color: { rgb: CLR_BORDER } }, right: { style: 'thin', color: { rgb: CLR_BORDER } } },
    });
    const leftCell = (bg, bold) => ({
      font: { bold: !!bold, sz: 10, name: 'Calibri', color: { rgb: '1a1a1a' } },
      fill: { patternType: 'solid', fgColor: { rgb: bg || CLR_WHITE } },
      alignment: { horizontal: 'left', vertical: 'center' },
      border: { top: { style: 'thin', color: { rgb: CLR_BORDER } }, bottom: { style: 'thin', color: { rgb: CLR_BORDER } }, left: { style: 'thin', color: { rgb: CLR_BORDER } }, right: { style: 'thin', color: { rgb: CLR_BORDER } } },
    });

    const FIXED_COLS = 3; // No, Nama, Dept
    const SUMMARY_COLS = 3; // Total Jam, Total Masuk, Total Keluar
    const totalCols = FIXED_COLS + (allDates.length * 2) + SUMMARY_COLS;

    // ── Baris 1: Judul ──────────────────────────────────────────────
    set(R, 0, `Presensi Yayasan - ${periodLabel}`, {
      font: { bold: true, sz: 14, name: 'Calibri', color: { rgb: CLR_TITLE_FG } },
      fill: { patternType: 'solid', fgColor: { rgb: 'E8F5EE' } },
      alignment: { horizontal: 'left', vertical: 'center' },
    });
    merges.push({ s: { r: R, c: 0 }, e: { r: R, c: totalCols - 1 } });
    R++;

    // ── Baris 2: Info cetak ─────────────────────────────────────────
    const now = new Date();
    set(R, 0, `Dicetak: ${now.getDate()}/${now.getMonth()+1}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())} WIB  |  Oleh: ${user.username}${department ? '  |  Departemen: '+department : ''}`, {
      font: { italic: true, sz: 9, name: 'Calibri', color: { rgb: '555555' } },
      alignment: { horizontal: 'left', vertical: 'center' },
    });
    merges.push({ s: { r: R, c: 0 }, e: { r: R, c: totalCols - 1 } });
    R++;

    // ── Baris 3: Header - No, Nama, Dept | Tanggal-tanggal | Summary ─
    set(R, 0, 'No',         boldWhiteCenter(CLR_HEADER_BG));
    set(R, 1, 'Nama',       boldWhiteCenter(CLR_HEADER_BG));
    set(R, 2, 'Departemen', boldWhiteCenter(CLR_HEADER_BG));
    merges.push({ s: { r: R, c: 0 }, e: { r: R+1, c: 0 } });
    merges.push({ s: { r: R, c: 1 }, e: { r: R+1, c: 1 } });
    merges.push({ s: { r: R, c: 2 }, e: { r: R+1, c: 2 } });

    // Tanggal headers (2 kolom per hari)
    const DAYS_ID = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
    allDates.forEach((d, i) => {
      const dt = new Date(d + 'T00:00:00');
      const dayName = DAYS_ID[dt.getDay()];
      const dateLabel = `${dayName}, ${dt.getDate()}/${dt.getMonth()+1}`;
      const c = FIXED_COLS + i * 2;
      const isSunday = dt.getDay() === 0;
      const dateBg = isSunday ? 'C0392B' : CLR_DATE_BG;
      set(R, c, dateLabel, boldWhiteCenter(dateBg));
      merges.push({ s: { r: R, c }, e: { r: R, c: c+1 } });
    });

    // Summary headers
    const sumStart = FIXED_COLS + allDates.length * 2;
    set(R, sumStart,   'Total Jam Kerja', boldWhiteCenter(CLR_HEADER_BG));
    set(R, sumStart+1, 'Total Cek-in',    boldWhiteCenter(CLR_HEADER_BG));
    set(R, sumStart+2, 'Total Cek-out',   boldWhiteCenter(CLR_HEADER_BG));
    merges.push({ s: { r: R, c: sumStart   }, e: { r: R+1, c: sumStart   } });
    merges.push({ s: { r: R, c: sumStart+1 }, e: { r: R+1, c: sumStart+1 } });
    merges.push({ s: { r: R, c: sumStart+2 }, e: { r: R+1, c: sumStart+2 } });
    R++;

    // ── Baris 4: Sub-header Cek-in / Cek-out per hari ───────────────
    set(R, 0, '', {}); set(R, 1, '', {}); set(R, 2, '', {});
    allDates.forEach((d, i) => {
      const dt = new Date(d + 'T00:00:00');
      const isSunday = dt.getDay() === 0;
      const subBg = isSunday ? 'F1948A' : CLR_SUBHDR_BG;
      const c = FIXED_COLS + i * 2;
      set(R, c,   'Cek-in',  { font: { bold: true, sz: 9, name: 'Calibri', color: { rgb: isSunday ? 'FFFFFF' : '1A6E46' } }, fill: { patternType: 'solid', fgColor: { rgb: subBg } }, alignment: { horizontal: 'center', vertical: 'center' }, border: { top: { style: 'thin', color: { rgb: CLR_BORDER } }, bottom: { style: 'thin', color: { rgb: CLR_BORDER } }, left: { style: 'thin', color: { rgb: CLR_BORDER } }, right: { style: 'thin', color: { rgb: CLR_BORDER } } } });
      set(R, c+1, 'Cek-out', { font: { bold: true, sz: 9, name: 'Calibri', color: { rgb: isSunday ? 'FFFFFF' : '1A6E46' } }, fill: { patternType: 'solid', fgColor: { rgb: subBg } }, alignment: { horizontal: 'center', vertical: 'center' }, border: { top: { style: 'thin', color: { rgb: CLR_BORDER } }, bottom: { style: 'thin', color: { rgb: CLR_BORDER } }, left: { style: 'thin', color: { rgb: CLR_BORDER } }, right: { style: 'thin', color: { rgb: CLR_BORDER } } } });
    });
    R++;

    // ── Baris data per karyawan ──────────────────────────────────────
    employees.forEach((emp, idx) => {
      const rowBg = idx % 2 === 0 ? CLR_WHITE : CLR_ROW_ALT;
      let totalMasuk = 0, totalKeluar = 0, totalDurMs = 0;

      set(R, 0, idx + 1,    normalCell(rowBg));
      set(R, 1, emp.nama,   leftCell(rowBg, true));
      set(R, 2, emp.dept,   leftCell(rowBg));

      allDates.forEach((d, i) => {
        const c = FIXED_COLS + i * 2;
        const entry = emp.byDate[d];
        if (entry) {
          if (entry.masuk) totalMasuk++;
          if (entry.keluar) totalKeluar++;
          totalDurMs += (entry.durMs || 0);
          set(R, c,   entry.masuk || '-',  { font: { sz: 9, name: 'Calibri', color: { rgb: '0B5E30' } }, fill: { patternType: 'solid', fgColor: { rgb: rowBg } }, alignment: { horizontal: 'center', vertical: 'center' }, border: { top: { style: 'thin', color: { rgb: CLR_BORDER } }, bottom: { style: 'thin', color: { rgb: CLR_BORDER } }, left: { style: 'thin', color: { rgb: CLR_BORDER } }, right: { style: 'thin', color: { rgb: CLR_BORDER } } } });
          set(R, c+1, entry.keluar || '-', { font: { sz: 9, name: 'Calibri', color: { rgb: entry.keluar ? '333333' : 'CC0000' } }, fill: { patternType: 'solid', fgColor: { rgb: rowBg } }, alignment: { horizontal: 'center', vertical: 'center' }, border: { top: { style: 'thin', color: { rgb: CLR_BORDER } }, bottom: { style: 'thin', color: { rgb: CLR_BORDER } }, left: { style: 'thin', color: { rgb: CLR_BORDER } }, right: { style: 'thin', color: { rgb: CLR_BORDER } } } });
        } else {
          set(R, c,   '', normalCell(rowBg));
          set(R, c+1, '', normalCell(rowBg));
        }
      });

      // Summary
      const totalHr  = Math.floor(totalDurMs / 3600000);
      const totalMin = Math.floor((totalDurMs % 3600000) / 60000);
      const totalJam = totalDurMs > 0 ? `${totalHr}j ${totalMin}m` : '-';
      set(R, sumStart,   totalJam,    normalCell(CLR_SUMMARY_BG, true));
      set(R, sumStart+1, totalMasuk,  normalCell(CLR_SUMMARY_BG, true));
      set(R, sumStart+2, totalKeluar, normalCell(CLR_SUMMARY_BG, true));

      R++;
    });

    // ── Baris total keseluruhan ───────────────────────────────────────
    set(R, 0, '', {}); set(R, 1, '', {});
    set(R, 2, 'TOTAL HADIR', boldWhiteCenter(CLR_HEADER_BG));

    allDates.forEach((d, i) => {
      const c = FIXED_COLS + i * 2;
      const hadirCount = employees.filter(emp => !!emp.byDate[d] && !!emp.byDate[d].masuk).length;
      set(R, c,   hadirCount > 0 ? hadirCount : '', normalCell('FFF3CD', true));
      set(R, c+1, '', normalCell(CLR_WHITE));
    });

    R++;

    // ── Ref range ─────────────────────────────────────────────────────
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: R - 1, c: totalCols - 1 } });
    ws['!merges'] = merges;

    // ── Lebar kolom ─────────────────────────────────────────────────
    const colWidths = [
      { wch: 4 },  // No
      { wch: 22 }, // Nama
      { wch: 14 }, // Dept
    ];
    for (let i = 0; i < allDates.length * 2; i++) {
      colWidths.push({ wch: 7 }); // Cek-in/out
    }
    colWidths.push({ wch: 14 }); // Total Jam
    colWidths.push({ wch: 11 }); // Total Masuk
    colWidths.push({ wch: 11 }); // Total Keluar
    ws['!cols'] = colWidths;

    // Tinggi baris
    ws['!rows'] = [
      { hpt: 22 }, // judul
      { hpt: 14 }, // info
      { hpt: 28 }, // header
      { hpt: 16 }, // sub-header
    ];

    const sheetName = `Presensi ${periodLabel}`.substring(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    const labelFrom = date_from || 'awal';
    const labelTo   = date_to   || 'akhir';
    const fileName  = `Presensi_Yayasan_${labelFrom}_sd_${labelTo}.xlsx`;

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    return new Response(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error('[API/export]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
