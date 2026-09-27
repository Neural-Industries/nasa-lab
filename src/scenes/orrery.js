// ASTEROIDS — the inner Solar System from JPL orbital elements, with every
// asteroid passing within 0.05 AU of Earth in the next 60 days (JPL CAD),
// each propagated along its own orbit from full-precision SBDB elements.
// Plus NeoWs' week of approaches and the Sentry impact-monitoring list.
import * as THREE from 'three';
import { api } from '../core/api.js';
import * as A from '../core/astro.js';
import { esc, fmtUTC, fmtDate, n0, n1, n2, sig, relTime, clamp, diameterFromH, safeUrl } from '../core/util.js';

const S = 40; // scene units per AU
const LD_AU = A.LUNAR_DISTANCE_KM / A.AU_KM;
const PLANET_VIS = { mercury: 0.55, venus: 0.8, earth: 0.85, mars: 0.65, jupiter: 2.4, saturn: 2.1, uranus: 1.5, neptune: 1.5 };

function ellipsePoints(el, steps = 256) {
  const pts = [];
  const v = [0, 0, 0], sc = [0, 0, 0];
  for (let k = 0; k <= steps; k++) {
    const E = (k / steps) * Math.PI * 2;
    const M = (E - el.e * Math.sin(E)) * A.R2D;
    A.orbitalPosition(el.a, el.e, el.i, el.om, el.w, M, v);
    A.eclipticToScene(v, S, sc);
    pts.push(new THREE.Vector3(sc[0], sc[1], sc[2]));
  }
  return pts;
}

export function create(ctx) {
  const { engine, clock, sound, ui } = ctx;
  const scene = new THREE.Scene();
  const state = { rocks: [], week: null, sentry: [], selection: null, loading: true, error: null };
  const tmp = [0, 0, 0], sc = [0, 0, 0];

  // ── Sun ────────────────────────────────────────────────────────────────
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow([[0, 'rgba(255,248,230,1)'], [0.2, 'rgba(255,215,150,0.8)'], [0.5, 'rgba(255,160,80,0.15)'], [1, 'rgba(255,140,60,0)']]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  sunSprite.scale.setScalar(9);
  scene.add(sunSprite);
  const sunCore = new THREE.Mesh(new THREE.SphereGeometry(1.1, 32, 16), new THREE.MeshBasicMaterial({ color: 0xfff2d0 }));
  scene.add(sunCore);
  scene.add(new THREE.PointLight(0xffffff, 3, 0, 0));
  scene.add(new THREE.AmbientLight(0xffffff, 0.12));

  // ── Planets ────────────────────────────────────────────────────────────
  const planets = A.PLANETS.map((p) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(PLANET_VIS[p.id], 32, 16), new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.9, emissive: p.color, emissiveIntensity: 0.18 }));
    mesh.userData.planet = p;
    scene.add(mesh);
    const k = A.planetElements(p, clock.sim);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ellipsePoints({ a: k.a, e: k.e, i: k.i, om: k.node, w: k.peri })),
      new THREE.LineBasicMaterial({ color: p.id === 'earth' ? 0x7fb2ff : 0xb9b9bb, transparent: true, opacity: p.id === 'earth' ? 0.55 : 0.2 }));
    scene.add(line);
    const label = engine.addLabel(esc(p.name), () => (ctx.active === api_ ? mesh.position : null), { below: p.id !== 'earth' });
    label.visible = false;
    return { p, mesh, line, label };
  });
  const earth = planets.find((x) => x.p.id === 'earth');

  // Earth–Moon system (only readable when zoomed in)
  const earthSystem = new THREE.Group();
  scene.add(earthSystem);
  const ldRing = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 128 }, (_, i) => new THREE.Vector3(Math.cos((i / 128) * Math.PI * 2) * LD_AU * S, 0, Math.sin((i / 128) * Math.PI * 2) * LD_AU * S))),
    new THREE.LineDashedMaterial({ color: 0xb9b9bb, transparent: true, opacity: 0.5, dashSize: 0.01, gapSize: 0.008 }));
  ldRing.computeLineDistances();
  earthSystem.add(ldRing);
  const moonDot = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 16, 8), new THREE.MeshBasicMaterial({ color: 0xcfcfcf }));
  earthSystem.add(moonDot);
  const earthDot = new THREE.Mesh(new THREE.SphereGeometry(0.0167, 24, 12), new THREE.MeshBasicMaterial({ color: 0x6c9cff }));
  earthSystem.add(earthDot);
  engine.addLabel('Moon', () => (ctx.active === api_ && engine.camera.position.distanceTo(earth.mesh.position) < 1.2 ? moonDot.getWorldPosition(new THREE.Vector3()) : null), { below: true });
  engine.addLabel('1 lunar distance', () => (ctx.active === api_ && engine.camera.position.distanceTo(earth.mesh.position) < 1.2 ? earthSystem.localToWorld(new THREE.Vector3(LD_AU * S * 0.72, 0, LD_AU * S * 0.72)) : null), { below: true });

  // ── Asteroids ──────────────────────────────────────────────────────────
  const rockMat = new THREE.ShaderMaterial({
    uniforms: { uPixel: { value: Math.min(devicePixelRatio, 2) } },
    vertexShader: /* glsl */ `
      attribute vec3 color; attribute float size;
      uniform float uPixel;
      varying vec3 vC;
      void main() {
        vC = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(size * uPixel * (18.0 / -mv.z), 3.0 * uPixel, 14.0 * uPixel);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float core = smoothstep(0.55, 0.0, d);
        float ring = smoothstep(0.12, 0.0, abs(d - 0.85));
        gl_FragColor = vec4(vC * (core * 1.4 + ring * 0.8), max(core, ring));
      }`,
    transparent: true,
    depthWrite: false,
  });
  let rockPoints = null;
  const rockOrbits = new THREE.Group();
  scene.add(rockOrbits);
  const approachLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xf64137, dashSize: 0.02, gapSize: 0.015, transparent: true, opacity: 0.9 }));
  approachLine.visible = false;
  scene.add(approachLine);
  let selLabel = null;

  const rockColor = (distLd) => {
    const t = clamp(Math.log10(distLd) / Math.log10(20), 0, 1);
    return [1.0, 0.45 + 0.45 * t, 0.3 + 0.6 * t];
  };

  function elementsFromSbdb(s) {
    const el = Object.fromEntries((s.orbit?.elements || []).map((x) => [x.name, Number(x.value)]));
    if (!(el.e < 1) || !Number.isFinite(el.a)) return null;
    return { a: el.a, e: el.e, i: el.i, om: el.om, w: el.w, ma: el.ma, n: el.n, epoch: Number(s.orbit.epoch) };
  }

  async function load() {
    try {
      const cad = await api('/api/cad?days=60&dist=0.05', 'ssd');
      const f = cad.fields;
      const ix = (k) => f.indexOf(k);
      const rows = (cad.data || []).map((r) => ({
        des: r[ix('des')], name: (r[ix('fullname')] || r[ix('des')]).trim().replace(/^\((.*)\)$/, '$1'), jd: Number(r[ix('jd')]), t: A.msFromJd(Number(r[ix('jd')])),
        distAu: Number(r[ix('dist')]), distMinAu: Number(r[ix('dist_min')]), distMaxAu: Number(r[ix('dist_max')]),
        vRel: Number(r[ix('v_rel')]), h: Number(r[ix('h')]), diameter: r[ix('diameter')] ? Number(r[ix('diameter')]) : null, tSigma: r[ix('t_sigma_f')],
      }));
      // Keep the nearest approach per object, nearest first, capped for the SBDB fan-out.
      const byDes = new Map();
      rows.forEach((r) => { if (!byDes.has(r.des) || byDes.get(r.des).distAu > r.distAu) byDes.set(r.des, r); });
      const chosen = [...byDes.values()].sort((a, b) => a.distAu - b.distAu).slice(0, 40);
      state.cadCount = rows.length;
      const out = [];
      for (let i = 0; i < chosen.length; i += 5) {
        const batch = await Promise.all(chosen.slice(i, i + 5).map(async (r) => {
          try {
            const s = await api(`/api/sbdb?des=${encodeURIComponent(r.des)}`, 'ssd');
            const el = elementsFromSbdb(s);
            if (!el) return null;
            return { ...r, el, sbdb: s, source: 'cad' };
          } catch { return null; }
        }));
        out.push(...batch.filter(Boolean));
        state.rocks = out.slice().sort((a, b) => a.t - b.t);
        buildRocks();
        if (ctx.active === api_) renderPanel();
      }
      state.loading = false;
    } catch (err) {
      state.error = err.message;
      state.loading = false;
    }
    updateMarks();
    if (ctx.active === api_) renderPanel();

    api('/api/neo/feed', 'neows').then((j) => {
      const list = [];
      for (const [day, arr] of Object.entries(j.near_earth_objects || {})) {
        for (const o of arr) {
          const ca = o.close_approach_data?.[0];
          if (!ca) continue;
          list.push({
            id: o.id, name: o.name.replace(/[()]/g, '').trim(), day, hazardous: o.is_potentially_hazardous_asteroid, sentry: o.is_sentry_object,
            t: Number(ca.epoch_date_close_approach), km: Number(ca.miss_distance.kilometers), ld: Number(ca.miss_distance.lunar), kms: Number(ca.relative_velocity.kilometers_per_second),
            dMin: o.estimated_diameter?.meters?.estimated_diameter_min, dMax: o.estimated_diameter?.meters?.estimated_diameter_max, h: o.absolute_magnitude_h, url: o.nasa_jpl_url,
          });
        }
      }
      state.week = { count: j.element_count, list: list.sort((a, b) => a.t - b.t) };
      if (ctx.active === api_) renderPanel();
    }).catch((e) => { state.week = { error: e.message }; if (ctx.active === api_) renderPanel(); });

    api('/api/sentry', 'ssd').then((j) => {
      state.sentry = (j.data || []).map((d) => ({ des: d.des, name: (d.fullname?.trim() || d.des).replace(/^\((.*)\)$/, '$1'), ip: Number(d.ip), ps: Number(d.ps_cum), range: d.range, n: Number(d.n_imp), diameter: Number(d.diameter), h: Number(d.h), vinf: Number(d.v_inf) }))
        .sort((a, b) => b.ps - a.ps).slice(0, 12);
      state.sentryCount = Number(j.count);
      if (ctx.active === api_) renderPanel();
    }).catch(() => {});
  }

  function buildRocks() {
    if (rockPoints) { scene.remove(rockPoints); rockPoints.geometry.dispose(); }
    rockOrbits.children.forEach((l) => l.geometry.dispose());
    rockOrbits.clear();
    const N = state.rocks.length;
    const col = new Float32Array(N * 3), size = new Float32Array(N);
    state.rocks.forEach((r, i) => {
      const ld = r.distAu / LD_AU;
      col.set(rockColor(ld), i * 3);
      size[i] = 1.6;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ellipsePoints(r.el, 200)),
        new THREE.LineBasicMaterial({ color: new THREE.Color(...rockColor(ld)), transparent: true, opacity: 0.16 }));
      line.userData.rock = r;
      rockOrbits.add(line);
      r.line = line;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    rockPoints = new THREE.Points(geo, rockMat);
    rockPoints.frustumCulled = false;
    rockPoints.name = 'rocks';
    scene.add(rockPoints);
    highlight();
  }

  function highlight() {
    const sel = state.selection?.rock;
    state.rocks.forEach((r) => { r.line.material.opacity = r === sel ? 0.95 : 0.16; });
    if (selLabel) { selLabel.remove(); selLabel = null; }
    if (sel) {
      const i = state.rocks.indexOf(sel);
      const v = new THREE.Vector3();
      selLabel = engine.addLabel(esc(sel.name), () => {
        if (ctx.active !== api_ || !rockPoints) return null;
        const a = rockPoints.geometry.attributes.position.array;
        return v.set(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
      });
    }
  }

  function updateMarks() {
    api_.marks = state.rocks.map((r) => ({ t: r.t, label: `${r.name} · ${n2(r.distAu / LD_AU)} LD`, strength: clamp(1 - Math.log10(r.distAu / LD_AU + 1) / 1.4, 0.2, 1) }));
    if (ctx.active === api_) ui.setTimeRange(api_.timeRange, api_.marks);
  }

  // ── Selection & panel ──────────────────────────────────────────────────
  function selectRock(r, { fly = true, jump = true } = {}) {
    if (!r) return;
    state.selection = { rock: r };
    highlight();
    if (jump) {
      clock.set(r.t - 2.5 * 86400000);
      clock.setRate(3600);
    }
    if (fly) {
      const ep = earth.mesh.position.clone();
      const off = new THREE.Vector3(0.35, 0.5, 0.6).normalize().multiplyScalar(clamp((r.distAu / LD_AU) * 0.12, 0.35, 4));
      engine.flyTo(ep.clone().add(off), ep, { duration: 2.6 });
      state.follow = 'earth';
    }
    sound.ping(sound.note(clamp(1 - r.distAu / 0.05, 0, 1), 220), { gain: 0.1 });
    renderPanel();
  }

  async function addFromNeoWs(item) {
    const existing = state.rocks.find((r) => r.name.includes(item.name) || item.name.includes(r.des));
    if (existing) return selectRock(existing);
    try {
      const o = await api(`/api/neo/lookup/${encodeURIComponent(item.id)}`, 'neows');
      const od = o.orbital_data;
      const el = { a: Number(od.semi_major_axis), e: Number(od.eccentricity), i: Number(od.inclination), om: Number(od.ascending_node_longitude), w: Number(od.perihelion_argument), ma: Number(od.mean_anomaly), n: Number(od.mean_motion), epoch: Number(od.epoch_osculation) };
      if (!(el.e < 1)) throw new Error('Unbound orbit');
      const r = { des: item.name, name: item.name, t: item.t, distAu: item.km / A.AU_KM, distMinAu: null, distMaxAu: null, vRel: item.kms, h: item.h, diameter: null, el, source: 'neows', neows: item, orbitClass: od.orbit_class?.orbit_class_description };
      state.rocks.push(r);
      state.rocks.sort((a, b) => a.t - b.t);
      buildRocks();
      updateMarks();
      selectRock(r);
    } catch (err) {
      ui.toast(`NeoWs couldn't provide that orbit: ${err.message}`);
    }
  }

  async function addFromSentry(item) {
    const existing = state.rocks.find((r) => r.des === item.des);
    if (existing) return selectRock(existing, { jump: false });
    try {
      const s = await api(`/api/sbdb?des=${encodeURIComponent(item.des)}`, 'ssd');
      const el = elementsFromSbdb(s);
      if (!el) throw new Error('No elliptical orbit');
      const r = { des: item.des, name: item.name, t: null, distAu: null, el, sbdb: s, source: 'sentry', sentry: item, h: item.h };
      state.rocks.push(r);
      buildRocks();
      state.selection = { rock: r };
      highlight();
      engine.flyTo(new THREE.Vector3(0, 90, 70), new THREE.Vector3(), { duration: 2.4 });
      state.follow = null;
      renderPanel();
    } catch (err) {
      ui.toast(`SBDB couldn't provide that orbit: ${err.message}`);
    }
  }

  function distanceGauge(ld) {
    // Log scale from 0.01 LD to 20 LD with GEO and the Moon marked.
    const w = 320, x = (v) => 10 + ((Math.log10(clamp(v, 0.01, 20)) + 2) / (Math.log10(20) + 2)) * (w - 20);
    const ticks = [0.01, 0.1, 1, 10].map((v) => `<line x1="${x(v)}" y1="18" x2="${x(v)}" y2="26" stroke="var(--ink)"/><text x="${x(v)}" y="38" text-anchor="middle">${v} LD</text>`).join('');
    const geo = 42164 / A.LUNAR_DISTANCE_KM;
    return `<div class="gauge"><svg viewBox="0 0 ${w} 64" role="img" aria-label="Miss distance ${n2(ld)} lunar distances on a logarithmic scale">
      <line x1="10" y1="22" x2="${w - 10}" y2="22" stroke="var(--ink)"/>${ticks}
      <line x1="${x(geo)}" y1="10" x2="${x(geo)}" y2="22" stroke="var(--ink)" stroke-dasharray="2 2"/><text x="${x(geo)}" y="8" text-anchor="middle">GEO</text>
      <circle cx="${x(1)}" cy="22" r="3.5" fill="var(--carbon)" stroke="var(--ink)"/><text x="${x(1)}" y="52" text-anchor="middle">Moon</text>
      <path d="M${x(ld)} 22 l-5 -10 h10 z" fill="var(--red-bright)"/><text x="${x(ld)}" y="62" text-anchor="middle" style="font-weight:700">${n2(ld)} LD</text>
    </svg></div>`;
  }

  function renderPanel() {
    if (ctx.active !== api_) return;
    const r = state.selection?.rock;
    if (r) return renderRock(r);
    const next = state.rocks.filter((x) => x.t >= Date.now()).sort((a, b) => a.distAu - b.distAu)[0];
    const html = `
      <h2>Rocks passing Earth</h2>
      <p class="lede">Every asteroid that JPL's Close Approach Data predicts will pass within 0.05 AU (19.5 lunar distances) in the next 60 days, each flying along its own orbit. Planets and orbits are computed from JPL elements for the time on the clock.</p>
      <div class="row-actions">
        <button class="etch-btn etch-btn--primary etch-btn--small" type="button" id="play60">Play the next 60 days</button>
        <button class="etch-btn etch-btn--small" type="button" id="to-earth">Zoom to Earth</button>
        <button class="etch-btn etch-btn--small" type="button" id="to-system">Whole system</button>
      </div>
      ${state.error ? `<p class="err">JPL's close-approach service didn't answer (${esc(state.error)}).</p>` : ''}
      <dl class="stats">
        <div><dt>Approaches · 60 d</dt><dd>${state.cadCount != null ? n0(state.cadCount) : '…'}</dd></div>
        <div><dt>Closest</dt><dd>${next ? `${n2(next.distAu / LD_AU)} <small>LD</small>` : '…'}</dd></div>
      </dl>
      <h3>Closest approaches <small>JPL CAD + SBDB</small></h3>
      ${state.rocks.length ? `<ul class="list">${state.rocks.filter((x) => x.source === 'cad').map((x) => `
        <li><button type="button" data-rock="${esc(x.des)}"><span class="t"><span class="dot" style="background:rgb(${rockColor(x.distAu / LD_AU).map((c) => Math.round(c * 255)).join(',')})"></span>${esc(x.name)}</span><span class="m">${n2(x.distAu / LD_AU)} LD</span>
        <span class="s">${esc(fmtUTC(x.t))} · ${n1(x.vRel)} km/s · ${esc(sizeText(x))}</span></button></li>`).join('')}</ul>` : state.loading ? '<div class="skeleton"></div><div class="skeleton w80"></div><div class="skeleton w60"></div>' : '<p>No close approaches found.</p>'}
      <h3>This week <small>Asteroids NeoWs</small></h3>
      ${!state.week ? '<div class="skeleton"></div>' : state.week.error ? `<p class="err">NeoWs didn't answer (${esc(state.week.error)}).</p>` : `
        <p>${n0(state.week.count)} near-Earth objects make their closest approach this week. ${state.week.list.filter((x) => x.hazardous).length} are classed as potentially hazardous: big enough, and on orbits that come close enough, to deserve watching. That label doesn't mean an impact is expected.</p>
        <ul class="list">${state.week.list.slice(0, 16).map((x) => `
          <li><button type="button" data-neo="${esc(x.id)}"><span class="t">${esc(x.name)}${x.hazardous ? ' · hazardous' : ''}</span><span class="m">${n1(x.ld)} LD</span>
          <span class="s">${esc(fmtDate(x.t))} · ${n0(x.dMin)}–${n0(x.dMax)} m · ${n1(x.kms)} km/s</span></button></li>`).join('')}</ul>`}
      <h3>Watched for impact <small>JPL Sentry</small></h3>
      ${state.sentry.length ? `<p>Sentry continuously checks ${state.sentryCount ? n0(state.sentryCount) : 'about two thousand'} objects for any chance of hitting Earth in the next century. These are the highest on the Palermo scale; all are below zero, meaning less likely than the background chance of an impact that size.</p>
        <ul class="list">${state.sentry.map((x) => `<li><button type="button" data-sentry="${esc(x.des)}"><span class="t">${esc(x.name)}</span><span class="m">1 in ${n0(1 / x.ip)}</span>
          <span class="s">${esc(x.range)} · ${Number.isFinite(x.diameter) ? `${n0(x.diameter * 1000)} m` : '—'} · Palermo ${n2(x.ps)}</span></button></li>`).join('')}</ul>` : '<div class="skeleton"></div>'}
      <span class="src">Sources: <a href="https://ssd-api.jpl.nasa.gov/doc/cad.html" target="_blank" rel="noopener">JPL SSD/CNEOS</a> CAD, SBDB and Sentry; NASA NeoWs. Planet and asteroid sizes are exaggerated so they can be seen; positions are not.</span>
    `;
    const el = ui.setPanel(html);
    el.querySelector('#play60').addEventListener('click', () => { clock.now(); clock.setRate(86400); state.follow = null; engine.flyTo(new THREE.Vector3(18, 34, 52), new THREE.Vector3(), { duration: 2.5 }); });
    el.querySelector('#to-earth').addEventListener('click', () => { const ep = earth.mesh.position.clone(); engine.flyTo(ep.clone().add(new THREE.Vector3(0.3, 0.45, 0.55)), ep, { duration: 2.4 }); state.follow = 'earth'; });
    el.querySelector('#to-system').addEventListener('click', () => { state.follow = null; engine.flyTo(new THREE.Vector3(0, 95, 80), new THREE.Vector3(), { duration: 2.4 }); });
    el.querySelectorAll('[data-rock]').forEach((b) => b.addEventListener('click', () => selectRock(state.rocks.find((x) => x.des === b.dataset.rock))));
    el.querySelectorAll('[data-neo]').forEach((b) => b.addEventListener('click', () => addFromNeoWs(state.week.list.find((x) => x.id === b.dataset.neo))));
    el.querySelectorAll('[data-sentry]').forEach((b) => b.addEventListener('click', () => addFromSentry(state.sentry.find((x) => x.des === b.dataset.sentry))));
  }

  function sizeText(r) {
    if (r.diameter) return `${n0(r.diameter * 1000)} m across`;
    if (Number.isFinite(r.h)) { const [lo, hi] = diameterFromH(r.h); return `~${sig(lo, 2)}–${sig(hi, 2)} m`; }
    return 'size unknown';
  }

  function renderRock(r) {
    const s = r.sbdb;
    const cls = s?.object?.orbit_class?.name || r.orbitClass || '';
    const ld = r.distAu != null ? r.distAu / LD_AU : null;
    const el = ui.setPanel(`
      <button class="etch-btn etch-btn--small" type="button" id="back" style="margin-bottom:14px">← All approaches</button>
      <h2>${esc(r.name)}</h2>
      <p class="lede">${esc(cls ? `${cls} asteroid` : 'Near-Earth asteroid')}${s?.object?.pha ? ' · potentially hazardous' : ''}${r.t ? ` · closest to Earth ${esc(fmtUTC(r.t))} (${esc(relTime(r.t))})` : ''}.</p>
      ${ld != null ? distanceGauge(ld) : ''}
      <dl class="stats">
        ${ld != null ? `<div><dt>Miss distance</dt><dd>${n0(r.distAu * A.AU_KM)} <small>km</small></dd></div><div><dt>Lunar distances</dt><dd>${n2(ld)}</dd></div>` : ''}
        ${r.vRel ? `<div><dt>Relative speed</dt><dd>${n1(r.vRel)} <small>km/s</small></dd></div>` : ''}
        <div><dt>Size</dt><dd style="font-size:13px">${esc(sizeText(r))}</dd></div>
        <div><dt>Orbit</dt><dd>${n2(r.el.a)} <small>AU · e ${n2(r.el.e)}</small></dd></div>
        <div><dt>Period</dt><dd>${n0(360 / r.el.n)} <small>days</small></dd></div>
        ${s?.orbit?.n_obs_used ? `<div><dt>Observations</dt><dd>${n0(s.orbit.n_obs_used)}</dd></div>` : ''}
        ${r.distMinAu ? `<div><dt>3σ range</dt><dd style="font-size:12.5px">${n2(r.distMinAu / LD_AU)}–${n2(r.distMaxAu / LD_AU)} <small>LD</small></dd></div>` : ''}
      </dl>
      ${r.sentry ? `<p class="note">Sentry lists ${n0(r.sentry.n)} potential impact${r.sentry.n === 1 ? '' : 's'} between ${esc(r.sentry.range)}, with a cumulative probability of 1 in ${n0(1 / r.sentry.ip)}.</p>` : ''}
      <p class="note">${r.t ? 'The clock has jumped to 2½ days before closest approach and runs at an hour a second. Watch it cross the dashed lunar-distance ring.' : 'Its orbit is highlighted.'} Positions are two-body propagations of JPL's osculating elements; the distances above are JPL's own.</p>
      <span class="src"><a href="https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(r.des)}" target="_blank" rel="noopener">JPL Small-Body Database ↗</a>${r.neows?.url ? ` · <a href="${esc(safeUrl(r.neows.url))}" target="_blank" rel="noopener">NeoWs record ↗</a>` : ''}</span>
    `);
    el.querySelector('#back').addEventListener('click', () => { state.selection = null; highlight(); approachLine.visible = false; renderPanel(); });
  }

  // ── Frame ──────────────────────────────────────────────────────────────
  let lastSim = clock.sim;
  const earthPos = new THREE.Vector3();

  const api_ = {
    id: 'asteroids',
    title: 'Asteroids',
    scene,
    timeRange: [-7, 60],
    marks: [],
    async init() { load(); },
    enter() {
      const cam = engine.camera;
      cam.near = 0.002; cam.far = 20000; cam.updateProjectionMatrix();
      engine.controls.minDistance = 0.06;
      engine.controls.maxDistance = 2600;
      engine.bloom.strength = 0.7;
      engine.bloom.threshold = 0.75;
      engine.sky.rotation.set(-A.obliquity(clock.sim), 0, 0);
      planets.forEach((x) => { x.label.visible = true; });
      cam.position.set(30, 120, 150);
      engine.controls.target.set(0, 0, 0);
      engine.flyTo(new THREE.Vector3(14, 30, 46), new THREE.Vector3(0, 0, 0), { duration: 2.8 });
      state.follow = null;
      ui.setTimeRange(api_.timeRange, api_.marks);
      renderPanel();
      api_.mood();
    },
    exit() { planets.forEach((x) => { x.label.visible = false; }); },
    mood() { sound.mood({ base: 49, bright: 0.3, wind: 0.02 }); },
    update(dt, sim) {
      for (const x of planets) {
        A.planetPosition(x.p, sim, tmp);
        A.eclipticToScene(tmp, S, sc);
        x.mesh.position.set(sc[0], sc[1], sc[2]);
      }
      earthPos.copy(earth.mesh.position);
      earthSystem.position.copy(earthPos);
      // Moon: geocentric, converted from equatorial to ecliptic.
      const m = A.moonEquatorial(sim);
      const eps = A.obliquity(sim);
      const xq = Math.cos(m.dec) * Math.cos(m.ra), yq = Math.cos(m.dec) * Math.sin(m.ra), zq = Math.sin(m.dec);
      const ve = [xq, yq * Math.cos(eps) + zq * Math.sin(eps), -yq * Math.sin(eps) + zq * Math.cos(eps)].map((v) => v * (m.km / A.AU_KM));
      A.eclipticToScene(ve, S, sc);
      moonDot.position.set(sc[0], sc[1], sc[2]);

      const camToEarth = engine.camera.position.distanceTo(earthPos);
      const near = camToEarth < 1.2;
      earth.mesh.visible = !near;
      earthSystem.visible = near || camToEarth < 3;
      const s = clamp(camToEarth / 1.2, 0.25, 1);
      earthDot.scale.setScalar(s);
      moonDot.scale.setScalar(s * 1.4);

      if (rockPoints) {
        const arr = rockPoints.geometry.attributes.position.array;
        state.rocks.forEach((r, i) => {
          A.smallBodyPosition(r.el, sim, tmp);
          A.eclipticToScene(tmp, S, sc);
          arr[i * 3] = sc[0]; arr[i * 3 + 1] = sc[1]; arr[i * 3 + 2] = sc[2];
          if (r.t && lastSim < r.t && sim >= r.t && clock.playing) sound.ping(sound.note(clamp(1 - Math.log10(r.distAu / LD_AU + 1) / 1.4, 0, 1), 220), { gain: 0.1, dur: 2 });
        });
        rockPoints.geometry.attributes.position.needsUpdate = true;
        const sel = state.selection?.rock;
        if (sel && sel.t) {
          const i = state.rocks.indexOf(sel);
          approachLine.geometry.setFromPoints([earthPos.clone(), new THREE.Vector3(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2])]);
          approachLine.computeLineDistances();
          approachLine.visible = true;
        } else approachLine.visible = false;
      }
      // Keep Earth centred while following it.
      if (state.follow === 'earth' && !engine.flying) {
        const delta = earthPos.clone().sub(engine.controls.target);
        engine.controls.target.add(delta);
        engine.camera.position.add(delta);
      }
      lastSim = sim;
    },
    pickables() {
      const out = planets.map((x) => x.mesh).filter((m) => m.visible);
      if (rockPoints) out.push(rockPoints);
      out.push(earthDot);
      return out;
    },
    configureRaycaster(rc) {
      const d = engine.camera.position.distanceTo(engine.controls.target);
      rc.params.Points.threshold = clamp(d * 0.012, 0.004, 3);
    },
    filterHits(hits) {
      const rock = hits.filter((h) => h.object === rockPoints).sort((a, b) => a.distanceToRay - b.distanceToRay)[0];
      return rock || hits[0] || null;
    },
    hover(hit) {
      if (hit.object === rockPoints) {
        const r = state.rocks[hit.index];
        return r ? { title: r.name, sub: r.t ? `${n2(r.distAu / LD_AU)} LD on ${fmtDate(r.t)}` : 'Sentry object' } : null;
      }
      if (hit.object === earthDot) return { title: 'Earth', sub: 'with the Moon at its true distance' };
      const p = hit.object.userData.planet;
      if (p) {
        A.planetPosition(p, clock.sim, tmp);
        const e = A.planetPosition(A.PLANETS[2], clock.sim);
        const d = Math.hypot(tmp[0] - e[0], tmp[1] - e[1], tmp[2] - e[2]);
        return { title: p.name, sub: p.id === 'earth' ? `${n2(Math.hypot(...tmp))} AU from the Sun` : `${n2(d)} AU from Earth · ${n1((d * A.AU_KM) / 299792.458 / 60)} light-min` };
      }
      return null;
    },
    click(hit) {
      if (hit.object === rockPoints) selectRock(state.rocks[hit.index], { jump: false });
      else if (hit.object.userData.planet?.id === 'mars') ctx.go('mars');
      else if (hit.object.userData.planet?.id === 'earth' || hit.object === earthDot) ctx.go('earth');
    },
    clickEmpty() { if (state.selection) { state.selection = null; highlight(); renderPanel(); } },
    readouts() {
      const next = state.rocks.filter((x) => x.t && x.t >= clock.sim).sort((a, b) => a.t - b.t)[0];
      const closest = state.rocks.filter((x) => x.t && x.t >= Date.now()).sort((a, b) => a.distAu - b.distAu)[0];
      return [
        ['Approaches · 60 d', state.cadCount != null ? n0(state.cadCount) : '…', { loading: state.cadCount == null }],
        ['Next', next ? `${next.name} · ${relTime(next.t, clock.sim)}` : '…'],
        ['Closest', closest ? `${n2(closest.distAu / LD_AU)} LD · ${fmtDate(closest.t)}` : '…'],
        ['This week', state.week?.count != null ? `${state.week.count} objects` : '…'],
        ['Sentry list', state.sentryCount ? `${n0(state.sentryCount)} objects` : '…'],
      ];
    },
    searchItems() {
      return [
        ...state.rocks.map((r) => ({ kind: 'Asteroid', title: r.name, meta: r.t ? `${n2(r.distAu / LD_AU)} LD · ${fmtDate(r.t)}` : 'Sentry', run: () => selectRock(r) })),
        ...A.PLANETS.map((p) => ({ kind: 'Planet', title: p.name, meta: 'orrery', run: () => { const x = planets.find((q) => q.p === p); state.follow = null; engine.flyTo(x.mesh.position.clone().add(new THREE.Vector3(3, 4, 6)), x.mesh.position.clone(), { duration: 2.2 }); } })),
      ];
    },
    tour: {
      closest() { const r = state.rocks.filter((x) => x.t >= Date.now()).sort((a, b) => a.distAu - b.distAu)[0]; if (r) selectRock(r); return r; },
      facts: () => ({ count: state.cadCount, closest: state.rocks.filter((x) => x.t >= Date.now()).sort((a, b) => a.distAu - b.distAu)[0], week: state.week }),
    },
  };
  return api_;
}

function glow(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  stops.forEach(([o, col]) => grad.addColorStop(o, col));
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
