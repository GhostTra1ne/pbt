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
await call('setWebhook', { url: endpoint + '/telegram/webhook', secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['callback_query'] });
await call('setMyDescription', { description: 'Тетрадь смерти КП Pussy Boys Team / UaSquad в Lineage 2. Хранитель получает заявки с сайта и одобряет или отклоняет их прямо здесь.' });
await call('setMyShortDescription', { short_description: 'Модерация Тетради смерти PBT / UaSquad · Lineage 2' });
const verified = await call('getWebhookInfo');
if (verified.url !== endpoint + '/telegram/webhook') throw new Error('Webhook verification failed');
await call('sendMessage', { chat_id: env.TELEGRAM_ADMIN_ID, text: '☠ Тетрадь смерти PBT подключена.\n\nЗаявки будут приходить сюда с кнопками «Одобрить» и «Отклонить». Решение доступно только тебе.\n\nСтраница: https://pussyboys.team/death-note.html\nСейчас проверяю публикацию и тестовую заявку.' });
console.log(JSON.stringify({ bot: bot.username, webhookConfigured: true, ownerNotified: true }));
