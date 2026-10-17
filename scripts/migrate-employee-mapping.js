// Memetakan UID tiap mesin ke Pejuang secara eksplisit (device_enrollments.employee_uid).
//
//   npm run migrate:mapping                        -> dry-run: tampilkan laporan, tidak mengubah apa pun
//   npm run migrate:mapping -- --apply             -> terapkan
//   npm run migrate:mapping -- --apply --trust-device=5
//        -> mesin id 5 dianggap sumber nomor Pejuang: UID dihubungkan berdasarkan nomor saja
//
// Aturan penghubungan otomatis: nomor UID mesin sama dengan nomor Pejuang DAN nama
// cocok. Nomor sama dengan nama berbeda tidak dihubungkan (kemungkinan orang lain),
// kecuali untuk LEGACY-01 (data lama satu mesin) dan mesin di --trust-device.
const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env' });

// Salinan lib/names.js (skrip ini berjalan di luar bundler Next.js).
const normalizeName = (value) => String(value || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
function sameName(a, b) {
  const left = normalizeName(a);
  const right = normalizeName(b);
  return Boolean(left && right && (left.includes(right) || right.includes(left)));
}

const apply = process.argv.includes('--apply');
const trustedIds = new Set(
  process.argv.filter((arg) => arg.startsWith('--trust-device=')).flatMap((arg) => arg.split('=')[1].split(',')).map(Number).filter(Boolean)
);

async function hasColumn(connection, table, column) {
  const [rows] = await connection.query(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'absensi_db',
  });

  try {
    console.log(apply ? '== MODE TERAPKAN ==' : '== DRY-RUN (tidak ada yang diubah; tambahkan --apply untuk menerapkan) ==');

    // ALTER TABLE tidak bisa di-rollback, jadi kolom hanya ditambahkan saat --apply.
    const hasLocked = await hasColumn(connection, 'device_enrollments', 'link_locked');
    if (!hasLocked && apply) {
      await connection.query(`ALTER TABLE device_enrollments ADD COLUMN link_locked TINYINT(1) NOT NULL DEFAULT 0 AFTER employee_uid`);
      console.log('Kolom device_enrollments.link_locked ditambahkan.');
    }
    const lockedColumn = hasLocked || apply ? 'de.link_locked' : '0';

    await connection.beginTransaction();

    const [created] = await connection.query(`
      INSERT IGNORE INTO device_enrollments (device_id, device_uid, display_name)
      SELECT DISTINCT device_id, uid, '' FROM attendance_logs
    `);
    console.log(`${created.affectedRows} baris pemetaan dibuat untuk UID yang hanya ada di log scan.`);

    const [devices] = await connection.query(`SELECT id, code, name FROM devices ORDER BY id`);
    const [rows] = await connection.query(`
      SELECT de.id, de.device_id, de.device_uid, de.display_name, e.name AS employee_name
      FROM device_enrollments de
      LEFT JOIN employees e ON e.uid = de.device_uid
      WHERE de.employee_uid IS NULL AND ${lockedColumn} = 0
      ORDER BY de.device_id, de.device_uid
    `);

    const toLink = [];
    for (const device of devices) {
      const trusted = device.code === 'LEGACY-01' || trustedIds.has(device.id);
      const deviceRows = rows.filter((row) => row.device_id === device.id);
      const report = { byName: 0, byNumber: [], conflicts: [], unnamed: 0, unregistered: 0 };
      for (const row of deviceRows) {
        if (!row.employee_name) report.unregistered++;
        else if (sameName(row.employee_name, row.display_name)) { report.byName++; toLink.push(row.id); }
        // Mesin dipercaya: nomor mesin = nomor Pejuang, beda ejaan nama diabaikan.
        else if (trusted) { report.byNumber.push(row); toLink.push(row.id); }
        else if (!row.display_name) report.unnamed++;
        else report.conflicts.push(row);
      }
      if (deviceRows.length === 0) continue;

      const showPairs = (list) => list.filter((row) => row.display_name).forEach((row) => {
        console.log(`    UID ${row.device_uid}: di mesin "${row.display_name}" vs Pejuang "${row.employee_name}"`);
      });
      console.log(`\n[${device.id}] ${device.name} (${device.code})${trusted ? ' - nomor dipercaya' : ''}`);
      console.log(`  dihubungkan (nomor + nama cocok)   : ${report.byName}`);
      if (trusted) {
        console.log(`  dihubungkan (nomor saja)           : ${report.byNumber.length}`);
        showPairs(report.byNumber);
      } else {
        console.log(`  BENTROK (nomor sama, nama berbeda) : ${report.conflicts.length}`);
        showPairs(report.conflicts);
        console.log(`  tanpa nama di mesin (perlu manual) : ${report.unnamed}`);
        if (report.conflicts.length || report.unnamed) {
          console.log(`  -> bila nomor UID mesin ini memang sama dengan nomor Pejuang, ulangi dengan --trust-device=${device.id}`);
        }
      }
      console.log(`  belum ada Pejuang dengan nomor ini : ${report.unregistered}`);
    }

    if (toLink.length) {
      await connection.query(`UPDATE device_enrollments SET employee_uid = device_uid WHERE id IN (?)`, [toLink]);
    }
    console.log(`\nTotal dihubungkan: ${toLink.length}. Yang bentrok/belum terhubung bisa diatur di halaman Pejuang.`);

    if (apply) {
      await connection.commit();
      console.log('Migrasi pemetaan selesai.');
    } else {
      await connection.rollback();
      console.log('Dry-run selesai; semua perubahan dibatalkan.');
    }
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    await connection.end();
  }
}

migrate().catch((error) => {
  console.error('Migrasi gagal:', error.message);
  process.exitCode = 1;
});
