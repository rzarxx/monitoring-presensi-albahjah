const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const mysql = require('mysql2/promise');
const { execFileSync } = require('node:child_process');

const port = Number(process.env.ATTENDANCE_AUDIT_PORT || 0);

test('attendance queries and department isolation on an isolated MySQL instance', { skip: !port }, async () => {
  const root = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root' });
  const [[server]] = await root.query('SELECT @@port AS port, @@datadir AS datadir');
  assert.equal(Number(server.port), port);
  assert.match(server.datadir, /attendance-audit-/i);
  const database = `attendance_audit_${Date.now()}`;
  await root.query(`CREATE DATABASE \`${database}\``);
  await root.end();
  const pool = mysql.createPool({ host: '127.0.0.1', port, user: 'root', database, connectionLimit: 5 });
  const query = async (sql, args) => (await pool.query(sql, args))[0];
  try {
    for (const sql of [
      'CREATE TABLE employees (uid INT PRIMARY KEY, name VARCHAR(255), department VARCHAR(255))',
      'CREATE TABLE device_enrollments (id INT PRIMARY KEY AUTO_INCREMENT, device_id INT, device_uid INT, employee_uid INT, display_name VARCHAR(255))',
      'CREATE TABLE attendance_logs (id INT PRIMARY KEY AUTO_INCREMENT, device_id INT, uid INT, timestamp DATETIME, state INT DEFAULT 0)',
      'CREATE TABLE leaves (id INT PRIMARY KEY AUTO_INCREMENT, device_id INT, uid INT, date DATE, type VARCHAR(50), reason TEXT)',
      'CREATE TABLE login_attempt_limits (account_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, attempts INT UNSIGNED NOT NULL, window_start DATETIME NOT NULL, INDEX idx_login_attempt_window (window_start)) ENGINE=InnoDB',
      'CREATE TABLE admins (id INT PRIMARY KEY AUTO_INCREMENT, username VARCHAR(255) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, role VARCHAR(50), department VARCHAR(255))',
    ]) await query(sql);
    const env = { ...process.env, DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_USER: 'root', DB_PASSWORD: '', DB_NAME: database };
    execFileSync(process.execPath, ['scripts/migrate-manual-attendance.js'], { env });
    execFileSync(process.execPath, ['scripts/migrate-manual-attendance.js'], { env });
    const [[{ today }]] = await pool.query("SELECT DATE_FORMAT(UTC_TIMESTAMP() + INTERVAL 7 HOUR, '%Y-%m-%d') AS today");
    await query("INSERT INTO employees VALUES (1,'Nama Sama','Teknik'),(2,'Nama Sama','Teknik'),(3,'Lain','SDM')");
    await query("INSERT INTO device_enrollments (device_id,device_uid,employee_uid,display_name) VALUES (2,11,1,'A'),(2,14,1,'A2'),(2,12,2,'B'),(2,13,3,'C'),(2,2,NULL,'Unmapped'),(3,11,3,'Other')");
    await query('INSERT INTO attendance_logs (device_id,uid,timestamp) VALUES (2,11,?),(2,14,?),(2,2,?),(3,11,?)', [`${today} 08:00:00`, `${today} 16:00:00`, `${today} 09:00:00`, `${today} 10:00:00`]);
    await query("INSERT INTO leaves (device_id,uid,date,type,reason) VALUES (2,2,?,'Izin','old'),(2,2,?,'Alfa','new'),(2,3,?,'Sakit','other department')", [today, today, today]);

    const user = { role: 'kepala_divisi', department: 'Teknik' };
    const dependencies = {
      'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } },
      '@/lib/db': { query, getPool: () => pool },
      '@/lib/auth': { getUserSession: async () => user, isDepartmentManager: (role) => ['manager', 'kepala_divisi', 'kepala_subdivisi'].includes(role) },
      '@/lib/devices': { requireDevice: async (params) => ({ id: Number(params.get('device_id')), name: 'Test', code: 'T' }) },
      '@/lib/events': { emitRealtimeEvent() {} },
    };
    async function load(path) {
      const source = new vm.SourceTextModule(fs.readFileSync(path, 'utf8'), { importModuleDynamically: (specifier) => import(specifier) });
      await source.link((specifier) => {
        const values = dependencies[specifier];
        return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); });
      });
      await source.evaluate();
      return source.namespace;
    }

    const report = await load('lib/attendance-report.js');
    const rows = await report.getAttendanceReport({ deviceId: 2, user, dateFrom: today, dateTo: today, department: user.department });
    assert.equal(rows.length, 2);
    assert.equal(new Set(rows.map((row) => row.employee_key)).size, 2);
    assert.equal(rows.find((row) => row.employee_key === '1').jam_keluar, '16:00');
    assert.equal(rows.find((row) => row.employee_key === '2').leave_type, 'Alfa');

    const logs = await load('app/api/logs/route.js');
    const logResponse = await logs.GET({ url: `http://localhost/api/logs?device_id=2&date=${today}&limit=100` });
    assert.equal(logResponse.status, 200, logResponse.body.error);
    assert.equal(logResponse.body.report.length, 2);
    assert.equal(logResponse.body.missingAttendance.length, 1);
    assert.equal(logResponse.body.missingAttendance[0].status_type, 'Alfa');

    const recap = await load('app/api/employees/[uid]/recap/route.js');
    const recapResponse = await recap.GET({ url: 'http://localhost/api/employees/1/recap?device_id=2&period=weekly' }, { params: Promise.resolve({ uid: '1' }) });
    assert.equal(recapResponse.status, 200, recapResponse.body.error);
    const day = recapResponse.body.daily.find((entry) => entry.date === today);
    assert.equal(day.status, 'Hadir');
    assert.equal(day.check_in, '08:00');
    assert.equal(day.check_out, '16:00');
    const denied = await recap.GET({ url: 'http://localhost/api/employees/3/recap?device_id=2' }, { params: Promise.resolve({ uid: '3' }) });
    assert.equal(denied.status, 404);

    const stats = await load('app/api/stats/route.js');
    const statsResponse = await stats.GET({ url: 'http://localhost/api/stats?device_id=2' });
    assert.equal(statsResponse.status, 200, statsResponse.body.error);
    const summary = statsResponse.body.data.find((entry) => entry.date === today);
    assert.equal(summary.hadir, 1);
    assert.equal(summary.alfa, 1);
    assert.equal(summary.sakit, 0);

    const leaves = await load('app/api/leaves/route.js');
    const save = (uid, type) => leaves.POST({ url: 'http://localhost/api/leaves?device_id=2', json: async () => ({ uid, date: today, type, check_in: '08:15', check_out: '16:30' }) });
    assert.equal((await save(3, 'Alfa')).status, 404);
    assert.equal((await save(1, 'Alfa')).status, 409);
    assert.equal((await save(2, 'Hadir')).status, 403);
    user.role = 'superadmin';
    user.username = 'super-tester';
    assert.equal((await save(2, 'Hadir')).status, 200);
    user.role = 'kepala_divisi';
    assert.equal((await save(2, 'Alfa')).status, 403);
    const [savedPresence] = await query('SELECT manual_by FROM leaves WHERE device_id = 2 AND uid = 2 AND date = ? LIMIT 1', [today]);
    assert.equal(savedPresence.manual_by, 'super-tester');
    const updated = await report.getAttendanceReport({ deviceId: 2, user, dateFrom: today, dateTo: today, department: user.department });
    assert.equal(updated.find((row) => row.employee_key === '2').leave_type, 'Hadir');
    assert.equal(updated.find((row) => row.employee_key === '2').jam_masuk, '08:15');
    assert.equal(updated.find((row) => row.employee_key === '2').jam_keluar, '16:30');
    assert.equal(Number(updated.find((row) => row.employee_key === '2').dur_min), 495);
    const manualRecap = await recap.GET({ url: 'http://localhost/api/employees/2/recap?device_id=2&period=weekly' }, { params: Promise.resolve({ uid: '2' }) });
    assert.equal(manualRecap.body.daily.find((entry) => entry.date === today).check_in, '08:15');
    assert.equal(manualRecap.body.daily.find((entry) => entry.date === today).check_out, '16:30');
    const manualLogs = await logs.GET({ url: `http://localhost/api/logs?device_id=2&date=${today}&limit=100` });
    assert.equal(manualLogs.body.report.find((entry) => entry.employee_uid === 2).leave_type, 'Hadir');
    const manualStats = await stats.GET({ url: 'http://localhost/api/stats?device_id=2' });
    assert.equal(manualStats.body.data.find((entry) => entry.date === today).hadir, 2);
    dependencies['@/lib/attendance-report'] = { getAttendanceReport: report.getAttendanceReport };
    const pdf = await load('app/api/pdf/route.js');
    const pdfResponse = await pdf.GET({ url: `http://localhost/api/pdf?device_id=2&date_from=${today}&date_to=${today}` });
    assert.equal(pdfResponse.status, 200, pdfResponse.body?.error);
    const pdfHtml = await pdfResponse.text();
    assert.match(pdfHtml, /Hadir manual/);
    assert.match(pdfHtml, /08:15/);
    assert.match(pdfHtml, /16:30/);
    assert.doesNotMatch(pdfHtml, /other department/);
    const excel = await load('app/api/export/route.js');
    const excelResponse = await excel.GET({ url: `http://localhost/api/export?device_id=2&date_from=${today}&date_to=${today}` });
    assert.equal(excelResponse.status, 200, excelResponse.body?.error);
    const xlsx = await import('xlsx');
    const workbook = xlsx.read(Buffer.from(await excelResponse.arrayBuffer()), { type: 'buffer' });
    const cells = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 }).flat();
    assert.equal(cells.filter((value) => value === 'Nama Sama').length, 2);
    assert.ok(cells.includes('08:15 (manual)'));
    assert.ok(cells.includes('16:30'));
    assert.ok(!cells.includes('Lain'));

    await query('INSERT INTO attendance_logs (device_id,uid,timestamp) VALUES (2,12,?)', [`${today} 09:00:00`]);
    const afterTap = await report.getAttendanceReport({ deviceId: 2, user, dateFrom: today, dateTo: today, department: user.department });
    const personTwo = afterTap.filter((row) => row.employee_key === '2');
    assert.equal(personTwo.length, 1);
    assert.equal(personTwo[0].leave_type, null);
    assert.equal(personTwo[0].jam_masuk, '09:00');

    await query("INSERT INTO employees VALUES (4,'Concurrent','Teknik')");
    await query("INSERT INTO device_enrollments (device_id,device_uid,employee_uid,display_name) VALUES (2,15,4,'Concurrent')");
    const results = await Promise.all([save(4, 'Sakit'), save(4, 'Izin')]);
    assert.deepEqual(results.map((result) => result.status), [200, 200]);
    const [{ count }] = await query('SELECT COUNT(*) AS count FROM leaves WHERE device_id = 2 AND uid = 4 AND date = ?', [today]);
    assert.equal(count, 1);

    dependencies['node:crypto'] = require('node:crypto');
    const limiter = await load('lib/login-rate-limit.js');
    const secret = Buffer.from('test-only-secret-at-least-32-characters');
    const attempts = await Promise.all(Array.from({ length: 12 }, () => limiter.recordLoginAttempt('account:1', secret)));
    assert.equal(attempts.filter((item) => item.allowed).length, 10);
    assert.equal(attempts.filter((item) => !item.allowed).length, 2);
    await limiter.clearLoginAttempts(attempts[0].key);
    assert.equal((await limiter.recordLoginAttempt('account:1', secret)).allowed, true);

    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'test-only-secret-at-least-32-characters';
    try {
      dependencies['jose'] = await import('jose');
      dependencies['node:crypto'] = { ...require('node:crypto'), default: require('node:crypto') };
      dependencies['node:util'] = require('node:util');
      const auth = await load('lib/auth.js');
      const passwords = await load('lib/password.js');
      dependencies['@/lib/auth'] = auth;
      dependencies['@/lib/password'] = passwords;
      dependencies['@/lib/login-rate-limit'] = limiter;
      dependencies['next/server'] = { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200, cookies: { set(name, value) { this[name] = value; } } }) } };
      const login = await load('app/api/auth/login/route.js');
      await query('INSERT INTO admins (username,password,role,department) VALUES (?,?,?,?)', ['dummy', await passwords.hashPassword('dummy-password-123'), 'kepala_divisi', 'Teknik']);
      const loginRequest = (password) => ({ json: async () => ({ username: 'dummy', password }) });
      const loggedIn = await login.POST(loginRequest('dummy-password-123'));
      assert.equal(loggedIn.status, 200, loggedIn.body.error);
      const sessionRequest = { cookies: { get: () => ({ value: loggedIn.cookies.auth_token }) } };
      assert.equal((await auth.getUserSession(sessionRequest)).department, 'Teknik');
      await query('UPDATE admins SET password = ? WHERE username = ?', [await passwords.hashPassword('different-password-123'), 'dummy']);
      assert.equal(await auth.getUserSession(sessionRequest), null);
      for (let i = 0; i < 10; i++) assert.equal((await login.POST(loginRequest('incorrect'))).status, 401);
      assert.equal((await login.POST(loginRequest('incorrect'))).status, 429);
    } finally {
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    }
  } finally {
    await pool.end();
  }
});
