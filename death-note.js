'use strict';
const telegramWebApp = window.Telegram?.WebApp;
if (telegramWebApp) { telegramWebApp.ready(); telegramWebApp.expand(); }
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
function entryCell(label, value, className) {
  const cell = node('div', '', `entry-cell ${className}`);
  cell.append(node('span', label, 'entry-label'), node('span', value, 'entry-value'));
  return cell;
}
function clanCell(clan) {
  const name = clan || 'Без клана';
  const cell = node('div', '', 'entry-cell entry-clan');
  cell.append(node('span', 'Клан', 'entry-label'));
  if (name !== 'Без клана') {
    const crest = document.createElement('img');
    crest.className = 'entry-clan-crest';
    crest.src = `assets/clans/${encodeURIComponent(name)}.png`;
    crest.alt = '';
    crest.width = 32;
    crest.height = 24;
    crest.loading = 'lazy';
    crest.addEventListener('error', () => { crest.hidden = true; cell.classList.add('no-crest'); });
    cell.append(crest);
  } else {
    cell.classList.add('no-crest');
  }
  cell.append(node('span', name, 'entry-clan-name'));
  return cell;
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
  filtered.forEach(entry => {
    const article = node('article', '', 'entry');
    article.append(
      clanCell(entry.clan),
      entryCell('Ник', entry.nickname, 'entry-nick'),
      entryCell('Причина почему пидорас', entry.reason, 'entry-reason')
    );
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
const clanSelect = $('clan-select');
const clanCrest = $('clan-crest');
function updateClanCrest() {
  const clan = clanSelect.value;
  if (!clan || clan === 'Без клана') { clanCrest.removeAttribute('src'); return; }
  clanCrest.src = `assets/clans/${encodeURIComponent(clan)}.png`;
}
clanSelect.addEventListener('change', updateClanCrest);
$('request-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true; $('request-status').textContent = 'Передаём хранителю…';
  try {
    await request('/submissions', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    form.reset(); updateClanCrest(); $('request-status').textContent = 'Заявка принята. Имя появится после одобрения хранителем.';
  } catch (error) { $('request-status').textContent = error.message; }
  finally { button.disabled = false; }
});
function adminEntry(entry, className) {
  const article = node('article', '', className);
  article.append(node('h3', `Ник: ${entry.nickname}`), node('p', `Клан: ${entry.clan || 'Без клана'}`), node('p', `Причина почему пидорас: ${entry.reason}`));
  return article;
}
async function loadAdmin() {
  const keyAtRequest = adminKey;
  const [pending, published] = await Promise.all([request('/admin/submissions', {}, true), request('/admin/entries', {}, true)]);
  if (!adminKey || adminKey !== keyAtRequest) return;
  $('pending').replaceChildren(); $('published').replaceChildren();
  $('pending-section').hidden = false; $('published-section').hidden = false;
  $('pending-count').textContent = pending.length;
  $('published-count').textContent = published.length;
  $('admin-status').textContent = `Новых заявок: ${pending.length}. В тетради: ${published.length}.`;
  $('login-form').hidden = true; $('logout').hidden = false;
  if (!pending.length) $('pending').append(node('p', 'Все заявки рассмотрены.', 'admin-empty'));
  pending.forEach(entry => {
    const article = adminEntry(entry, 'pending-entry');
    const actions = node('div', '', 'actions');
    for (const [action, label] of [['approve', 'Вписать в тетрадь'], ['reject', 'Отклонить']]) {
      const button = node('button', label);
      if (action === 'reject') button.className = 'secondary-button';
      button.addEventListener('click', async () => {
        actions.querySelectorAll('button').forEach(b => b.disabled = true);
        try {
          await request(`/admin/submissions/${entry.id}/${action}`, { method: 'POST', body: '{}' }, true);
          await loadAdmin(); await loadEntries();
        } catch (error) { $('admin-status').textContent = error.message; actions.querySelectorAll('button').forEach(b => b.disabled = false); }
      });
      actions.append(button);
    }
    article.append(actions); $('pending').append(article);
  });
  if (!published.length) $('published').append(node('p', 'В тетради пока нет записей.', 'admin-empty'));
  published.forEach(entry => {
    const article = adminEntry(entry, 'published-entry');
    const actions = node('div', '', 'actions');
    const button = node('button', 'Удалить из тетради', 'danger-button');
    button.addEventListener('click', async () => {
      if (!window.confirm(`Удалить ${entry.nickname} из тетради?`)) return;
      button.disabled = true;
      try {
        await request(`/admin/entries/${entry.id}/remove`, { method: 'POST', body: '{}' }, true);
        await loadAdmin(); await loadEntries();
      } catch (error) { $('admin-status').textContent = error.message; button.disabled = false; }
    });
    actions.append(button); article.append(actions); $('published').append(article);
  });
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  adminKey = new FormData(form).get('key');
  const button = form.querySelector('button'); button.disabled = true;
  try { await loadAdmin(); form.reset(); }
  catch (error) { adminKey = ''; $('admin-status').textContent = error.message; }
  finally { button.disabled = false; }
});
function logout() { adminKey = ''; $('pending').replaceChildren(); $('published').replaceChildren(); $('pending-section').hidden = true; $('published-section').hidden = true; $('admin-status').textContent = ''; $('login-form').hidden = false; $('logout').hidden = true; $('login-form').reset(); }
$('logout').addEventListener('click', logout);
$('admin-dialog').addEventListener('close', logout);
loadEntries();
