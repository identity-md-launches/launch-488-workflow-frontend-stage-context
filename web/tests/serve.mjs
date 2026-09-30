// Serve the production export below a gateway-style subpath, without route rewrites.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (!pathname.startsWith('/site/')) { res.writeHead(404).end(); return; }
  const path = resolve(root, decodeURIComponent(pathname.slice(6)) || 'index.html');
  if (!path.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  try {
    const file = (await stat(path)).isDirectory() ? resolve(path, 'index.html') : path;
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
}).listen(43187, '127.0.0.1');
