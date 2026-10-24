// Read-only inventory used to verify that unrelated resources did not change.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const config = readFileSync(join(homedir(), 'AppData/Roaming/xdg.config/.wrangler/config/default.toml'), 'utf8');
const token = config.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!token) throw new Error('Wrangler credential unavailable');
const account = '58c9d75325c0f993be3900185a3305e1';
async function get(path) {
  const response = await fetch('https://api.cloudflare.com/client/v4/accounts/' + account + path, { headers: { Authorization: 'Bearer ' + token } });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error('Cloudflare inventory request failed');
  return result.result;
}
const workers = (await get('/workers/scripts')).map(({ id, modified_on, etag }) => ({ id, modified_on, etag }));
const databases = (await get('/d1/database')).map(({ uuid, name, created_at }) => ({ uuid, name, created_at }));
const snapshot = { workers, databases };
mkdirSync(new URL('./.local/', import.meta.url), { recursive: true });
if (process.argv[2] === 'before') {
  writeFileSync(new URL('./.local/before.json', import.meta.url), JSON.stringify(snapshot, null, 2));
  console.log(JSON.stringify(snapshot, null, 2));
} else {
  const before = JSON.parse(readFileSync(new URL('./.local/before.json', import.meta.url), 'utf8'));
  const changed = before.workers.filter(old => JSON.stringify(workers.find(w => w.id === old.id)) !== JSON.stringify(old));
  const removed = before.databases.filter(old => !databases.some(db => db.uuid === old.uuid));
  console.log(JSON.stringify({ unchangedExistingWorkers: !changed.length, changedWorkers: changed.map(w => w.id), removedDatabases: removed.map(db => db.name), newWorkers: workers.filter(w => !before.workers.some(old => old.id === w.id)).map(w => w.id), newDatabases: databases.filter(db => !before.databases.some(old => old.uuid === db.uuid)).map(db => db.name) }, null, 2));
  if (changed.length || removed.length) process.exitCode = 1;
}
