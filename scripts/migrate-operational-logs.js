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
    await connection.query(`CREATE TABLE IF NOT EXISTS operational_logs (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      level ENUM('info', 'warning', 'error') NOT NULL DEFAULT 'info',
      event_type VARCHAR(80) NOT NULL,
      source VARCHAR(40) NOT NULL DEFAULT 'system',
      message VARCHAR(1000) NOT NULL,
      device_id INT NULL,
      job_id CHAR(36) NULL,
      context_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_operational_logs_created_at (created_at),
      INDEX idx_operational_logs_level_created_at (level, created_at),
      INDEX idx_operational_logs_job_id (job_id),
      CONSTRAINT fk_operational_logs_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Migrasi log operasional selesai.');
  } finally {
    await connection.end();
  }
}

migrate().catch((error) => {
  console.error('Migrasi log operasional gagal:', error.message);
  process.exitCode = 1;
});
