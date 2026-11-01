const mysql = require('mysql2/promise');

async function migrateAdminRoles(connection) {
  const [[column]] = await connection.query(`
    SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT,
           CHARACTER_SET_NAME, COLLATION_NAME, COLUMN_COMMENT, EXTRA
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admins' AND COLUMN_NAME = 'role'
  `);
  if (!column) throw new Error('Kolom admins.role tidak ditemukan.');
  if (column.DATA_TYPE === 'varchar' && Number(column.CHARACTER_MAXIMUM_LENGTH) >= 16) return false;
  if (!['enum', 'varchar', 'char'].includes(column.DATA_TYPE) || column.EXTRA) {
    throw new Error('Tipe atau atribut admins.role tidak didukung; periksa skema secara manual.');
  }
  const identifiers = [column.CHARACTER_SET_NAME, column.COLLATION_NAME];
  if (identifiers.some((value) => !value || !/^[a-zA-Z0-9_]+$/.test(value))) {
    throw new Error('Karakter set atau collation kolom tidak dikenali.');
  }
  const [[length]] = await connection.query('SELECT COALESCE(MAX(CHAR_LENGTH(CAST(role AS CHAR))), 0) AS max_length FROM admins');
  if (Number(length.max_length) > 255 || Number(column.CHARACTER_MAXIMUM_LENGTH) > 255 || (column.COLUMN_DEFAULT || '').length > 255) {
    throw new Error('Nilai role terlalu panjang untuk migrasi otomatis.');
  }
  const nullable = column.IS_NULLABLE === 'YES';
  const defaultClause = column.COLUMN_DEFAULT === null
    ? (nullable ? ' DEFAULT NULL' : '')
    : ` DEFAULT ${connection.escape(column.COLUMN_DEFAULT)}`;
  const comment = column.COLUMN_COMMENT ? ` COMMENT ${connection.escape(column.COLUMN_COMMENT)}` : '';
  await connection.query(`ALTER TABLE admins MODIFY COLUMN role VARCHAR(255) CHARACTER SET ${identifiers[0]} COLLATE ${identifiers[1]} ${nullable ? 'NULL' : 'NOT NULL'}${defaultClause}${comment}`);
  return true;
}

async function main() {
  require('dotenv').config({ path: '.env', quiet: true });
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'absensi_db',
  });
  try {
    const changed = await migrateAdminRoles(connection);
    console.log(changed ? 'Migrasi peran akun selesai.' : 'Kolom peran akun sudah mendukung peran baru.');
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Migrasi peran akun gagal. Periksa skema dan hak ALTER database.');
    if (error.message.startsWith('Kolom ') || error.message.startsWith('Tipe ') || error.message.startsWith('Karakter ') || error.message.startsWith('Nilai ')) console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { migrateAdminRoles };
