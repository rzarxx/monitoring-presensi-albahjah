const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env', quiet: true });

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'absensi_db',
  });
  try {
    for (const [name, definition] of [['manual_check_in', 'TIME NULL'], ['manual_check_out', 'TIME NULL'], ['manual_by', 'VARCHAR(255) NULL']]) {
      const [rows] = await connection.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', ['leaves', name]);
      if (!rows.length) await connection.query(`ALTER TABLE leaves ADD COLUMN \`${name}\` ${definition}`);
    }
    console.log('Migrasi hadir manual selesai.');
  } finally { await connection.end(); }
}

migrate().catch(() => {
  console.error('Migrasi hadir manual gagal. Periksa tabel leaves dan hak ALTER database.');
  process.exitCode = 1;
});
