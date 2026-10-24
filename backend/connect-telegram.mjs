// Connect only the dedicated PBT bot to the dedicated PBT Worker.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
const env = parseEnv(readFileSync(new URL('./.dev.vars', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const endpoint = 'https://pbt-death-note.mrhally007.workers.dev';
async function call(method, body = {}) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error('Telegram setup failed. Credentials were not printed.');
  return result.result;
}
const bot = await call('getMe');
if (bot.username !== 'PBTDeathNoteBot') throw new Error('Unexpected bot. Refusing changes.');
const current = await call('getWebhookInfo');
if (current.url && current.url !== endpoint + '/telegram/webhook') throw new Error('Unexpected existing webhook. Refusing changes.');
const probe = await fetch(endpoint + '/telegram/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': env.TELEGRAM_WEBHOOK_SECRET }, body: '{}' });
if (!probe.ok) throw new Error('Worker webhook secret is not configured yet.');
await call('setWebhook', { url: endpoint + '/telegram/webhook', secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'] });
await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Открыть тетрадь', web_app: { url: env.SITE_URL || 'https://pussyboys.team/death-note.html' } } });
await call('setMyCommands', { commands: [{ command: 'start', description: 'Открыть тетрадь и меню' }] });
await call('setMyDescription', { description: 'Тетрадь смерти Pussy Boys Team в Lineage 2. Открой сайт внутри Telegram, посмотри записи или подай заявку.' });
await call('setMyShortDescription', { short_description: 'Тетрадь смерти PBT · Lineage 2' });
const verified = await call('getWebhookInfo');
if (verified.url !== endpoint + '/telegram/webhook') throw new Error('Webhook verification failed');
console.log(JSON.stringify({ bot: bot.username, webhookConfigured: true, adminId: env.TELEGRAM_ADMIN_ID, miniAppConfigured: true }));
