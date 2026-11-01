const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function createRoute({ user, employee = { uid: 7, department: 'Teknik', deviceId: 2 }, scans = false, existing = [] } = {}) {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push('begin'); },
    async rollback() { calls.push('rollback'); },
    async commit() { calls.push('commit'); },
    release() { calls.push('release'); },
    async query(sql, params) {
      if (sql.includes('FROM employees e')) {
        const scoped = sql.includes('e.department = ?');
        const matches = employee && params[0] === employee.uid && params[scoped ? 2 : 1] === employee.deviceId && (!scoped || params[1] === employee.department);
        return [matches ? [{ uid: employee.uid }] : []];
      }
      if (sql.includes('FROM attendance_logs')) return [scans ? [{ id: 1 }] : []];
      if (sql.startsWith('SELECT id, type FROM leaves')) return [existing];
      if (sql.startsWith('INSERT INTO leaves')) { calls.push({ insert: params }); return [{ affectedRows: 1 }]; }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const exports = {
    'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } },
    '@/lib/db': { getPool: () => ({ getConnection: async () => connection }), query: async () => [] },
    '@/lib/auth': { getUserSession: async () => user, isDepartmentManager: (role) => ['manager', 'kepala_divisi', 'kepala_subdivisi'].includes(role) },
    '@/lib/devices': { requireDevice: async (params) => ({ id: Number(params.get('device_id')) }) },
    '@/lib/events': { emitRealtimeEvent: () => calls.push('event') },
  };
  const routeModule = new vm.SourceTextModule(fs.readFileSync('app/api/leaves/route.js', 'utf8'));
  await routeModule.link((specifier) => {
    const values = exports[specifier];
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    });
  });
  await routeModule.evaluate();
  return { post: routeModule.namespace.POST, calls };
}

function request(uid = 7, date = '2026-10-30', deviceId = 2, type = 'Alfa', check_in = '08:00', check_out = '16:00') {
  return { url: `http://localhost/api/leaves?device_id=${deviceId}`, json: async () => ({ uid, date, type, check_in, check_out }) };
}

test('hanya Super Admin dapat mencatat atau mengubah hadir manual', async () => {
  for (const role of ['admin', 'sdm', 'manager', 'kepala_divisi', 'kepala_subdivisi']) {
    const route = await createRoute({ user: { role, department: 'Teknik' } });
    assert.equal((await route.post(request(7, '2026-10-30', 2, 'Hadir'))).status, 403);
    assert.ok(!route.calls.includes('commit'));
    if (role !== 'admin') {
      const withPresence = await createRoute({ user: { role, department: 'Teknik' }, existing: [{ id: 1, type: 'Hadir' }] });
      assert.equal((await withPresence.post(request())).status, 403);
      assert.ok(withPresence.calls.includes('rollback'));
    }
  }
  const superadmin = await createRoute({ user: { role: 'superadmin' } });
  assert.equal((await superadmin.post(request(7, '2026-10-30', 2, 'Hadir'))).status, 200);
  assert.equal((await superadmin.post(request(7, '2026-10-30', 2, 'Hadir', '', ''))).status, 422);
  assert.equal((await superadmin.post(request(7, '2026-10-30', 2, 'Hadir', '16:00', '08:00'))).status, 422);
});

test('kepala hanya dapat menyimpan status anggota departemen dan mesin sendiri', async () => {
  for (const role of ['manager', 'kepala_divisi', 'kepala_subdivisi']) {
    const { post, calls } = await createRoute({ user: { role, department: 'Teknik' } });
    assert.equal((await post(request())).status, 200);
    assert.ok(calls.includes('commit'));
    assert.ok(calls.some((call) => call.insert));
  }
});

test('departemen lain, mesin lain, dan departemen kosong ditolak', async () => {
  for (const [department, device, expected] of [['SDM', 2, 404], ['Teknik', 3, 404], ['', 2, 403]]) {
    const { post, calls } = await createRoute({ user: { role: 'kepala_divisi', department } });
    assert.equal((await post(request(7, '2026-10-30', device))).status, expected);
    assert.ok(!calls.some((call) => call.insert));
  }
});

test('admin pemantau, tanggal tidak valid, dan scan yang sudah ada ditolak', async () => {
  let route = await createRoute({ user: { role: 'admin' } });
  assert.equal((await route.post(request())).status, 403);
  route = await createRoute({ user: { role: 'kepala_subdivisi', department: 'Teknik' } });
  assert.equal((await route.post(request(7, '2026-02-30'))).status, 422);
  assert.equal((await route.post(request('7abc'))).status, 422);
  route = await createRoute({ user: { role: 'kepala_subdivisi', department: 'Teknik' }, scans: true });
  assert.equal((await route.post(request())).status, 409);
  assert.ok(route.calls.includes('rollback'));
  assert.ok(!route.calls.some((call) => call.insert));
});

test('sesi membaca peran dan departemen terbaru dan menolak akun terhapus', async () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-characters';
  let account = { id: 1, username: 'kepala', role: 'kepala_divisi', department: 'Teknik', password: 'old-password-hash' };
  let signedPayload = { adminId: 1 };
  const routeModule = new vm.SourceTextModule(fs.readFileSync('lib/auth.js', 'utf8'));
  await routeModule.link((specifier) => {
    const values = specifier === 'jose' ? { jwtVerify: async () => ({ payload: signedPayload }) }
      : specifier === 'node:crypto' ? require('node:crypto') : { query: async () => account ? [account] : [] };
    return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); });
  });
  await routeModule.evaluate();
  try {
    signedPayload = { adminId: 1, sessionProof: routeModule.namespace.sessionProof(new TextEncoder().encode(process.env.JWT_SECRET), account.password) };
    const requestWithCookie = { cookies: { get: () => ({ value: 'signed-token' }) } };
    assert.equal((await routeModule.namespace.getUserSession(requestWithCookie)).department, 'Teknik');
    account = { ...account, role: 'kepala_subdivisi', department: 'SDM' };
    const updated = await routeModule.namespace.getUserSession(requestWithCookie);
    assert.equal(updated.role, 'kepala_subdivisi');
    assert.equal(updated.department, 'SDM');
    assert.equal(updated.password, undefined);
    account = { ...account, password: 'new-password-hash' };
    assert.equal(await routeModule.namespace.getUserSession(requestWithCookie), null);
    account = null;
    assert.equal(await routeModule.namespace.getUserSession(requestWithCookie), null);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
