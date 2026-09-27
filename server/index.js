// Local / self-hosted entry: the gateway plus (in production) the built client.
// On Vercel, api/index.js serves the same app and the CDN serves dist/.
import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { app, KEY } from './app.js';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const PROD = process.env.NODE_ENV === 'production';

// ── Static client (production) ──
const dist = path.resolve(process.cwd(), 'dist');
if (PROD && existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '7d', index: false }));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, HOST, () => {
  console.log(`\n  🛰  NASA Lab gateway on http://${HOST}:${PORT}  (key: ${KEY === 'DEMO_KEY' ? 'DEMO_KEY — set NASA_API_KEY in .env' : 'configured'})`);
  if (PROD) console.log(`  🌌 Serving app at http://${HOST}:${PORT}\n`);
  // Warm the slow, heavy feeds so the first visit doesn't wait on them.
  const local = `http://127.0.0.1:${PORT}`;
  setTimeout(() => {
    for (const p of ['/api/tle/featured', '/api/tle/catalog', '/api/exoplanets', '/api/eonet/events?limit=1000', '/api/techport/recent', '/api/cad?days=60&dist=0.05']) {
      fetch(local + p).then((r) => r.arrayBuffer()).catch(() => {});
    }
  }, 400);
});
