// Kleiner statischer Server mit SPA-Fallback für den Web-Export (nur für lokale Tests).
// Aufruf: node e2e/serve.mjs <verzeichnis> <port>
// Bindet nur an 127.0.0.1. Unbekannte Pfade ohne Dateiendung liefern index.html,
// damit Deep Links wie /kunde/rechnungen/<id> direkt geöffnet werden können.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'dist-demo');
const port = Number(process.argv[3] ?? 4173);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

if (!existsSync(join(root, 'index.html'))) {
  console.error(`Kein Export gefunden unter ${root}. Zuerst "pnpm --filter @werkstatt/app export:demo" ausführen.`);
  process.exit(1);
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const safePath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, safePath);
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    const candidate = join(file, 'index.html');
    if (existsSync(candidate)) file = candidate;
    else if (extname(safePath) === '') file = join(root, 'index.html');
    else {
      res.writeHead(404).end('Nicht gefunden');
      return;
    }
  }
  res.writeHead(200, {
    'Content-Type': types[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => {
  console.log(`Demo-Export ${root} unter http://127.0.0.1:${port}/`);
});
