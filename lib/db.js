import mysql from 'mysql2/promise';

// Gunakan global untuk mencegah multiple pools saat Next.js hot-reload
let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host:             process.env.DB_HOST      || '127.0.0.1',
      port:     parseInt(process.env.DB_PORT     || '3306', 10),
      user:             process.env.DB_USER      || 'root',
      password:         process.env.DB_PASSWORD  || '',
      database:         process.env.DB_NAME      || 'absensi_db',
      waitForConnections: true,
      connectionLimit:    10,
      queueLimit:         0,
      enableKeepAlive:    true,
      keepAliveInitialDelay: 10000,
      connectTimeout:     20000,
      // Batas waktu idle sebelum koneksi dilepas (ms) — 60 detik
      idleTimeout:        60000,
    });
    console.log('[DB] Pool created');
  }
  return pool;
}

// Helper query yang otomatis retry 1x jika koneksi mati
export async function query(sql, params) {
  try {
    const [rows] = await getPool().query(sql, params);
    return rows;
  } catch (err) {
    // Jika koneksi terputus, reset pool dan coba sekali lagi
    if (err.code === 'ECONNREFUSED' || err.code === 'PROTOCOL_CONNECTION_LOST' || err.fatal) {
      console.warn('[DB] Connection lost, resetting pool and retrying...');
      pool = null; // Reset pool
      const [rows] = await getPool().query(sql, params);
      return rows;
    }
    throw err;
  }
}

export default getPool();
