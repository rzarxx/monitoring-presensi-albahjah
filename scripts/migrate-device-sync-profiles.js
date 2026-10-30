const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env' });

async function hasColumn(connection, column) {
  const [rows] = await connection.query(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'devices' AND COLUMN_NAME = ?`,
    [column]
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
    if (!(await hasColumn(connection, 'sync_profile'))) {
      await connection.query(`ALTER TABLE devices ADD COLUMN sync_profile ENUM('auto', 'modern', 'legacy') NOT NULL DEFAULT 'auto' AFTER connection_driver`);
    }
    if (!(await hasColumn(connection, 'sync_lookback_hours'))) {
      await connection.query(`ALTER TABLE devices ADD COLUMN sync_lookback_hours SMALLINT UNSIGNED NOT NULL DEFAULT 72 AFTER sync_profile`);
    }
    if (!(await hasColumn(connection, 'firmware_note'))) {
      await connection.query(`ALTER TABLE devices ADD COLUMN firmware_note VARCHAR(255) NULL AFTER sync_lookback_hours`);
    }
    console.log('Migrasi profil sinkronisasi mesin selesai.');
  } finally {
    await connection.end();
  }
}

migrate().catch((error) => {
  console.error('Migrasi profil sinkronisasi gagal:', error.message);
  process.exitCode = 1;
});
