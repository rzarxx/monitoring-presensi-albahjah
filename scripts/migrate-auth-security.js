const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env' });

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'absensi_db',
  });
  try {
    await connection.query(`CREATE TABLE IF NOT EXISTS login_attempt_limits (
      account_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      attempts INT UNSIGNED NOT NULL,
      window_start DATETIME NOT NULL,
      INDEX idx_login_attempt_window (window_start)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Migrasi proteksi login selesai.');
  } finally {
    await connection.end();
  }
}

migrate().catch(() => {
  console.error('Migrasi proteksi login gagal. Periksa akses database dan hak pembuatan tabel.');
  process.exitCode = 1;
});
