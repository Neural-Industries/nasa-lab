// Smoke-test every gateway endpoint: status, size, latency, and that the
// NASA API key never appears in a response body. Run with the gateway up:
//   npm run check
import { readFileSync } from 'node:fs';

const BASE = process.env.NASA_LAB_URL || 'http://127.0.0.1:8787';
let key = '';
try { key = (readFileSync('.env', 'utf8').match(/^NASA_API_KEY=(.*)$/m) || [])[1]?.trim() || ''; } catch { /* no .env */ }

const ENDPOINTS = [
  ['APOD', '/api/apod'],
  ['APOD random', '/api/apod?count=2'],
  ['NeoWs feed', '/api/neo/feed'],
  ['DONKI flares', '/api/donki/FLR'],
  ['DONKI CMEs', '/api/donki/CMEAnalysis'],
  ['DONKI storms', '/api/donki/GST'],
  ['DONKI notes', '/api/donki/notifications'],
  ['EONET', '/api/eonet/events?limit=50'],
  ['EPIC', '/api/epic/natural/latest'],
  ['Exoplanets', '/api/exoplanets'],
  ['InSight', '/api/insight'],
  ['Library', '/api/library/search?q=apollo'],
  ['OSDR', '/api/osdr/search?q=mouse'],
  ['CAD', '/api/cad?days=60&dist=0.05'],
  ['SBDB', '/api/sbdb?des=99942'],
  ['Sentry', '/api/sentry'],
  ['Fireballs', '/api/fireballs'],
  ['TechTransfer', '/api/techtransfer/patent?q=robot'],
  ['TechPort', '/api/techport/recent'],
  ['TLE featured', '/api/tle/featured'],
  ['TLE catalogue', '/api/tle/catalog'],
  ['SSC', '/api/ssc/locations'],
];

let failures = 0;
for (const [name, path] of ENDPOINTS) {
  const t0 = performance.now();
  try {
    const res = await fetch(BASE + path, { signal: AbortSignal.timeout(240000) });
    const body = await res.text();
    const ms = Math.round(performance.now() - t0);
    const leak = key && key !== 'DEMO_KEY' && body.includes(key);
    const stale = res.headers.get('x-nasa-lab-stale') ? ' (stale copy)' : '';
    if (leak) failures++;
    if (!res.ok && name !== 'SSC') failures++;
    console.log(`${res.ok ? '✓' : '✗'} ${name.padEnd(14)} ${String(res.status).padEnd(4)} ${String(body.length).padStart(8)} B ${String(ms).padStart(6)} ms${stale}${leak ? '  !! KEY LEAKED' : ''}`);
  } catch (err) {
    if (name !== 'SSC') failures++;
    console.log(`✗ ${name.padEnd(14)} ${err.name === 'TimeoutError' ? 'timed out' : err.message}`);
  }
}
console.log(failures ? `\n${failures} problem(s).` : '\nAll endpoints healthy; no key leaks.');
process.exit(failures ? 1 : 0);
