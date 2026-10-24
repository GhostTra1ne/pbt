import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
import { createDatabase } from './db-adapter.mjs';
import { notify } from './telegram.mjs';

const admin = '12345678';
const id = '12345678-1234-1234-1234-123456789abc';
async function setup(run) {
  const DB = createDatabase();
  await DB.prepare("INSERT INTO submissions(id,nickname,server,reason,reporter) VALUES(?,?,?,?,?)").bind(id, 'Enemy', 'Lu4 · Black', 'Игровой конфликт для проверки.', '').run();
  const env = { DB, TELEGRAM_BOT_TOKEN: 'fake-test-token', TELEGRAM_ADMIN_ID: admin, TELEGRAM_WEBHOOK_SECRET: 'fake-test-webhook-secret-at-least-24-chars' };
  const calls = []; const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const method = new URL(url).pathname.split('/').pop();
    calls.push({ method, body: JSON.parse(options.body) });
    return Response.json({ ok: true, result: method === 'sendMessage' ? { message_id: 99 } : true });
  };
  try { await run({ env, calls, DB }); } finally { globalThis.fetch = original; DB.close(); }
}
function callback(env, action = 'a', from = admin, secret = env.TELEGRAM_WEBHOOK_SECRET, chat = admin) {
  return new Request('https://worker.test/telegram/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret }, body: JSON.stringify({ callback_query: { id: 'query-1', from: { id: Number(from) }, data: `dn:${action}:${id}`, message: { message_id: 99, chat: { id: Number(chat), type: 'private' }, text: 'pending', reply_markup: { inline_keyboard: [[{}]] } } } }) });
}
test('notification contains the three application fields and valid approve/reject buttons, delivered once', async () => setup(async ({ env, calls }) => {
  await notify(env, id); await notify(env, id);
  assert.equal(calls.length, 1); assert.equal(calls[0].body.chat_id, admin);
  const buttons = calls[0].body.reply_markup.inline_keyboard[0];
  assert.equal(buttons.length, 2); assert.ok(buttons.every(b => Buffer.byteLength(b.callback_data) <= 64));
  assert.equal(calls[0].body.parse_mode, undefined);
  assert.match(calls[0].body.text, /Ник: Enemy\nКлан: —\nПричина почему пидорас: Игровой конфликт для проверки\./);
  assert.doesNotMatch(calls[0].body.text, /Сервер:|Автор:|Доказательства:/);
}));
test('webhook secret and owner identity protect moderation', async () => setup(async ({ env, calls, DB }) => {
  assert.equal((await worker.fetch(callback(env, 'a', admin, 'wrong'), env, {})).status, 403);
  assert.equal(calls.length, 0);
  assert.equal((await worker.fetch(callback(env, 'a', '555'), env, {})).status, 200);
  assert.equal(calls[0].method, 'answerCallbackQuery'); assert.equal(calls[0].body.show_alert, true);
  await worker.fetch(callback(env, 'a', admin, env.TELEGRAM_WEBHOOK_SECRET, '555'), env, {});
  assert.equal((await DB.prepare('SELECT status FROM submissions WHERE id=?').bind(id).all()).results[0].status, 'pending');
}));
test('Telegram approval publishes; duplicate rejection cannot reverse it', async () => setup(async ({ env, calls, DB }) => {
  assert.equal((await worker.fetch(callback(env), env, {})).status, 200);
  const entries = await (await worker.fetch(new Request('https://worker.test/entries'), env, {})).json();
  assert.equal(entries.length, 1); assert.equal(entries[0].nickname, 'Enemy'); assert.equal('reporter' in entries[0], false);
  assert.deepEqual(calls.find(c => c.method === 'editMessageText').body.reply_markup, { inline_keyboard: [] });
  await worker.fetch(callback(env, 'r'), env, {});
  assert.equal((await DB.prepare('SELECT status FROM submissions WHERE id=?').bind(id).all()).results[0].status, 'approved');
}));
test('Telegram rejection keeps entry private', async () => setup(async ({ env }) => {
  await worker.fetch(callback(env, 'r'), env, {});
  assert.deepEqual(await (await worker.fetch(new Request('https://worker.test/entries'), env, {})).json(), []);
}));
test('failed delivery remains in retry queue; cron sends it later', async () => setup(async ({ env, calls, DB }) => {
  const success = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ ok: false }, { status: 503 });
  await notify(env, id);
  const row = (await DB.prepare('SELECT telegram_message_id,telegram_claimed_at FROM submissions WHERE id=?').bind(id).all()).results[0];
  assert.equal(row.telegram_message_id, null); assert.equal(row.telegram_claimed_at, null);
  globalThis.fetch = success;
  const jobs = [];
  await worker.scheduled({}, env, { waitUntil(p) { jobs.push(p); } }); await Promise.all(jobs);
  assert.equal(calls.filter(c => c.method === 'sendMessage').length, 1);
}));
