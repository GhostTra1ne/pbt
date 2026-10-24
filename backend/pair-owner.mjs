// Run locally after sending /start to the new bot. Never prints credentials.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
const file = new URL('./.dev.vars', import.meta.url);
let text = readFileSync(file, 'utf8');
const secrets = parseEnv(text.replace(/^\uFEFF/, ''));
async function call(method, body = {}) {
  const response = await fetch(`https://api.telegram.org/bot${secrets.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000)
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error('Telegram request failed; credentials were not printed.');
  return result.result;
}
const bot = await call('getMe');
if (bot.username !== 'PBTDeathNoteBot') throw new Error('Unexpected bot. Refusing to use this credential.');
const webhook = await call('getWebhookInfo');
if (webhook.url) throw new Error('Bot already has a webhook. Refusing to change it.');
const updates = await call('getUpdates', { timeout: 0 });
const starts = updates.filter(u => u.message?.chat?.type === 'private' && u.message.text === '/start');
const owners = [...new Set(starts.map(u => String(u.message.from.id)))];
if (owners.length !== 1 || !starts.length || starts.some(u => u.message.from.id !== u.message.chat.id)) throw new Error('Cannot identify one owner from private /start messages.');
function set(name, value) {
  const pattern = new RegExp('^' + name + '=.*$', 'm');
  text = pattern.test(text) ? text.replace(pattern, name + '=' + value) : text + '\n' + name + '=' + value + '\n';
}
set('TELEGRAM_ADMIN_ID', owners[0]);
for (const key of ['ADMIN_KEY', 'RATE_SALT', 'TELEGRAM_WEBHOOK_SECRET']) if (!secrets[key]) set(key, randomBytes(32).toString('hex'));
writeFileSync(file, text);
console.log(JSON.stringify({ bot: bot.username, ownerIdentified: true, secretsStoredLocally: true }));
