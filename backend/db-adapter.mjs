// SQLite adapter for local preview and integration tests. Production uses Cloudflare D1.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function createDatabase(filename = ':memory:') {
  const db = new DatabaseSync(filename);
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  function prepare(sql, values = []) {
    return {
      bind(...args) { return prepare(sql, args); },
      async all() { return { results: db.prepare(sql).all(...values) }; },
      async run() { const result = db.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; }
    };
  }
  return { prepare, async batch(statements) {
    db.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec('COMMIT'); return results; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }, close() { db.close(); } };
}
