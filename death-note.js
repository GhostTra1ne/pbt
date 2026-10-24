'use strict';
const api = (window.DEATH_NOTE_API || '').replace(/\/$/, '');
const $ = (id) => document.getElementById(id);
let entries = [];
let adminKey = '';
async function request(path, options = {}, admin = false) {
  if (!api) throw new Error('Приём заявок ещё не подключён. Хранитель настраивает тетрадь.');
  const response = await fetch(api + path, { ...options, headers: {
    'Content-Type': 'application/json', ...(admin ? { Authorization: 'Bearer ' + adminKey } : {})
  }, signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Не удалось выполнить запрос. Попробуй позже.');
  return result;
}
function node(tag, value, className) {
  const el = document.createElement(tag);
  el.textContent = value;
  if (className) el.className = className;
  return el;
}
function renderEntries() {
  const search = $('search').value.trim().toLocaleLowerCase('ru');
  const filtered = entries.filter(e => [e.nickname, e.clan, e.server].join(' ').toLocaleLowerCase('ru').includes(search));
  $('entries').replaceChildren();
  const count = entries.length;
  const word = count % 10 === 1 && count % 100 !== 11 ? 'ЗАПИСЬ' : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? 'ЗАПИСИ' : 'ЗАПИСЕЙ';
  $('entry-count').textContent = `${count} ${word}`;
  $('list-status').textContent = filtered.length ? '' : search ? 'Имя не найдено.' : 'В тетради пока нет имён. Первую страницу откроет хранитель.';
  $('list-status').hidden = filtered.length > 0;
  filtered.forEach((entry, i) => {
    const article = node('article', '', 'entry');
    const heading = node('div', '', 'entry-head');
    heading.append(node('h3', entry.nickname), node('span', String(i + 1).padStart(2, '0'), 'entry-index'));
    article.append(heading, node('div', [entry.server, entry.clan || 'Без клана'].join(' / '), 'meta'), node('p', entry.reason));
    $('entries').append(article);
  });
}
async function loadEntries() {
  if (!api) {
    $('list-status').textContent = 'Тетрадь готовится к открытию. Приём заявок пока не подключён.';
    return;
  }
  try { entries = await request('/entries'); renderEntries(); }
  catch (error) { $('list-status').hidden = false; $('list-status').textContent = error.message; }
}
for (const [button, dialog] of [['open-request', 'request-dialog'], ['open-admin', 'admin-dialog']]) {
  $(button).addEventListener('click', () => $(dialog).showModal());
}
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.querySelector('.close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  } });
});
$('search').addEventListener('input', () => { if (api) renderEntries(); });
$('request-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true; $('request-status').textContent = 'Передаём хранителю…';
  try {
    await request('/submissions', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    form.reset(); $('request-status').textContent = 'Заявка принята. Имя появится после одобрения хранителем.';
  } catch (error) { $('request-status').textContent = error.message; }
  finally { button.disabled = false; }
});
async function loadPending() {
  const keyAtRequest = adminKey;
  const pending = await request('/admin/submissions', {}, true);
  if (!adminKey || adminKey !== keyAtRequest) return;
  $('pending').replaceChildren();
  $('admin-status').textContent = pending.length ? `Ожидают решения: ${pending.length}` : 'Все заявки рассмотрены.';
  $('login-form').hidden = true; $('logout').hidden = false;
  pending.forEach(entry => {
    const article = node('article', '', 'pending-entry');
    article.append(node('h3', entry.nickname), node('p', `${entry.server} / ${entry.clan || 'Без клана'}`), node('p', entry.reason), node('p', `Автор: ${entry.reporter}`));
    if (entry.evidence && /^https?:\/\//i.test(entry.evidence)) {
      const link = node('a', 'Открыть доказательства ↗');
      link.href = entry.evidence; link.target = '_blank'; link.rel = 'noopener noreferrer'; article.append(link);
    }
    const actions = node('div', '', 'actions');
    for (const [action, label] of [['approve', 'Вписать в тетрадь'], ['reject', 'Отклонить']]) {
      const button = node('button', label);
      button.addEventListener('click', async () => {
        actions.querySelectorAll('button').forEach(b => b.disabled = true);
        try {
          await request(`/admin/submissions/${entry.id}/${action}`, { method: 'POST', body: '{}' }, true);
          await loadPending(); await loadEntries();
        } catch (error) { $('admin-status').textContent = error.message; actions.querySelectorAll('button').forEach(b => b.disabled = false); }
      });
      actions.append(button);
    }
    article.append(actions); $('pending').append(article);
  });
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  adminKey = new FormData(form).get('key');
  const button = form.querySelector('button'); button.disabled = true;
  try { await loadPending(); form.reset(); }
  catch (error) { adminKey = ''; $('admin-status').textContent = error.message; }
  finally { button.disabled = false; }
});
function logout() { adminKey = ''; $('pending').replaceChildren(); $('admin-status').textContent = ''; $('login-form').hidden = false; $('logout').hidden = true; $('login-form').reset(); }
$('logout').addEventListener('click', logout);
$('admin-dialog').addEventListener('close', logout);
loadEntries();
