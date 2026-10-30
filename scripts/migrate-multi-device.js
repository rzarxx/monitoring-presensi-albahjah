const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env' });

async function hasColumn(connection, table, column) {
  const [rows] = await connection.query(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function hasIndex(connection, table, index) {
  const [rows] = await connection.query(
    `SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, index]
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
    await connection.query(`CREATE TABLE IF NOT EXISTS segments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(120) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await connection.query(`CREATE TABLE IF NOT EXISTS devices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      segment_id INT NULL,
      code VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(120) NOT NULL,
      model ENUM('X105', 'X103', 'OTHER') NOT NULL DEFAULT 'OTHER',
      connection_driver ENUM('zkem_tcp') NOT NULL DEFAULT 'zkem_tcp',
      sync_profile ENUM('auto', 'modern', 'legacy') NOT NULL DEFAULT 'auto',
      sync_lookback_hours SMALLINT UNSIGNED NOT NULL DEFAULT 72,
      firmware_note VARCHAR(255) NULL,
      host VARCHAR(255) NOT NULL,
      port SMALLINT UNSIGNED NOT NULL DEFAULT 4370,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_devices_segment FOREIGN KEY (segment_id) REFERENCES segments(id) ON DELETE SET NULL,
      INDEX idx_devices_segment (segment_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await connection.query(`CREATE TABLE IF NOT EXISTS device_enrollments (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      device_id INT NOT NULL,
      employee_uid INT NULL,
      device_uid INT NOT NULL,
      display_name VARCHAR(255) NOT NULL DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_enrollments_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
      UNIQUE KEY unique_device_uid (device_id, device_uid),
      INDEX idx_enrollments_employee_uid (employee_uid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await connection.query(`INSERT INTO segments (code, name) VALUES ('LEGACY', 'Data Sebelum Multi-Mesin') ON DUPLICATE KEY UPDATE name = VALUES(name)`);
    const [[legacySegment]] = await connection.query(`SELECT id FROM segments WHERE code = 'LEGACY' LIMIT 1`);
    await connection.query(
      `INSERT INTO devices (segment_id, code, name, model, host, port)
       VALUES (?, 'LEGACY-01', 'Data Presensi Lama', 'OTHER', '0.0.0.0', 0)
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [legacySegment.id]
    );
    const [[legacyDevice]] = await connection.query(`SELECT id FROM devices WHERE code = 'LEGACY-01' LIMIT 1`);

    if (!(await hasColumn(connection, 'attendance_logs', 'device_id'))) {
      await connection.query(`ALTER TABLE attendance_logs ADD COLUMN device_id INT NULL AFTER id`);
    }
    await connection.query(`UPDATE attendance_logs SET device_id = ? WHERE device_id IS NULL`, [legacyDevice.id]);

    if (!(await hasColumn(connection, 'leaves', 'device_id'))) {
      await connection.query(`ALTER TABLE leaves ADD COLUMN device_id INT NULL AFTER id`);
    }
    await connection.query(`UPDATE leaves SET device_id = ? WHERE device_id IS NULL`, [legacyDevice.id]);

    if (await hasIndex(connection, 'attendance_logs', 'unique_scan')) {
      await connection.query(`ALTER TABLE attendance_logs DROP INDEX unique_scan`);
    }
    if (!(await hasIndex(connection, 'attendance_logs', 'unique_device_scan'))) {
      await connection.query(`ALTER TABLE attendance_logs ADD UNIQUE KEY unique_device_scan (device_id, uid, timestamp)`);
    }
    if (!(await hasIndex(connection, 'attendance_logs', 'idx_device_timestamp'))) {
      await connection.query(`ALTER TABLE attendance_logs ADD INDEX idx_device_timestamp (device_id, timestamp)`);
    }
    if (!(await hasIndex(connection, 'leaves', 'idx_leaves_device_date'))) {
      await connection.query(`ALTER TABLE leaves ADD INDEX idx_leaves_device_date (device_id, date)`);
    }

    await connection.query(`ALTER TABLE attendance_logs MODIFY device_id INT NOT NULL`);
    await connection.query(`ALTER TABLE leaves MODIFY device_id INT NOT NULL`);
    console.log('Migrasi multi-mesin selesai. Log lama dipetakan ke LEGACY-01.');
  } catch (error) {
    throw error;
  } finally {
    await connection.end();
  }
}

migrate().catch((error) => {
  console.error('Migrasi gagal:', error.message);
  process.exitCode = 1;
});
