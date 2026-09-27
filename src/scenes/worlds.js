// OTHER WORLDS — the Moon, Mars and Vesta wrapped in NASA Trek mosaics
// (LRO, Viking, Dawn), with landing sites, InSight's last weather reports,
// live distances and imagery from the NASA Image and Video Library.
import * as THREE from 'three';
import { api } from '../core/api.js';
import * as A from '../core/astro.js';
import { stitchTrek, TREK } from '../core/trek.js';
import { esc, n0, n1, fmtDate, clamp, safeUrl } from '../core/util.js';

const WORLDS = {
  moon: {
    title: 'The Moon',
    radiusKm: 1737.4,
    scale: [1, 1, 1],
    lede: 'Wrapped in the Lunar Reconnaissance Orbiter\'s global mosaic. Every crater you can see was photographed from lunar orbit.',
    facts: (sim) => {
      const km = A.moonEquatorial(sim).km;
      return [['Distance now', `${n0(km)} km`], ['Light time', `${(km / 299792.458).toFixed(2)} s`], ['Radius', '1,737 km'], ['Surface gravity', '1.62 m/s²'], ['Day (sunrise to sunrise)', '29.5 Earth days'], ['Phase now', `${A.moonPhase(sim).name}`]];
    },
    sites: [
      { name: 'Apollo 11', lat: 0.67408, lon: 23.47297, note: 'First crewed landing · 20 Jul 1969 · Sea of Tranquility' },
      { name: 'Apollo 12', lat: -3.01239, lon: -23.42157, note: '19 Nov 1969 · landed beside Surveyor 3' },
      { name: 'Apollo 14', lat: -3.6453, lon: -17.47136, note: '5 Feb 1971 · Fra Mauro highlands' },
      { name: 'Apollo 15', lat: 26.13222, lon: 3.63386, note: '30 Jul 1971 · first Lunar Roving Vehicle' },
      { name: 'Apollo 16', lat: -8.97301, lon: 15.50019, note: '21 Apr 1972 · Descartes highlands' },
      { name: 'Apollo 17', lat: 20.1908, lon: 30.77168, note: '11 Dec 1972 · last crewed landing, Taurus–Littrow' },
      { name: 'Chang\'e 4', lat: -45.4446, lon: 177.5991, note: '3 Jan 2019 · first landing on the far side (CNSA)' },
      { name: 'Tycho', lat: -43.31, lon: -11.36, note: '85 km crater, about 108 million years old' },
      { name: 'Shackleton', lat: -89.67, lon: 129.78, note: 'South-pole crater at the heart of Artemis landing regions' },
    ],
    library: 'Apollo lunar surface',
  },
  mars: {
    title: 'Mars',
    radiusKm: 3389.5,
    scale: [1, 1, 1],
    lede: 'Wrapped in the Viking orbiters\' global colour mosaic. Switch to MOLA elevation to see Olympus Mons tower over the Tharsis bulge.',
    facts: (sim) => {
      const e = A.planetPosition(A.PLANETS[2], sim), m = A.planetPosition(A.PLANETS[3], sim);
      const au = Math.hypot(m[0] - e[0], m[1] - e[1], m[2] - e[2]);
      return [['Distance now', `${n0(au * A.AU_KM / 1e6)} million km`], ['One-way light time', `${n1(au * A.AU_KM / 299792.458 / 60)} min`], ['Radius', '3,390 km'], ['Surface gravity', '3.72 m/s²'], ['Sol (solar day)', '24 h 39 min'], ['Year', '687 Earth days']];
    },
    sites: [
      { name: 'Perseverance', lat: 18.4447, lon: 77.4508, note: 'Landed 18 Feb 2021 in Jezero crater, an ancient river delta' },
      { name: 'Curiosity', lat: -4.5895, lon: 137.4417, note: 'Landed 6 Aug 2012 in Gale crater, climbing Mount Sharp' },
      { name: 'InSight', lat: 4.5024, lon: 135.6234, note: 'Lander 2018–2022 · marsquakes and weather, Elysium Planitia' },
      { name: 'Viking 1', lat: 22.27, lon: -47.95, note: 'First successful Mars landing by NASA · 20 Jul 1976' },
      { name: 'Viking 2', lat: 47.64, lon: 134.29, note: 'Utopia Planitia · 3 Sep 1976' },
      { name: 'Pathfinder', lat: 19.13, lon: -33.22, note: '4 Jul 1997 · the Sojourner rover' },
      { name: 'Spirit', lat: -14.5684, lon: 175.4726, note: 'Gusev crater · 2004–2010' },
      { name: 'Opportunity', lat: -1.9462, lon: -5.5266, note: 'Meridiani Planum · 2004–2018, 45 km driven' },
      { name: 'Phoenix', lat: 68.22, lon: -125.75, note: 'Found water ice in the arctic soil · 2008' },
      { name: 'Olympus Mons', lat: 18.65, lon: -133.8, note: 'Tallest volcano in the Solar System, about 22 km high' },
      { name: 'Valles Marineris', lat: -13.9, lon: -59.2, note: 'Canyon system 4,000 km long and up to 7 km deep' },
      { name: 'Hellas Planitia', lat: -42.4, lon: 70.5, note: 'Impact basin 2,300 km across' },
    ],
    library: 'Mars Perseverance',
    insight: true,
    atmosphere: [1.0, 0.55, 0.35],
  },
  vesta: {
    title: 'Vesta',
    radiusKm: 262.7,
    // Triaxial: 572.6 × 557.2 × 446.4 km
    scale: [1, 446.4 / 572.6, 557.2 / 572.6],
    lede: 'The second-largest body in the asteroid belt, mapped by NASA\'s Dawn spacecraft from orbit between July 2011 and September 2012. The giant Rheasilvia impact basin flattens its south pole.',
    facts: (sim, vesta) => {
      let dist = '—';
      if (vesta) {
        const e = A.planetPosition(A.PLANETS[2], sim), v = A.smallBodyPosition(vesta, sim);
        dist = `${n1(Math.hypot(v[0] - e[0], v[1] - e[1], v[2] - e[2]))} AU`;
      }
      return [['Distance now', dist], ['Dimensions', '573 × 557 × 446 km'], ['Rotation', '5 h 20 min'], ['Discovered', '1807, by Heinrich Olbers'], ['Orbit', '2.36 AU from the Sun'], ['Visited by', 'Dawn, 2011–2012']];
    },
    sites: [],
    library: 'Vesta Dawn',
  },
};

export function create(ctx, id) {
  const { engine, clock, sound, ui } = ctx;
  const cfg = WORLDS[id];
  const trek = TREK[id];
  const scene = new THREE.Scene();
  const state = { layer: 'color', progress: 0, level: 0, failed: 0, images: null, insight: null, selection: null };

  const material = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 1, metalness: 0 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 96), material);
  body.scale.set(...cfg.scale);
  body.name = id;
  scene.add(body);

  const key = new THREE.DirectionalLight(0xfff4e6, 2.6);
  scene.add(key, key.target);
  scene.add(new THREE.AmbientLight(0xffffff, 0.22));

  if (cfg.atmosphere) {
    const [r, g, b] = cfg.atmosphere;
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.03, 96, 48), new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Vector3(r, g, b) } },
      vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uColor; varying vec3 vN; void main(){ float d = dot(normalize(vN), vec3(0.0,0.0,1.0)); float i = pow(clamp(-d * 3.0, 0.0, 1.0), 1.8); gl_FragColor = vec4(uColor * i * 0.8, i * 0.8); }',
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })));
  }

  // Landing-site pins
  const pinGeo = new THREE.BufferGeometry();
  const pinPos = new Float32Array(cfg.sites.length * 3);
  cfg.sites.forEach((s, i) => pinPos.set(A.latLonToXYZ(s.lat, s.lon, 1.004), i * 3));
  pinGeo.setAttribute('position', new THREE.BufferAttribute(pinPos, 3));
  const dotCanvas = document.createElement('canvas');
  dotCanvas.width = dotCanvas.height = 64;
  const dg = dotCanvas.getContext('2d');
  dg.fillStyle = '#fff';
  dg.beginPath(); dg.arc(32, 32, 30, 0, Math.PI * 2); dg.fill();
  const pins = new THREE.Points(pinGeo, new THREE.PointsMaterial({ color: 0xf64137, size: 9, sizeAttenuation: false, map: new THREE.CanvasTexture(dotCanvas), alphaTest: 0.5, transparent: true, depthWrite: false }));
  pins.name = 'pins';
  scene.add(pins);
  const occluder = (p) => {
    const c = engine.camera.position;
    const d = p.clone().sub(c);
    const len = d.length();
    d.divideScalar(len);
    const tca = -c.dot(d);
    if (tca < 0 || tca > len) return false;
    return c.lengthSq() - tca * tca < 0.992;
  };
  const siteLabels = cfg.sites.map((s) => {
    const p = new THREE.Vector3(...A.latLonToXYZ(s.lat, s.lon, 1.004));
    const l = engine.addLabel(esc(s.name), () => (ctx.active === api_ ? p : null), { occluder });
    return l;
  });

  const textures = {};
  async function loadLayer(layer, z) {
    const keyName = `${layer}:${z}`;
    if (textures[keyName]) return textures[keyName];
    const { canvas, failed } = await stitchTrek(trek.body, trek[layer], z, (p) => {
      state.progress = p;
      if (p === 1 || Math.random() < 0.15) updateProgress();
    });
    state.failed = failed;
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = engine.renderer.capabilities.getMaxAnisotropy();
    textures[keyName] = t;
    return t;
  }

  function apply(t) {
    material.map = t;
    material.color.set(0xffffff);
    material.needsUpdate = true;
  }

  async function showLayer(layer) {
    state.layer = layer;
    renderPanel();
    try {
      apply(await loadLayer(layer, 2));
      state.level = 2;
      renderPanel();
      const hi = await loadLayer(layer, 3);
      if (state.layer === layer) { apply(hi); state.level = 3; }
      // Free the low-resolution copy once the sharp one is on screen.
      textures[`${layer}:2`]?.dispose();
      delete textures[`${layer}:2`];
    } catch (err) {
      ui.toast(`Trek imagery failed to load: ${err.message}`);
    }
    renderPanel();
  }

  function updateProgress() {
    const el = document.getElementById('w-progress');
    if (el) el.textContent = state.progress < 1 ? `stitching tiles · ${n0(state.progress * 100)}%` : `${state.level === 3 ? '4096' : '2048'} px mosaic${state.failed ? ` · ${state.failed} tiles missing` : ''}`;
  }

  let vesta = null;
  async function loadExtras() {
    api(`/api/library/search?q=${encodeURIComponent(cfg.library)}&media_type=image`, 'library')
      .then((j) => { state.images = (j.collection?.items || []).filter((it) => it.links?.[0]?.href).slice(0, 6); renderPanel(); })
      .catch(() => { state.images = []; renderPanel(); });
    if (cfg.insight) {
      api('/api/insight', 'insight').then((j) => {
        state.insight = (j.sol_keys || []).map((k) => ({ sol: k, ...j[k] })).filter((s) => s.AT || s.PRE);
        renderPanel();
      }).catch(() => { state.insight = []; renderPanel(); });
    }
    if (id === 'vesta') {
      api('/api/sbdb?des=4', 'ssd').then((s) => {
        const el = Object.fromEntries(s.orbit.elements.map((x) => [x.name, Number(x.value)]));
        vesta = { a: el.a, e: el.e, i: el.i, om: el.om, w: el.w, ma: el.ma, n: el.n, epoch: Number(s.orbit.epoch) };
        renderPanel();
      }).catch(() => {});
    }
  }

  function flyToSite(s) {
    const p = new THREE.Vector3(...A.latLonToXYZ(s.lat, s.lon)).normalize();
    engine.flyTo(p.multiplyScalar(engine.fit(1.9)), new THREE.Vector3(), { duration: 2.2 });
    state.selection = s;
    sound.ping(sound.note((s.lat + 90) / 180, 262), { gain: 0.08 });
    renderPanel();
  }

  function renderPanel() {
    if (ctx.active !== api_) return;
    const facts = cfg.facts(clock.sim, vesta);
    const html = `
      <h2>${esc(cfg.title)}</h2>
      <p class="lede">${esc(cfg.lede)}</p>
      <dl class="stats">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd style="font-size:13.5px">${esc(v)}</dd></div>`).join('')}</dl>

      <h3>Surface <small id="w-progress">${state.progress < 1 ? `stitching tiles · ${n0(state.progress * 100)}%` : `${state.level === 3 ? '4096' : '2048'} px mosaic`}</small></h3>
      <div class="chips" role="radiogroup" aria-label="Surface layer">
        <button class="chip" type="button" role="radio" data-layer="color" aria-checked="${state.layer === 'color'}" aria-pressed="${state.layer === 'color'}">${esc(trek.color.title)}</button>
        <button class="chip" type="button" role="radio" data-layer="relief" aria-checked="${state.layer === 'relief'}" aria-pressed="${state.layer === 'relief'}">${esc(trek.relief.title)}</button>
      </div>

      ${cfg.sites.length ? `
      <h3>${id === 'moon' ? 'Landing sites & landmarks' : 'Landers, rovers & landmarks'} <small>${cfg.sites.length} pins</small></h3>
      <ul class="list">${cfg.sites.map((s, i) => `<li><button type="button" data-site="${i}" class="${state.selection === s ? 'is-active' : ''}"><span class="t">${esc(s.name)}</span><span class="m">${n1(Math.abs(s.lat))}°${s.lat >= 0 ? 'N' : 'S'} ${n1(Math.abs(s.lon))}°${s.lon >= 0 ? 'E' : 'W'}</span><span class="s">${esc(s.note)}</span></button></li>`).join('')}</ul>` : ''}

      ${cfg.insight ? renderInsight() : ''}

      <h3>From the archive <small>NASA Image & Video Library</small></h3>
      ${state.images == null ? '<div class="skeleton"></div>' : state.images.length ? `
        <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:8px">
          ${state.images.map((it, i) => `<button class="tile" type="button" data-img="${i}"><span class="tile__img"><img src="${esc(safeUrl(it.links[0].href))}" alt="${esc(it.data?.[0]?.title || '')}" loading="lazy"/></span></button>`).join('')}
        </div>
        <div class="row-actions"><button class="etch-btn etch-btn--small" type="button" id="more-images">Search the library</button></div>` : '<p>The library returned nothing just now.</p>'}
      <span class="src">Surface: <a href="https://trek.nasa.gov/" target="_blank" rel="noopener">NASA Solar System Treks</a> WMTS · ${esc(trek[state.layer].layer)}</span>
    `;
    const el = ui.setPanel(html);
    el.querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.layer !== state.layer) showLayer(b.dataset.layer); }));
    el.querySelectorAll('[data-site]').forEach((b) => b.addEventListener('click', () => flyToSite(cfg.sites[Number(b.dataset.site)])));
    el.querySelectorAll('[data-img]').forEach((b) => b.addEventListener('click', () => ctx.openArchive('library', { q: cfg.library, item: state.images[Number(b.dataset.img)] })));
    el.querySelector('#more-images')?.addEventListener('click', () => ctx.openArchive('library', { q: cfg.library }));
  }

  function renderInsight() {
    if (state.insight == null) return '<h3>Weather at Elysium Planitia <small>InSight</small></h3><div class="skeleton"></div>';
    if (!state.insight.length) return '<h3>Weather at Elysium Planitia <small>InSight</small></h3><p>The InSight archive feed did not answer.</p>';
    const rows = state.insight.map((s) => `<tr>
      <td class="num">${esc(s.sol)}</td>
      <td class="num">${s.AT ? `${n0(s.AT.mn)}° / ${n0(s.AT.mx)}°` : '—'}</td>
      <td class="num">${s.PRE ? n0(s.PRE.av) : '—'}</td>
      <td class="num">${s.HWS ? n1(s.HWS.av) : '—'}</td></tr>`).join('');
    const first = state.insight[0], last = state.insight[state.insight.length - 1];
    return `
      <h3>Weather at Elysium Planitia <small>InSight · archive</small></h3>
      <p>The last week of reports InSight's weather station sent home: sols ${esc(first.sol)}–${esc(last.sol)}, ${esc(fmtDate(Date.parse(first.First_UTC)))} to ${esc(fmtDate(Date.parse(last.Last_UTC)))}, in the northern ${esc(first.Northern_season || '')}. The mission ended in December 2022.</p>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:6px">
        <thead><tr style="text-align:left;color:var(--ink-3);font-size:10px;letter-spacing:.1em;text-transform:uppercase">
          <th style="padding:6px 0;border-bottom:1px solid var(--ink-line)">Sol</th><th style="border-bottom:1px solid var(--ink-line)">Low / high °C</th><th style="border-bottom:1px solid var(--ink-line)">Pa</th><th style="border-bottom:1px solid var(--ink-line)">Wind m/s</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="src">Air pressure is under 1% of Earth's. Source: NASA InSight Mars Weather Service API.</p>`;
  }

  const tmpV = new THREE.Vector3();
  const api_ = {
    id,
    title: cfg.title,
    scene,
    timeRange: [-7, 7],
    marks: [],
    async init() {
      showLayer('color');
      loadExtras();
    },
    enter() {
      const cam = engine.camera;
      cam.near = 0.005; cam.far = 500; cam.updateProjectionMatrix();
      engine.controls.minDistance = 1.08;
      engine.controls.maxDistance = 12;
      engine.bloom.strength = 0.35;
      engine.bloom.threshold = 0.95;
      const start = cfg.sites[0] ? new THREE.Vector3(...A.latLonToXYZ(cfg.sites[0].lat + 12, cfg.sites[0].lon - 20)).normalize() : new THREE.Vector3(0.6, 0.3, 0.75).normalize();
      cam.position.copy(start).multiplyScalar(7);
      engine.controls.target.set(0, 0, 0);
      engine.flyTo(start.clone().multiplyScalar(engine.fit(3.5)), new THREE.Vector3(), { duration: 2.8 });
      siteLabels.forEach((l) => { l.visible = true; });
      renderPanel();
      api_.mood();
    },
    exit() { siteLabels.forEach((l) => { l.visible = false; }); },
    mood() { sound.mood({ base: id === 'mars' ? 46.2 : id === 'moon' ? 55 : 61.7, bright: 0.2, wind: id === 'mars' ? 0.08 : 0 }); },
    update() {
      // A raking key light from over the viewer's shoulder keeps relief readable.
      tmpV.copy(engine.camera.position).normalize();
      const side = new THREE.Vector3(0, 1, 0).cross(tmpV).normalize();
      key.position.copy(tmpV).multiplyScalar(5).addScaledVector(side, -3.5).add(new THREE.Vector3(0, 2.5, 0));
    },
    pickables: () => [body, pins],
    configureRaycaster(rc) { rc.params.Points.threshold = 0.03 * engine.camera.position.length() / 3; },
    filterHits(hits) {
      const bodyHit = hits.find((h) => h.object === body);
      const pin = hits.filter((h) => h.object === pins && (!bodyHit || h.distance < bodyHit.distance + 0.01)).sort((a, b) => a.distanceToRay - b.distanceToRay)[0];
      return pin || bodyHit || null;
    },
    hover(hit) {
      if (hit.object === pins) { const s = cfg.sites[hit.index]; return { title: s.name, sub: s.note }; }
      const p = hit.point.clone().divide(new THREE.Vector3(...cfg.scale)).normalize();
      const lat = Math.asin(p.y) * A.R2D, lon = Math.atan2(-p.z, p.x) * A.R2D;
      return { title: `${n1(Math.abs(lat))}°${lat >= 0 ? 'N' : 'S'}  ${n1(Math.abs(lon))}°${lon >= 0 ? 'E' : 'W'}`, sub: cfg.title };
    },
    click(hit) { if (hit.object === pins) flyToSite(cfg.sites[hit.index]); },
    clickEmpty() { if (state.selection) { state.selection = null; renderPanel(); } },
    readouts() {
      const f = cfg.facts(clock.sim, vesta);
      return [...f.slice(0, 4).map(([k, v]) => [k, v]), ['Imagery', `Trek · ${state.level ? (state.level === 3 ? '4096' : '2048') + ' px' : 'loading…'}`, { loading: !state.level }]];
    },
    searchItems() {
      return cfg.sites.map((s) => ({ kind: cfg.title.replace('The ', ''), title: s.name, meta: s.note, run: () => flyToSite(s) }));
    },
    tour: {
      site(name) { const s = cfg.sites.find((x) => x.name === name) || cfg.sites[0]; if (s) flyToSite(s); return s; },
      facts: () => ({ insight: state.insight }),
    },
  };
  return api_;
}
