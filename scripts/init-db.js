const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env' });

async function resetDb() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'absensi_db',
  });

  console.log('Connected to MySQL...');

  // Matikan cek foreign key sementara agar bisa drop tabel
  await connection.query(`SET FOREIGN_KEY_CHECKS = 0`);
  
  // Hapus tabel lama
  await connection.query(`DROP TABLE IF EXISTS attendance_logs`);
  await connection.query(`DROP TABLE IF EXISTS leaves`);
  await connection.query(`DROP TABLE IF EXISTS employees`);
  await connection.query(`DROP TABLE IF EXISTS admins`);
  console.log('Old tables dropped.');

  await connection.query(`SET FOREIGN_KEY_CHECKS = 1`);

  // Buat tabel admins
  await connection.query(`
    CREATE TABLE admins (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(50) DEFAULT 'admin',
      department VARCHAR(255) DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('Table "admins" created.');

  // Buat tabel employees
  await connection.query(`
    CREATE TABLE employees (
      id INT AUTO_INCREMENT PRIMARY KEY,
      uid INT UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      department VARCHAR(255) DEFAULT ''
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('Table "employees" created.');

  // Buat tabel attendance_logs TANPA foreign key constraint
  // agar semua log dari mesin bisa masuk meski UID belum terdaftar
  await connection.query(`
    CREATE TABLE attendance_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      uid INT NOT NULL,
      timestamp DATETIME NOT NULL,
      state INT DEFAULT 0,
      INDEX idx_uid (uid),
      INDEX idx_timestamp (timestamp),
      INDEX idx_uid_timestamp (uid, timestamp)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('Table "attendance_logs" created (no FK constraint).');

  // Buat tabel leaves
  await connection.query(`
    CREATE TABLE leaves (
      id INT AUTO_INCREMENT PRIMARY KEY,
      uid INT NOT NULL,
      date DATE NOT NULL,
      type VARCHAR(50) NOT NULL,
      reason TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_uid_date (uid, date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('Table "leaves" created.');

  console.log('');
  console.log('✅ Database reset selesai! Silakan jalankan Sync dari dashboard.');
  
  await connection.end();
}

resetDb().catch(console.error);
