// NASA Lab — orchestrates the engine, scenes, interface and data.
import * as THREE from 'three';
import { createEngine } from './core/engine.js';
import { clock } from './core/clock.js';
import { sound } from './core/audio.js';
import { $, prefersReducedMotion } from './core/util.js';
import * as ui from './ui/shell.js';
import { runBoot } from './ui/boot.js';

const canvas = $('#stage');

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

if (!webglAvailable()) {
  $('#boot').innerHTML = `<div class="boot__inner"><p class="boot__mark">NASA Lab</p><p class="boot__sub">This browser can't start WebGL, which NASA Lab needs to draw NASA's data in 3-D. Try a current version of Chrome, Edge, Firefox or Safari with hardware acceleration switched on.</p></div>`;
  throw new Error('WebGL unavailable');
}

const engine = createEngine(canvas);

// ── Scene registry ───────────────────────────────────────────────────────
// km is the live distance from Earth, re-measured by scenes/distances.js for the destination rail.
const DESTINATIONS = [
  { id: 'earth', name: 'Earth', key: '1', load: () => import('./scenes/earth.js'), km: 0 },
  { id: 'moon', name: 'Moon', key: '2', load: () => import('./scenes/worlds.js'), km: 384400, distText: '384,400 km' },
  { id: 'sun', name: 'Sun', key: '3', load: () => import('./scenes/sun.js'), km: 1.496e8, distText: '1.0 AU' },
  { id: 'asteroids', name: 'Asteroids', key: '4', load: () => import('./scenes/orrery.js'), km: 1.2e6, distText: '—' },
  { id: 'mars', name: 'Mars', key: '5', load: () => import('./scenes/worlds.js'), km: 2.5e8, distText: '' },
  { id: 'vesta', name: 'Vesta', key: '6', load: () => import('./scenes/worlds.js'), km: 3.5e8, distText: '' },
  { id: 'exoplanets', name: 'Exoplanets', key: '7', load: () => import('./scenes/exoplanets.js'), km: 4.01e13, distText: '4.2 ly' },
];

const instances = new Map();
let active = null;
let activeId = null;
let navigating = false;

const ctx = {
  engine,
  THREE,
  clock,
  sound,
  ui,
  get active() { return active; },
  go: (id, opts) => navigate(id, opts),
  destinations: DESTINATIONS,
  instances,
  getScene,
};

async function getScene(id) {
  if (instances.has(id)) return instances.get(id);
  const dest = DESTINATIONS.find((d) => d.id === id);
  if (!dest) throw new Error(`Unknown destination ${id}`);
  const mod = await dest.load();
  const inst = mod.create(ctx, id);
  const ready = inst.init();
  instances.set(id, inst);
  inst.ready = ready;
  return inst;
}

async function navigate(id, opts = {}) {
  if (!DESTINATIONS.some((d) => d.id === id)) id = 'earth';
  if (navigating) return;
  if (id === activeId) { active?.focus?.(opts); return; }
  navigating = true;
  ui.hideTooltip();
  sound.sweep();
  const first = !active;
  try {
    if (!first) await ui.irisClose();
    active?.exit?.();
    engine.cancelFlight();
    const inst = await getScene(id);
    active = inst;
    activeId = id;
    ui.setActiveDestination(id);
    const dest = DESTINATIONS.find((d) => d.id === id);
    ui.setTitle(inst.title || dest.name);
    ui.setTimeRange(inst.timeRange || [-2, 2], []);
    engine.controls.autoRotate = false;
    engine.sky.rotation.set(0, 0, 0);
    inst.enter(opts);
    history.replaceState(null, '', `#/${id}${opts.deep ? '/' + encodeURIComponent(opts.deep) : ''}`);
    refreshReadouts();
    if (!first) await ui.irisOpen();
  } catch (err) {
    console.error(err);
    ui.toast(`Couldn't open ${id}: ${err.message}`);
    await ui.irisOpen();
  } finally {
    navigating = false;
  }
}

ui.initPulsar(DESTINATIONS, (id) => navigate(id));

// ── Readouts (1 Hz) ──────────────────────────────────────────────────────
function refreshReadouts() {
  if (!active?.readouts) return;
  try { ui.setReadouts(active.readouts()); } catch (e) { console.warn(e); }
}
setInterval(refreshReadouts, 1000);

// ── Picking ──────────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerPx = null;
let pointerDirty = false;
let hovered = null;
let downAt = null;

canvas.addEventListener('pointermove', (e) => {
  pointerPx = { x: e.clientX, y: e.clientY };
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  pointerDirty = true;
});
canvas.addEventListener('pointerleave', () => { pointerPx = null; hovered = null; ui.hideTooltip(); canvas.classList.remove('is-pointing'); });
canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 6) return;
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  const hit = pick();
  if (hit && active?.click) { active.click(hit); ui.expandPanel(); }
  else active?.clickEmpty?.();
});

function pick() {
  if (!active?.pickables) return null;
  const objs = active.pickables();
  if (!objs.length) return null;
  raycaster.setFromCamera(pointer, engine.camera);
  active.configureRaycaster?.(raycaster);
  const hits = raycaster.intersectObjects(objs, false);
  return active.filterHits ? active.filterHits(hits) : hits[0] || null;
}

function updateHover() {
  if (!pointerDirty || !pointerPx || engine.flying) return;
  pointerDirty = false;
  const hit = pick();
  const info = hit && active?.hover ? active.hover(hit) : null;
  if (info) {
    ui.showTooltip(pointerPx.x, pointerPx.y, info.title, info.sub);
    canvas.classList.add('is-pointing');
  } else {
    ui.hideTooltip();
    canvas.classList.remove('is-pointing');
  }
  hovered = info;
}

// ── Frame loop ───────────────────────────────────────────────────────────
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  clock.tick(dt);
  if (active) {
    active.update?.(dt, clock.sim);
    engine.frame(dt, active.scene);
  }
  updateHover();
  ui.tickTimebar();
  requestAnimationFrame(frame);
}

// ── Frame inset: keep the subject centred in the unobstructed area ──────
function applyInset() {
  const w = window.innerWidth, h = window.innerHeight;
  const cam = engine.camera;
  if (w <= 860) {
    const panelH = document.body.classList.contains('panel-collapsed') ? 44 : h * 0.36;
    cam.setViewOffset(w, h, 0, Math.round(panelH * 0.42), w, h);
  } else {
    const panelW = document.getElementById('panel').offsetWidth + 16;
    cam.setViewOffset(w, h, Math.round(panelW * 0.42), 0, w, h);
  }
  cam.updateProjectionMatrix();
}
window.addEventListener('resize', applyInset);
new MutationObserver(applyInset).observe(document.body, { attributes: true, attributeFilter: ['class'] });
engine.applyInset = applyInset;

// ── Keyboard ─────────────────────────────────────────────────────────────
const typing = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
window.addEventListener('keydown', async (e) => {
  if (e.defaultPrevented) return;
  const sheetOpen = !$('#archive').hidden || !$('#palette').hidden || !$('#help').hidden;
  if (e.key === 'Escape') {
    if (sheetOpen) return; // sheets handle their own Escape
    const tour = await import('./ui/tour.js');
    if (tour.isRunning()) { tour.stop(); return; }
    active?.clickEmpty?.();
    return;
  }
  if (typing(e.target) || sheetOpen || e.metaKey || e.ctrlKey || e.altKey) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    return;
  }
  const dest = DESTINATIONS.find((d) => d.key === e.key);
  if (dest) { navigate(dest.id); return; }
  switch (e.key) {
    case ' ': e.preventDefault(); clock.toggle(); break;
    case 'n': case 'N': clock.now(); break;
    case '/': e.preventDefault(); openPalette(); break;
    case 's': case 'S': toggleSound(); break;
    case 'a': case 'A': openArchive('apod'); break;
    case 't': case 'T': startTour(); break;
    case 'p': case 'P': snap(); break;
    case 'f': case 'F': toggleFullscreen(); break;
    case '?': openHelp(); break;
    case 'r': case 'R': engine.controls.autoRotate = !engine.controls.autoRotate; ui.toast(engine.controls.autoRotate ? 'Auto-rotate on' : 'Auto-rotate off', 1400); break;
    default: break;
  }
});

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => ui.toast('Full screen is not available here'));
  else document.exitFullscreen?.();
}

// ── Brand-plate tools ────────────────────────────────────────────────────
const soundBtn = $('#btn-sound');
async function toggleSound() {
  if (sound.enabled) { sound.disable(); soundBtn.setAttribute('aria-pressed', 'false'); ui.toast('Sound off', 1400); }
  else {
    try {
      await sound.enable();
      soundBtn.setAttribute('aria-pressed', 'true');
      active?.mood?.();
      ui.toast('Sound on: a drone for each place, and data you can hear', 2600);
    } catch { ui.toast('This browser blocked audio'); }
  }
}
soundBtn.addEventListener('click', toggleSound);

async function openArchive(tab, opts) { (await import('./ui/archive.js')).openArchive(ctx, typeof tab === 'string' ? tab : undefined, opts); }
async function openPalette() { (await import('./ui/palette.js')).openPalette(ctx); }
async function openHelp() { (await import('./ui/help.js')).openHelp(ctx); }
async function startTour() { (await import('./ui/tour.js')).start(ctx); }
async function snap() { (await import('./ui/postcard.js')).postcard(ctx); }
ctx.openArchive = openArchive;
ctx.startTour = startTour;

$('#btn-archive').addEventListener('click', () => openArchive('apod'));
$('#btn-search').addEventListener('click', openPalette);
$('#btn-help').addEventListener('click', openHelp);
$('#btn-tour').addEventListener('click', startTour);
$('#btn-snap').addEventListener('click', snap);

// ── Boot ─────────────────────────────────────────────────────────────────
function parseHash() {
  const [, id, deep] = location.hash.match(/^#\/([a-z]+)(?:\/(.+))?/) || [];
  return { id: DESTINATIONS.some((d) => d.id === id) ? id : 'earth', deep: deep ? decodeURIComponent(deep) : undefined };
}

(async function boot() {
  applyInset();
  requestAnimationFrame((t) => { last = t; frame(t); });
  const { id, deep } = parseHash();
  await runBoot(async (log) => {
    ctx.log = log;
    const inst = await getScene(id);
    await inst.ready;
    await navigate(id, { deep });
    // Warm the next likely destinations quietly once the first scene is up.
    if (id !== 'earth') getScene('earth').catch(() => {});
  });
  ctx.log = () => {};
  window.addEventListener('hashchange', () => {
    const h = parseHash();
    if (h.id !== activeId) navigate(h.id, { deep: h.deep });
  });
  if (!prefersReducedMotion() && activeId === 'earth') engine.controls.autoRotate = false;
  import('./scenes/distances.js').then((m) => m.liveDistances(ctx)).catch((e) => console.warn('distances', e));
})();

export { ctx };
