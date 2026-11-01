const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function loadProxy() {
  const nextResponse = {
    json: (body, options = {}) => ({ body, status: options.status || 200 }),
    next: () => ({ status: 200 }),
    redirect: () => ({ status: 307, cookies: { delete() {} } }),
  };
  const source = new vm.SourceTextModule(fs.readFileSync('proxy.js', 'utf8'));
  await source.link((name) => {
    const values = name === 'next/server' ? { NextResponse: nextResponse } : { jwtVerify: async () => ({ payload: { sessionProof: 'a'.repeat(64) } }) };
    return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); });
  });
  await source.evaluate();
  return source.namespace.proxy;
}

test('Origin hanya menerima origin terkonfigurasi dan mengabaikan header proxy', async () => {
  const saved = { node: process.env.NODE_ENV, origin: process.env.APP_ORIGIN, publicUrl: process.env.NEXT_PUBLIC_APP_URL, secret: process.env.JWT_SECRET };
  process.env.NODE_ENV = 'production';
  process.env.APP_ORIGIN = 'https://attendance.example';
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters';
  try {
    const proxy = await loadProxy();
    const request = (origin, forwardedHost) => ({
      method: 'POST', nextUrl: { pathname: '/api/leaves', origin: 'http://internal:3000' },
      headers: new Headers({ origin, 'x-forwarded-host': forwardedHost }),
      cookies: { get: () => ({ value: 'dummy' }) },
    });
    assert.equal((await proxy(request('https://attacker.example', 'attacker.example'))).status, 403);
    assert.equal((await proxy(request('https://attendance.example', 'attacker.example'))).status, 200);
    const loginAttempt = request('https://attacker.example', 'attacker.example');
    loginAttempt.nextUrl.pathname = '/api/auth/login';
    assert.equal((await proxy(loginAttempt)).status, 403);
    const scheduler = { method: 'POST', nextUrl: { pathname: '/api/cron/sync' } };
    assert.equal((await proxy(scheduler)).status, 200);
    delete process.env.APP_ORIGIN;
    delete process.env.NEXT_PUBLIC_APP_URL;
    assert.equal((await proxy(request('https://attacker.example', 'attacker.example'))).status, 503);
  } finally {
    for (const [key, value] of [['NODE_ENV', saved.node], ['APP_ORIGIN', saved.origin], ['NEXT_PUBLIC_APP_URL', saved.publicUrl], ['JWT_SECRET', saved.secret]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
