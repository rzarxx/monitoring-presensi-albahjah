import { createHmac, randomInt } from 'node:crypto';
import { getPool, query } from '@/lib/db';

const MAX_ATTEMPTS = 10;

export async function recordLoginAttempt(username, secret) {
  const key = createHmac('sha256', secret).update('attendance-login-v1\0').update(username.trim().toLowerCase()).digest('hex');
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(`INSERT INTO login_attempt_limits (account_key, attempts, window_start)
      VALUES (?, 1, UTC_TIMESTAMP())
      ON DUPLICATE KEY UPDATE
        attempts = IF(window_start < UTC_TIMESTAMP() - INTERVAL 15 MINUTE, 1, attempts + 1),
        window_start = IF(window_start < UTC_TIMESTAMP() - INTERVAL 15 MINUTE, UTC_TIMESTAMP(), window_start)`, [key]);
    const [[row]] = await connection.query('SELECT attempts FROM login_attempt_limits WHERE account_key = ?', [key]);
    await connection.commit();
    if (randomInt(100) === 0) {
      query('DELETE FROM login_attempt_limits WHERE window_start < UTC_TIMESTAMP() - INTERVAL 1 DAY LIMIT 200').catch(() => {});
    }
    return { key, allowed: Number(row.attempts) <= MAX_ATTEMPTS };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function clearLoginAttempts(key) {
  await query('DELETE FROM login_attempt_limits WHERE account_key = ?', [key]);
}
