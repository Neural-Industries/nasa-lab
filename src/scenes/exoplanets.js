// EXOPLANETS — every confirmed planet in the NASA Exoplanet Archive at its
// real position around the Sun (RA, Dec, distance), coloured by its star's
// temperature or by how it was found, with the discovery timeline replayable
// as sound, and a procedural impression of any world from its radius and
// equilibrium temperature.
import * as THREE from 'three';
import { api } from '../core/api.js';
import * as A from '../core/astro.js';
import { esc, n0, n1, n2, clamp, prefersReducedMotion } from '../core/util.js';

const LY_PER_PC = 3.26156;
const METHOD_COLORS = {
  Transit: [0.35, 0.78, 1.0],
  'Radial Velocity': [1.0, 0.62, 0.3],
  Microlensing: [0.8, 0.45, 1.0],
  Imaging: [0.4, 1.0, 0.6],
  'Transit Timing Variations': [1.0, 0.9, 0.35],
  'Eclipse Timing Variations': [1.0, 0.8, 0.5],
  'Orbital Brightness Modulation': [1.0, 0.45, 0.55],
  Pulsar: [0.95, 0.95, 1.0],
  Astrometry: [0.6, 1.0, 0.95],
  'Pulsation Timing Variations': [0.85, 0.85, 0.7],
  'Disk Kinematics': [0.7, 0.7, 0.9],
};
const logR = (d) => 120 * Math.log10(1 + d / 10);
// Side-on to the Kepler field (RA 290.7°, Dec +44.5°) so its cone of discoveries reads clearly.
const TRUE_TARGET = new THREE.Vector3(120, 330, 310);
const TRUE_VIEW = new THREE.Vector3(1650, 520, -520);
const LOG_VIEW = new THREE.Vector3(300, 230, 470);

function classify(R, T) {
  if (R == null) return { type: 'unknown', label: 'size unknown' };
  if (R > 6) {
    if (T != null && T > 1000) return { type: 'hotjupiter', label: 'hot gas giant' };
    if (T != null && T < 150) return { type: 'icegiant', label: 'cold giant' };
    return { type: 'gasgiant', label: 'gas giant' };
  }
  if (R >= 2) {
    if (T != null && T < 150) return { type: 'icegiant', label: 'icy Neptune-like world' };
    return { type: 'subneptune', label: 'sub-Neptune' };
  }
  if (T == null) return { type: 'rocky', label: 'rocky world (temperature unknown)' };
  if (T > 1000) return { type: 'lava', label: 'molten rocky world' };
  if (T >= 180 && T <= 320) return { type: 'temperate', label: 'temperate rocky world' };
  if (T < 180) return { type: 'icy', label: 'frozen rocky world' };
  return { type: 'rocky', label: 'hot rocky world' };
}

const TYPE_ID = { rocky: 0, temperate: 1, icy: 2, lava: 3, subneptune: 4, gasgiant: 5, hotjupiter: 6, icegiant: 7, unknown: 0 };

export function create(ctx) {
  const { engine, clock, sound, ui } = ctx;
  const scene = new THREE.Scene();
  const state = {
    data: null, n: 0, loading: true, error: null,
    logMode: false, mix: 0, mixTarget: 0,
    colorBy: 'star', year: 2026, playing: false,
    methods: null, temperate: false, selection: null,
  };
  let rows = [];

  const mat = new THREE.ShaderMaterial({
    uniforms: { uPixel: { value: Math.min(devicePixelRatio, 2) }, uYear: { value: 2100 }, uTime: { value: 0 }, uSel: { value: -1 } },
    vertexShader: /* glsl */ `
      attribute vec3 color; attribute float size; attribute float year; attribute float show; attribute float idx;
      uniform float uPixel; uniform float uYear; uniform float uTime; uniform float uSel;
      varying vec3 vC; varying float vA; varying float vNew; varying float vSel;
      void main() {
        vC = color;
        float born = step(year, uYear);
        vNew = born * (1.0 - smoothstep(0.0, 1.2, uYear - year));
        vSel = step(abs(idx - uSel), 0.5);
        vA = born * show;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float s = size * (1.0 + vNew * 2.5 + vSel * 2.0);
        gl_PointSize = clamp(s * uPixel * (1100.0 / -mv.z), 2.0 * uPixel, 26.0 * uPixel) * vA;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC; varying float vA; varying float vNew; varying float vSel;
      void main() {
        if (vA < 0.5) discard;
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float core = smoothstep(1.0, 0.0, d);
        core = core * core;
        float ring = vSel * smoothstep(0.12, 0.0, abs(d - 0.8));
        vec3 c = mix(vC, vec3(1.0), vNew * 0.6);
        gl_FragColor = vec4(c * (core * (1.5 + vNew * 1.5) + ring * 2.0), max(core, ring));
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  let points = null;
  let posTrue, posLog;

  // The Sun, for scale and orientation
  const sunMark = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 8), new THREE.MeshBasicMaterial({ color: 0xfff1c9 }));
  scene.add(sunMark);
  const sunLabel = engine.addLabel('Sun · you are here', () => (ctx.active === api_ ? sunMark.position : null), { below: true });
  sunLabel.visible = false;
  const rings = new THREE.Group();
  scene.add(rings);
  const ringLabels = [];

  function buildRings() {
    rings.children.forEach((c) => c.geometry.dispose());
    rings.clear();
    ringLabels.forEach((l) => l.remove());
    ringLabels.length = 0;
    for (const pc of [10, 100, 1000]) {
      const r = state.logMode ? logR(pc) : pc;
      const pts = Array.from({ length: 180 }, (_, i) => new THREE.Vector3(Math.cos((i / 180) * Math.PI * 2) * r, 0, Math.sin((i / 180) * Math.PI * 2) * r));
      const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xb9b9bb, transparent: true, opacity: 0.16 }));
      rings.add(ring);
      const p = new THREE.Vector3(r * 0.7071, 0, r * 0.7071);
      const l = engine.addLabel(`${n0(pc * LY_PER_PC)} light-years`, () => (ctx.active === api_ && engine.camera.position.length() < r * 6 ? p : null), { below: true });
      ringLabels.push(l);
    }
  }

  async function load() {
    try {
      const j = await api('/api/exoplanets', 'exoplanet', { timeout: 120000 });
      const c = j.columns;
      const N = j.count;
      rows = [];
      for (let i = 0; i < N; i++) {
        rows.push({
          name: c.pl_name[i], host: c.hostname[i], ra: c.ra[i], dec: c.dec[i], dist: c.sy_dist[i], R: c.pl_rade[i], M: c.pl_bmasse[i],
          period: c.pl_orbper[i], a: c.pl_orbsmax[i], ecc: c.pl_orbeccen[i], T: c.pl_eqt[i], insol: c.pl_insol[i], teff: c.st_teff[i],
          srad: c.st_rad[i], smass: c.st_mass[i], spec: c.st_spectype[i], year: c.disc_year[i], method: c.discoverymethod[i],
          facility: c.disc_facility[i], np: c.sy_pnum[i], ns: c.sy_snum[i],
        });
      }
      state.total = N;
      rows = rows.filter((r) => r.dist != null && r.dist > 0 && r.ra != null && r.dec != null);
      rows.forEach((r, i) => { r.i = i; r.cls = classify(r.R, r.T); });
      state.n = rows.length;
      state.systems = new Set(rows.map((r) => r.host)).size;
      state.methods = new Set(Object.keys(countBy('method')));
      state.fetched = j.fetched;
      build();
      state.loading = false;
      if (state.pendingDeep) { select(find(state.pendingDeep), true); state.pendingDeep = null; }
    } catch (err) {
      state.error = err.message;
      state.loading = false;
    }
    if (ctx.active === api_) renderPanel();
  }

  const countBy = (k) => rows.reduce((m, r) => ((m[r[k]] = (m[r[k]] || 0) + 1), m), {});
  const isTemperate = (r) => r.R != null && r.R <= 1.6 && r.insol != null && r.insol >= 0.35 && r.insol <= 1.5;

  function build() {
    const N = rows.length;
    posTrue = new Float32Array(N * 3);
    posLog = new Float32Array(N * 3);
    const col = new Float32Array(N * 3), size = new Float32Array(N), year = new Float32Array(N), show = new Float32Array(N), idx = new Float32Array(N);
    const v = [0, 0, 0];
    rows.forEach((r, i) => {
      A.raDecToScene(r.ra, r.dec, r.dist, v);
      posTrue.set(v, i * 3);
      A.raDecToScene(r.ra, r.dec, logR(r.dist), v);
      posLog.set(v, i * 3);
      size[i] = clamp(1.2 + Math.sqrt(r.R ?? 2) * 0.9, 1.4, 6);
      year[i] = r.year ?? 2000;
      show[i] = 1;
      idx[i] = i;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posTrue), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('year', new THREE.BufferAttribute(year, 1));
    geo.setAttribute('show', new THREE.BufferAttribute(show, 1));
    geo.setAttribute('idx', new THREE.BufferAttribute(idx, 1));
    points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.name = 'exoplanets';
    scene.add(points);
    recolor();
    buildRings();
    mat.uniforms.uYear.value = state.year + 0.999;
    refilter();
  }

  function recolor() {
    if (!points) return;
    const col = points.geometry.attributes.color.array;
    rows.forEach((r, i) => {
      const c = state.colorBy === 'star' ? A.kelvinToRgb(r.teff || 5000) : (METHOD_COLORS[r.method] || [0.8, 0.8, 0.8]);
      col.set(c, i * 3);
    });
    points.geometry.attributes.color.needsUpdate = true;
  }

  function refilter() {
    if (!points) return;
    const show = points.geometry.attributes.show.array;
    let n = 0;
    rows.forEach((r, i) => {
      const ok = state.methods.has(r.method) && (!state.temperate || isTemperate(r));
      show[i] = ok ? 1 : 0;
      if (ok && (r.year ?? 0) <= state.year) n++;
    });
    state.visible = n;
    points.geometry.attributes.show.needsUpdate = true;
  }

  // ── Mini planet renderer ────────────────────────────────────────────────
  let mini = null;
  function miniRenderer() {
    if (mini) return mini;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 640;
    canvas.setAttribute('aria-hidden', 'true');
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.setPixelRatio(1);
    r.setSize(640, 640, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    const sc = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 10);
    cam.position.set(0, 0, 3.9);
    const uniforms = { uType: { value: 0 }, uTime: { value: 0 }, uSeed: { value: 0 }, uStar: { value: new THREE.Vector3(1, 1, 1) }, uLight: { value: new THREE.Vector3(-0.6, 0.35, 0.72).normalize() } };
    const planet = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `varying vec3 vP; varying vec3 vN; void main(){ vP = position; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uType; uniform float uTime; uniform float uSeed; uniform vec3 uStar; uniform vec3 uLight;
        varying vec3 vP; varying vec3 vN;
        vec3 hash3(vec3 p){ p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6))); return fract(sin(p)*43758.5453)*2.0-1.0; }
        float noise(vec3 p){ vec3 i=floor(p), f=fract(p), u=f*f*(3.0-2.0*f);
          return mix(mix(mix(dot(hash3(i),f),dot(hash3(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x), mix(dot(hash3(i+vec3(0,1,0)),f-vec3(0,1,0)),dot(hash3(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
                     mix(mix(dot(hash3(i+vec3(0,0,1)),f-vec3(0,0,1)),dot(hash3(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x), mix(dot(hash3(i+vec3(0,1,1)),f-vec3(0,1,1)),dot(hash3(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y),u.z); }
        float fbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<6;i++){ s+=a*noise(p); p*=2.02; a*=0.5; } return s; }
        void main(){
          float t = uTime * 0.08;
          float c = cos(t), s = sin(t);
          vec3 p = vec3(c*vP.x + s*vP.z, vP.y, -s*vP.x + c*vP.z) + uSeed;
          vec3 col; float emit = 0.0; float spec = 0.0;
          int ty = int(uType + 0.5);
          if (ty == 0) { float n = fbm(p*3.0); col = mix(vec3(0.35,0.28,0.22), vec3(0.72,0.6,0.48), smoothstep(-0.3,0.4,n)); }
          else if (ty == 1) { float n = fbm(p*2.2); float land = smoothstep(0.02,0.08,n); col = mix(vec3(0.05,0.16,0.38), mix(vec3(0.2,0.36,0.16), vec3(0.55,0.47,0.33), smoothstep(0.1,0.4,n)), land);
            spec = (1.0-land)*0.6; float cl = smoothstep(0.05,0.35,fbm(p*3.5+vec3(t*2.0,0.0,0.0))); col = mix(col, vec3(0.95), cl*0.8); spec *= 1.0-cl;
            col = mix(col, vec3(0.92,0.96,1.0), smoothstep(0.78,0.9,abs(vP.y))); }
          else if (ty == 2) { float n = fbm(p*3.0); col = mix(vec3(0.7,0.8,0.9), vec3(0.95,0.97,1.0), smoothstep(-0.2,0.3,n)); col *= 0.85 + 0.15*smoothstep(0.0,0.02,abs(fbm(p*9.0))); }
          else if (ty == 3) { float n = fbm(p*3.5); float cr = 1.0 - smoothstep(0.0,0.06,abs(fbm(p*6.0))); col = vec3(0.08,0.06,0.05) + vec3(0.12)*smoothstep(-0.2,0.5,n); emit = cr*1.8; }
          else if (ty == 4) { float b = sin(vP.y*9.0 + fbm(p*2.5)*2.5); col = mix(vec3(0.36,0.62,0.72), vec3(0.62,0.82,0.86), 0.5+0.5*b); col = mix(col, vec3(0.85,0.93,0.95), 0.25); }
          else if (ty == 5) { float b = sin(vP.y*16.0 + fbm(p*vec3(1.0,6.0,1.0))*3.0); col = mix(vec3(0.62,0.48,0.34), vec3(0.93,0.86,0.72), 0.5+0.5*b); col = mix(col, vec3(0.75,0.45,0.3), smoothstep(0.55,0.8,fbm(p*vec3(3.0,12.0,3.0)))*0.5); }
          else if (ty == 6) { float b = sin(vP.y*12.0 + fbm(p*vec3(1.0,5.0,1.0))*3.0); col = mix(vec3(0.16,0.09,0.08), vec3(0.34,0.2,0.15), 0.5+0.5*b); emit = 0.35 + 0.25*b; }
          else { float b = sin(vP.y*7.0 + fbm(p*2.0)); col = mix(vec3(0.55,0.78,0.84), vec3(0.72,0.9,0.93), 0.5+0.5*b); }
          vec3 N = normalize(vN);
          float ndl = dot(N, uLight);
          float diff = smoothstep(-0.05, 0.6, ndl);
          vec3 V = vec3(0.0,0.0,1.0);
          vec3 H = normalize(uLight + V);
          float sp = pow(max(dot(N,H),0.0), 40.0) * spec * step(0.0, ndl);
          float rim = pow(1.0 - max(dot(N,V),0.0), 3.0);
          vec3 lit = col * uStar * diff * 1.25 + uStar * sp + col * 0.02;
          vec3 glowCol = ty == 3 ? vec3(1.0,0.4,0.08) : vec3(0.9,0.25,0.1);
          lit += glowCol * emit * (ty == 6 ? (1.0 - diff) : 1.0);
          vec3 atm = ty == 1 ? vec3(0.35,0.6,1.0) : ty >= 4 ? col : vec3(0.0);
          lit += atm * rim * diff * 0.6;
          gl_FragColor = vec4(lit, 1.0);
        }`,
    }));
    sc.add(planet);
    let raf = 0;
    const loop = () => {
      if (!canvas.isConnected) { raf = 0; return; }
      uniforms.uTime.value += prefersReducedMotion() ? 0 : 0.016;
      r.render(sc, cam);
      raf = requestAnimationFrame(loop);
    };
    mini = { canvas, uniforms, start() { if (!raf) raf = requestAnimationFrame(loop); } };
    return mini;
  }

  // ── Panel ──────────────────────────────────────────────────────────────
  function find(name) { return rows.find((r) => r.name === name); }

  function notable() {
    if (!rows.length) return [];
    const byDist = [...rows].sort((a, b) => a.dist - b.dist);
    const picks = [];
    const add = (r, why) => { if (r && !picks.some((p) => p.r === r)) picks.push({ r, why }); };
    add(byDist[0], 'the nearest known exoplanet');
    add(find('51 Peg b'), 'first planet found around a Sun-like star, 1995');
    add(find('TRAPPIST-1 e'), 'one of seven Earth-sized worlds around one small star');
    add(find('Kepler-186 f'), 'first Earth-sized planet found in a habitable zone');
    add(find('Kepler-22 b'), 'Kepler\'s first habitable-zone find');
    add(find('HD 209458 b'), 'first planet seen transiting its star');
    add(find('PSR B1257+12 c'), 'among the very first exoplanets, orbiting a pulsar');
    add([...rows].filter((r) => r.T != null).sort((a, b) => b.T - a.T)[0], 'the hottest on record here');
    add(byDist[byDist.length - 1], 'the most distant with a measured distance');
    return picks;
  }

  function renderPanel() {
    if (ctx.active !== api_) return;
    if (state.selection) return renderPlanet(state.selection);
    const methods = rows.length ? Object.entries(countBy('method')).sort((a, b) => b[1] - a[1]) : [];
    const temperate = rows.filter(isTemperate).length;
    const thisYear = rows.filter((r) => r.year === 2026).length;
    const nearest = rows.length ? rows.reduce((a, b) => (a.dist < b.dist ? a : b)) : null;
    const html = `
      <h2>${state.n ? `${n0(state.total)} worlds` : 'Every known world'}</h2>
      <p class="lede">Every confirmed planet beyond the Solar System, from NASA's Exoplanet Archive, placed where it really is around the Sun. The dense cone is the patch of sky the Kepler telescope stared at for four years.</p>
      ${state.error ? `<p class="err">The Exoplanet Archive didn't answer (${esc(state.error)}).</p>` : ''}
      ${state.loading ? '<div class="skeleton"></div><div class="skeleton w60"></div>' : ''}
      ${rows.length ? `
      <dl class="stats">
        <div><dt>Confirmed planets</dt><dd>${n0(state.total)}</dd></div>
        <div><dt>Planetary systems</dt><dd>${n0(state.systems)}</dd></div>
        <div><dt>Nearest</dt><dd>${n1(nearest.dist * LY_PER_PC)} <small>ly</small></dd></div>
        <div><dt>Found in 2026</dt><dd>${n0(thisYear)}</dd></div>
      </dl>

      <h3>Discovery timeline <small>${state.playing ? 'playing' : 'drag or play'}</small></h3>
      <div style="display:flex;gap:10px;align-items:center">
        <button class="icon-btn" type="button" id="x-play" aria-label="${state.playing ? 'Pause' : 'Play'} discovery timeline"><svg viewBox="0 0 24 24">${state.playing ? '<path d="M8 5v14M16 5v14"/>' : '<path d="M7 5l12 7-12 7z" fill="currentColor"/>'}</svg></button>
        <input type="range" id="x-year" min="1992" max="2026" step="1" value="${state.year}" aria-label="Show planets discovered up to this year"/>
        <output class="mono" id="x-year-out" style="min-width:3.2em;text-align:right;font-weight:600">${state.year}</output>
      </div>
      <p class="src" id="x-count">${n0(state.visible ?? state.n)} shown</p>

      <h3>View</h3>
      <div class="chips" role="group" aria-label="Distance scale">
        <button class="chip" type="button" data-dist="true" aria-pressed="${!state.logMode}">True distances</button>
        <button class="chip" type="button" data-dist="log" aria-pressed="${state.logMode}">Logarithmic</button>
      </div>
      <div class="chips" role="group" aria-label="Colour by">
        <button class="chip" type="button" data-color="star" aria-pressed="${state.colorBy === 'star'}">Colour: star temperature</button>
        <button class="chip" type="button" data-color="method" aria-pressed="${state.colorBy === 'method'}">Colour: discovery method</button>
      </div>
      <div class="chips">
        <button class="chip" type="button" id="x-temperate" aria-pressed="${state.temperate}">Only temperate, Earth-sized · ${n0(temperate)}</button>
      </div>
      ${state.temperate ? '<p class="note">Planets under 1.6 Earth radii that receive between 0.35 and 1.5 times the starlight Earth does. That makes them candidates for liquid water, not confirmed habitable worlds.</p>' : ''}

      <h3>Discovery methods</h3>
      <div class="chips">${methods.map(([m, k]) => `<button class="chip" type="button" data-method="${esc(m)}" aria-pressed="${state.methods.has(m)}">${state.colorBy === 'method' ? `<span class="swatch" style="background:rgb(${(METHOD_COLORS[m] || [0.8, 0.8, 0.8]).map((x) => Math.round(x * 255)).join(',')})"></span>` : ''}${esc(m)} <span class="num">${n0(k)}</span></button>`).join('')}</div>

      <h3>Notable worlds</h3>
      <ul class="list">${notable().map(({ r, why }) => `<li><button type="button" data-planet="${r.i}"><span class="t">${esc(r.name)}</span><span class="m">${n1(r.dist * LY_PER_PC)} ly</span><span class="s">${esc(why)}</span></button></li>`).join('')}</ul>
      <p class="src">Source: <a href="https://exoplanetarchive.ipac.caltech.edu/" target="_blank" rel="noopener">NASA Exoplanet Archive</a>, Planetary Systems Composite Parameters (TAP). ${state.n < state.total ? `${n0(state.total - state.n)} planets without a measured distance aren't placed.` : ''}</p>
      ` : ''}
    `;
    const el = ui.setPanel(html);
    wire(el);
  }

  function wire(el) {
    el.querySelector('#x-play')?.addEventListener('click', togglePlay);
    el.querySelector('#x-year')?.addEventListener('input', (e) => { state.playing = false; setYear(Number(e.target.value)); });
    el.querySelectorAll('[data-dist]').forEach((b) => b.addEventListener('click', () => setLog(b.dataset.dist === 'log')));
    el.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => { state.colorBy = b.dataset.color; recolor(); renderPanel(); }));
    el.querySelector('#x-temperate')?.addEventListener('click', () => { state.temperate = !state.temperate; refilter(); renderPanel(); });
    el.querySelectorAll('[data-method]').forEach((b) => b.addEventListener('click', () => {
      const m = b.dataset.method;
      if (state.methods.has(m)) state.methods.delete(m); else state.methods.add(m);
      refilter();
      renderPanel();
    }));
    el.querySelectorAll('[data-planet]').forEach((b) => b.addEventListener('click', () => select(rows[Number(b.dataset.planet)], true)));
  }

  function setYear(y) {
    const prev = state.year;
    state.year = y;
    mat.uniforms.uYear.value = y + 0.999;
    refilter();
    const out = document.getElementById('x-year-out');
    if (out) out.textContent = y;
    const slider = document.getElementById('x-year');
    if (slider && Number(slider.value) !== y) slider.value = y;
    const cnt = document.getElementById('x-count');
    if (cnt) cnt.textContent = `${n0(state.visible)} shown · ${n0(rows.filter((r) => r.year === y).length)} found in ${y}`;
    if (y > prev) {
      const found = rows.filter((r) => r.year === y).length;
      sound.ping(sound.note(clamp(Math.log10(found + 1) / 3.2, 0, 1), 196, 3), { gain: 0.1, dur: 1.4 });
    }
  }

  let playTimer = null;
  function togglePlay() {
    state.playing = !state.playing;
    clearInterval(playTimer);
    if (state.playing) {
      if (state.year >= 2026) setYear(1991);
      if (!state.logMode) setLog(true, false);
      engine.flyTo(LOG_VIEW.clone(), new THREE.Vector3(), { duration: 2 });
      playTimer = setInterval(() => {
        if (state.year >= 2026) { state.playing = false; clearInterval(playTimer); renderPanel(); return; }
        setYear(state.year + 1);
      }, 900);
    }
    renderPanel();
  }

  function setLog(on, render = true) {
    state.logMode = on;
    state.mixTarget = on ? 1 : 0;
    buildRings();
    if (render) renderPanel();
    engine.flyTo(on ? LOG_VIEW.clone() : TRUE_VIEW.clone(), on ? new THREE.Vector3() : TRUE_TARGET.clone(), { duration: 2 });
  }

  function positionOf(r, out = new THREE.Vector3()) {
    const a = points.geometry.attributes.position.array;
    return out.set(a[r.i * 3], a[r.i * 3 + 1], a[r.i * 3 + 2]);
  }

  function select(r, fly) {
    if (!r) return;
    state.selection = r;
    mat.uniforms.uSel.value = r.i;
    if (fly && points) {
      const p = positionOf(r);
      const dir = p.clone().normalize();
      const dist = Math.max(8, p.length() * 0.08);
      engine.flyTo(p.clone().add(dir.multiplyScalar(dist)).add(new THREE.Vector3(0, dist * 0.4, 0)), p, { duration: 2.6 });
    }
    sound.ping(sound.note(clamp(1 - Math.log10(r.dist) / 4, 0, 1), 262), { gain: 0.09 });
    renderPanel();
  }

  function renderPlanet(r) {
    const siblings = rows.filter((x) => x.host === r.host && x !== r);
    const T = r.T != null ? `${n0(r.T)} K (${n0(r.T - 273.15)} °C)` : '—';
    const el = ui.setPanel(`
      <button class="etch-btn etch-btn--small" type="button" id="back" style="margin-bottom:14px">← All worlds</button>
      <h2>${esc(r.name)}</h2>
      <p class="lede">A ${esc(r.cls.label)}, ${n1(r.dist * LY_PER_PC)} light-years away, found by ${esc(r.method.toLowerCase())} in ${esc(r.year)}${r.facility ? ` (${esc(r.facility)})` : ''}.</p>
      <figure class="figure" id="mini-slot"></figure>
      <p class="src" style="margin-top:10px">An impression generated from the archive's radius and temperature. No exoplanet has ever been photographed in this detail.</p>
      <dl class="stats">
        <div><dt>Radius</dt><dd>${r.R != null ? `${n2(r.R)} <small>R⊕</small>` : '—'}</dd></div>
        <div><dt>Mass</dt><dd>${r.M != null ? `${n1(r.M)} <small>M⊕</small>` : '—'}</dd></div>
        <div><dt>Year length</dt><dd>${r.period != null ? (r.period < 2 ? `${n1(r.period * 24)} <small>hours</small>` : `${n1(r.period)} <small>days</small>`) : '—'}</dd></div>
        <div><dt>Orbit</dt><dd>${r.a != null ? `${n2(r.a)} <small>AU</small>` : '—'}</dd></div>
        <div><dt>Equilibrium temp.</dt><dd style="font-size:13px">${T}</dd></div>
        <div><dt>Starlight vs Earth</dt><dd>${r.insol != null ? `${n2(r.insol)}×` : '—'}</dd></div>
      </dl>
      <h3>Its star <small>${esc(r.host)}</small></h3>
      <dl class="stats">
        <div><dt>Temperature</dt><dd>${r.teff != null ? `${n0(r.teff)} <small>K</small>` : '—'}</dd></div>
        <div><dt>Type</dt><dd>${esc(r.spec || '—')}</dd></div>
        <div><dt>Radius</dt><dd>${r.srad != null ? `${n2(r.srad)} <small>R☉</small>` : '—'}</dd></div>
        <div><dt>Planets known</dt><dd>${esc(r.np ?? '—')}</dd></div>
      </dl>
      ${siblings.length ? `<ul class="list" style="margin-top:10px">${siblings.map((x) => `<li><button type="button" data-planet="${x.i}"><span class="t">${esc(x.name)}</span><span class="m">${x.R != null ? `${n2(x.R)} R⊕` : ''}</span></button></li>`).join('')}</ul>` : ''}
      <span class="src"><a href="https://exoplanetarchive.ipac.caltech.edu/overview/${encodeURIComponent(r.host)}" target="_blank" rel="noopener">Archive overview of ${esc(r.host)} ↗</a></span>
    `);
    el.querySelector('#back').addEventListener('click', () => { state.selection = null; mat.uniforms.uSel.value = -1; renderPanel(); });
    el.querySelectorAll('[data-planet]').forEach((b) => b.addEventListener('click', () => select(rows[Number(b.dataset.planet)], true)));
    const m = miniRenderer();
    m.uniforms.uType.value = TYPE_ID[r.cls.type];
    m.uniforms.uSeed.value = (r.i * 7.31) % 50;
    const [cr, cg, cb] = A.kelvinToRgb(r.teff || 5700);
    m.uniforms.uStar.value.set(cr, cg, cb);
    const slot = el.querySelector('#mini-slot');
    m.canvas.style.width = '100%';
    m.canvas.style.height = 'auto';
    m.canvas.style.background = '#050507';
    slot.append(m.canvas);
    m.start();
  }

  const api_ = {
    id: 'exoplanets',
    title: 'Exoplanets',
    scene,
    timeRange: [-7, 7],
    marks: [],
    async init() { load(); },
    enter(opts = {}) {
      if (opts.deep) { if (rows.length) setTimeout(() => select(find(opts.deep), true), 3100); else state.pendingDeep = opts.deep; }
      const cam = engine.camera;
      cam.near = 0.1; cam.far = 60000; cam.updateProjectionMatrix();
      engine.controls.minDistance = 2;
      engine.controls.maxDistance = 20000;
      engine.bloom.strength = 0.8;
      engine.bloom.threshold = 0.6;
      sunLabel.visible = true;
      ringLabels.forEach((l) => { l.visible = true; });
      cam.position.set(1400, 900, 2200);
      engine.controls.target.set(0, 0, 0);
      engine.flyTo(state.logMode ? LOG_VIEW.clone() : TRUE_VIEW.clone(), state.logMode ? new THREE.Vector3() : TRUE_TARGET.clone(), { duration: 3 });
      renderPanel();
      api_.mood();
    },
    exit() {
      sunLabel.visible = false;
      ringLabels.forEach((l) => { l.visible = false; });
      state.playing = false;
      clearInterval(playTimer);
    },
    mood() { sound.mood({ base: 36.7, bright: 0.45, wind: 0 }); },
    update(dt) {
      mat.uniforms.uTime.value += dt;
      if (points && Math.abs(state.mix - state.mixTarget) > 1e-4) {
        state.mix += (state.mixTarget - state.mix) * Math.min(1, dt * 3.5);
        if (Math.abs(state.mix - state.mixTarget) < 0.002) state.mix = state.mixTarget;
        const arr = points.geometry.attributes.position.array;
        const k = state.mix;
        for (let i = 0; i < arr.length; i++) arr[i] = posTrue[i] + (posLog[i] - posTrue[i]) * k;
        points.geometry.attributes.position.needsUpdate = true;
      }
    },
    pickables: () => (points ? [points] : []),
    configureRaycaster(rc) { rc.params.Points.threshold = engine.camera.position.distanceTo(engine.controls.target) * 0.008; },
    filterHits(hits) {
      const show = points.geometry.attributes.show.array;
      const yr = points.geometry.attributes.year.array;
      return hits.filter((h) => show[h.index] > 0.5 && yr[h.index] <= state.year).sort((a, b) => a.distanceToRay - b.distanceToRay)[0] || null;
    },
    hover(hit) {
      const r = rows[hit.index];
      return r ? { title: r.name, sub: `${r.cls.label} · ${n1(r.dist * LY_PER_PC)} ly · ${r.year}` } : null;
    },
    click(hit) { select(rows[hit.index], false); },
    clickEmpty() { if (state.selection) { state.selection = null; mat.uniforms.uSel.value = -1; renderPanel(); } },
    readouts() {
      const nearest = rows.length ? rows.reduce((a, b) => (a.dist < b.dist ? a : b)) : null;
      return [
        ['Confirmed planets', state.total ? n0(state.total) : '…', { loading: !state.total }],
        ['Systems', state.systems ? n0(state.systems) : '…'],
        ['Showing', state.visible != null ? n0(state.visible) : state.n ? n0(state.n) : '…'],
        ['Discovered by', String(state.year)],
        ['Nearest', nearest ? `${nearest.name} · ${n1(nearest.dist * LY_PER_PC)} ly` : '…'],
      ];
    },
    searchItems() { return rows.map((r) => ({ kind: 'Exoplanet', title: r.name, meta: `${n1(r.dist * LY_PER_PC)} ly · ${r.cls.label}`, run: () => select(r, true) })); },
    focus(opts = {}) { if (opts.deep) { const r = find(opts.deep); if (r) select(r, true); } },
    tour: {
      timeline() { if (!state.playing) togglePlay(); },
      pick(name) { const r = find(name) || rows.reduce((a, b) => (a.dist < b.dist ? a : b), rows[0]); if (r) select(r, true); return r; },
      facts: () => ({ total: state.total, systems: state.systems, temperate: rows.filter(isTemperate).length }),
    },
  };
  return api_;
}
