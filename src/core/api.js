// Client for the NASA Lab gateway. Every call is attributed to one of the
// api.nasa.gov catalogue entries so the Sources board can report live health.

export const SOURCES = [
  { id: 'apod', name: 'APOD', full: 'Astronomy Picture of the Day', probe: '/api/apod', where: 'Archive → Picture of the Day' },
  { id: 'neows', name: 'Asteroids NeoWs', full: 'Near Earth Object Web Service', probe: '/api/neo/feed', where: 'Asteroids' },
  { id: 'donki', name: 'DONKI', full: 'Space Weather Database of Notifications, Knowledge, Information', probe: '/api/donki/FLR', where: 'Sun · Earth aurora' },
  { id: 'eonet', name: 'EONET', full: 'Earth Observatory Natural Event Tracker', probe: '/api/eonet/events?limit=1000', where: 'Earth' },
  { id: 'epic', name: 'EPIC', full: 'Earth Polychromatic Imaging Camera (DSCOVR)', probe: '/api/epic/natural/latest', where: 'Earth → View from L1' },
  { id: 'exoplanet', name: 'Exoplanet Archive', full: 'NASA Exoplanet Archive (TAP)', probe: '/api/exoplanets', where: 'Exoplanets' },
  { id: 'gibs', name: 'GIBS', full: 'Global Imagery Browse Services', probe: null, where: 'Earth surface & science layers' },
  { id: 'insight', name: 'InSight', full: 'Mars Weather Service (archive)', probe: '/api/insight', where: 'Mars' },
  { id: 'library', name: 'Image & Video Library', full: 'images.nasa.gov', probe: '/api/library/search?q=apollo', where: 'Archive → Library' },
  { id: 'osdr', name: 'OSDR', full: 'Open Science Data Repository', probe: '/api/osdr/search?q=space', where: 'Archive → Space biology' },
  { id: 'ssc', name: 'Satellite Situation Center', full: 'SSCWeb spacecraft locations', probe: '/api/ssc/locations', where: 'Sources (status only)' },
  { id: 'ssd', name: 'SSD / CNEOS', full: 'JPL Solar System Dynamics: CAD, SBDB, Sentry, Fireball', probe: '/api/cad?days=60&dist=0.05', where: 'Asteroids · Earth fireballs' },
  { id: 'techport', name: 'TechPort', full: 'NASA technology projects', probe: '/api/techport/recent', where: 'Archive → Technology' },
  { id: 'techtransfer', name: 'TechTransfer', full: 'Patents, software and spinoffs', probe: '/api/techtransfer/patent?q=space', where: 'Archive → Technology' },
  { id: 'tle', name: 'TLE API', full: 'Two-line element sets for Earth-orbiting objects', probe: '/api/tle/featured', where: 'Earth satellites' },
  { id: 'trek', name: 'Moon / Mars / Vesta Trek', full: 'Trek WMTS imagery', probe: null, where: 'Moon · Mars · Vesta' },
];

const status = new Map(SOURCES.map((s) => [s.id, { state: 'idle', ms: null, at: null, note: '' }]));
const listeners = new Set();
const memo = new Map();

export const sourceStatus = () => SOURCES.map((s) => ({ ...s, ...status.get(s.id) }));
export const onStatus = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export function mark(id, state, extra = {}) {
  const prev = status.get(id);
  if (!prev) return;
  // A later success should not be downgraded by a single failure of another call.
  if (state === 'bad' && prev.state === 'ok' && !extra.force) return;
  status.set(id, { ...prev, state, at: Date.now(), ...extra });
  listeners.forEach((fn) => fn());
}

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

/**
 * GET JSON from the gateway.
 * @param {string} path  e.g. '/api/eonet/events?limit=1000'
 * @param {string} source  catalogue id for health reporting
 */
export async function api(path, source, { cache = true, timeout = 60000 } = {}) {
  if (cache && memo.has(path)) return memo.get(path);
  const job = (async () => {
    const t0 = performance.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(path, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      const stale = res.headers.get('X-NASA-Lab-Stale') === '1';
      let body;
      try { body = await res.json(); } catch { body = null; }
      if (!res.ok) {
        const msg = body?.error || body?.message || body?.msg || `HTTP ${res.status}`;
        throw new ApiError(msg, res.status);
      }
      if (source) mark(source, stale ? 'warn' : 'ok', { ms: Math.round(performance.now() - t0), note: stale ? 'serving cached copy' : '' });
      return body;
    } catch (err) {
      const msg = err.name === 'AbortError' ? 'timed out' : err.message;
      if (source) mark(source, 'bad', { note: msg });
      memo.delete(path);
      throw err.name === 'AbortError' ? new ApiError('The service took too long to answer', 504) : err;
    } finally {
      clearTimeout(timer);
    }
  })();
  if (cache) memo.set(path, job);
  return job;
}

/** Load an image, reporting to a source. Resolves to HTMLImageElement. */
export function loadImage(url, source, { crossOrigin = 'anonymous', timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.decoding = 'async';
    const timer = setTimeout(() => { img.src = ''; if (source) mark(source, 'bad', { note: 'timed out' }); reject(new ApiError('Image timed out', 504)); }, timeout);
    img.onload = () => { clearTimeout(timer); if (source) mark(source, 'ok'); resolve(img); };
    img.onerror = () => { clearTimeout(timer); if (source) mark(source, 'bad', { note: 'image failed' }); reject(new ApiError('Image failed to load', 502)); };
    img.src = url;
  });
}

/** Proxy a NASA-hosted image through the gateway so WebGL may sample it. */
export const proxied = (url) => `/api/img?u=${encodeURIComponent(url)}`;
