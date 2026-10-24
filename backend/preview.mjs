import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import worker from './worker.mjs';
import { createDatabase } from './db-adapter.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const env = { DB: createDatabase(), ADMIN_KEY: 'preview-only-key-do-not-use-in-production', ALLOWED_ORIGINS: 'http://localhost:8788,http://127.0.0.1:8788' };
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg' };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost:8788');
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 12000) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
      const request = new Request('http://localhost' + url.pathname.slice(4), { method: req.method, headers: req.headers, ...(size ? { body: Buffer.concat(chunks) } : {}) });
      const response = await worker.fetch(request, env, { waitUntil(promise) { promise.catch(() => {}); } });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
    }
    if (url.pathname === '/death-note-config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end("window.DEATH_NOTE_API = location.origin + '/api';"); return; }
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(root, '.' + relative);
    if (!file.startsWith(root) || relative.includes('/.') || relative.startsWith('/backend/')) { res.writeHead(403); res.end(); return; }
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(8788, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:8788/death-note.html\nTemporary local archive; no production notifications.'));
