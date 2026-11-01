const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const { migrateAdminRoles } = require('../scripts/migrate-admin-roles');

const port = Number(process.env.ATTENDANCE_AUDIT_PORT || 0);

test('legacy account roles migrate without losing data and migration is repeatable', { skip: !port }, async () => {
  const connection = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root' });
  const [[server]] = await connection.query('SELECT @@port AS port, @@datadir AS datadir');
  assert.equal(Number(server.port), port);
  assert.match(server.datadir, /attendance-audit-/i);
  const database = `role_audit_${Date.now()}_${process.pid}`;
  await connection.query(`CREATE DATABASE \`${database}\``);
  try {
    await connection.query(`USE \`${database}\``);
    await connection.query("CREATE TABLE admins (id INT PRIMARY KEY, role ENUM('admin','superadmin','sdm','manager') NOT NULL DEFAULT 'admin')");
    await connection.query("INSERT INTO admins VALUES (1,'superadmin'),(2,'sdm')");
    assert.equal(await migrateAdminRoles(connection), true);
    assert.deepEqual((await connection.query('SELECT role FROM admins ORDER BY id'))[0].map((row) => row.role), ['superadmin', 'sdm']);
    await connection.query("INSERT INTO admins VALUES (3,'kepala_divisi'),(4,'kepala_subdivisi')");
    await connection.query('INSERT INTO admins (id) VALUES (5)');
    const [[row]] = await connection.query('SELECT role FROM admins WHERE id = 5');
    assert.equal(row.role, 'admin');
    assert.equal(await migrateAdminRoles(connection), false);
    await connection.query('DROP TABLE admins');
    await connection.query("CREATE TABLE admins (id INT PRIMARY KEY, role VARCHAR(5) NULL DEFAULT NULL)");
    await connection.query("INSERT INTO admins VALUES (1,'admin'),(2,NULL)");
    assert.equal(await migrateAdminRoles(connection), true);
    await connection.query("INSERT INTO admins VALUES (3,'kepala_subdivisi')");
    const [[nullRow]] = await connection.query('SELECT role FROM admins WHERE id = 2');
    assert.equal(nullRow.role, null);
  } finally {
    await connection.query(`DROP DATABASE \`${database}\``);
    await connection.end();
  }
});
