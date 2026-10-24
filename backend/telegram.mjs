export async function telegram(env, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000)
  });
  const result = await response.json();
  // Telegram may retry the same callback after the edit already succeeded.
  if (method === 'editMessageText' && result.error_code === 400 && /message is not modified/i.test(result.description || '')) return true;
  if (!response.ok || !result.ok) throw new Error('Telegram API request failed');
  return result.result;
}
export function message(entry, status = 'pending') {
  const title = { pending: '☠ Новая заявка в Тетрадь смерти', approved: '✅ Вписан в тетрадь', rejected: '❌ Заявка отклонена' }[status];
  return `${title}\n\nНик: ${entry.nickname}\nСервер: ${entry.server}\nКлан: ${entry.clan || '—'}\nАвтор: ${entry.reporter}\n\n${entry.reason}${entry.evidence ? '\n\nДоказательства: ' + entry.evidence : ''}`;
}
export async function notify(env, id) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ADMIN_ID) return;
  const now = Date.now();
  const claim = await env.DB.prepare("UPDATE submissions SET telegram_claimed_at=? WHERE id=? AND status='pending' AND telegram_message_id IS NULL AND (telegram_claimed_at IS NULL OR telegram_claimed_at < ?)").bind(now, id, now - 120000).run();
  if (!claim.meta.changes) return;
  try {
    const { results } = await env.DB.prepare('SELECT * FROM submissions WHERE id=?').bind(id).all();
    const result = await telegram(env, 'sendMessage', {
      chat_id: env.TELEGRAM_ADMIN_ID, text: message(results[0]),
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[
        { text: '✅ Одобрить', callback_data: 'dn:a:' + id },
        { text: '❌ Отклонить', callback_data: 'dn:r:' + id }
      ]] }
    });
    await env.DB.prepare('UPDATE submissions SET telegram_message_id=?, telegram_claimed_at=NULL WHERE id=?').bind(result.message_id, id).run();
  } catch {
    await env.DB.prepare('UPDATE submissions SET telegram_claimed_at=NULL WHERE id=? AND telegram_claimed_at=?').bind(id, now).run();
    console.error('Telegram notification failed; awaiting retry');
  }
}
export async function handleUpdate(update, env) {
  const query = update.callback_query;
  if (!query) return;
  const owner = String(env.TELEGRAM_ADMIN_ID || '');
  if (!owner || String(query.from?.id) !== owner || String(query.message?.chat?.id) !== owner || query.message?.chat?.type !== 'private') {
    await telegram(env, 'answerCallbackQuery', { callback_query_id: query.id, text: 'Решение доступно только хранителю.', show_alert: true });
    return;
  }
  const match = String(query.data || '').match(/^dn:([ar]):([a-f0-9-]{36})$/);
  if (!match) { await telegram(env, 'answerCallbackQuery', { callback_query_id: query.id, text: 'Неизвестная кнопка.' }); return; }
  const id = match[2];
  const { results } = await env.DB.prepare('SELECT * FROM submissions WHERE id=?').bind(id).all();
  const entry = results[0];
  if (!entry) { await telegram(env, 'answerCallbackQuery', { callback_query_id: query.id, text: 'Заявка не найдена.' }); return; }
  const status = match[1] === 'a' ? 'approved' : 'rejected';
  const result = await env.DB.prepare("UPDATE submissions SET status=?,reviewed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending'").bind(status, id).run();
  const current = (await env.DB.prepare('SELECT status FROM submissions WHERE id=?').bind(id).all()).results[0].status;
  await telegram(env, 'answerCallbackQuery', { callback_query_id: query.id, text: result.meta.changes ? current === 'approved' ? 'Имя опубликовано в тетради.' : 'Заявка отклонена.' : 'Эта заявка уже рассмотрена.' });
  const text = message(entry, current);
  if (query.message.text !== text || query.message.reply_markup?.inline_keyboard?.length) {
    await telegram(env, 'editMessageText', { chat_id: owner, message_id: query.message.message_id, text, link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: [] } });
  }
}
