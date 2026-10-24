const PAGE_SIZE = 6;

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
  const title = { pending: '☠ Новая заявка в Тетрадь смерти', approved: '✅ Вписан в тетрадь', rejected: '❌ Заявка отклонена', deleted: '🗑 Удалён из тетради' }[status];
  return `${title}\n\nНик: ${entry.nickname}\nКлан: ${entry.clan || '—'}\nПричина почему пидорас: ${entry.reason}`;
}

function siteUrl(env) {
  return env.SITE_URL || 'https://pussyboys.team/death-note.html';
}

function siteButton(env) {
  return { text: '☠ Открыть Тетрадь смерти', web_app: { url: siteUrl(env) } };
}

async function sendHome(env, chatId, admin) {
  const keyboard = admin ? [
    [{ text: '📨 Новые заявки', callback_data: 'dn:p:0' }, { text: '📖 Записи', callback_data: 'dn:e:0' }],
    [siteButton(env)]
  ] : [[siteButton(env)]];
  const text = admin
    ? '☠ Панель хранителя\n\nЗдесь можно принять или отклонить заявку, удалить опубликованную запись и открыть тетрадь.'
    : '☠ Тетрадь смерти Pussy Boys Team\n\nОткрой тетрадь внутри Telegram, чтобы посмотреть записи или подать заявку.';
  await telegram(env, 'sendMessage', { chat_id: chatId, text, reply_markup: { inline_keyboard: keyboard } });
}

function pageKeyboard(kind, rows, page, hasNext) {
  const keyboard = rows.flatMap(entry => kind === 'p' ? [[
    { text: `✅ ${entry.nickname}`.slice(0, 40), callback_data: 'dn:a:' + entry.id },
    { text: '❌ Отклонить', callback_data: 'dn:r:' + entry.id }
  ]] : [[{ text: `🗑 ${entry.nickname}`.slice(0, 40), callback_data: 'dn:x:' + entry.id }]]);
  const nav = [];
  if (page > 0) nav.push({ text: '← Назад', callback_data: `dn:${kind}:${page - 1}` });
  if (hasNext) nav.push({ text: 'Дальше →', callback_data: `dn:${kind}:${page + 1}` });
  if (nav.length) keyboard.push(nav);
  keyboard.push([{ text: '↻ Обновить', callback_data: `dn:${kind}:${page}` }, { text: '⌂ Меню', callback_data: 'dn:h' }]);
  return { inline_keyboard: keyboard };
}

async function renderPage(env, query, kind, requestedPage = 0) {
  const page = Math.max(0, Math.min(100, Number(requestedPage) || 0));
  const offset = page * PAGE_SIZE;
  const pending = kind === 'p';
  const sql = pending
    ? "SELECT id,nickname,clan,reason FROM submissions WHERE status='pending' ORDER BY created_at ASC LIMIT ? OFFSET ?"
    : "SELECT id,nickname,clan,reason FROM submissions WHERE status='approved' AND deleted_at IS NULL ORDER BY reviewed_at DESC,id DESC LIMIT ? OFFSET ?";
  const { results } = await env.DB.prepare(sql).bind(PAGE_SIZE + 1, offset).all();
  const rows = results.slice(0, PAGE_SIZE);
  const title = pending ? '📨 Новые заявки' : '📖 Записи в тетради';
  const details = rows.length ? rows.map((entry, index) => `${offset + index + 1}. ${entry.nickname} · ${entry.clan || '—'}\n${entry.reason}`).join('\n\n') : pending ? 'Новых заявок нет.' : 'В тетради пока нет записей.';
  await telegram(env, 'editMessageText', {
    chat_id: query.message.chat.id, message_id: query.message.message_id,
    text: `${title}\n\n${details}`,
    link_preview_options: { is_disabled: true },
    reply_markup: pageKeyboard(kind, rows, page, results.length > PAGE_SIZE)
  });
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
  const owner = String(env.TELEGRAM_ADMIN_ID || '');
  const incoming = update.message;
  if (incoming?.chat?.type === 'private' && incoming.from?.id === incoming.chat.id) {
    await sendHome(env, incoming.chat.id, Boolean(owner) && String(incoming.from.id) === owner);
    return;
  }

  const query = update.callback_query;
  if (!query) return;
  if (!owner || String(query.from?.id) !== owner || String(query.message?.chat?.id) !== owner || query.message?.chat?.type !== 'private') {
    await telegram(env, 'answerCallbackQuery', { callback_query_id: query.id, text: 'Управление доступно только хранителю.', show_alert: true });
    return;
  }

  const menu = String(query.data || '').match(/^dn:([pe]):(\d+)$/);
  if (menu) {
    await telegram(env, 'answerCallbackQuery', { callback_query_id: query.id });
    await renderPage(env, query, menu[1], menu[2]);
    return;
  }
  if (query.data === 'dn:h') {
    await telegram(env, 'answerCallbackQuery', { callback_query_id: query.id });
    await telegram(env, 'editMessageText', {
      chat_id: owner, message_id: query.message.message_id,
      text: '☠ Панель хранителя\n\nВыбери действие.',
      reply_markup: { inline_keyboard: [
        [{ text: '📨 Новые заявки', callback_data: 'dn:p:0' }, { text: '📖 Записи', callback_data: 'dn:e:0' }],
        [siteButton(env)]
      ] }
    });
    return;
  }

  const match = String(query.data || '').match(/^dn:([ardx]):([a-f0-9-]{36})$/);
  if (!match) { await telegram(env, 'answerCallbackQuery', { callback_query_id: query.id, text: 'Неизвестная кнопка.' }); return; }
  const id = match[2];
  const { results } = await env.DB.prepare('SELECT * FROM submissions WHERE id=?').bind(id).all();
  const entry = results[0];
  if (!entry) { await telegram(env, 'answerCallbackQuery', { callback_query_id: query.id, text: 'Запись не найдена.' }); return; }

  if (match[1] === 'x') {
    await telegram(env, 'answerCallbackQuery', { callback_query_id: query.id });
    await telegram(env, 'editMessageText', {
      chat_id: owner, message_id: query.message.message_id,
      text: `Удалить ${entry.nickname} из тетради?\n\nКлан: ${entry.clan || '—'}\nПричина почему пидорас: ${entry.reason}`,
      reply_markup: { inline_keyboard: [[
        { text: '🗑 Да, удалить', callback_data: 'dn:d:' + id },
        { text: 'Отмена', callback_data: 'dn:e:0' }
      ]] }
    });
    return;
  }

  if (match[1] === 'd') {
    const result = await env.DB.prepare("UPDATE submissions SET deleted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='approved' AND deleted_at IS NULL").bind(id).run();
    await telegram(env, 'answerCallbackQuery', { callback_query_id: query.id, text: result.meta.changes ? 'Запись удалена из тетради.' : 'Запись уже удалена.' });
    await renderPage(env, query, 'e', 0);
    return;
  }

  const status = match[1] === 'a' ? 'approved' : 'rejected';
  const result = await env.DB.prepare("UPDATE submissions SET status=?,reviewed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending'").bind(status, id).run();
  const current = (await env.DB.prepare('SELECT status FROM submissions WHERE id=?').bind(id).all()).results[0].status;
  await telegram(env, 'answerCallbackQuery', { callback_query_id: query.id, text: result.meta.changes ? current === 'approved' ? 'Имя опубликовано в тетради.' : 'Заявка отклонена.' : 'Эта заявка уже рассмотрена.' });
  const text = message(entry, current);
  if (query.message.text !== text || query.message.reply_markup?.inline_keyboard?.length) {
    await telegram(env, 'editMessageText', { chat_id: owner, message_id: query.message.message_id, text, link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: [] } });
  }
}
