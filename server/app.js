// NASA Lab API gateway (the Express app, shared by the local server in
// server/index.js and the Vercel function in api/index.js).
// Every NASA call goes through here so that
//   1. the api.nasa.gov key never reaches the browser (it is injected here and
//      scrubbed from every response body — NeoWs echoes it in its links),
//   2. endpoints without CORS headers (JPL SSD, EPIC archive, image assets…)
//      become usable from WebGL,
//   3. responses are cached on disk, so the hourly quota lasts and the app
//      keeps working (with stale data) when an upstream service hiccups.
import express from 'express';
import path from 'node:path';
import { cached } from './cache.js';

// Locally the key comes from .env; on Vercel from the project's Environment Variables.
try { process.loadEnvFile(path.resolve(process.cwd(), '.env')); } catch { /* optional */ }

export const KEY = (process.env.NASA_API_KEY || 'DEMO_KEY').trim();
const ON_VERCEL = !!process.env.VERCEL;
const UA = 'NASA-Lab/1.0 (open-source NASA open-data explorer)';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ───────────────────────────── helpers ─────────────────────────────

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const scrub = (text) => (KEY && KEY !== 'DEMO_KEY' ? text.split(KEY).join('REDACTED') : text);

async function upstream(url, { timeout = 25_000, binary = false, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: binary ? '*/*' : 'application/json', ...headers },
    });
    let type = res.headers.get('content-type') || (binary ? 'application/octet-stream' : 'application/json');
    const raw = Buffer.from(await res.arrayBuffer());
    const body = binary ? raw : Buffer.from(scrub(raw.toString('utf8')));
    // EONET labels its JSON as RSS; normalise anything that is plainly JSON.
    if (!binary && !/json/.test(type) && /^\s*[[{]/.test(body.subarray(0, 64).toString('utf8'))) type = 'application/json; charset=utf-8';
    return { status: res.status, type, body };
  } finally {
    clearTimeout(timer);
  }
}

const nasa = (p, params = {}) => {
  const u = new URL('https://api.nasa.gov' + p);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, v);
  u.searchParams.set('api_key', KEY);
  return u.toString();
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s) => typeof s === 'string' && DATE.test(s) && !Number.isNaN(Date.parse(s));
const text = (s, max = 120) => (typeof s === 'string' ? s.trim().slice(0, max) : '');
const int = (s, lo, hi, dflt) => {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const todayUTC = () => new Date().toISOString().slice(0, 10);

function send(req, res, entry, maxAge = 300) {
  if (!entry) throw new HttpError(502, 'Upstream unavailable');
  const ok = entry.status >= 200 && entry.status < 300;
  res.status(ok ? 200 : entry.status);
  res.set('Content-Type', entry.type);
  // s-maxage lets Vercel's CDN (or any shared cache) answer repeat requests, so
  // every visitor shares one upstream call and the API key's quota lasts.
  // A stale fallback copy is only shared briefly so a recovery shows up fast.
  if (!ok) res.set('Cache-Control', 'no-store');
  else if (entry.stale) res.set('Cache-Control', 'public, max-age=60, s-maxage=60');
  else res.set('Cache-Control', `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 4}`);
  if (entry.stale) res.set('X-NASA-Lab-Stale', '1');
  // Vercel compresses responses itself; only the local server gzips by hand.
  if (!ON_VERCEL && entry.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    res.set('Content-Encoding', 'gzip');
    res.set('Vary', 'Accept-Encoding');
    return res.end(entry.gz);
  }
  return res.end(entry.body);
}

const json = (data) => ({ status: 200, type: 'application/json; charset=utf-8', body: Buffer.from(JSON.stringify(data)) });

/** Proxy a JSON-ish upstream URL through the cache. */
const proxy = async (req, res, url, ttl, opts = {}) =>
  send(req, res, await cached(url, ttl, () => upstream(url, opts)), Math.round(Math.min(ttl, HOUR) / 1000));

// ───────────────────────────── app ─────────────────────────────

export const app = express();
app.disable('x-powered-by');
// Behind Vercel's proxy the client address arrives in X-Forwarded-For.
app.set('trust proxy', ON_VERCEL);

// Tiny token bucket per client so an exposed server can't burn the key.
const buckets = new Map();
app.use('/api', (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'local';
  const now = Date.now();
  const b = buckets.get(ip) || { tokens: 240, t: now };
  b.tokens = Math.min(240, b.tokens + ((now - b.t) / 1000) * 4);
  b.t = now;
  if (b.tokens < 1) return res.status(429).json({ error: 'Slow down, space cadet.' });
  b.tokens -= 1;
  buckets.set(ip, b);
  next();
});

const route = (p, handler) =>
  app.get(p, async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      const status = err.status || (err.name === 'AbortError' ? 504 : 502);
      if (status >= 500) console.warn(`[api] ${req.path} → ${status}: ${err.message}`);
      if (!res.headersSent) res.status(status).json({ error: err.message || 'Upstream error' });
    }
  });

route('/api/health', (req, res) => res.json({ ok: true, keyConfigured: KEY !== 'DEMO_KEY', time: new Date().toISOString() }));

// ── APOD ──
route('/api/apod', async (req, res) => {
  const { date, start_date, end_date, count } = req.query;
  if (count !== undefined) {
    const n = int(count, 1, 40, 12);
    // Random picks are not cached for long — the point is novelty.
    const url = nasa('/planetary/apod', { count: n, thumbs: 'true' });
    const id = `apod:count:${n}:${Math.floor(Date.now() / (5 * MIN))}`;
    return send(req, res, await cached(id, 5 * MIN, () => upstream(url)), 60);
  }
  if (start_date || end_date) {
    if (!isDate(start_date) || (end_date && !isDate(end_date))) throw new HttpError(400, 'Invalid date range');
    const span = (Date.parse(end_date || todayUTC()) - Date.parse(start_date)) / DAY;
    if (span < 0 || span > 62) throw new HttpError(400, 'Range must be 0–62 days');
    const live = !end_date || end_date >= todayUTC();
    return proxy(req, res, nasa('/planetary/apod', { start_date, end_date, thumbs: 'true' }), live ? HOUR : 30 * DAY);
  }
  if (date !== undefined && !isDate(date)) throw new HttpError(400, 'Invalid date');
  const live = !date || date >= todayUTC();
  return proxy(req, res, nasa('/planetary/apod', { date, thumbs: 'true' }), live ? HOUR : 30 * DAY);
});

// ── Asteroids NeoWs ──
route('/api/neo/feed', async (req, res) => {
  const start = isDate(req.query.start_date) ? req.query.start_date : todayUTC();
  const endGuess = new Date(Date.parse(start) + 6 * DAY).toISOString().slice(0, 10);
  const end = isDate(req.query.end_date) ? req.query.end_date : endGuess;
  const span = (Date.parse(end) - Date.parse(start)) / DAY;
  if (span < 0 || span > 7) throw new HttpError(400, 'NeoWs feed spans at most 7 days');
  return proxy(req, res, nasa('/neo/rest/v1/feed', { start_date: start, end_date: end }), 3 * HOUR);
});
route('/api/neo/lookup/:id', async (req, res) => {
  if (!/^\d{5,10}$/.test(req.params.id)) throw new HttpError(400, 'Invalid NEO id');
  return proxy(req, res, nasa(`/neo/rest/v1/neo/${req.params.id}`), DAY);
});
route('/api/neo/browse', async (req, res) =>
  proxy(req, res, nasa('/neo/rest/v1/neo/browse', { page: int(req.query.page, 0, 2000, 0), size: 20 }), DAY));

// ── DONKI space weather ──
const DONKI = new Set(['FLR', 'CME', 'CMEAnalysis', 'GST', 'SEP', 'IPS', 'HSS', 'MPC', 'RBE', 'WSAEnlilSimulations', 'notifications']);
route('/api/donki/:type', async (req, res) => {
  const { type } = req.params;
  if (!DONKI.has(type)) throw new HttpError(404, 'Unknown DONKI type');
  const end = isDate(req.query.endDate) ? req.query.endDate : todayUTC();
  const start = isDate(req.query.startDate) ? req.query.startDate : new Date(Date.parse(end) - 30 * DAY).toISOString().slice(0, 10);
  if ((Date.parse(end) - Date.parse(start)) / DAY > 400) throw new HttpError(400, 'Range too large');
  const params = { startDate: start, endDate: end };
  if (type === 'CMEAnalysis') Object.assign(params, { mostAccurateOnly: 'true', speed: '0', halfAngle: '0', catalog: 'ALL' });
  if (type === 'notifications') params.type = 'all';
  return proxy(req, res, nasa(`/DONKI/${type}`, params), 30 * MIN);
});

// ── EONET natural events ──
route('/api/eonet/events', async (req, res) => {
  const u = new URL('https://eonet.gsfc.nasa.gov/api/v3/events');
  u.searchParams.set('status', ['open', 'closed', 'all'].includes(req.query.status) ? req.query.status : 'open');
  u.searchParams.set('limit', String(int(req.query.limit, 1, 1000, 400)));
  if (req.query.days) u.searchParams.set('days', String(int(req.query.days, 1, 3650, 30)));
  if (/^[a-zA-Z]{3,30}$/.test(req.query.category || '')) u.searchParams.set('category', req.query.category);
  return proxy(req, res, u.toString(), 20 * MIN);
});
route('/api/eonet/categories', async (req, res) => proxy(req, res, 'https://eonet.gsfc.nasa.gov/api/v3/categories', DAY));

// ── EPIC ──
const EPIC_COLL = new Set(['natural', 'enhanced']);
route('/api/epic/:coll/:what{/:date}', async (req, res) => {
  const { coll, what, date } = req.params;
  if (!EPIC_COLL.has(coll)) throw new HttpError(404, 'Unknown collection');
  let url;
  if (what === 'latest') url = `https://epic.gsfc.nasa.gov/api/${coll}`;
  else if (what === 'available') url = `https://epic.gsfc.nasa.gov/api/${coll}/available`;
  else if (what === 'date' && isDate(date)) url = `https://epic.gsfc.nasa.gov/api/${coll}/date/${date}`;
  else throw new HttpError(400, 'Use latest, available or date/YYYY-MM-DD');
  return proxy(req, res, url, what === 'date' ? 7 * DAY : HOUR);
});
route('/api/epic-image/:coll/:date/:image', async (req, res) => {
  const { coll, date, image } = req.params;
  const size = req.query.size === 'thumbs' ? 'thumbs' : 'jpg';
  if (!EPIC_COLL.has(coll) || !isDate(date) || !/^epic_[a-z0-9_]+$/i.test(image)) throw new HttpError(400, 'Bad EPIC image');
  const [y, m, d] = date.split('-');
  const url = `https://epic.gsfc.nasa.gov/archive/${coll}/${y}/${m}/${d}/${size}/${image}.jpg`;
  const entry = await cached(url, 365 * DAY, () => upstream(url, { binary: true, timeout: 40_000 }));
  if (!/^image\//.test(entry.type)) throw new HttpError(404, 'Image not found');
  return send(req, res, entry, 30 * 86400);
});

// ── Generic image proxy for WebGL textures (strict host allow-list) ──
const IMG_HOSTS = new Set(['images-assets.nasa.gov', 'apod.nasa.gov', 'epic.gsfc.nasa.gov', 'www.nasa.gov', 'science.nasa.gov', 'mars.nasa.gov']);
route('/api/img', async (req, res) => {
  let u;
  try { u = new URL(String(req.query.u || '')); } catch { throw new HttpError(400, 'Bad URL'); }
  if (u.protocol === 'http:' && IMG_HOSTS.has(u.hostname)) u.protocol = 'https:';
  if (u.protocol !== 'https:' || !IMG_HOSTS.has(u.hostname) || u.username || u.password || u.port) throw new HttpError(403, 'Host not allowed');
  const url = u.toString();
  const entry = await cached(url, 30 * DAY, () => upstream(url, { binary: true, timeout: 40_000 }));
  if (!/^image\//.test(entry.type)) throw new HttpError(415, 'Not an image');
  res.set('Access-Control-Allow-Origin', '*');
  return send(req, res, entry, 30 * 86400);
});

// ── NASA Image & Video Library ──
route('/api/library/search', async (req, res) => {
  const q = text(req.query.q, 100);
  if (!q) throw new HttpError(400, 'Missing q');
  const u = new URL('https://images-api.nasa.gov/search');
  u.searchParams.set('q', q);
  u.searchParams.set('media_type', /^(image|video|audio)(,(image|video|audio))*$/.test(req.query.media_type || '') ? req.query.media_type : 'image,video');
  u.searchParams.set('page', String(int(req.query.page, 1, 100, 1)));
  u.searchParams.set('page_size', '60');
  return proxy(req, res, u.toString(), 6 * HOUR);
});
route('/api/library/asset/:id', async (req, res) => {
  const id = req.params.id;
  // NASA ids may contain spaces, parentheses and punctuation; they are URL-encoded below.
  if (typeof id !== 'string' || !id.length || id.length > 240 || /[\/\\?#\u0000-\u001f]/.test(id)) throw new HttpError(400, 'Bad id');
  return proxy(req, res, `https://images-api.nasa.gov/asset/${encodeURIComponent(id)}`, DAY);
});

// ── Exoplanet Archive (TAP) — returned column-oriented to keep it small ──
const EXO_COLS = ['pl_name', 'hostname', 'ra', 'dec', 'sy_dist', 'pl_rade', 'pl_bmasse', 'pl_orbper', 'pl_orbsmax', 'pl_orbeccen',
  'pl_eqt', 'pl_insol', 'st_teff', 'st_rad', 'st_mass', 'st_spectype', 'disc_year', 'discoverymethod', 'disc_facility', 'sy_pnum', 'sy_snum'];
route('/api/exoplanets', async (req, res) => {
  const id = 'exoplanets:pscomppars:v1';
  const entry = await cached(id, DAY, async () => {
    const q = `select ${EXO_COLS.join(',')} from pscomppars`;
    const url = `https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=${encodeURIComponent(q)}&format=json`;
    const r = await upstream(url, { timeout: ON_VERCEL ? 50_000 : 90_000 });
    if (r.status !== 200) return r;
    const rows = JSON.parse(r.body.toString('utf8'));
    const cols = Object.fromEntries(EXO_COLS.map((c) => [c, rows.map((row) => row[c] ?? null)]));
    return json({ count: rows.length, columns: cols, fetched: new Date().toISOString() });
  });
  return send(req, res, entry, 3600);
});

// ── TLE (satellites) ──
const TLE_BASE = 'https://tle.ivanstanojevic.me/api/tle/';
const compactTle = (m) => [m.satelliteId, m.name, m.line1, m.line2, m.date];
route('/api/tle/featured', async (req, res) => {
  const entry = await cached('tle:featured:v1', 6 * HOUR, async () => {
    const r = await upstream(`${TLE_BASE}?page-size=100&sort=popularity&sort-dir=desc`);
    if (r.status !== 200) return r;
    return json(JSON.parse(r.body).member.map(compactTle));
  });
  return send(req, res, entry, 3600);
});
route('/api/tle/catalog', async (req, res) => {
  const entry = await cached('tle:catalog:v1', 12 * HOUR, async () => {
    // The TLE API slows sharply under parallel load, so fetch a few pages at a
    // time. A serverless function has ~60 s: on Vercel, stop starting batches
    // after a 40 s budget and serve whatever the catalogue holds by then.
    const PAGES = 40;
    const STEP = 3;
    const deadline = ON_VERCEL ? Date.now() + 40_000 : Infinity;
    const out = new Map();
    let failures = 0;
    for (let start = 1; start <= PAGES && Date.now() < deadline - 5_000; start += STEP) {
      const timeout = Math.max(5_000, Math.min(30_000, deadline - Date.now()));
      const batch = [];
      for (let p = start; p < start + STEP && p <= PAGES; p++) {
        batch.push(
          upstream(`${TLE_BASE}?page-size=100&page=${p}&sort=popularity&sort-dir=desc`, { timeout })
            .then((r) => (r.status === 200 ? JSON.parse(r.body).member : Promise.reject(new Error(String(r.status)))))
            .then((members) => members.forEach((m) => out.set(m.satelliteId, compactTle(m))))
            .catch(() => { failures++; }),
        );
      }
      await Promise.all(batch);
    }
    if (out.size === 0) return { status: 502, type: 'application/json', body: Buffer.from('{"error":"TLE service unavailable"}') };
    if (failures) console.warn(`[tle] catalog built with ${failures} failed pages`);
    return json([...out.values()]);
  });
  return send(req, res, entry, 3600);
});
route('/api/tle/search', async (req, res) => {
  const q = text(req.query.q, 60);
  if (!q) throw new HttpError(400, 'Missing q');
  const url = `${TLE_BASE}?search=${encodeURIComponent(q)}&page-size=50`;
  const entry = await cached(url, 6 * HOUR, async () => {
    const r = await upstream(url);
    if (r.status !== 200) return r;
    return json(JSON.parse(r.body).member.map(compactTle));
  });
  return send(req, res, entry, 3600);
});

// ── JPL Solar System Dynamics / CNEOS ──
route('/api/cad', async (req, res) => {
  const days = int(req.query.days, 1, 365, 60);
  const past = int(req.query.past, 0, 365, 0);
  const dist = Math.min(0.2, Math.max(0.001, Number(req.query.dist) || 0.05));
  const u = new URL('https://ssd-api.jpl.nasa.gov/cad.api');
  const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
  u.searchParams.set('date-min', past ? iso(-past) : 'now');
  u.searchParams.set('date-max', iso(days));
  u.searchParams.set('dist-max', String(dist));
  u.searchParams.set('diameter', 'true');
  u.searchParams.set('fullname', 'true');
  u.searchParams.set('sort', 'date');
  return proxy(req, res, u.toString(), 2 * HOUR);
});
route('/api/sbdb', async (req, res) => {
  const des = text(req.query.des, 60);
  if (!des) throw new HttpError(400, 'Missing des');
  return proxy(req, res, `https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=${encodeURIComponent(des)}&phys-par=1&full-prec=1`, 7 * DAY);
});
route('/api/sentry', async (req, res) => proxy(req, res, 'https://ssd-api.jpl.nasa.gov/sentry.api', 6 * HOUR));
route('/api/fireballs', async (req, res) =>
  proxy(req, res, 'https://ssd-api.jpl.nasa.gov/fireball.api?limit=400&req-loc=true', 6 * HOUR));

// ── InSight Mars weather (mission ended 2022; archive feed) ──
route('/api/insight', async (req, res) => proxy(req, res, nasa('/insight_weather/', { feedtype: 'json', ver: '1.0' }), 7 * DAY));

// ── TechTransfer ──
route('/api/techtransfer/:kind', async (req, res) => {
  const { kind } = req.params;
  if (!['patent', 'software', 'spinoff'].includes(kind)) throw new HttpError(404, 'Unknown kind');
  const q = text(req.query.q, 80) || 'space';
  return proxy(req, res, `https://technology.nasa.gov/api/api/${kind}/${encodeURIComponent(q)}`, DAY);
});

// ── TechPort ──
// TechPort's search endpoint ignores its query, so the UI shows a live feed of
// the projects NASA teams updated most recently, with full details.
const stripHtml = (h) => (typeof h === 'string'
  ? h.replace(/<\/(p|li)>/g, ' ').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
  : '');
const trimProject = (p) => ({
  projectId: p.projectId,
  title: p.title,
  status: p.status,
  start: p.startDateString || p.startDate || '',
  end: p.endDateString || p.endDate || '',
  lastUpdated: p.lastUpdated || '',
  trlBegin: p.trlBegin ?? null, trlCurrent: p.trlCurrent ?? null, trlEnd: p.trlEnd ?? null,
  program: p.program?.title || '',
  tx: p.primaryTx?.title || '',
  lead: p.leadOrganization?.organizationName || '',
  leadCity: [p.leadOrganization?.city, p.leadOrganization?.stateTerritory?.abbreviation].filter(Boolean).join(', '),
  destinations: [].concat(p.destinationType || []).map((d) => (typeof d === 'string' ? d : d?.description || d?.title || '')).filter(Boolean),
  description: stripHtml(p.description).slice(0, 1200),
  benefits: stripHtml(p.benefits).slice(0, 600),
});
route('/api/techport/recent', async (req, res) => {
  const entry = await cached('techport:recent:v1', 12 * HOUR, async () => {
    const since = new Date(Date.now() - 45 * DAY).toISOString().slice(0, 10);
    const list = await upstream(`https://techport.nasa.gov/api/projects?updatedSince=${since}`, { timeout: ON_VERCEL ? 20_000 : 45_000 });
    if (list.status !== 200) return list;
    const ids = (JSON.parse(list.body).projects || [])
      .sort((a, b) => Date.parse(b.lastUpdated) - Date.parse(a.lastUpdated))
      .slice(0, ON_VERCEL ? 12 : 16)
      .map((p) => p.projectId);
    const projects = [];
    const step = ON_VERCEL ? 6 : 4;
    for (let i = 0; i < ids.length; i += step) {
      const chunk = await Promise.all(ids.slice(i, i + step).map((id) =>
        upstream(`https://techport.nasa.gov/api/projects/${id}`, { timeout: ON_VERCEL ? 15_000 : 45_000 })
          .then((r) => (r.status === 200 ? trimProject(JSON.parse(r.body).project) : null))
          .catch(() => null)));
      projects.push(...chunk.filter(Boolean));
    }
    if (!projects.length) return { status: 502, type: 'application/json', body: Buffer.from('{"error":"TechPort unavailable"}') };
    return json({ since, projects });
  });
  return send(req, res, entry, 3600);
});
route('/api/techport/project/:id', async (req, res) => {
  if (!/^\d{1,8}$/.test(req.params.id)) throw new HttpError(400, 'Bad id');
  const url = `https://techport.nasa.gov/api/projects/${req.params.id}`;
  const entry = await cached(url, DAY, async () => {
    const r = await upstream(url, { timeout: 45_000 });
    return r.status === 200 ? json(trimProject(JSON.parse(r.body).project)) : r;
  });
  return send(req, res, entry, 3600);
});

// ── Open Science Data Repository ──
route('/api/osdr/search', async (req, res) => {
  const term = text(req.query.q, 80) || 'space';
  const u = new URL('https://osdr.nasa.gov/osdr/data/search');
  u.searchParams.set('term', term);
  u.searchParams.set('size', '24');
  u.searchParams.set('type', 'cgene');
  return proxy(req, res, u.toString(), DAY);
});

// ── Satellite Situation Center (positions of magnetospheric missions) ──
const SSC_SATS = ['iss', 'mms1', 'themisa', 'themisd', 'themise', 'arase', 'cluster1', 'geotail', 'twins1'];
route('/api/ssc/locations', async (req, res) => {
  const end = new Date(Math.floor(Date.now() / HOUR) * HOUR);
  const start = new Date(end.getTime() - 12 * HOUR);
  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const url = `https://sscweb.gsfc.nasa.gov/WS/sscr/2/locations/${SSC_SATS.join(',')}/${fmt(start)},${fmt(end)}/geo/`;
  return proxy(req, res, url, HOUR, { timeout: 20_000 });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'No such endpoint' }));
