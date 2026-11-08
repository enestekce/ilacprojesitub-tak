import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon' };

createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const requested = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (requested !== root && !requested.startsWith(root + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (!(await stat(requested)).isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(requested).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(await readFile(requested));
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(4173, '127.0.0.1', () => console.log('İlaç Rehberi önizleme: http://localhost:4173 (kapatmak için Ctrl+C)'));

