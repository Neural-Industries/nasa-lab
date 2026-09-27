// THE ARCHIVE — APOD's thirty years, the NASA Image and Video Library,
// TechTransfer & TechPort, space biology from OSDR, and a live health board
// for every catalogue source.
import { api, sourceStatus, onStatus, SOURCES } from '../core/api.js';
import { speak, stopSpeaking, canSpeak, canListen, listen } from '../core/audio.js';
import { $, esc, plain, safeUrl, fmtDate, isoDay, n0, relTime, debounce } from '../core/util.js';

const TABS = [
  { id: 'apod', label: 'Picture of the Day' },
  { id: 'library', label: 'Image & Video Library' },
  { id: 'tech', label: 'Technology' },
  { id: 'bio', label: 'Space biology' },
  { id: 'sources', label: 'Sources' },
];
const APOD_FIRST = '1995-06-16';

let root, body, lastFocus, offStatus;
let current = 'apod';
const memo = { apod: null, library: { q: '', type: 'image,video', page: 1 }, tech: { kind: 'patent', q: '' }, bio: { q: '' } };

export function openArchive(ctx, tab = 'apod', opts = {}) {
  root = $('#archive');
  if (root.hidden) lastFocus = document.activeElement;
  root.innerHTML = `
    <div class="plate sheet__plate">
      <div class="sheet__head">
        <h2 id="archive-title">Archive</h2>
        <div class="sheet__tabs" role="tablist" aria-label="Archive sections">
          ${TABS.map((t) => `<button type="button" role="tab" id="tab-${t.id}" data-tab="${t.id}" aria-controls="archive-body" aria-selected="false">${esc(t.label)}</button>`).join('')}
        </div>
        <button class="icon-btn sheet__close" type="button" aria-label="Close archive (Esc)"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </div>
      <div class="sheet__body" id="archive-body" role="tabpanel" tabindex="-1"></div>
    </div>`;
  root.hidden = false;
  body = root.querySelector('#archive-body');
  root.querySelector('.sheet__close').addEventListener('click', close);
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  root.onkeydown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    if (e.key === 'Tab') trapFocus(e);
  };
  if (tab === 'library' && opts.q) { memo.library.q = opts.q; memo.library.page = 1; }
  show(tab, opts);
  root.querySelector(`[data-tab="${tab}"]`)?.focus();
}

function trapFocus(e) {
  const f = [...root.querySelectorAll('button, a[href], input, select, textarea, iframe, video, audio, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && el.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function close() {
  stopSpeaking();
  offStatus?.();
  root.hidden = true;
  root.innerHTML = '';
  lastFocus?.focus?.();
}

function show(tab, opts = {}) {
  current = tab;
  offStatus?.();
  root.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  body.setAttribute('aria-labelledby', `tab-${tab}`);
  body.scrollTop = 0;
  ({ apod: showApod, library: showLibrary, tech: showTech, bio: showBio, sources: showSources })[tab](opts);
}

const loading = (n = 3) => Array.from({ length: n }, (_, i) => `<div class="skeleton ${i % 2 ? 'w60' : 'w80'}"></div>`).join('');
const failure = (msg) => `<p class="err">${esc(msg)}</p>`;

// ── APOD ─────────────────────────────────────────────────────────────────

async function showApod() {
  const today = isoDay(Date.now());
  body.innerHTML = `
    <div class="toolbar">
      <label class="field" style="flex:0 1 230px"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="1"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/></svg>
        <span class="vh">Date</span><input type="date" id="apod-date" min="${APOD_FIRST}" max="${today}" value="${esc(memo.apod?.date || today)}"/></label>
      <button class="etch-btn etch-btn--small" type="button" id="apod-today">Today</button>
      <button class="etch-btn etch-btn--small" type="button" id="apod-random">Surprise me</button>
      <span style="flex:1"></span>
      <span class="src" style="margin:0">Try your birthday: the archive starts on 16 June 1995.</span>
    </div>
    <div id="apod-view">${loading(4)}</div>
    <h3 style="margin-top:34px">Twelve from thirty years</h3>
    <div class="grid" id="apod-grid">${loading(2)}</div>`;
  const dateEl = body.querySelector('#apod-date');
  dateEl.addEventListener('change', () => { if (dateEl.value >= APOD_FIRST && dateEl.value <= today) loadApod(dateEl.value); });
  body.querySelector('#apod-today').addEventListener('click', () => { dateEl.value = today; loadApod(today); });
  body.querySelector('#apod-random').addEventListener('click', () => {
    const start = Date.parse(APOD_FIRST), end = Date.now() - 86400000;
    const d = isoDay(start + Math.random() * (end - start));
    dateEl.value = d;
    loadApod(d);
  });
  loadApod(memo.apod?.date || today);
  loadApodGrid();
}

async function loadApod(date) {
  const view = body.querySelector('#apod-view');
  if (!view) return;
  view.innerHTML = loading(4);
  try {
    const a = await api(`/api/apod?date=${date}`, 'apod');
    memo.apod = a;
    renderApod(a, view);
  } catch (err) {
    // Today's picture is sometimes posted late in the US day.
    if (date === isoDay(Date.now())) {
      try { const y = await api(`/api/apod?date=${isoDay(Date.now() - 86400000)}`, 'apod'); memo.apod = y; renderApod(y, view, 'Today\'s picture isn\'t posted yet, so here is yesterday\'s.'); return; } catch { /* fall through */ }
    }
    view.innerHTML = failure(`APOD didn't return a picture for ${fmtDate(Date.parse(date))}: ${err.message}.`);
  }
}

function apodMedia(a) {
  if (a.media_type === 'image') return `<a href="${esc(safeUrl(a.hdurl || a.url))}" target="_blank" rel="noopener" title="Open full resolution"><img src="${esc(safeUrl(a.url))}" alt="${esc(a.title)}"/></a>`;
  if (a.media_type === 'video') {
    const u = safeUrl(a.url);
    if (/youtube\.com\/embed|player\.vimeo\.com/.test(u)) return `<iframe src="${esc(u)}" title="${esc(a.title)}" allow="fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe>`;
    if (/\.(mp4|webm|mov)(\?|$)/i.test(u)) return `<video src="${esc(u)}" controls playsinline preload="metadata"></video>`;
    return `<p style="color:var(--white);padding:40px">This day's entry is a video. <a href="${esc(u)}" target="_blank" rel="noopener">Watch it at the source ↗</a></p>`;
  }
  return `<p style="color:var(--white);padding:40px">This day's entry is interactive. <a href="https://apod.nasa.gov/apod/ap${esc(a.date.slice(2).replace(/-/g, ''))}.html" target="_blank" rel="noopener">Open it on APOD ↗</a></p>`;
}

function renderApod(a, view, note = '') {
  view.innerHTML = `
    <div class="viewer">
      <div class="viewer__media">${apodMedia(a)}</div>
      <div>
        ${note ? `<p class="note" style="margin-top:0">${esc(note)}</p>` : ''}
        <h2>${esc(a.title)}</h2>
        <p class="meta">${esc(fmtDate(Date.parse(a.date)))}${a.copyright ? ` · © ${esc(plain(a.copyright))}` : ' · public domain'}</p>
        <p class="body">${esc(a.explanation)}</p>
        <div class="row-actions">
          ${canSpeak ? '<button class="etch-btn etch-btn--small" type="button" id="apod-read">Read it to me</button>' : ''}
          <a class="etch-btn etch-btn--small" href="https://apod.nasa.gov/apod/ap${esc(a.date.slice(2).replace(/-/g, ''))}.html" target="_blank" rel="noopener">APOD page ↗</a>
        </div>
      </div>
    </div>`;
  view.querySelector('#apod-read')?.addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (b.dataset.on) { stopSpeaking(); b.textContent = 'Read it to me'; delete b.dataset.on; return; }
    b.dataset.on = '1';
    b.textContent = 'Stop reading';
    speak(`${a.title}. ${a.explanation}`, { onend: () => { b.textContent = 'Read it to me'; delete b.dataset.on; } });
  });
}

async function loadApodGrid() {
  const grid = body.querySelector('#apod-grid');
  try {
    const list = await api('/api/apod?count=12', 'apod', { cache: false });
    if (!body.querySelector('#apod-grid')) return;
    grid.innerHTML = list.map((a, i) => {
      const thumb = a.media_type === 'image' ? a.url : a.thumbnail_url;
      return `<button class="tile" type="button" data-i="${i}">
        <span class="tile__img">${thumb ? `<img src="${esc(safeUrl(thumb))}" alt="" loading="lazy"/>` : ''}${a.media_type !== 'image' ? `<span class="tile__badge">${esc(a.media_type)}</span>` : ''}</span>
        <span class="tile__t">${esc(a.title)}</span><span class="tile__m">${esc(fmtDate(Date.parse(a.date)))}</span></button>`;
    }).join('');
    grid.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
      const a = list[Number(b.dataset.i)];
      memo.apod = a;
      const d = body.querySelector('#apod-date');
      if (d) d.value = a.date;
      renderApod(a, body.querySelector('#apod-view'));
      body.scrollTo({ top: 0, behavior: 'smooth' });
    }));
  } catch (err) {
    grid.innerHTML = failure(`APOD's random picks didn't load: ${err.message}.`);
  }
}

// ── Image & Video Library ─────────────────────────────────────────────────

function showLibrary(opts = {}) {
  const st = memo.library;
  body.innerHTML = `
    <form class="toolbar" id="lib-form" role="search">
      <label class="field"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>
        <span class="vh">Search NASA's images, video and audio</span>
        <input type="search" id="lib-q" placeholder="Search NASA’s images, videos and sounds" value="${esc(st.q)}" autocomplete="off"/></label>
      ${canListen ? '<button class="etch-btn etch-btn--small" type="button" id="lib-voice" title="Search by voice">Speak</button>' : ''}
      <div class="seg" role="radiogroup" aria-label="Media type">
        ${[['image,video', 'All'], ['image', 'Images'], ['video', 'Video'], ['audio', 'Audio']].map(([v, l]) => `<button class="etch-btn etch-btn--small${st.type === v ? ' is-active' : ''}" type="button" role="radio" aria-checked="${st.type === v}" data-type="${v}">${l}</button>`).join('')}
      </div>
      <button class="etch-btn etch-btn--small etch-btn--primary" type="submit">Search</button>
    </form>
    <div id="lib-suggest" class="chips" style="margin:-6px 0 18px">${['Apollo 11', 'Pillars of Creation', 'Artemis II', 'aurora from ISS', 'Saturn rings', 'Perseverance', 'Earthrise', 'solar flare', 'sounds of space'].map((s) => `<button class="chip" type="button" data-s="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    <div id="lib-results"></div>`;
  const form = body.querySelector('#lib-form');
  const q = body.querySelector('#lib-q');
  form.addEventListener('submit', (e) => { e.preventDefault(); st.q = q.value.trim(); st.page = 1; searchLibrary(); });
  body.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => { st.type = b.dataset.type; showLibrary(); if (st.q) searchLibrary(); }));
  body.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { q.value = b.dataset.s; st.q = b.dataset.s; st.page = 1; if (b.dataset.s === 'sounds of space') st.type = 'audio'; showLibrary(); searchLibrary(); }));
  body.querySelector('#lib-voice')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.textContent = 'Listening…';
    b.disabled = true;
    try {
      const said = await listen();
      if (said) { q.value = said; st.q = said; st.page = 1; searchLibrary(); }
    } catch (err) {
      body.querySelector('#lib-results').innerHTML = failure(err.message);
    } finally {
      b.textContent = 'Speak';
      b.disabled = false;
    }
  });
  if (opts.item) openLibraryItem(opts.item);
  else if (st.q) searchLibrary();
  else q.focus();
}

async function searchLibrary() {
  const st = memo.library;
  const out = body.querySelector('#lib-results');
  if (!out || !st.q) return;
  out.innerHTML = `<div class="grid">${Array.from({ length: 8 }, () => '<div><div class="tile__img skeleton" style="height:auto;aspect-ratio:1;margin:0"></div></div>').join('')}</div>`;
  try {
    const j = await api(`/api/library/search?q=${encodeURIComponent(st.q)}&media_type=${encodeURIComponent(st.type)}&page=${st.page}`, 'library');
    const items = j.collection?.items || [];
    const total = j.collection?.metadata?.total_hits ?? items.length;
    if (!items.length) { out.innerHTML = `<p>Nothing in the library matches “${esc(st.q)}”. Try a mission, a planet or a telescope.</p>`; return; }
    out.innerHTML = `
      <p class="src" style="margin:0 0 12px">${n0(total)} results for “${esc(st.q)}”</p>
      <div class="grid">${items.map((it, i) => {
        const d = it.data?.[0] || {};
        const thumb = it.links?.find((l) => l.rel === 'preview')?.href || it.links?.[0]?.href;
        return `<button class="tile" type="button" data-i="${i}">
          <span class="tile__img">${thumb ? `<img src="${esc(safeUrl(thumb))}" alt="" loading="lazy"/>` : ''}${d.media_type !== 'image' ? `<span class="tile__badge">${esc(d.media_type || '')}</span>` : ''}</span>
          <span class="tile__t">${esc(d.title || 'Untitled')}</span>
          <span class="tile__m">${esc(d.date_created ? fmtDate(Date.parse(d.date_created)) : '')}${d.center ? ` · ${esc(d.center)}` : ''}</span></button>`;
      }).join('')}</div>
      <div class="row-actions" style="justify-content:center;margin-top:22px">
        ${st.page > 1 ? '<button class="etch-btn etch-btn--small" type="button" id="lib-prev">Previous page</button>' : ''}
        ${j.collection?.links?.some((l) => l.rel === 'next') ? '<button class="etch-btn etch-btn--small" type="button" id="lib-next">Next page</button>' : ''}
      </div>`;
    out.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => openLibraryItem(items[Number(b.dataset.i)])));
    out.querySelector('#lib-next')?.addEventListener('click', () => { st.page++; searchLibrary(); body.scrollTo({ top: 0 }); });
    out.querySelector('#lib-prev')?.addEventListener('click', () => { st.page--; searchLibrary(); body.scrollTo({ top: 0 }); });
  } catch (err) {
    out.innerHTML = failure(`The library search failed: ${err.message}.`);
  }
}

async function openLibraryItem(it) {
  const d = it.data?.[0] || {};
  const prev = body.innerHTML;
  const thumb = it.links?.find((l) => l.rel === 'preview')?.href || it.links?.[0]?.href;
  body.innerHTML = `
    <button class="etch-btn etch-btn--small" type="button" id="lib-back" style="margin-bottom:18px">← Back to results</button>
    <div class="viewer">
      <div class="viewer__media" id="lib-media">${thumb ? `<img src="${esc(safeUrl(thumb))}" alt="${esc(d.title || '')}"/>` : loading(2)}</div>
      <div>
        <h2>${esc(d.title || 'Untitled')}</h2>
        <p class="meta">${esc(d.date_created ? fmtDate(Date.parse(d.date_created)) : '')}${d.center ? ` · ${esc(d.center)}` : ''} · ${esc(d.nasa_id || '')}${d.photographer ? ` · ${esc(plain(d.photographer))}` : ''}</p>
        <p class="body">${esc(plain(d.description || d.description_508 || ''))}</p>
        ${d.keywords?.length ? `<div class="chips">${d.keywords.slice(0, 12).map((k) => `<button class="chip" type="button" data-k="${esc(k)}">${esc(k)}</button>`).join('')}</div>` : ''}
        <div class="row-actions" id="lib-actions"><a class="etch-btn etch-btn--small" href="https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id || '')}" target="_blank" rel="noopener">images.nasa.gov ↗</a></div>
      </div>
    </div>`;
  body.scrollTop = 0;
  body.querySelector('#lib-back').addEventListener('click', () => {
    if (memo.library.q) { showLibrary(); } else { body.innerHTML = prev; showLibrary(); }
  });
  body.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => { memo.library.q = b.dataset.k; memo.library.page = 1; showLibrary(); }));
  try {
    const j = await api(`/api/library/asset/${encodeURIComponent(d.nasa_id)}`, 'library');
    const hrefs = (j.collection?.items || []).map((x) => x.href.replace(/^http:/, 'https:'));
    const media = body.querySelector('#lib-media');
    if (!media) return;
    const pick = (res) => res.map((r) => hrefs.find((h) => r.test(h))).find(Boolean);
    if (d.media_type === 'video') {
      const v = pick([/~medium\.mp4$/i, /~mobile\.mp4$/i, /~orig\.mp4$/i, /\.mp4$/i]);
      if (v) media.innerHTML = `<video src="${esc(safeUrl(v))}" controls playsinline preload="metadata" poster="${esc(safeUrl(thumb || ''))}"></video>`;
    } else if (d.media_type === 'audio') {
      const a = pick([/~128k\.mp3$/i, /\.mp3$/i, /\.m4a$/i, /\.wav$/i]);
      if (a) media.innerHTML = `<audio src="${esc(safeUrl(a))}" controls preload="metadata"></audio>`;
    } else {
      const big = pick([/~large\.jpg$/i, /~medium\.jpg$/i, /~orig\.(jpg|png)$/i]);
      if (big) media.innerHTML = `<a href="${esc(safeUrl(pick([/~orig\.(jpg|png|tif)$/i]) || big))}" target="_blank" rel="noopener" title="Open original"><img src="${esc(safeUrl(big))}" alt="${esc(d.title || '')}"/></a>`;
    }
  } catch { /* keep the preview */ }
}

// ── Technology: TechTransfer + TechPort ────────────────────────────────────

function showTech() {
  const st = memo.tech;
  body.innerHTML = `
    <p style="margin-top:0">NASA licenses its inventions and publishes its software, and tracks thousands of technology projects on TechPort. Search the transfer catalogue, or see what engineers updated this month.</p>
    <form class="toolbar" id="tt-form" role="search">
      <label class="field"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>
        <span class="vh">Search NASA technology</span><input type="search" id="tt-q" placeholder="Try: robot, solar, water, 3D printing, battery" value="${esc(st.q)}"/></label>
      <div class="seg" role="radiogroup" aria-label="Catalogue">
        ${[['patent', 'Patents'], ['software', 'Software'], ['spinoff', 'Spinoffs']].map(([v, l]) => `<button class="etch-btn etch-btn--small${st.kind === v ? ' is-active' : ''}" type="button" role="radio" aria-checked="${st.kind === v}" data-kind="${v}">${l}</button>`).join('')}
      </div>
      <button class="etch-btn etch-btn--small etch-btn--primary" type="submit">Search</button>
    </form>
    <div id="tt-results"></div>
    <h3 style="margin-top:34px">Updated on TechPort this month</h3>
    <div id="tp-results">${loading(3)}</div>`;
  const q = body.querySelector('#tt-q');
  body.querySelector('#tt-form').addEventListener('submit', (e) => { e.preventDefault(); st.q = q.value.trim(); searchTech(); });
  body.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => {
    st.kind = b.dataset.kind;
    body.querySelectorAll('[data-kind]').forEach((x) => { x.classList.toggle('is-active', x === b); x.setAttribute('aria-checked', String(x === b)); });
    searchTech();
  }));
  searchTech();
  loadTechPort();
}

async function searchTech() {
  const st = memo.tech;
  const out = body.querySelector('#tt-results');
  if (!out) return;
  const q = st.q || ({ patent: 'space', software: 'orbit', spinoff: 'medical' })[st.kind];
  out.innerHTML = loading(4);
  try {
    const j = await api(`/api/techtransfer/${st.kind}?q=${encodeURIComponent(q)}`, 'techtransfer');
    const res = j.results || [];
    if (!res.length) { out.innerHTML = `<p>No ${esc(st.kind)} results for “${esc(q)}”.</p>`; return; }
    out.innerHTML = `<p class="src" style="margin:0 0 6px">${n0(j.total ?? res.length)} ${esc(st.kind)} results for “${esc(q)}”${st.q ? '' : ' (a starter search)'}</p>
      <div class="cards-list">${res.slice(0, 24).map((r) => {
        const img = typeof r[10] === 'string' && /^https?:/.test(r[10]) ? r[10] : '';
        const link = st.kind === 'software' && /^https?:/.test(r[8] || '') ? r[8] : `https://technology.nasa.gov/${st.kind}/${encodeURIComponent(r[1])}`;
        return `<article class="entry">
          ${img ? `<img src="${esc(safeUrl(img))}" alt="" loading="lazy"/>` : ''}
          <h4>${esc(plain(r[2]))}</h4>
          <p class="meta">${esc(r[1])} · ${esc(r[9] || '')}${r[5] ? ` · ${esc(plain(r[5]))}` : ''}${r[6] ? ` · ${esc(plain(r[6]))}` : ''}</p>
          <p>${esc(plain(r[3]).slice(0, 320))}${plain(r[3]).length > 320 ? '…' : ''}</p>
          <a href="${esc(safeUrl(link))}" target="_blank" rel="noopener">Read more ↗</a>
        </article>`;
      }).join('')}</div>`;
  } catch (err) {
    out.innerHTML = failure(`TechTransfer didn't answer: ${err.message}.`);
  }
}

async function loadTechPort() {
  const out = body.querySelector('#tp-results');
  try {
    const j = await api('/api/techport/recent', 'techport', { timeout: 200000 });
    if (!body.querySelector('#tp-results')) return;
    out.innerHTML = `<div class="cards-list">${j.projects.map((p) => `
      <article class="entry">
        <h4>${esc(p.title)}</h4>
        <p class="meta">${esc(p.status || '')} · ${esc(p.start)}–${esc(p.end)}${p.lead ? ` · ${esc(p.lead)}` : ''}</p>
        ${p.trlCurrent != null ? trl(p) : ''}
        <p>${esc(p.description.slice(0, 300))}${p.description.length > 300 ? '…' : ''}</p>
        <a href="https://techport.nasa.gov/projects/${encodeURIComponent(p.projectId)}" target="_blank" rel="noopener">TechPort project ${esc(p.projectId)} ↗</a>
      </article>`).join('')}</div>
      <p class="src">Technology Readiness Level runs from 1 (basic principles observed) to 9 (proven in flight). Filled cells span the project's start and target TRL; the dark cell is where it stands now.</p>`;
  } catch (err) {
    out.innerHTML = failure(`TechPort didn't answer: ${err.message}.`);
  }
}

function trl(p) {
  const cells = [];
  for (let i = 1; i <= 9; i++) {
    const on = p.trlBegin != null && p.trlEnd != null && i >= p.trlBegin && i <= p.trlEnd;
    cells.push(`<span class="${i === p.trlCurrent ? 'now' : on ? 'on' : ''}">${i}</span>`);
  }
  return `<div class="trl" role="img" aria-label="Technology readiness ${p.trlCurrent} of 9, from ${p.trlBegin} toward ${p.trlEnd}">${cells.join('')}</div>`;
}

// ── Space biology: OSDR ────────────────────────────────────────────────────

function showBio() {
  const st = memo.bio;
  body.innerHTML = `
    <p style="margin-top:0">What happens to living things in space? NASA's Open Science Data Repository holds experiments flown on the Space Shuttle, the ISS and beyond, from mice and plants to microbes and astronauts' own cells.</p>
    <form class="toolbar" id="bio-form" role="search">
      <label class="field"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>
        <span class="vh">Search space biology studies</span><input type="search" id="bio-q" placeholder="Try: mouse, Arabidopsis, bone, microgravity, radiation, muscle" value="${esc(st.q)}"/></label>
      <button class="etch-btn etch-btn--small etch-btn--primary" type="submit">Search</button>
    </form>
    <div class="chips" style="margin:-6px 0 18px">${['microgravity', 'radiation', 'Arabidopsis', 'bone loss', 'muscle', 'Rodent Research', 'microbes'].map((s) => `<button class="chip" type="button" data-s="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    <div id="bio-results"></div>`;
  const q = body.querySelector('#bio-q');
  body.querySelector('#bio-form').addEventListener('submit', (e) => { e.preventDefault(); st.q = q.value.trim(); searchBio(); });
  body.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { q.value = b.dataset.s; st.q = b.dataset.s; searchBio(); }));
  searchBio();
}

async function searchBio() {
  const out = body.querySelector('#bio-results');
  if (!out) return;
  const q = memo.bio.q || 'microgravity';
  out.innerHTML = loading(4);
  try {
    const j = await api(`/api/osdr/search?q=${encodeURIComponent(q)}`, 'osdr');
    const hits = j.hits?.hits || [];
    if (!hits.length) { out.innerHTML = `<p>No studies match “${esc(q)}”.</p>`; return; }
    out.innerHTML = `<p class="src" style="margin:0 0 6px">${n0(j.hits.total?.value ?? j.hits.total)} studies for “${esc(q)}”${memo.bio.q ? '' : ' (a starter search)'}</p>
      <div class="cards-list">${hits.map((h) => {
        const s = h._source || {};
        const acc = s.Accession || h._id;
        const mission = typeof s.Mission === 'object' ? s.Mission?.Name : s.Mission;
        const released = Number(s['Study Public Release Date']);
        const flat = (v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : '');
        return `<article class="entry">
          <h4>${esc(plain(s['Study Title'] || s['Project Title'] || acc))}</h4>
          <p class="meta">${esc(acc)} · ${esc(flat(s.organism) || '—')}${mission ? ` · ${esc(mission)}` : ''}${s['Flight Program'] ? ` · ${esc(s['Flight Program'])}` : ''}${released ? ` · released ${esc(fmtDate(released * 1000))}` : ''}</p>
          <p>${esc(plain(s['Study Description'] || '').slice(0, 320))}…</p>
          ${flat(s['Study Factor Name']) ? `<p class="meta">Factors: ${esc(flat(s['Study Factor Name']))}</p>` : ''}
          <a href="https://osdr.nasa.gov/bio/repo/data/studies/${encodeURIComponent(acc)}" target="_blank" rel="noopener">Open ${esc(acc)} in OSDR ↗</a>
        </article>`;
      }).join('')}</div>`;
  } catch (err) {
    out.innerHTML = failure(`OSDR didn't answer: ${err.message}.`);
  }
}

// ── Sources board ──────────────────────────────────────────────────────────

function showSources() {
  const render = () => {
    const list = sourceStatus();
    const ok = list.filter((s) => s.state === 'ok').length;
    body.innerHTML = `
      <p style="margin-top:0">NASA Lab draws on all ${SOURCES.length} families in the <a href="https://api.nasa.gov/" target="_blank" rel="noopener">api.nasa.gov</a> catalogue. Every request goes through a small local gateway that keeps the API key off your device, caches responses and serves the last good copy if a service stumbles. This board shows how each source has answered this session.</p>
      <div class="row-actions" style="margin-bottom:18px"><button class="etch-btn etch-btn--small etch-btn--primary" type="button" id="probe">Check every source now</button><span class="src" style="margin:8px 0 0 6px">${ok} of ${list.length} answering</span></div>
      <div class="status-grid">${list.map((s) => `
        <div class="status-row">
          <span class="led ${s.state === 'ok' ? 'ok' : s.state === 'warn' ? 'warn' : s.state === 'bad' ? 'bad' : ''}" aria-hidden="true"></span>
          <span class="n">${esc(s.name)}</span>
          <span class="v">${esc(s.state === 'ok' ? (s.ms != null ? `${n0(s.ms)} ms` : 'ok') : s.state === 'warn' ? 'cached' : s.state === 'bad' ? 'not answering' : s.state === 'checking' ? 'checking…' : 'not used yet')}</span>
          <span class="d">${esc(s.full)} · ${esc(s.where)}${s.note ? ` · ${esc(s.note)}` : ''}${s.at ? ` · ${esc(relTime(s.at))}` : ''}</span>
        </div>`).join('')}</div>
      <p class="src" style="margin-top:18px">GIBS and Trek are tile and map services loaded straight into the 3-D scenes, so they are marked as their images arrive. The Satellite Situation Center only appears here: its web service would not accept connections while NASA Lab was built, so it drives no scene.</p>`;
    body.querySelector('#probe').addEventListener('click', probeAll);
  };
  render();
  offStatus = onStatus(debounce(() => { if (current === 'sources' && !root.hidden) render(); }, 150));
}

async function probeAll() {
  const { mark } = await import('../core/api.js');
  await Promise.allSettled(SOURCES.filter((s) => s.probe).map(async (s) => {
    mark(s.id, 'checking', { force: true });
    try { await api(s.probe, s.id, { cache: false, timeout: s.id === 'ssc' ? 25000 : 90000 }); }
    catch (err) { mark(s.id, 'bad', { force: true, note: err.message }); }
  }));
}
