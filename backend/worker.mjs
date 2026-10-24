import { notify, handleUpdate } from './telegram.mjs';
const limits = { nickname: [1, 40], server: [1, 60], clan: [0, 60], reason: [10, 1500], evidence: [0, 500], reporter: [1, 40] };
export function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Некорректная заявка.');
  const clean = {};
  for (const [key, [min, max]] of Object.entries(limits)) {
    const value = input[key] === undefined ? '' : input[key];
    if (typeof value !== 'string') throw new Error('Все поля должны содержать текст.');
    clean[key] = value.trim();
    if (clean[key].length < min || clean[key].length > max) throw new Error(`Проверь поле ${key}: от ${min} до ${max} символов.`);
  }
  if (clean.evidence) {
    let url;
    try { url = new URL(clean.evidence); } catch { throw new Error('Некорректная ссылка.'); }
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Ссылка должна начинаться с https:// или http://.');
  }
  return clean;
}
async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
async function authorized(request, env) {
  if (!env.ADMIN_KEY || env.ADMIN_KEY.length < 24) return false;
  const actual = await digest(request.headers.get('Authorization') || '');
  const expected = await digest('Bearer ' + env.ADMIN_KEY);
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
async function readJSON(request, maxBytes = 12000) {
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error('Пустой запрос.'), { status: 400 });
  let size = 0; const chunks = [];
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw Object.assign(new Error('Запрос слишком большой.'), { status: 413 }); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw Object.assign(new Error('Некорректный JSON.'), { status: 400 }); }
}
export default {
  async scheduled(_event, env, ctx) {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ADMIN_ID) return;
    ctx.waitUntil((async () => {
      const { results } = await env.DB.prepare("SELECT id FROM submissions WHERE status='pending' AND telegram_message_id IS NULL ORDER BY created_at ASC LIMIT 10").all();
      await Promise.all(results.map(entry => notify(env, entry.id)));
    })());
  },
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim());
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin' };
    if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !allowed.includes(origin)) return json({ error: 'Этот сайт не имеет доступа.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600' } });
    const path = new URL(request.url).pathname.replace(/\/$/, '') || '/';
    try {
      if (request.method === 'POST' && path === '/telegram/webhook') {
        const secret = env.TELEGRAM_WEBHOOK_SECRET;
        if (!secret || secret.length < 24) return json({ error: 'Telegram не настроен.' }, 503);
        const actual = await digest(request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '');
        const expected = await digest(secret);
        if (actual.some((byte, i) => byte !== expected[i])) return json({ error: 'Недопустимый запрос.' }, 403);
        const update = await readJSON(request, 20000);
        if (!update || typeof update !== 'object') return json({ error: 'Некорректное обновление.' }, 400);
        await handleUpdate(update, env);
        return json({ ok: true });
      }
      if (request.method === 'GET' && path === '/entries') {
        const result = await env.DB.prepare("SELECT id, nickname, server, clan, reason, reviewed_at FROM submissions WHERE status = 'approved' ORDER BY reviewed_at DESC, id DESC LIMIT 1000").all();
        return json(result.results);
      }
      if (request.method === 'POST' && path === '/submissions') {
        if (!request.headers.get('Content-Type')?.includes('application/json')) return json({ error: 'Ожидается JSON.' }, 415);
        const input = await readJSON(request);
        if (input?.website) return json({ ok: true }, 201);
        let data;
        try { data = validate(input); } catch (error) { return json({ error: error.message }, 400); }
        const ip = request.headers.get('CF-Connecting-IP') || 'local';
        const hashed = Array.from(await digest(ip + (env.RATE_SALT || env.ADMIN_KEY || 'local'))).map(n => n.toString(16).padStart(2, '0')).join('');
        const bucket = Math.floor(Date.now() / 3600000);
        const id = crypto.randomUUID();
        // D1 batch is transactional: increment and gated insert cannot race.
        const results = await env.DB.batch([
          env.DB.prepare('INSERT INTO rate_limits (ip_hash, bucket, count) VALUES (?, ?, 1) ON CONFLICT(ip_hash, bucket) DO UPDATE SET count = count + 1').bind(hashed, bucket),
          env.DB.prepare("INSERT INTO submissions (id,nickname,server,clan,reason,evidence,reporter,status) SELECT ?,?,?,?,?,?,?,'pending' WHERE (SELECT count FROM rate_limits WHERE ip_hash=? AND bucket=?) <= 3").bind(id, data.nickname, data.server, data.clan, data.reason, data.evidence, data.reporter, hashed, bucket),
          env.DB.prepare('DELETE FROM rate_limits WHERE bucket < ?').bind(bucket - 24)
        ]);
        if (!results[1].meta.changes) return json({ error: 'Не более трёх заявок в час. Попробуй позже.' }, 429);
        if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_ADMIN_ID) ctx.waitUntil(notify(env, id));
        return json({ ok: true, id }, 201);
      }
      if (path.startsWith('/admin/')) {
        if (!await authorized(request, env)) return json({ error: 'Неверный ключ хранителя.' }, 401);
        if (request.method === 'GET' && path === '/admin/submissions') {
          const result = await env.DB.prepare("SELECT * FROM submissions WHERE status='pending' ORDER BY created_at ASC LIMIT 500").all();
          return json(result.results);
        }
        const match = path.match(/^\/admin\/submissions\/([a-f0-9-]{36})\/(approve|reject)$/);
        if (request.method === 'POST' && match) {
          const status = match[2] === 'approve' ? 'approved' : 'rejected';
          const result = await env.DB.prepare("UPDATE submissions SET status=?,reviewed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending'").bind(status, match[1]).run();
          if (!result.meta.changes) return json({ error: 'Заявка уже рассмотрена или не найдена.' }, 409);
          return json({ ok: true });
        }
      }
      return json({ error: 'Страница не найдена.' }, 404);
    } catch (error) {
      if (error.status === 400 || error.status === 413) return json({ error: error.message }, error.status);
      console.error('Death Note request failed'); return json({ error: 'Архив временно недоступен. Попробуй позже.' }, 503);
    }
  }
};
