// Small shared helpers. Everything that reaches innerHTML goes through esc().

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Strip markup from upstream HTML fragments, decode common entities, then escape. */
export function plain(html) {
  const txt = String(html ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
  return txt;
}

/** Only allow http(s) links out; anything else becomes '#'. */
export function safeUrl(u) {
  try {
    const url = new URL(String(u), location.href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '#';
  } catch {
    return '#';
  }
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
export const n0 = (v) => (Number.isFinite(+v) ? nf0.format(+v) : '—');
export const n1 = (v) => (Number.isFinite(+v) ? nf1.format(+v) : '—');
export const n2 = (v) => (Number.isFinite(+v) ? nf2.format(+v) : '—');
/** Round to d significant figures, formatted without exponents. */
export const sig = (v, d = 3) => {
  if (!Number.isFinite(+v)) return '—';
  const r = Number(Number(+v).toPrecision(d));
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: Math.max(0, d - 1 - Math.floor(Math.log10(Math.abs(r) || 1))) }).format(r);
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

/** "27 Sep 2026 06:30 UTC" */
export function fmtUTC(ms, { seconds = false, time = true } = {}) {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (!time) return date;
  return `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${seconds ? ':' + pad(d.getUTCSeconds()) : ''} UTC`;
}
export const fmtDate = (ms) => fmtUTC(ms, { time: false });
export const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Parse DONKI-style "2026-09-01T21:04Z" and friends as UTC. */
export function parseUTC(s) {
  if (!s) return NaN;
  let t = String(s).trim().replace(' ', 'T');
  if (/T\d{2}:\d{2}Z$/.test(t)) t = t.replace('Z', ':00Z');
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(t)) t += /T/.test(t) ? 'Z' : 'T00:00:00Z';
  return Date.parse(t);
}

/** "3 h ago", "in 2 d" */
export function relTime(ms, now = Date.now()) {
  const d = ms - now;
  const a = Math.abs(d);
  const units = [[86400000 * 365, 'yr'], [86400000, 'd'], [3600000, 'h'], [60000, 'min']];
  for (const [u, l] of units) {
    if (a >= u) {
      const v = Math.round(a / u);
      return d < 0 ? `${v} ${l} ago` : `in ${v} ${l}`;
    }
  }
  return 'now';
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Estimated asteroid diameter range (m) from absolute magnitude, albedo 0.05–0.25. */
export function diameterFromH(H) {
  const d = (p) => (1329 / Math.sqrt(p)) * Math.pow(10, -0.2 * H) * 1000;
  return [d(0.25), d(0.05)];
}

export function download(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}
