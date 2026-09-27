// The persistent interface: brand plate readouts, detail panel, tooltip,
// toast, the destination rail, the time bar and the iris transition.
import { clock, RATES } from '../core/clock.js';
import { $, esc, fmtUTC, clamp, prefersReducedMotion } from '../core/util.js';

const readoutsEl = $('#readouts');
const titleEl = $('#scene-title');
const panelEl = $('#panel');
const panelBody = $('#panel-body');
const tooltipEl = $('#tooltip');
const toastEl = $('#toast');
const irisEl = $('#iris');

// ── Readouts & panel ─────────────────────────────────────────────────────

export function setTitle(t) {
  titleEl.textContent = t;
  document.title = `${t} — NASA Lab`;
}

/** rows: [label, value, { loading }] — values are escaped here. */
export function setReadouts(rows) {
  readoutsEl.innerHTML = rows
    .map(([k, v, o = {}]) => `<dt>${esc(k)}</dt><dd class="${o.loading ? 'is-loading' : ''}">${esc(v)}</dd>`)
    .join('');
}

export function setPanel(html) {
  panelBody.innerHTML = html;
  panelBody.scrollTop = 0;
  return panelBody;
}
export const panel = panelBody;

const grip = $('#panel-grip');
grip.addEventListener('click', () => {
  const collapsed = panelEl.classList.toggle('is-collapsed');
  document.body.classList.toggle('panel-collapsed', collapsed);
  grip.setAttribute('aria-expanded', String(!collapsed));
  grip.setAttribute('aria-label', collapsed ? 'Expand details' : 'Collapse details');
});
export function expandPanel() {
  if (!panelEl.classList.contains('is-collapsed')) return;
  panelEl.classList.remove('is-collapsed');
  document.body.classList.remove('panel-collapsed');
  grip.setAttribute('aria-expanded', 'true');
}

// ── Tooltip & toast ──────────────────────────────────────────────────────

export function showTooltip(x, y, title, sub = '') {
  tooltipEl.innerHTML = `<strong>${esc(title)}</strong>${sub ? `<span>${esc(sub)}</span>` : ''}`;
  tooltipEl.hidden = false;
  const w = tooltipEl.offsetWidth, h = tooltipEl.offsetHeight;
  const px = clamp(x + 16, 8, window.innerWidth - w - 8);
  const py = y + h + 24 > window.innerHeight ? y - h - 14 : y + 18;
  tooltipEl.style.transform = `translate(${px}px, ${py}px)`;
}
export const hideTooltip = () => { tooltipEl.hidden = true; };

let toastTimer;
export function toast(msg, ms = 3200) {
  toastEl.textContent = msg;
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), ms);
}

// ── Iris ─────────────────────────────────────────────────────────────────

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export async function irisClose() {
  if (prefersReducedMotion()) { irisEl.classList.add('is-closed'); return; }
  irisEl.classList.add('is-closed');
  await wait(560);
}
export async function irisOpen() {
  irisEl.classList.remove('is-closed');
  await wait(prefersReducedMotion() ? 0 : 560);
}

// ── Destination rail ─────────────────────────────────────────────────────
// Each destination carries a hairline track whose red dot sits at the real,
// log-scaled distance from Earth (10^5 km at the left, 10^14 km ≈ 10 ly at
// the right), re-measured from live data by scenes/distances.js.

const railEl = $('#pulsar');
const KM_MIN = 1e5, KM_MAX = 1e14;
const ARROW = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 7.2h7.3L7.7 4.6l1.1-1.1L13.3 8l-4.5 4.5-1.1-1.1 2.6-2.6H3z"/></svg>';
const trackPos = (km) => (km ? ((Math.log10(clamp(km, KM_MIN, KM_MAX)) - 5) / 9) * 100 : 0);

let destinations = [];
let onNavigate = () => {};
let activeId = 'earth';

export function initPulsar(list, navigate) {
  destinations = list;
  onNavigate = navigate;
  railEl.innerHTML = `
    <div class="dest__head"><span class="label-mono">Destinations</span><span class="label-mono" style="letter-spacing:.16em">from Earth</span></div>
    <ul class="dest__list">${list.map((d) => `
      <li><button class="dest__item" type="button" data-id="${d.id}" aria-current="${d.id === activeId ? 'page' : 'false'}">
        <span class="dest__key" aria-hidden="true">${esc(d.key)}</span>
        <span class="dest__name">${esc(d.name)}</span>
        <span class="dest__meta"><span data-dist>${esc(d.id === 'earth' ? 'you are here' : d.distText || '')}</span><span class="arrow">${ARROW}</span></span>
        <span class="dest__track" aria-hidden="true"><i style="left:${trackPos(d.km).toFixed(1)}%"></i></span>
      </button></li>`).join('')}
    </ul>
    <div class="dest__foot" aria-hidden="true"><span>100,000 KM</span><span>LOG SCALE</span><span>10 LY</span></div>`;
  railEl.querySelectorAll('.dest__item').forEach((b) => b.addEventListener('click', () => onNavigate(b.dataset.id)));
  updateLabels();
}

function updateLabels() {
  railEl.querySelectorAll('.dest__item').forEach((b) => {
    const d = destinations.find((x) => x.id === b.dataset.id);
    const dist = d.id === 'earth' ? 'you are here' : d.distText || '';
    b.setAttribute('aria-label', `${d.name}${dist ? `, ${dist}` : ''}${d.id === 'earth' ? '' : ' from Earth'} (key ${d.key})`);
  });
}

export function setDestinationDistance(id, km, text) {
  const d = destinations.find((x) => x.id === id);
  if (!d) return;
  d.km = km;
  d.distText = text;
  const b = railEl.querySelector(`.dest__item[data-id="${id}"]`);
  if (!b) return;
  b.querySelector('[data-dist]').textContent = text;
  b.querySelector('.dest__track i').style.left = `${trackPos(km).toFixed(1)}%`;
  updateLabels();
}

export function setActiveDestination(id) {
  activeId = id;
  railEl.querySelectorAll('.dest__item').forEach((b) => b.setAttribute('aria-current', b.dataset.id === id ? 'page' : 'false'));
  // On phones the rail is a horizontal strip: bring the active chip into view.
  const list = railEl.querySelector('.dest__list');
  const cur = railEl.querySelector('[aria-current="page"]');
  if (list && cur && list.scrollWidth > list.clientWidth) list.scrollTo({ left: cur.parentElement.offsetLeft - 12, behavior: 'smooth' });
}

// ── Time bar ─────────────────────────────────────────────────────────────

const timebar = $('#timebar');
const dateOut = $('#time-date');
const rateOut = $('#time-rate');
const ratesEl = $('#time-rates');
const scaleEl = $('#time-scale');
const scaleSvg = scaleEl.querySelector('svg');
const playBtn = $('#time-play');

let range = [-2, 2];
let marks = [];
let lastDraw = 0;

ratesEl.innerHTML = RATES.map((r) => `<button type="button" role="radio" aria-checked="false" data-rate="${r.v}" title="${esc(r.long)}">${esc(r.label)}</button>`).join('');
ratesEl.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-rate]');
  if (b) clock.setRate(Number(b.dataset.rate));
});
playBtn.addEventListener('click', () => clock.toggle());
$('#time-now').addEventListener('click', () => clock.now());

function syncControls() {
  timebar.classList.toggle('is-paused', !clock.playing);
  playBtn.setAttribute('aria-label', clock.playing ? 'Pause time (Space)' : 'Play time (Space)');
  ratesEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.rate) === clock.rate)));
  const r = RATES.find((x) => x.v === clock.rate);
  rateOut.textContent = !clock.playing ? 'paused' : clock.isLive ? 'live · real time' : r ? r.long : `${clock.rate}×`;
}
clock.on(syncControls);
syncControls();

/** days relative to now, e.g. [-30, 2]; marks: [{ t, label, strength }] */
export function setTimeRange(r, m = []) {
  range = r;
  marks = m;
  drawScale(true);
}

function drawScale(force) {
  const now = performance.now();
  if (!force && now - lastDraw < 120) return;
  lastDraw = now;
  const w = scaleEl.clientWidth, h = scaleEl.clientHeight;
  if (!w) return;
  scaleSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const t0 = Date.now() + range[0] * 86400000, t1 = Date.now() + range[1] * 86400000;
  const x = (t) => ((t - t0) / (t1 - t0)) * w;
  const base = h - 11;
  const out = [`<line x1="0" y1="${base}" x2="${w}" y2="${base}" stroke="var(--ink)" stroke-width="1"/>`];
  const days = range[1] - range[0];
  const step = days > 120 ? 30 : days > 45 ? 7 : days > 10 ? 1 : 0.25;
  const startDay = Math.ceil((t0 - Date.UTC(1970, 0, 1)) / 86400000 / step) * step;
  for (let d = startDay; d * 86400000 <= t1; d += step) {
    const t = d * 86400000;
    const isDay = Math.abs(d - Math.round(d)) < 1e-6;
    const date = new Date(t);
    const major = step >= 1 ? date.getUTCDate() === 1 || (step === 1 && date.getUTCDay() === 1) : isDay;
    const xx = x(t);
    out.push(`<line x1="${xx.toFixed(1)}" y1="${base}" x2="${xx.toFixed(1)}" y2="${base + (major ? 7 : 4)}" stroke="var(--ink)" stroke-width="1" opacity="${major ? 0.9 : 0.5}"/>`);
  }
  for (const m of marks) {
    if (m.t < t0 || m.t > t1) continue;
    const xx = x(m.t);
    const hh = 4 + (m.strength ?? 0.5) * 12;
    out.push(`<line x1="${xx.toFixed(1)}" y1="${base - 3}" x2="${xx.toFixed(1)}" y2="${(base - 3 - hh).toFixed(1)}" stroke="var(--ink)" stroke-width="1.2" opacity=".75"><title>${esc(m.label || '')}</title></line>`);
  }
  const xn = x(Date.now());
  out.push(`<g><line x1="${xn}" y1="2" x2="${xn}" y2="${base + 8}" stroke="var(--red-bright)" stroke-width="1.5"/>
    <text x="${xn + 5}" y="9" font-size="8.5" font-family="var(--f-data)" fill="var(--red-bright)" letter-spacing=".2em">NOW</text></g>`);
  const xs = clamp(x(clock.sim), 0, w);
  out.push(`<circle cx="${xs.toFixed(1)}" cy="${base}" r="6" fill="var(--white)"/>`);
  out.push(`<text x="0" y="${h}" font-size="8.5" font-family="var(--f-data)" fill="var(--ink-3)">${esc(fmtUTC(t0, { time: false }))}</text>`);
  out.push(`<text x="${w}" y="${h}" text-anchor="end" font-size="8.5" font-family="var(--f-data)" fill="var(--ink-3)">${esc(fmtUTC(t1, { time: false }))}</text>`);
  scaleSvg.innerHTML = out.join('');
}

// Scrub by dragging along the time scale.
let scrubbing = false;
function scrubTo(e) {
  const r = scaleEl.getBoundingClientRect();
  const f = clamp((e.clientX - r.left) / r.width, 0, 1);
  const t0 = Date.now() + range[0] * 86400000, t1 = Date.now() + range[1] * 86400000;
  clock.set(t0 + f * (t1 - t0));
  drawScale(true);
}
scaleEl.addEventListener('pointerdown', (e) => { scrubbing = true; scaleEl.setPointerCapture(e.pointerId); scrubTo(e); });
scaleEl.addEventListener('pointermove', (e) => { if (scrubbing) scrubTo(e); });
scaleEl.addEventListener('pointerup', () => { scrubbing = false; });
scaleEl.style.cursor = 'ew-resize';
scaleEl.setAttribute('title', 'Drag to travel through time');

export function tickTimebar() {
  dateOut.textContent = fmtUTC(clock.sim, { seconds: clock.rate <= 60 });
  drawScale(false);
}
window.addEventListener('resize', () => drawScale(true));
