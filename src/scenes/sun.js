// THE SUN, THIS MONTH — DONKI's solar flares placed where they erupted on
// the disc (carried round by the Sun's differential rotation), its coronal
// mass ejections as expanding shells flying outward at their measured speed,
// true to scale, and the geomagnetic storms they caused when they hit Earth.
import * as THREE from 'three';
import { api } from '../core/api.js';
import { esc, fmtUTC, fmtDate, n0, n1, relTime, isoDay, parseUTC, safeUrl, clamp } from '../core/util.js';
import { D2R, SUN_RADIUS_KM, AU_KM } from '../core/astro.js';

const EARTH_DIST = AU_KM / SUN_RADIUS_KM; // ≈ 215 solar radii
const CLASS_BASE = { A: 1e-8, B: 1e-7, C: 1e-6, M: 1e-5, X: 1e-4 };

function flareFlux(cls) {
  const m = /^([ABCMX])(\d+(?:\.\d+)?)?/.exec(cls || '');
  if (!m) return 1e-6;
  return CLASS_BASE[m[1]] * (m[2] ? Number(m[2]) : 1);
}

function parseLocation(s) {
  const m = /([NS])(\d+)\s*([EW])(\d+)/i.exec(s || '');
  if (!m) return null;
  return { lat: Number(m[2]) * (m[1].toUpperCase() === 'S' ? -1 : 1), lonW: Number(m[4]) * (m[3].toUpperCase() === 'E' ? -1 : 1) };
}

/** Synodic differential rotation rate in degrees/day (Snodgrass & Ulrich, sidereal − Earth's orbital rate). */
const synodicRate = (latDeg) => {
  const s2 = Math.sin(latDeg * D2R) ** 2;
  return 14.713 - 2.396 * s2 - 1.787 * s2 * s2 - 0.9856;
};

const sunPoint = (lat, lonW, r = 1) => new THREE.Vector3(
  r * Math.cos(lat * D2R) * Math.sin(lonW * D2R),
  r * Math.sin(lat * D2R),
  r * Math.cos(lat * D2R) * Math.cos(lonW * D2R),
);

export function create(ctx) {
  const { engine, clock, sound, ui } = ctx;
  const scene = new THREE.Scene();
  const state = { flares: [], cmes: [], storms: [], notes: [], loaded: false, error: null, selection: null };

  // ── The Sun ────────────────────────────────────────────────────────────
  const sunUniforms = { uTime: { value: 0 }, uRot: { value: 0 } };
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(1, 128, 64),
    new THREE.ShaderMaterial({
      uniforms: sunUniforms,
      vertexShader: /* glsl */ `
        varying vec3 vP; varying vec3 vN; varying vec3 vV;
        void main() {
          vP = position;
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uRot;
        varying vec3 vP; varying vec3 vN; varying vec3 vV;
        vec3 hash3(vec3 p) { p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6))); return fract(sin(p) * 43758.5453123) * 2.0 - 1.0; }
        float noise(vec3 p) {
          vec3 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(dot(hash3(i), f), dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                         mix(dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0)), dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
                     mix(mix(dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1)), dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                         mix(dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1)), dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
        }
        float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
        void main() {
          float c = cos(uRot), s = sin(uRot);
          vec3 p = vec3(c * vP.x + s * vP.z, vP.y, -s * vP.x + c * vP.z);
          float gran = fbm(p * 22.0 + vec3(0.0, uTime * 0.05, 0.0));
          float cells = fbm(p * 5.0 - vec3(uTime * 0.01));
          float mu = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
          float limb = 0.35 + 0.65 * pow(mu, 0.55);
          vec3 hot = vec3(1.0, 0.74, 0.36), warm = vec3(0.92, 0.36, 0.07), cool = vec3(0.55, 0.13, 0.02);
          float g = smoothstep(-0.18, 0.28, gran + cells * 0.5);
          vec3 col = mix(warm, hot, g);
          col = mix(cool, col, limb);
          gl_FragColor = vec4(col * (1.05 * limb + 0.06), 1.0);
        }`,
    }),
  );
  sun.name = 'sun';
  scene.add(sun);

  const coronaTex = glowTexture([[0, 'rgba(255,236,200,0.55)'], [0.2, 'rgba(255,190,110,0.22)'], [0.45, 'rgba(255,140,60,0.05)'], [1, 'rgba(255,120,40,0)']]);
  const corona = new THREE.Sprite(new THREE.SpriteMaterial({ map: coronaTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  corona.scale.setScalar(6.5);
  scene.add(corona);

  // ── Earth marker ──────────────────────────────────────────────────────
  const earth = new THREE.Group();
  earth.position.set(0, 0, EARTH_DIST);
  const earthBall = new THREE.Mesh(new THREE.SphereGeometry(0.9, 32, 16), new THREE.MeshBasicMaterial({ color: 0x5d8fd6 }));
  earth.add(earthBall);
  const hitGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture([[0, 'rgba(120,200,255,0.9)'], [0.3, 'rgba(90,160,255,0.35)'], [1, 'rgba(60,120,255,0)']]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  hitGlow.scale.setScalar(26);
  earth.add(hitGlow);
  scene.add(earth);
  const orbit = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(Array.from({ length: 256 }, (_, i) => new THREE.Vector3(Math.sin((i / 256) * Math.PI * 2) * EARTH_DIST, 0, Math.cos((i / 256) * Math.PI * 2) * EARTH_DIST))),
    new THREE.LineBasicMaterial({ color: 0xb9b9bb, transparent: true, opacity: 0.18 }),
  );
  scene.add(orbit);
  const sunEarthLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, EARTH_DIST - 1)]),
    new THREE.LineDashedMaterial({ color: 0xb9b9bb, transparent: true, opacity: 0.22, dashSize: 3, gapSize: 3 }));
  sunEarthLine.computeLineDistances();
  scene.add(sunEarthLine);

  // ── Flares ─────────────────────────────────────────────────────────────
  const flareMat = new THREE.ShaderMaterial({
    uniforms: { uPixel: { value: Math.min(devicePixelRatio, 2) } },
    vertexShader: /* glsl */ `
      attribute float size; attribute float glow; attribute vec3 color;
      uniform float uPixel;
      varying float vGlow; varying vec3 vC;
      void main() {
        vGlow = glow; vC = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * uPixel * (10.0 / -mv.z) * (0.6 + glow * 2.2);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vGlow; varying vec3 vC;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c) * 2.0;
        float core = smoothstep(0.35, 0.0, d);
        float spikes = pow(max(0.0, 1.0 - abs(c.x * c.y) * 60.0), 6.0) * smoothstep(1.0, 0.1, d);
        float a = (core + spikes * vGlow) * (0.18 + vGlow);
        if (a < 0.01) discard;
        gl_FragColor = vec4(vC * a * 2.2, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  let flarePoints = null;

  // ── CMEs ───────────────────────────────────────────────────────────────
  const cmeGroup = new THREE.Group();
  scene.add(cmeGroup);
  const cmeMat = (color) => new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: /* glsl */ `
      varying float vEdge; varying vec3 vN; varying vec3 vV;
      void main() {
        vEdge = uv.y;
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity; uniform vec3 uColor;
      varying float vEdge; varying vec3 vN; varying vec3 vV;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.5);
        float edge = smoothstep(0.0, 0.25, 1.0 - vEdge);
        float a = uOpacity * (0.04 + rim * rim * 1.1) * (0.35 + edge * 0.65);
        gl_FragColor = vec4(uColor * a * 1.5, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });

  function buildCmes() {
    cmeGroup.clear();
    for (const c of state.cmes) {
      const half = clamp(c.halfAngle, 5, 80) * D2R;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 12, 0, Math.PI * 2, 0, half), cmeMat(c.earthward ? 0xffc27a : 0xffe7c2));
      const axis = sunPoint(c.lat, c.lon).normalize();
      cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
      cap.visible = false;
      cap.userData.cme = c;
      c.mesh = cap;
      cmeGroup.add(cap);
    }
  }

  // ── Data ───────────────────────────────────────────────────────────────
  async function load() {
    const end = isoDay(Date.now());
    const start = isoDay(Date.now() - 30 * 86400000);
    const q = `startDate=${start}&endDate=${end}`;
    const [flr, cme, gst, notes] = await Promise.allSettled([
      api(`/api/donki/FLR?${q}`, 'donki'),
      api(`/api/donki/CMEAnalysis?${q}`, 'donki'),
      api(`/api/donki/GST?${q}`, 'donki'),
      api(`/api/donki/notifications?startDate=${isoDay(Date.now() - 7 * 86400000)}&endDate=${end}`, 'donki'),
    ]);
    if (flr.status === 'rejected' && cme.status === 'rejected') state.error = flr.reason?.message || 'DONKI unavailable';

    state.flares = (flr.value || []).map((f) => {
      const loc = parseLocation(f.sourceLocation);
      return {
        id: f.flrID, cls: f.classType || '?', flux: flareFlux(f.classType), begin: parseUTC(f.beginTime), peak: parseUTC(f.peakTime || f.beginTime),
        end: parseUTC(f.endTime), loc, region: f.activeRegionNum, link: f.link, note: f.note,
      };
    }).filter((f) => Number.isFinite(f.peak)).sort((a, b) => a.peak - b.peak);

    state.cmes = (cme.value || []).map((c) => {
      const t21 = parseUTC(c.time21_5);
      const axis = sunPoint(c.latitude ?? 0, c.longitude ?? 0).normalize();
      const offEarth = Math.acos(clamp(axis.z, -1, 1)) / D2R;
      const earthward = offEarth < (c.halfAngle ?? 0) + 5;
      const eta = earthward && c.speed > 0 ? t21 + ((EARTH_DIST - 21.5) * SUN_RADIUS_KM / c.speed) * 1000 : null;
      return { id: c.associatedCMEID, t21, lat: c.latitude ?? 0, lon: c.longitude ?? 0, halfAngle: c.halfAngle ?? 20, speed: c.speed ?? 0, type: c.type, note: c.note, link: c.link, earthward, offEarth, eta };
    }).filter((c) => Number.isFinite(c.t21) && c.speed > 0);
    // One entry per CME: DONKI can hold several "most accurate" analyses of the same event.
    state.cmes = [...new Map(state.cmes.map((c) => [c.id, c])).values()].sort((a, b) => a.t21 - b.t21);

    state.storms = (gst.value || []).map((g) => ({
      id: g.gstID, start: parseUTC(g.startTime), link: g.link,
      kp: Math.max(0, ...(g.allKpIndex || []).map((k) => k.kpIndex || 0)),
    })).filter((g) => Number.isFinite(g.start)).sort((a, b) => a.start - b.start);

    state.notes = (notes.value || []).map((n) => ({ type: n.messageType, t: parseUTC(n.messageIssueTime), url: n.messageURL, id: n.messageID, body: n.messageBody || '' }))
      .sort((a, b) => b.t - a.t);

    buildFlares();
    buildCmes();
    state.loaded = true;
    updateMarks();
    if (ctx.active === api_) renderPanel();
  }

  function buildFlares() {
    if (flarePoints) { scene.remove(flarePoints); flarePoints.geometry.dispose(); }
    const list = state.flares.filter((f) => f.loc);
    state.placed = list;
    const N = list.length;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const size = new Float32Array(N), col = new Float32Array(N * 3);
    list.forEach((f, i) => {
      const lg = Math.log10(f.flux);
      size[i] = 6 + (lg + 7) * 7;
      const hot = clamp((lg + 6) / 2, 0, 1);
      col.set([1, 0.75 + 0.2 * hot, 0.45 + 0.5 * hot], i * 3);
    });
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(N), 1));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    flarePoints = new THREE.Points(geo, flareMat);
    flarePoints.frustumCulled = false;
    flarePoints.name = 'flares';
    scene.add(flarePoints);
  }

  function updateMarks() {
    const marks = [
      ...state.flares.map((f) => ({ t: f.peak, label: `${f.cls} flare`, strength: clamp((Math.log10(f.flux) + 7) / 3.5, 0.15, 1) })),
      ...state.cmes.map((c) => ({ t: c.t21, label: `CME ${n0(c.speed)} km/s`, strength: clamp(c.speed / 2000, 0.2, 1) })),
      ...state.storms.map((g) => ({ t: g.start, label: `Storm Kp ${g.kp}`, strength: 1 })),
    ];
    api_.marks = marks;
    if (ctx.active === api_) ui.setTimeRange(api_.timeRange, marks);
  }

  // ── Per-frame state ────────────────────────────────────────────────────
  let lastSim = clock.sim;

  function stepFlares(sim) {
    if (!flarePoints) return;
    const pos = flarePoints.geometry.attributes.position.array;
    const glow = flarePoints.geometry.attributes.glow.array;
    state.placed.forEach((f, i) => {
      const days = (sim - f.peak) / 86400000;
      const lonW = f.loc.lonW + synodicRate(f.loc.lat) * days;
      const p = sunPoint(f.loc.lat, lonW, 1.004);
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      // Bright at the peak, a lingering scar afterwards, nothing before it happened.
      let g = 0;
      if (sim >= f.begin - 600000) {
        const dtH = (sim - f.peak) / 3600000;
        g = dtH < 0 ? clamp(1 + dtH / 0.5, 0, 1) : Math.max(Math.exp(-dtH / 2.5), days < 3 ? 0.12 : 0.04);
        if (lonW > 100) g = 0; // rotated behind the west limb
      }
      glow[i] = g;
      // Sonify a flare the moment the clock sweeps across its peak.
      if (lastSim < f.peak && sim >= f.peak && clock.playing && sim - lastSim < 5 * 86400000) {
        const lg = Math.log10(f.flux);
        sound.ping(sound.note(clamp((lg + 7) / 3.5, 0, 1), 196, 3), { gain: clamp(0.04 + (lg + 6) * 0.06, 0.03, 0.2), pan: clamp(f.loc.lonW / 90, -1, 1), dur: 2.4 });
      }
    });
    flarePoints.geometry.attributes.position.needsUpdate = true;
    flarePoints.geometry.attributes.glow.needsUpdate = true;
  }

  function stepCmes(sim) {
    let fastestActive = 0;
    for (const c of state.cmes) {
      const r = 21.5 + (c.speed * (sim - c.t21)) / 1000 / SUN_RADIUS_KM;
      const t0 = c.t21 - ((21.5 - 1) * SUN_RADIUS_KM / c.speed) * 1000; // leaves the surface
      const vis = sim >= t0 && r < EARTH_DIST * 1.35;
      c.mesh.visible = vis;
      if (!vis) continue;
      const rr = Math.max(1.05, r);
      c.mesh.scale.setScalar(rr);
      const fade = 1 - clamp((rr - 60) / (EARTH_DIST * 1.35 - 60), 0, 1);
      c.mesh.material.uniforms.uOpacity.value = 0.34 * fade + 0.04;
      fastestActive = Math.max(fastestActive, c.speed);
      if (lastSim < t0 && sim >= t0 && clock.playing) sound.sweep();
    }
    return fastestActive;
  }

  function stepStorms(sim) {
    let flash = 0;
    for (const g of state.storms) {
      const dtH = (sim - g.start) / 3600000;
      if (dtH >= 0 && dtH < 18) flash = Math.max(flash, (1 - dtH / 18) * clamp(g.kp / 9, 0.3, 1));
      if (lastSim < g.start && sim >= g.start && clock.playing) sound.ping(sound.note(0.1, 110), { gain: 0.18, dur: 3.5, type: 'triangle' });
    }
    hitGlow.material.opacity = flash;
  }

  // ── Panel ──────────────────────────────────────────────────────────────
  function counts() {
    const c = { X: 0, M: 0, C: 0, other: 0 };
    for (const f of state.flares) { const k = f.cls[0]; if (k in c) c[k]++; else c.other++; }
    return c;
  }

  function renderPanel() {
    if (ctx.active !== api_) return;
    if (state.selection?.kind === 'flare') return renderFlare(state.selection.flare);
    if (state.selection?.kind === 'cme') return renderCme(state.selection.cme);
    const c = counts();
    const strongest = [...state.flares].sort((a, b) => b.flux - a.flux)[0];
    const fastest = [...state.cmes].sort((a, b) => b.speed - a.speed)[0];
    const earthward = state.cmes.filter((x) => x.earthward);
    const maxKp = state.storms.length ? Math.max(...state.storms.map((g) => g.kp)) : null;
    const html = `
      <h2>The Sun, this month</h2>
      <p class="lede">Every flare and coronal mass ejection NASA's space-weather forecasters logged in the last 30 days, placed where it happened. Distances are true to scale: Earth is 215 solar radii away, down the dashed line.</p>
      <div class="row-actions">
        <button class="etch-btn etch-btn--primary etch-btn--small" type="button" id="replay">Replay the last 30 days</button>
        <button class="etch-btn etch-btn--small" type="button" id="zoom-out">Pull back to Earth</button>
      </div>
      ${state.error ? `<p class="err">DONKI isn't answering right now (${esc(state.error)}). Try again in a minute.</p>` : ''}
      ${!state.loaded && !state.error ? '<div class="skeleton"></div><div class="skeleton w60"></div><div class="skeleton w80"></div>' : ''}
      ${state.loaded ? `
      <dl class="stats">
        <div><dt>Solar flares</dt><dd>${n0(state.flares.length)}</dd></div>
        <div><dt>X · M · C class</dt><dd>${c.X} · ${c.M} · ${c.C}</dd></div>
        <div><dt>Strongest</dt><dd>${strongest ? esc(strongest.cls) : '—'} <small>${strongest ? esc(fmtDate(strongest.peak)) : ''}</small></dd></div>
        <div><dt>CMEs analysed</dt><dd>${n0(state.cmes.length)}</dd></div>
        <div><dt>Fastest CME</dt><dd>${fastest ? n0(fastest.speed) : '—'} <small>km/s</small></dd></div>
        <div><dt>Toward Earth</dt><dd>${n0(earthward.length)}</dd></div>
        <div><dt>Geomagnetic storms</dt><dd>${n0(state.storms.length)}</dd></div>
        <div><dt>Peak Kp</dt><dd>${maxKp != null ? n1(maxKp) : '—'}</dd></div>
      </dl>

      <h3>Flares <small>DONKI FLR · newest first</small></h3>
      ${state.flares.length ? `<ul class="list">${[...state.flares].reverse().slice(0, 14).map((f) => `
        <li><button type="button" data-flare="${esc(f.id)}"><span class="t">${esc(f.cls)} flare${f.region ? ` · AR ${esc(f.region)}` : ''}</span><span class="m">${esc(fmtUTC(f.peak))}</span>
        <span class="s">${f.loc ? `${esc(fmtLoc(f.loc))} on the disc` : 'location not reported'}</span></button></li>`).join('')}</ul>` : '<p>No flares logged in this window.</p>'}

      <h3>Coronal mass ejections <small>DONKI CMEAnalysis</small></h3>
      ${state.cmes.length ? `<ul class="list">${[...state.cmes].reverse().slice(0, 12).map((x) => `
        <li><button type="button" data-cme="${esc(x.id)}"><span class="t">${n0(x.speed)} km/s${x.earthward ? ' · toward Earth' : ''}</span><span class="m">${esc(fmtUTC(x.t21))}</span>
        <span class="s">half-angle ${n0(x.halfAngle)}° · ${n0(x.offEarth)}° from the Sun–Earth line</span></button></li>`).join('')}</ul>` : '<p>No CME analyses in this window.</p>'}

      <h3>Storms at Earth <small>DONKI GST</small></h3>
      ${state.storms.length ? `<ul class="list">${[...state.storms].reverse().map((g) => `<li><a class="row" href="${esc(safeUrl(g.link))}" target="_blank" rel="noopener"><span class="t">Kp ${n1(g.kp)} geomagnetic storm</span><span class="m">${esc(fmtUTC(g.start))}</span></a></li>`).join('')}</ul>` : '<p>No geomagnetic storms in the last 30 days: a quiet month at Earth.</p>'}

      <h3>Forecaster notes <small>DONKI notifications · 7 days</small></h3>
      ${state.notes.length ? `<ul class="list">${state.notes.slice(0, 10).map((n) => `<li><a class="row" href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener"><span class="t">${esc(NOTE_TYPES[n.type] || n.type)}</span><span class="m">${esc(relTime(n.t))}</span><span class="s">${esc(summary(n.body))}</span></a></li>`).join('')}</ul>` : '<p>No notifications this week.</p>'}
      <span class="src">Source: <a href="https://kauai.ccmc.gsfc.nasa.gov/DONKI/" target="_blank" rel="noopener">DONKI</a>, NASA Community Coordinated Modeling Center. Flare positions are as observed at the time; the Sun's differential rotation then carries them west.</span>
      ` : ''}
    `;
    const el = ui.setPanel(html);
    el.querySelector('#replay')?.addEventListener('click', replay);
    el.querySelector('#zoom-out')?.addEventListener('click', () => engine.flyTo(new THREE.Vector3(230, 150, 250), new THREE.Vector3(0, 0, EARTH_DIST * 0.45), { duration: 3 }));
    el.querySelectorAll('[data-flare]').forEach((b) => b.addEventListener('click', () => focusFlare(state.flares.find((f) => f.id === b.dataset.flare))));
    el.querySelectorAll('[data-cme]').forEach((b) => b.addEventListener('click', () => focusCme(state.cmes.find((x) => x.id === b.dataset.cme))));
  }

  const NOTE_TYPES = { FLR: 'Solar flare', CME: 'Coronal mass ejection', GST: 'Geomagnetic storm', SEP: 'Solar energetic particles', IPS: 'Interplanetary shock', RBE: 'Radiation belt enhancement', MPC: 'Magnetopause crossing', HSS: 'High-speed stream', Report: 'Weekly report' };
  const summary = (body) => {
    const m = /## Summary:\s*([\s\S]*?)(?:\n\s*\n|##|$)/i.exec(body);
    return (m ? m[1] : body).replace(/\s+/g, ' ').trim().slice(0, 160) + ((m ? m[1] : body).length > 160 ? '…' : '');
  };
  const fmtLoc = (l) => `${Math.abs(l.lat)}°${l.lat >= 0 ? 'N' : 'S'} ${Math.abs(l.lonW)}°${l.lonW >= 0 ? 'W' : 'E'}`;
  const back = () => '<button class="etch-btn etch-btn--small" type="button" id="back" style="margin-bottom:14px">← This month on the Sun</button>';

  function renderFlare(f) {
    const el = ui.setPanel(`
      ${back()}
      <h2>${esc(f.cls)} solar flare</h2>
      <p class="lede">Peak ${esc(fmtUTC(f.peak))}${f.region ? ` from active region ${esc(f.region)}` : ''}. The clock is parked at the peak.</p>
      <dl class="stats">
        <div><dt>Began</dt><dd>${esc(fmtUTC(f.begin).slice(-9))}</dd></div>
        <div><dt>Ended</dt><dd>${Number.isFinite(f.end) ? esc(fmtUTC(f.end).slice(-9)) : '—'}</dd></div>
        <div><dt>Peak X-ray flux</dt><dd>${f.flux.toExponential(1)} <small>W/m²</small></dd></div>
        <div><dt>Location</dt><dd>${f.loc ? esc(fmtLoc(f.loc)) : '—'}</dd></div>
      </dl>
      ${f.note ? `<p class="note">${esc(f.note)}</p>` : ''}
      <span class="src"><a href="${esc(safeUrl(f.link))}" target="_blank" rel="noopener">DONKI record ↗</a></span>`);
    el.querySelector('#back').addEventListener('click', () => { state.selection = null; renderPanel(); });
  }

  function renderCme(x) {
    const transitH = (EARTH_DIST - 21.5) * SUN_RADIUS_KM / x.speed / 3600;
    const el = ui.setPanel(`
      ${back()}
      <h2>Coronal mass ejection at ${n0(x.speed)} km/s</h2>
      <p class="lede">Crossed 21.5 solar radii at ${esc(fmtUTC(x.t21))}. ${x.earthward ? 'Its cone included the Sun–Earth line.' : `Aimed ${n0(x.offEarth)}° away from Earth.`}</p>
      <dl class="stats">
        <div><dt>Direction</dt><dd>${n0(Math.abs(x.lat))}°${x.lat >= 0 ? 'N' : 'S'} ${n0(Math.abs(x.lon))}°${x.lon >= 0 ? 'W' : 'E'}</dd></div>
        <div><dt>Half-angle</dt><dd>${n0(x.halfAngle)}°</dd></div>
        <div><dt>1 AU at this speed</dt><dd>${n1(transitH)} <small>h</small></dd></div>
        <div><dt>Type</dt><dd>${esc(x.type || '—')}</dd></div>
      </dl>
      ${x.earthward && x.eta ? `<p class="note">At constant speed it would reach Earth's distance around <strong>${esc(fmtUTC(x.eta))}</strong>. Real CMEs slow down or speed up in the solar wind, so forecasters use models such as WSA–ENLIL.</p>` : ''}
      ${x.note ? `<p class="note">${esc(x.note)}</p>` : ''}
      <span class="src"><a href="${esc(safeUrl(x.link))}" target="_blank" rel="noopener">DONKI record ↗</a></span>`);
    el.querySelector('#back').addEventListener('click', () => { state.selection = null; renderPanel(); });
  }

  function focusFlare(f) {
    if (!f) return;
    state.selection = { kind: 'flare', flare: f };
    clock.pause();
    clock.set(f.peak + 60000);
    if (f.loc) {
      const p = sunPoint(f.loc.lat, f.loc.lonW + synodicRate(f.loc.lat) * (60000 / 86400000));
      engine.flyTo(p.clone().multiplyScalar(4.2), new THREE.Vector3(), { duration: 2 });
    }
    renderPanel();
  }

  function focusCme(x) {
    if (!x) return;
    state.selection = { kind: 'cme', cme: x };
    const axis = sunPoint(x.lat, x.lon).normalize();
    clock.set(x.t21 + 6 * 3600000);
    clock.setRate(3600);
    const side = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0)).normalize();
    engine.flyTo(axis.clone().multiplyScalar(40).add(side.multiplyScalar(90)).add(new THREE.Vector3(0, 45, 0)), axis.clone().multiplyScalar(40), { duration: 2.6 });
    renderPanel();
  }

  function replay() {
    state.selection = null;
    state.replaying = true;
    clock.set(Date.now() - 30 * 86400000);
    clock.setRate(86400);
    engine.flyTo(new THREE.Vector3(160, 90, 170), new THREE.Vector3(0, 0, EARTH_DIST * 0.35), { duration: 2.5 });
    ui.toast('Replaying 30 days of solar activity at one day per second. Sound makes each flare audible.', 4200);
    renderPanel();
  }

  const api_ = {
    id: 'sun',
    title: 'The Sun',
    scene,
    timeRange: [-30, 3],
    marks: [],
    async init() { load().catch((e) => { state.error = e.message; if (ctx.active === api_) renderPanel(); }); },
    enter() {
      const cam = engine.camera;
      cam.near = 0.05; cam.far = 4000; cam.updateProjectionMatrix();
      engine.controls.minDistance = 1.6;
      engine.controls.maxDistance = 900;
      engine.bloom.strength = 0.55;
      engine.bloom.threshold = 0.7;
      cam.position.set(9, 4, 18);
      engine.controls.target.set(0, 0, 0);
      engine.flyTo(new THREE.Vector3(2.8, 1.5, 7.2).multiplyScalar(engine.fit(1)), new THREE.Vector3(0, 0, 0), { duration: 2.6 });
      ui.setTimeRange(api_.timeRange, api_.marks);
      renderPanel();
      api_.mood();
    },
    exit() {},
    mood() { sound.mood({ base: 41.2, bright: 0.55, wind: 0.25 }); },
    update(dt, sim) {
      sunUniforms.uTime.value += dt;
      // Visual rotation of the granulation at the equatorial synodic rate.
      sunUniforms.uRot.value = ((sim / 86400000) * synodicRate(0) * D2R) % (Math.PI * 2);
      stepFlares(sim);
      const fastest = stepCmes(sim);
      stepStorms(sim);
      if (state.replaying && sim >= Date.now()) { state.replaying = false; clock.now(); ui.toast('Back to the present.', 2000); }
      if (state.replaying && clock.rate !== 86400) state.replaying = false;
      if (sound.enabled && Math.random() < 0.02) sound.mood({ base: 41.2, bright: 0.55, wind: clamp(0.2 + fastest / 2500, 0.2, 1) });
      lastSim = sim;
      const d = engine.camera.position.distanceTo(earth.position);
      earthBall.scale.setScalar(clamp(d / 120, 0.4, 3));
    },
    pickables() {
      const out = [sun, earthBall, ...cmeGroup.children.filter((m) => m.visible)];
      if (flarePoints) out.push(flarePoints);
      return out;
    },
    configureRaycaster(rc) { rc.params.Points.threshold = 0.05 * clamp(engine.camera.position.length() / 5, 0.5, 20); },
    filterHits(hits) {
      const sunHit = hits.find((h) => h.object === sun);
      const flareHit = hits.filter((h) => h.object === flarePoints && state.placed[h.index] && flarePoints.geometry.attributes.glow.array[h.index] > 0.02 && (!sunHit || h.distance < sunHit.distance + 0.05))
        .sort((a, b) => a.distanceToRay - b.distanceToRay)[0];
      return flareHit || hits.find((h) => h.object !== flarePoints) || null;
    },
    hover(hit) {
      if (hit.object === flarePoints) { const f = state.placed[hit.index]; return { title: `${f.cls} flare`, sub: `${fmtUTC(f.peak)} · ${fmtLoc(f.loc)}` }; }
      if (hit.object === earthBall) return { title: 'Earth (enlarged)', sub: '215 solar radii · 8.3 light-minutes' };
      if (hit.object.userData.cme) { const c = hit.object.userData.cme; return { title: `CME · ${n0(c.speed)} km/s`, sub: `${fmtUTC(c.t21)}${c.earthward ? ' · toward Earth' : ''}` }; }
      if (hit.object === sun) return { title: 'The Sun', sub: '695,700 km radius · granulation is illustrative' };
      return null;
    },
    click(hit) {
      if (hit.object === flarePoints) focusFlare(state.placed[hit.index]);
      else if (hit.object.userData.cme) focusCme(hit.object.userData.cme);
      else if (hit.object === earthBall) ctx.go('earth');
    },
    clickEmpty() { if (state.selection) { state.selection = null; renderPanel(); } },
    readouts() {
      const c = counts();
      const active = state.cmes.filter((x) => x.mesh?.visible).length;
      return [
        ['Flares · 30 d', state.loaded ? `${n0(state.flares.length)} (${c.X} X · ${c.M} M)` : '…', { loading: !state.loaded }],
        ['CMEs · 30 d', state.loaded ? `${n0(state.cmes.length)} · ${state.cmes.filter((x) => x.earthward).length} Earthward` : '…', { loading: !state.loaded }],
        ['In flight now', state.loaded ? `${active} CME${active === 1 ? '' : 's'}` : '…'],
        ['Storms at Earth', state.loaded ? n0(state.storms.length) : '…'],
        ['Sun–Earth', '215 R☉ · 8.3 light-min'],
      ];
    },
    searchItems() {
      return [
        ...state.flares.map((f) => ({ kind: 'Flare', title: `${f.cls} flare`, meta: fmtUTC(f.peak), run: () => focusFlare(f) })),
        ...state.cmes.map((x) => ({ kind: 'CME', title: `CME ${n0(x.speed)} km/s`, meta: fmtUTC(x.t21), run: () => focusCme(x) })),
      ];
    },
    tour: {
      replay,
      strongest() { const f = [...state.flares].sort((a, b) => b.flux - a.flux)[0]; if (f) focusFlare(f); return f; },
      facts: () => ({ flares: state.flares.length, counts: counts(), cmes: state.cmes.length, earthward: state.cmes.filter((x) => x.earthward).length, storms: state.storms.length, strongest: [...state.flares].sort((a, b) => b.flux - a.flux)[0], fastest: [...state.cmes].sort((a, b) => b.speed - a.speed)[0] }),
    },
  };
  return api_;
}

function glowTexture(stops) {
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
