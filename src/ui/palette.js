// Search everything: places, actions, and every object any visited scene
// knows about — satellites, storms, flares, asteroids, landing sites, planets.
import { $, esc } from '../core/util.js';

let root, input, list, items = [], results = [], sel = 0, lastFocus;

function collect(ctx) {
  const out = [];
  ctx.destinations.forEach((d) => out.push({ kind: 'Go to', title: d.name, meta: `key ${d.key}`, scene: null, run: () => ctx.go(d.id) }));
  out.push(
    { kind: 'Action', title: 'Begin the tour', meta: 'T', run: () => ctx.startTour() },
    { kind: 'Action', title: 'Astronomy Picture of the Day', meta: 'Archive', run: () => ctx.openArchive('apod') },
    { kind: 'Action', title: 'Search the Image & Video Library', meta: 'Archive', run: () => ctx.openArchive('library') },
    { kind: 'Action', title: 'NASA patents, software & spinoffs', meta: 'Archive', run: () => ctx.openArchive('tech') },
    { kind: 'Action', title: 'Space biology experiments', meta: 'Archive', run: () => ctx.openArchive('bio') },
    { kind: 'Action', title: 'Data sources & health', meta: 'Archive', run: () => ctx.openArchive('sources') },
    { kind: 'Action', title: 'Return to the present moment', meta: 'N', run: () => ctx.clock.now() },
  );
  for (const [id, inst] of ctx.instances) {
    try {
      for (const it of inst.searchItems?.() || []) out.push({ ...it, scene: id });
    } catch { /* a scene still loading */ }
  }
  return out;
}

function score(it, terms) {
  const hay = `${it.title} ${it.meta || ''} ${it.kind}`.toLowerCase();
  let s = 0;
  for (const t of terms) {
    const i = hay.indexOf(t);
    if (i < 0) return -1;
    s += i === 0 ? 30 : it.title.toLowerCase().startsWith(t) ? 25 : hay[i - 1] === ' ' ? 12 : 4;
  }
  if (it.kind === 'Go to') s += 8;
  if (it.kind === 'Action') s += 4;
  return s - it.title.length * 0.02;
}

function filter() {
  const q = input.value.trim().toLowerCase();
  if (!q) results = items.filter((it) => it.kind === 'Go to' || it.kind === 'Action');
  else {
    const terms = q.split(/\s+/);
    results = items.map((it) => [score(it, terms), it]).filter(([s]) => s >= 0).sort((a, b) => b[0] - a[0]).slice(0, 60).map(([, it]) => it);
  }
  sel = 0;
  render();
}

function render() {
  if (!results.length) {
    list.innerHTML = `<li class="palette__empty">Nothing matches yet. Visit a place first to add its objects (satellites on Earth, flares on the Sun, 6,000 exoplanets…).</li>`;
    return;
  }
  list.innerHTML = results.map((it, i) => `<li role="option" aria-selected="${i === sel}"><button type="button" data-i="${i}" aria-selected="${i === sel}" tabindex="-1"><span class="k">${esc(it.kind)}</span><span class="t">${esc(it.title)}</span><span class="m">${esc(it.meta || '')}</span></button></li>`).join('');
  list.querySelector('[aria-selected="true"] button, button[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  input.setAttribute('aria-activedescendant', '');
}

async function run(it, ctx) {
  close();
  if (!it) return;
  if (it.scene && ctx.active?.id !== it.scene) {
    await ctx.go(it.scene);
    await new Promise((r) => setTimeout(r, 400));
  }
  it.run();
}

function close() {
  root.hidden = true;
  root.innerHTML = '';
  lastFocus?.focus?.();
}

export function openPalette(ctx) {
  root = $('#palette');
  if (!root.hidden) return;
  lastFocus = document.activeElement;
  root.innerHTML = `
    <div class="plate palette">
      <label class="field"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>
        <span class="vh">Search places, objects and actions</span>
        <input type="search" placeholder="Search satellites, storms, asteroids, exoplanets, places…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="palette-list"/></label>
      <ul class="palette__results" id="palette-list" role="listbox" aria-label="Results"></ul>
    </div>`;
  root.hidden = false;
  input = root.querySelector('input');
  list = root.querySelector('ul');
  items = collect(ctx);
  filter();
  input.focus();
  input.addEventListener('input', filter);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(results[sel], ctx); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  list.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) run(results[Number(b.dataset.i)], ctx); });
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
}
