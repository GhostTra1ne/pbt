import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { CLANS, validate } from './worker.mjs';
import { createDatabase } from './db-adapter.mjs';

const sample = { nickname: 'Enemy', clan: 'UAsquad', reason: 'Сорвал согласованный игровой бой.' };
function setup() {
  const DB = createDatabase();
  const env = { DB, ADMIN_KEY: 'local-test-key-at-least-24-characters', ALLOWED_ORIGINS: 'http://localhost:8788' };
  async function call(path, method = 'GET', data, auth = false, ip = '127.0.0.1') {
    const headers = { Origin: 'http://localhost:8788', 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = 'Bearer ' + env.ADMIN_KEY;
    return worker.fetch(new Request('http://localhost' + path, { method, headers, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }), env, { waitUntil() {} });
  }
  return { DB, env, call };
}
test('submission stays private until approval; private fields never appear publicly', async () => {
  const { DB, call } = setup();
  try {
    const response = await call('/submissions', 'POST', sample); assert.equal(response.status, 201);
    const { id } = await response.json();
    assert.deepEqual(await (await call('/entries')).json(), []);
    assert.equal((await call('/admin/submissions')).status, 401);
    const pending = await (await call('/admin/submissions', 'GET', undefined, true)).json();
    assert.equal(pending.length, 1); assert.equal(pending[0].server, 'Lu4 · Black');
    assert.equal(pending[0].evidence, ''); assert.equal(pending[0].reporter, '');
    assert.equal((await call(`/admin/submissions/${id}/approve`, 'POST', {}, false)).status, 401);
    assert.equal((await call(`/admin/submissions/${id}/approve`, 'POST', {}, true)).status, 200);
    const published = await (await call('/entries')).json();
    assert.equal(published[0].nickname, sample.nickname); assert.equal(published[0].server, 'Lu4 · Black');
    assert.equal('reporter' in published[0], false); assert.equal('evidence' in published[0], false);
    const adminEntries = await (await call('/admin/entries', 'GET', undefined, true)).json();
    assert.equal(adminEntries.length, 1); assert.equal(adminEntries[0].id, id);
    assert.equal((await call(`/admin/entries/${id}/remove`, 'POST', {}, false)).status, 401);
    assert.equal((await call(`/admin/entries/${id}/remove`, 'POST', {}, true)).status, 200);
    assert.deepEqual(await (await call('/entries')).json(), []);
    assert.deepEqual(await (await call('/admin/entries', 'GET', undefined, true)).json(), []);
    assert.equal((await call(`/admin/entries/${id}/remove`, 'POST', {}, true)).status, 409);
    assert.equal((await call(`/admin/submissions/${id}/reject`, 'POST', {}, true)).status, 409);
  } finally { DB.close(); }
});
test('reject does not publish; rate limit prevents fourth submission', async () => {
  const { DB, call } = setup();
  try {
    const { id } = await (await call('/submissions', 'POST', sample)).json();
    assert.equal((await call(`/admin/submissions/${id}/reject`, 'POST', {}, true)).status, 200);
    await call('/submissions', 'POST', sample); await call('/submissions', 'POST', sample);
    assert.equal((await call('/submissions', 'POST', sample)).status, 429);
    assert.deepEqual(await (await call('/entries')).json(), []);
  } finally { DB.close(); }
});
test('validation, CORS, body limits, and honeypot', async () => {
  const { DB, env, call } = setup();
  try {
    assert.throws(() => validate({ ...sample, nickname: ' ' }));
    assert.throws(() => validate({ ...sample, clan: 'UnknownClan' }), /Выбери клан из списка/);
    assert.equal(CLANS.length, 36);
    assert.equal(validate({ ...sample, clan: 'Без клана' }).clan, 'Без клана');
    assert.equal((await call('/submissions', 'POST', { ...sample, reason: 'x' })).status, 400);
    assert.equal((await call('/submissions', 'POST', { ...sample, website: 'bot' })).status, 201);
    assert.equal((await call('/admin/submissions', 'GET', undefined, true)).status, 200);
    const denied = await worker.fetch(new Request('http://localhost/entries', { headers: { Origin: 'https://bad.example' } }), env, {});
    assert.equal(denied.status, 403); assert.equal(denied.headers.has('Access-Control-Allow-Origin'), false);
    const preflight = await call('/submissions', 'OPTIONS'); assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('X-Frame-Options'), 'DENY');
    assert.equal(preflight.headers.get('Referrer-Policy'), 'no-referrer');
    assert.match(preflight.headers.get('Content-Security-Policy'), /default-src 'none'/);
    assert.match(preflight.headers.get('Permissions-Policy'), /camera=\(\)/);
    assert.equal((await call('/submissions', 'POST', { ...sample, reason: 'x'.repeat(13000) })).status, 413);
    assert.equal((await call('/admin/submissions', 'GET', undefined, true)).headers.get('Cache-Control'), 'no-store');
  } finally { DB.close(); }
});
