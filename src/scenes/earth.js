// EARTH, LIVE — GIBS imagery from the last full day, lit by the real Sun for
// the time on the clock; every tracked satellite propagated with SGP4; open
// EONET natural events; EPIC's view from L1; DONKI-driven aurora; JPL
// fireballs; and the Moon where it really is.
import * as THREE from 'three';
import { api, loadImage } from '../core/api.js';
import * as A from '../core/astro.js';
import { stitchTrek, TREK } from '../core/trek.js';
import { esc, fmtUTC, fmtDate, n0, n1, relTime, isoDay, parseUTC, safeUrl, clamp } from '../core/util.js';

const GIBS_URL = (layer, { date, w = 4096, h = 2048, fmt = 'image/jpeg', transparent = false } = {}) =>
  `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${layer}` +
  `&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=${w}&HEIGHT=${h}&FORMAT=${encodeURIComponent(fmt)}` +
  `${transparent ? '&TRANSPARENT=TRUE' : ''}${date ? `&TIME=${date}` : ''}`;

const DAILY_LAYER = 'VIIRS_SNPP_CorrectedReflectance_TrueColor';
const VIIRS_FIRST_DAY = '2015-11-24';

export const SCIENCE = [
  { id: 'none', name: 'True colour only' },
  { id: 'sst', name: 'Sea surface temperature', layer: 'GHRSST_L4_MUR_Sea_Surface_Temperature', what: 'Multi-scale Ultra-high Resolution (MUR) level-4 analysis blending several satellites, ~1 km.' },
  { id: 'aod', name: 'Aerosols: smoke, dust, haze', layer: 'MODIS_Combined_Value_Added_AOD', what: 'Aerosol optical depth from MODIS on Terra and Aqua — how much sunlight airborne particles block.' },
  { id: 'fires', name: 'Fires & thermal anomalies', layer: 'MODIS_Terra_Thermal_Anomalies_All', what: 'Active fire detections from MODIS on Terra, day and night passes.' },
  { id: 'rain', name: 'Precipitation rate', layer: 'IMERG_Precipitation_Rate', what: 'GPM IMERG merged precipitation estimate.' },
  { id: 'cloud', name: 'Cloud-top temperature', layer: 'MODIS_Terra_Cloud_Top_Temp_Day', what: 'MODIS Terra daytime cloud-top temperature — colder tops are taller storm clouds.' },
  { id: 'snow', name: 'Snow cover', layer: 'MODIS_Terra_NDSI_Snow_Cover', what: 'MODIS Terra Normalized Difference Snow Index.' },
  { id: 'ndvi', name: 'Vegetation (8-day)', layer: 'MODIS_Terra_NDVI_8Day', what: 'MODIS Terra Normalized Difference Vegetation Index, 8-day composite.' },
];

const EVENT_STYLE = {
  wildfires: { name: 'Wildfires', color: [1.0, 0.46, 0.16], size: 5 },
  severeStorms: { name: 'Severe storms', color: [0.35, 0.86, 1.0], size: 11 },
  volcanoes: { name: 'Volcanoes', color: [1.0, 0.16, 0.12], size: 10 },
  seaLakeIce: { name: 'Sea & lake ice', color: [0.9, 0.97, 1.0], size: 9 },
  floods: { name: 'Floods', color: [0.3, 0.55, 1.0], size: 9 },
  earthquakes: { name: 'Earthquakes', color: [1.0, 0.85, 0.3], size: 9 },
  dustHaze: { name: 'Dust & haze', color: [0.9, 0.75, 0.45], size: 8 },
  drought: { name: 'Drought', color: [0.85, 0.6, 0.3], size: 8 },
  landslides: { name: 'Landslides', color: [0.7, 0.5, 0.35], size: 8 },
  snow: { name: 'Snow', color: [0.95, 0.95, 1.0], size: 8 },
  tempExtremes: { name: 'Temperature extremes', color: [1.0, 0.35, 0.5], size: 8 },
  waterColor: { name: 'Water colour', color: [0.3, 0.9, 0.7], size: 8 },
  manmade: { name: 'Manmade', color: [0.8, 0.8, 0.8], size: 8 },
};

const SAT_COLORS = { LEO: [0.55, 0.86, 1.0], MEO: [1.0, 0.78, 0.36], GEO: [0.86, 0.6, 1.0], HEO: [1.0, 0.48, 0.44] };
const FEATURED = new Map([
  [25544, 'International Space Station'], [48274, 'Tiangong space station'], [20580, 'Hubble Space Telescope'],
  [25994, 'Terra (EOS AM-1)'], [27424, 'Aqua (EOS PM-1)'], [37849, 'Suomi NPP'], [43013, 'NOAA-20'],
  [39084, 'Landsat 8'], [49260, 'Landsat 9'], [41866, 'GOES-16'], [51850, 'GOES-18'], [43613, 'ICESat-2'],
  [54234, 'NOAA-21'], [33591, 'NOAA-19'], [36508, 'CryoSat-2'], [44714, 'Starlink-1008'],
]);

// Geomagnetic poles (IGRF-14, epoch 2025)
const GEOMAG_N = { lat: 80.8, lon: -72.6 };
const GEOMAG_S = { lat: -80.8, lon: 107.4 };

function imageryDate() {
  const now = new Date();
  const back = now.getUTCHours() < 15 ? 2 : 1;
  return isoDay(Date.now() - back * 86400000);
}

export function create(ctx) {
  const { engine, clock, sound, ui } = ctx;
  const scene = new THREE.Scene();
  const state = {
    date: imageryDate(),
    science: 'none',
    layers: { sats: true, events: true, fireballs: true, aurora: true, moon: true },
    sats: null,
    satCounts: null,
    events: [],
    eventCounts: {},
    epic: [],
    kp: null,
    fireballs: [],
    selection: null,
    status: {},
  };

  // ── Globe ──────────────────────────────────────────────────────────────
  const blank = new THREE.DataTexture(new Uint8Array([8, 18, 32, 255]), 1, 1);
  blank.needsUpdate = true;
  const uniforms = {
    uBase: { value: blank }, uDay: { value: blank }, uDayPrev: { value: blank }, uNight: { value: blank }, uMask: { value: blank }, uOverlay: { value: blank },
    uDayReady: { value: 0 }, uDayPrevReady: { value: 0 }, uNightReady: { value: 0 }, uMaskReady: { value: 0 }, uOverlayOpacity: { value: 0 },
    uSun: { value: new THREE.Vector3(1, 0, 0) },
  };
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(1, 192, 96),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vN; varying vec3 vP;
        void main() {
          vUv = uv;
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vP = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uBase, uDay, uDayPrev, uNight, uMask, uOverlay;
        uniform float uDayReady, uDayPrevReady, uNightReady, uMaskReady, uOverlayOpacity;
        uniform vec3 uSun;
        varying vec2 vUv; varying vec3 vN; varying vec3 vP;
        void main() {
          vec3 N = normalize(vN);
          vec3 L = normalize(uSun);
          vec3 V = normalize(cameraPosition - vP);
          float ndl = dot(N, L);

          vec3 base = texture2D(uBase, vUv).rgb;
          vec3 day1 = texture2D(uDay, vUv).rgb;
          vec3 day0 = texture2D(uDayPrev, vUv).rgb;
          // Swath gaps in a daily mosaic are black, with JPEG noise up to ~15/255.
          // Test the brightest channel (dark ocean keeps its blue, ~45/255). Gaps are
          // filled from the previous day's mosaic, and Blue Marble only where both miss.
          // JPEG ringing leaves a dim fringe along gap edges, so treat a texel as a
          // gap if any close neighbour is one (a 2-texel dilation of the mask).
          float peak1 = max(day1.r, max(day1.g, day1.b));
          vec2 e = vec2(2.0 / 4096.0, 2.0 / 2048.0);
          vec3 n1 = texture2D(uDay, vUv + vec2(e.x, 0.0)).rgb, n2 = texture2D(uDay, vUv - vec2(e.x, 0.0)).rgb;
          vec3 n3 = texture2D(uDay, vUv + vec2(0.0, e.y)).rgb, n4 = texture2D(uDay, vUv - vec2(0.0, e.y)).rgb;
          peak1 = min(peak1, min(min(max(n1.r, max(n1.g, n1.b)), max(n2.r, max(n2.g, n2.b))), min(max(n3.r, max(n3.g, n3.b)), max(n4.r, max(n4.g, n4.b)))));
          float has1 = smoothstep(0.006, 0.014, peak1) * uDayReady;
          float has0 = smoothstep(0.006, 0.014, max(day0.r, max(day0.g, day0.b))) * uDayPrevReady;
          vec3 day = mix(day0, day1, has1);
          float has = max(has1, has0);
          float lum = dot(day, vec3(0.2126, 0.7152, 0.0722));
          vec3 surf = mix(base, day, has);
          vec4 ov = texture2D(uOverlay, vUv);
          surf = mix(surf, ov.rgb, ov.a * uOverlayOpacity);

          float dayMix = smoothstep(-0.10, 0.14, ndl);
          vec3 lit = surf * (0.012 + 0.95 * pow(max(ndl, 0.0), 0.9));

          float water = uMaskReady * smoothstep(0.36, 0.44, texture2D(uMask, vUv).r);
          float cloud = smoothstep(0.10, 0.35, lum) * has;
          vec3 H = normalize(L + V);
          float spec = pow(max(dot(N, H), 0.0), 70.0) * water * (1.0 - cloud) * step(0.0, ndl);
          lit += vec3(1.0, 0.9, 0.72) * spec * 0.4;

          float tw = smoothstep(-0.2, 0.0, ndl) * (1.0 - smoothstep(0.0, 0.25, ndl));
          lit += vec3(0.6, 0.24, 0.07) * tw * 0.06;

          vec3 night = texture2D(uNight, vUv).rgb * uNightReady;
          float city = smoothstep(0.05, 0.45, dot(night, vec3(0.3333)));
          vec3 nightCol = night * 0.28 + vec3(1.0, 0.7, 0.36) * city * 1.5;

          vec3 col = mix(nightCol, lit, dayMix);
          float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
          col += vec3(0.28, 0.52, 1.0) * fres * (0.05 + 0.75 * smoothstep(-0.25, 0.6, ndl));
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  globe.name = 'globe';
  scene.add(globe);

  // Atmosphere halo
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.028, 96, 48),
    new THREE.ShaderMaterial({
      uniforms: { uSun: uniforms.uSun },
      vertexShader: /* glsl */ `
        varying vec3 vNV; varying vec3 vNW;
        void main() {
          vNV = normalize(normalMatrix * normal);
          vNW = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun;
        varying vec3 vNV; varying vec3 vNW;
        void main() {
          float d = dot(normalize(vNV), vec3(0.0, 0.0, 1.0));
          float i = pow(clamp(-d * 3.2, 0.0, 1.0), 1.6);
          float s = dot(normalize(vNW), normalize(uSun));
          vec3 tint = mix(vec3(1.0, 0.45, 0.2), vec3(0.3, 0.58, 1.0), smoothstep(-0.15, 0.35, s));
          float lit = 0.08 + 0.92 * smoothstep(-0.35, 0.3, s);
          gl_FragColor = vec4(tint * i * lit * 1.4, i * lit);
        }`,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  scene.add(atmosphere);

  // The Sun, far away along its true direction
  const sunGroup = new THREE.Group();
  const sunTex = radialTexture([[0, 'rgba(255,250,235,1)'], [0.18, 'rgba(255,236,190,0.95)'], [0.4, 'rgba(255,190,110,0.25)'], [1, 'rgba(255,160,80,0)']]);
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  sunSprite.scale.setScalar(60);
  sunGroup.add(sunSprite);
  scene.add(sunGroup);

  const sunLight = new THREE.DirectionalLight(0xffffff, 2.4);
  scene.add(sunLight, sunLight.target);
  scene.add(new THREE.AmbientLight(0xffffff, 0.02));

  // ── Moon ─────────────────────────────────────────────────────────────
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(1737.4 / 6371, 64, 32),
    new THREE.MeshStandardMaterial({ color: 0x8c8c8c, roughness: 1, metalness: 0 }),
  );
  moon.name = 'moon';
  scene.add(moon);

  // ── Satellites ───────────────────────────────────────────────────────
  const satMat = new THREE.ShaderMaterial({
    uniforms: { uPixel: { value: Math.min(devicePixelRatio, 2) }, uScale: { value: 3.0 } },
    vertexShader: /* glsl */ `
      attribute vec3 color; attribute float size;
      uniform float uPixel; uniform float uScale;
      varying vec3 vC; varying float vS;
      void main() {
        vC = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vS = size;
        gl_PointSize = clamp(size * uPixel * uScale / -mv.z, 1.6 * uPixel, 26.0 * uPixel);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC; varying float vS;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.12, d);
        float core = smoothstep(0.28, 0.0, d);
        gl_FragColor = vec4(vC * (0.55 + core * 1.1), a);
      }`,
    transparent: true,
    depthWrite: false,
  });
  let satPoints = null;
  let satWorker = null;
  const satSamples = { a: null, b: null, ta: 0, tb: 0, pending: false, seq: 0, lastReq: 0 };
  const satCallbacks = new Map();

  // Orbit trail for the selected (or featured) satellite
  const trailMat = new THREE.LineBasicMaterial({ color: 0xf64137, transparent: true, opacity: 0.55, depthWrite: false });
  const trail = new THREE.Line(new THREE.BufferGeometry(), trailMat);
  trail.frustumCulled = false;
  scene.add(trail);
  let trailFor = -1;
  let trailAt = 0;

  // ── EONET events ─────────────────────────────────────────────────────
  const eventMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixel: { value: Math.min(devicePixelRatio, 2) } },
    vertexShader: /* glsl */ `
      attribute vec3 color; attribute float size; attribute float phase;
      uniform float uTime; uniform float uPixel;
      varying vec3 vC; varying float vP;
      void main() {
        vC = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float p = fract(uTime * 0.45 + phase);
        vP = p;
        gl_PointSize = size * uPixel * (1.0 + 1.3 * p) * (3.2 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC; varying float vP;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float s = d * (1.0 + 1.3 * vP);
        float core = smoothstep(0.42, 0.18, s);
        float ring = smoothstep(0.1, 0.0, abs(d - 0.86)) * (1.0 - vP) * 0.9;
        float a = max(core, ring);
        if (a < 0.02) discard;
        gl_FragColor = vec4(vC * (0.9 + core * 0.8), a);
      }`,
    transparent: true,
    depthWrite: false,
  });
  let eventPoints = null;
  const stormTracks = new THREE.Group();
  scene.add(stormTracks);

  // ── Fireballs ────────────────────────────────────────────────────────
  const fireTex = starburstTexture();
  const fireMat = new THREE.PointsMaterial({ map: fireTex, size: 0.035, sizeAttenuation: true, color: 0xffd28a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  let firePoints = null;

  // ── Aurora ───────────────────────────────────────────────────────────
  const auroraMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSun: uniforms.uSun, uStrength: { value: 0.5 } },
    vertexShader: /* glsl */ `
      attribute float h; attribute float ang;
      varying float vH; varying float vA; varying vec3 vW;
      void main() {
        vH = h; vA = ang;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uSun; uniform float uStrength;
      varying float vH; varying float vA; varying vec3 vW;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      float noise(float x) { float i = floor(x); float f = fract(x); return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f)); }
      void main() {
        float rays = noise(vA * 38.0 + uTime * 0.6) * 0.6 + noise(vA * 97.0 - uTime * 1.3) * 0.4;
        float curtain = smoothstep(0.25, 0.9, rays);
        float fall = smoothstep(0.0, 0.12, vH) * (1.0 - smoothstep(0.25, 1.0, vH));
        vec3 green = vec3(0.25, 1.0, 0.55);
        vec3 red = vec3(0.9, 0.2, 0.45);
        vec3 col = mix(green, red, smoothstep(0.35, 0.95, vH));
        float night = 1.0 - smoothstep(-0.25, 0.15, dot(normalize(vW), normalize(uSun)));
        float a = curtain * fall * night * uStrength;
        gl_FragColor = vec4(col * a * 1.6, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const aurora = new THREE.Group();
  scene.add(aurora);

  function buildAurora(kp) {
    aurora.clear();
    const boundary = 66.5 - 2 * kp;
    for (const pole of [GEOMAG_N, GEOMAG_S]) {
      for (const [offset, height] of [[3.5, 0.045], [6.5, 0.035]]) {
        const colat = (90 - (boundary + offset)) * A.D2R;
        const segs = 256;
        const pos = [], hAttr = [], aAttr = [], idx = [];
        for (let i = 0; i <= segs; i++) {
          const phi = (i / segs) * Math.PI * 2;
          const x = Math.sin(colat) * Math.cos(phi), z = Math.sin(colat) * Math.sin(phi), y = Math.cos(colat);
          pos.push(x * 1.012, y * 1.012, z * 1.012, x * (1.012 + height), y * (1.012 + height), z * (1.012 + height));
          hAttr.push(0, 1);
          aAttr.push(i / segs + offset, i / segs + offset);
          if (i < segs) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('h', new THREE.Float32BufferAttribute(hAttr, 1));
        geo.setAttribute('ang', new THREE.Float32BufferAttribute(aAttr, 1));
        geo.setIndex(idx);
        const mesh = new THREE.Mesh(geo, auroraMat);
        const p = new THREE.Vector3(...A.latLonToXYZ(pole.lat, pole.lon));
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p);
        aurora.add(mesh);
      }
    }
    auroraMat.uniforms.uStrength.value = clamp(0.35 + kp * 0.09, 0.35, 1.2);
  }
  buildAurora(3);

  // ── Labels ───────────────────────────────────────────────────────────
  const tmpV = new THREE.Vector3();
  const occludedByEarth = (p) => {
    // Hidden if the segment camera→p passes through the globe.
    const c = engine.camera.position;
    const d = tmpV.copy(p).sub(c);
    const len = d.length();
    d.divideScalar(len);
    const tca = -c.dot(d);
    if (tca < 0 || tca > len) return false;
    const d2 = c.lengthSq() - tca * tca;
    return d2 < 0.995;
  };

  // ── Textures ─────────────────────────────────────────────────────────
  function toTexture(img, { color = true, aniso = true } = {}) {
    const t = new THREE.Texture(img);
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = aniso ? engine.renderer.capabilities.getMaxAnisotropy() : 1;
    t.wrapS = THREE.RepeatWrapping;
    t.needsUpdate = true;
    return t;
  }

  async function loadDaily(date) {
    state.status.daily = 'loading';
    const prevDate = isoDay(Date.parse(date) - 86400000);
    // The previous day only patches swath gaps, so it loads alongside, not first.
    const prev = prevDate >= VIIRS_FIRST_DAY
      ? loadImage(GIBS_URL(DAILY_LAYER, { date: prevDate }), 'gibs', { timeout: 45000 }).catch(() => null)
      : Promise.resolve(null);
    const img = await loadImage(GIBS_URL(DAILY_LAYER, { date }), 'gibs', { timeout: 45000 });
    swap('uDay', 'uDayReady', img);
    state.status.daily = 'ok';
    prev.then((p) => { if (state.date === date) swap('uDayPrev', 'uDayPrevReady', p); });
  }

  function swap(texKey, readyKey, img) {
    const old = uniforms[texKey].value;
    uniforms[texKey].value = img ? toTexture(img) : blank;
    uniforms[readyKey].value = img ? 1 : 0;
    if (old !== blank) old.dispose();
  }

  async function loadScience(id) {
    const layer = SCIENCE.find((s) => s.id === id);
    state.science = id;
    if (!layer?.layer) { uniforms.uOverlayOpacity.value = 0; return; }
    state.status.science = 'loading';
    renderPanel();
    try {
      const img = await loadImage(GIBS_URL(layer.layer, { date: state.date, w: 2048, h: 1024, fmt: 'image/png', transparent: true }), 'gibs', { timeout: 45000 });
      if (state.science !== id) return;
      const old = uniforms.uOverlay.value;
      uniforms.uOverlay.value = toTexture(img);
      if (old !== blank) old.dispose();
      uniforms.uOverlayOpacity.value = 0.92;
      state.status.science = 'ok';
    } catch (err) {
      state.status.science = 'error';
      ui.toast(`GIBS didn't return that layer: ${err.message}`);
    }
    renderPanel();
  }

  // ── Data loading ─────────────────────────────────────────────────────
  async function initSatellites(log) {
    try {
      const featured = await api('/api/tle/featured', 'tle');
      log?.('tle', 'TLE · satellites', `${featured.length} featured`);
      await startWorker(featured);
      // The full catalogue can take a minute on a cold cache; swap it in when it lands.
      api('/api/tle/catalog', 'tle', { timeout: 240000 })
        .then((all) => startWorker(all))
        .catch((e) => console.warn('TLE catalogue', e));
    } catch (err) {
      log?.('tle', 'TLE · satellites', 'unavailable', true);
      state.status.sats = 'error';
    }
  }

  function startWorker(tles) {
    return new Promise((resolve) => {
      if (!satWorker) {
        satWorker = new Worker(new URL('../workers/sat.worker.js', import.meta.url), { type: 'module' });
        satWorker.onmessage = onWorker;
      }
      satCallbacks.set('ready', (msg) => { buildSatPoints(msg.sats); resolve(); });
      satWorker.postMessage({ type: 'init', tles, now: Date.now() });
    });
  }

  function onWorker(e) {
    const msg = e.data;
    if (msg.type === 'ready') satCallbacks.get('ready')?.(msg);
    else if (msg.type === 'pos') onPositions(msg);
    else if (msg.type === 'track' && msg.index === trailFor) {
      trail.geometry.dispose();
      const g = new THREE.BufferGeometry();
      const pts = msg.pts;
      // Drop any zero (failed) samples so the line doesn't dive to the centre.
      const clean = [];
      for (let i = 0; i < pts.length; i += 3) if (pts[i] || pts[i + 1] || pts[i + 2]) clean.push(pts[i], pts[i + 1], pts[i + 2]);
      g.setAttribute('position', new THREE.Float32BufferAttribute(clean, 3));
      trail.geometry = g;
    } else if (msg.type === 'info') satCallbacks.get('info:' + msg.index)?.(msg);
    else if (msg.type === 'passes') satCallbacks.get('passes:' + msg.index)?.(msg);
  }

  function buildSatPoints(sats) {
    const prevSel = state.selection?.kind === 'sat' ? state.sats?.[state.selection.index]?.id : null;
    state.sats = sats;
    const N = sats.length;
    const counts = { LEO: 0, MEO: 0, GEO: 0, HEO: 0 };
    const colors = new Float32Array(N * 3), sizes = new Float32Array(N);
    sats.forEach((s, i) => {
      counts[s.cls]++;
      const f = FEATURED.has(s.id);
      const c = f ? [1.0, 1.0, 1.0] : SAT_COLORS[s.cls];
      colors.set(c, i * 3);
      sizes[i] = f ? 7 : s.cls === 'LEO' ? 2.4 : 3;
    });
    state.satCounts = counts;
    if (satPoints) { scene.remove(satPoints); satPoints.geometry.dispose(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    satPoints = new THREE.Points(geo, satMat);
    satPoints.frustumCulled = false;
    satPoints.name = 'sats';
    satPoints.visible = state.layers.sats;
    scene.add(satPoints);
    satSamples.a = satSamples.b = null;
    satSamples.pending = false;
    state.status.sats = 'ok';
    // Keep the ISS labelled and trailed by default.
    const issIdx = sats.findIndex((s) => s.id === 25544);
    state.issIndex = issIdx;
    if (prevSel != null) {
      const ni = sats.findIndex((s) => s.id === prevSel);
      if (ni >= 0) state.selection.index = ni;
    }
    requestTrail(state.selection?.kind === 'sat' ? state.selection.index : issIdx, true);
    ensureSatLabels();
    if (ctx.active === api_) renderPanel();
  }

  function requestSample(t) {
    if (!satWorker || !state.sats) return;
    satSamples.pending = true;
    satSamples.lastReq = performance.now();
    satWorker.postMessage({ type: 'prop', t, seq: ++satSamples.seq });
  }

  function onPositions(msg) {
    satSamples.pending = false;
    if (!satPoints || msg.pos.length !== state.sats.length * 3) return;
    const snap = Math.abs(clock.rate) > 600 || !clock.playing || !satSamples.b || Math.abs(clock.sim - msg.t) > Math.max(60000, Math.abs(clock.rate) * 3000);
    if (snap) {
      satSamples.a = msg.pos;
      satSamples.ta = msg.t;
      satSamples.b = msg.pos;
      satSamples.tb = msg.t;
      satPoints.geometry.attributes.position.array.set(msg.pos);
      satPoints.geometry.attributes.position.needsUpdate = true;
    } else {
      // Interpolate from what is on screen now to the new sample.
      satSamples.a = new Float32Array(satPoints.geometry.attributes.position.array);
      satSamples.ta = clock.sim;
      satSamples.b = msg.pos;
      satSamples.tb = msg.t;
    }
  }

  function stepSatellites() {
    if (!satPoints || !state.sats) return;
    const rate = Math.abs(clock.rate);
    const sim = clock.sim;
    if (!satSamples.pending) {
      if (!clock.playing) {
        if (!satSamples.b || satSamples.tb !== sim) requestSample(sim);
      } else if (rate > 600) {
        requestSample(sim);
      } else if (!satSamples.b || sim >= satSamples.ta + (satSamples.tb - satSamples.ta) * 0.6 || sim < satSamples.ta) {
        requestSample(sim + Math.max(1000, rate * 450));
      }
    }
    if (satSamples.a && satSamples.b && satSamples.a !== satSamples.b && clock.playing && rate <= 600) {
      const k = clamp((sim - satSamples.ta) / Math.max(1, satSamples.tb - satSamples.ta), 0, 1);
      const arr = satPoints.geometry.attributes.position.array;
      const a = satSamples.a, b = satSamples.b;
      for (let i = 0; i < arr.length; i++) arr[i] = a[i] + (b[i] - a[i]) * k;
      satPoints.geometry.attributes.position.needsUpdate = true;
    }
  }

  function satPosition(i, out = new THREE.Vector3()) {
    const arr = satPoints?.geometry.attributes.position.array;
    if (!arr || i < 0) return null;
    return out.set(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
  }

  function requestTrail(index, force = false) {
    if (!satWorker || index == null || index < 0 || !state.sats?.[index]) { trail.visible = false; return; }
    const s = state.sats[index];
    const now = clock.sim;
    if (!force && trailFor === index && Math.abs(now - trailAt) < Math.min(s.periodMin * 60000 * 0.05, 600000)) return;
    trailFor = index;
    trailAt = now;
    trail.visible = state.layers.sats;
    const span = Math.min(s.periodMin, 24 * 60) * 60000;
    satWorker.postMessage({ type: 'track', index, t0: now - span * 0.5, t1: now + span * 0.5, steps: 240 });
  }

  let satLabels = [];
  function ensureSatLabels() {
    satLabels.forEach((l) => l.remove());
    satLabels = [];
    if (state.issIndex >= 0) {
      const i = state.issIndex;
      const v = new THREE.Vector3();
      satLabels.push(engine.addLabel('ISS', () => (ctx.active === api_ && state.layers.sats ? satPosition(i, v) : null), { occluder: occludedByEarth }));
    }
    if (state.selection?.kind === 'sat' && state.selection.index !== state.issIndex) {
      const i = state.selection.index;
      const v = new THREE.Vector3();
      satLabels.push(engine.addLabel(esc(state.sats[i].name), () => (ctx.active === api_ ? satPosition(i, v) : null), { occluder: occludedByEarth }));
    }
  }

  async function loadEvents(log) {
    try {
      const j = await api('/api/eonet/events?limit=1000', 'eonet');
      const events = [];
      for (const e of j.events || []) {
        const pts = (e.geometry || []).filter((g) => g.type === 'Point' && Array.isArray(g.coordinates));
        if (!pts.length) continue;
        const lastG = pts[pts.length - 1];
        const cat = e.categories?.[0]?.id || 'manmade';
        events.push({
          id: e.id, title: e.title, cat, catTitle: e.categories?.[0]?.title || cat,
          lon: lastG.coordinates[0], lat: lastG.coordinates[1], date: parseUTC(lastG.date),
          mag: lastG.magnitudeValue, magUnit: lastG.magnitudeUnit, track: pts, sources: e.sources || [], link: e.link,
        });
      }
      state.events = events;
      state.eventCounts = events.reduce((m, e) => ((m[e.cat] = (m[e.cat] || 0) + 1), m), {});
      state.eventFilter = new Set(Object.keys(state.eventCounts));
      buildEventPoints();
      log?.('eonet', 'EONET · natural events', `${n0(events.length)} open`);
    } catch (err) {
      log?.('eonet', 'EONET · natural events', 'unavailable', true);
      state.status.events = 'error';
    }
  }

  function buildEventPoints() {
    if (eventPoints) { scene.remove(eventPoints); eventPoints.geometry.dispose(); }
    stormTracks.clear();
    const list = state.events.filter((e) => state.eventFilter.has(e.cat));
    state.visibleEvents = list;
    const N = list.length;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), phase = new Float32Array(N);
    list.forEach((e, i) => {
      const st = EVENT_STYLE[e.cat] || EVENT_STYLE.manmade;
      pos.set(A.latLonToXYZ(e.lat, e.lon, 1.004), i * 3);
      col.set(st.color, i * 3);
      size[i] = st.size;
      phase[i] = Math.random();
      if (e.cat === 'severeStorms' && e.track.length > 1) {
        const pts = e.track.map((g) => new THREE.Vector3(...A.latLonToXYZ(g.coordinates[1], g.coordinates[0], 1.003)));
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x59dbff, transparent: true, opacity: 0.8 }));
        stormTracks.add(line);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    eventPoints = new THREE.Points(geo, eventMat);
    eventPoints.name = 'events';
    eventPoints.visible = state.layers.events;
    stormTracks.visible = state.layers.events;
    scene.add(eventPoints);
  }

  async function loadKp(log) {
    try {
      const start = isoDay(Date.now() - 30 * 86400000);
      const gst = await api(`/api/donki/GST?startDate=${start}`, 'donki');
      state.gst = (gst || []).map((g) => ({
        id: g.gstID, start: parseUTC(g.startTime), link: g.link,
        kp: Math.max(...(g.allKpIndex || []).map((k) => k.kpIndex || 0), 0),
        obs: (g.allKpIndex || []).map((k) => ({ t: parseUTC(k.observedTime), kp: k.kpIndex, src: k.source })),
      })).sort((a, b) => b.start - a.start);
      const recent = state.gst.find((g) => Date.now() - g.start < 3 * 86400000);
      state.kp = recent ? { value: recent.kp, at: recent.start, storm: true } : { value: 3, at: null, storm: false };
      buildAurora(state.kp.value);
      log?.('donki', 'DONKI · geomagnetic storms', state.gst.length ? `${state.gst.length} in 30 days` : 'none in 30 days');
      updateMarks();
    } catch (err) {
      log?.('donki', 'DONKI · geomagnetic storms', 'unavailable', true);
      state.kp = { value: 3, at: null, storm: false, error: true };
    }
  }

  async function loadEpic(log) {
    try {
      const list = await api('/api/epic/natural/latest', 'epic');
      state.epic = (list || []).map((e) => ({
        image: e.image, caption: e.caption, t: parseUTC(e.date), date: e.date.slice(0, 10),
        centroid: e.centroid_coordinates, dscovr: e.dscovr_j2000_position, sun: e.sun_j2000_position, lunar: e.lunar_j2000_position,
      })).sort((a, b) => a.t - b.t);
      log?.('epic', 'EPIC · DSCOVR', state.epic.length ? `${state.epic.length} frames · ${fmtDate(state.epic[0].t)}` : 'no frames');
      updateMarks();
    } catch (err) {
      log?.('epic', 'EPIC · DSCOVR', 'unavailable', true);
    }
  }

  async function loadFireballs() {
    try {
      const j = await api('/api/fireballs', 'ssd');
      const f = j.fields;
      const ix = (k) => f.indexOf(k);
      state.fireballs = (j.data || []).map((r) => {
        const lat = Number(r[ix('lat')]) * (r[ix('lat-dir')] === 'S' ? -1 : 1);
        const lon = Number(r[ix('lon')]) * (r[ix('lon-dir')] === 'W' ? -1 : 1);
        return { t: parseUTC(r[ix('date')]), lat, lon, energy: Number(r[ix('energy')]), impact: Number(r[ix('impact-e')]), alt: r[ix('alt')] ? Number(r[ix('alt')]) : null, vel: r[ix('vel')] ? Number(r[ix('vel')]) : null };
      }).filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lon));
      const pos = new Float32Array(state.fireballs.length * 3);
      state.fireballs.forEach((b, i) => pos.set(A.latLonToXYZ(b.lat, b.lon, 1.006), i * 3));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      firePoints = new THREE.Points(geo, fireMat);
      firePoints.name = 'fireballs';
      firePoints.visible = state.layers.fireballs;
      scene.add(firePoints);
    } catch { /* optional layer */ }
  }

  async function loadMoonTexture() {
    try {
      const { canvas } = await stitchTrek(TREK.moon.body, TREK.moon.color, 2);
      const t = new THREE.CanvasTexture(canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      moon.material.map = t;
      moon.material.color.set(0xffffff);
      moon.material.needsUpdate = true;
    } catch { /* grey moon is fine */ }
  }

  function updateMarks() {
    const marks = [];
    for (const e of state.epic) marks.push({ t: e.t, label: `EPIC frame ${fmtUTC(e.t)}`, strength: 0.35 });
    for (const g of state.gst || []) marks.push({ t: g.start, label: `Geomagnetic storm, Kp ${g.kp}`, strength: clamp(g.kp / 9, 0.3, 1) });
    if (ctx.active === api_) ui.setTimeRange(api_.timeRange, marks);
    api_.marks = marks;
  }

  // ── Selection & panel ────────────────────────────────────────────────
  function select(sel) {
    state.selection = sel;
    ensureSatLabels();
    if (sel?.kind === 'sat') requestTrail(sel.index, true);
    else requestTrail(state.issIndex, true);
    renderPanel();
  }

  function flyToPoint(p, dist = 2.6) {
    const dir = p.clone().normalize();
    engine.flyTo(dir.multiplyScalar(dist), new THREE.Vector3(0, 0, 0), { duration: 2.2 });
  }

  function renderPanel() {
    if (ctx.active !== api_) return;
    const sel = state.selection;
    if (sel?.kind === 'sat') return renderSatPanel(sel.index);
    if (sel?.kind === 'event') return renderEventPanel(sel.event);
    if (sel?.kind === 'fireball') return renderFireballPanel(sel.fireball);
    renderOverview();
  }

  function renderOverview() {
    const sci = SCIENCE.find((s) => s.id === state.science);
    const c = state.satCounts;
    const storms = state.events.filter((e) => e.cat === 'severeStorms');
    const volcanoes = state.events.filter((e) => e.cat === 'volcanoes');
    const other = state.events.filter((e) => !['severeStorms', 'volcanoes', 'wildfires'].includes(e.cat));
    const fires = state.eventCounts.wildfires || 0;
    const epicFirst = state.epic[0];
    const phase = A.moonPhase(clock.sim);
    const featured = (state.sats || []).map((s, i) => ({ ...s, i })).filter((s) => FEATURED.has(s.id)).slice(0, 10);
    const today = isoDay(Date.now() - 86400000);
    const kp = state.kp;

    const html = `
      <h2>Earth, live</h2>
      <p class="lede">This is the planet as photographed by the VIIRS instrument on Suomi NPP on <strong>${esc(fmtDate(Date.parse(state.date)))}</strong>, lit by the Sun exactly where it stands at the time on the clock. Gaps between satellite passes are filled from the day before. The glow on the night side is VIIRS Black Marble city light.</p>
      <div class="toolbar" style="margin:14px 0 0">
        <label class="field" style="flex:1 1 150px" title="Choose the day GIBS should show">
          <svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="1"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/></svg>
          <span class="vh">Imagery date</span>
          <input type="date" id="e-date" min="${VIIRS_FIRST_DAY}" max="${today}" value="${esc(state.date)}"/>
        </label>
      </div>
      <span class="src">Imagery: <a href="https://nasa-gibs.github.io/gibs-api-docs/" target="_blank" rel="noopener">NASA GIBS</a> · ${esc(DAILY_LAYER)}${state.status.daily === 'loading' ? ' · loading…' : ''}</span>

      <h3>Science layer <small>GIBS · ${esc(fmtDate(Date.parse(state.date)))}</small></h3>
      <div class="chips" role="radiogroup" aria-label="Science layer">
        ${SCIENCE.map((s) => `<button class="chip" type="button" role="radio" data-sci="${s.id}" aria-pressed="${s.id === state.science}" aria-checked="${s.id === state.science}">${esc(s.name)}</button>`).join('')}
      </div>
      ${sci?.what ? `<p class="note">${esc(sci.what)}${state.status.science === 'loading' ? ' <strong>Loading…</strong>' : ''}</p>` : ''}

      <h3>Layers</h3>
      <div class="chips">
        ${[['sats', 'Satellites'], ['events', 'Natural events'], ['fireballs', 'Fireballs'], ['aurora', 'Aurora'], ['moon', 'Moon']]
          .map(([k, l]) => `<button class="chip" type="button" data-layer="${k}" aria-pressed="${state.layers[k]}">${esc(l)}</button>`).join('')}
      </div>

      <h3>Satellites <small>TLE API · SGP4 in a Web Worker</small></h3>
      ${c ? `
        <dl class="stats">
          <div><dt>Tracked now</dt><dd>${n0(state.sats.length)}</dd></div>
          <div><dt>Low Earth orbit</dt><dd><span class="dot" style="background:rgb(140,219,255)"></span>${n0(c.LEO)}</dd></div>
          <div><dt>Medium orbit</dt><dd><span class="dot" style="background:rgb(255,199,92)"></span>${n0(c.MEO)}</dd></div>
          <div><dt>Geostationary</dt><dd><span class="dot" style="background:rgb(219,153,255)"></span>${n0(c.GEO)}</dd></div>
        </dl>
        <ul class="list" style="margin-top:12px">
          ${featured.map((s) => `<li><button type="button" data-sat="${s.i}"><span class="t">${esc(FEATURED.get(s.id) || s.name)}</span><span class="m">${n0(s.altKm)} km</span></button></li>`).join('')}
        </ul>
        <p class="src">Positions are propagated live from each satellite's latest two-line element set. Only sets fresher than 30 days are shown.</p>
      ` : state.status.sats === 'error' ? '<p class="err">The TLE service is not answering right now.</p>' : '<div class="skeleton"></div><div class="skeleton w60"></div>'}

      <h3>Natural events <small>EONET · open now</small></h3>
      ${state.events.length ? `
        <div class="chips" aria-label="Filter events">
          ${Object.entries(state.eventCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
            const st = EVENT_STYLE[k] || EVENT_STYLE.manmade;
            return `<button class="chip" type="button" data-cat="${esc(k)}" aria-pressed="${state.eventFilter.has(k)}"><span class="swatch" style="background:rgb(${st.color.map((x) => Math.round(x * 255)).join(',')})"></span>${esc(st.name)} <span class="num">${n0(v)}</span></button>`;
          }).join('')}
        </div>
        <ul class="list" style="margin-top:12px">
          ${[...storms, ...volcanoes, ...other].slice(0, 12).map((e) => `<li><button type="button" data-event="${esc(e.id)}"><span class="t"><span class="dot" style="background:rgb(${(EVENT_STYLE[e.cat] || EVENT_STYLE.manmade).color.map((x) => Math.round(x * 255)).join(',')})"></span>${esc(e.title)}</span><span class="m">${esc(relTime(e.date))}</span></button></li>`).join('')}
          ${fires ? `<li><button type="button" data-cat-only="wildfires"><span class="t"><span class="dot" style="background:rgb(255,117,41)"></span>${n0(fires)} wildfires burning</span><span class="m">show only</span></button></li>` : ''}
        </ul>
      ` : state.status.events === 'error' ? '<p class="err">EONET is not answering right now.</p>' : '<div class="skeleton"></div><div class="skeleton w80"></div>'}

      <h3>The view from a million miles <small>EPIC · DSCOVR at L1</small></h3>
      ${epicFirst ? `
        <figure class="figure">
          <img id="epic-img" src="/api/epic-image/natural/${esc(epicFirst.date)}/${esc(epicFirst.image)}" alt="Earth's sunlit face photographed by NASA's EPIC camera on ${esc(fmtUTC(epicFirst.t))}" width="1024" height="1024" loading="lazy"/>
          <figcaption id="epic-cap">${esc(fmtUTC(epicFirst.t))} · centred on ${n1(Math.abs(epicFirst.centroid.lat))}°${epicFirst.centroid.lat >= 0 ? 'N' : 'S'} ${n1(Math.abs(epicFirst.centroid.lon))}°${epicFirst.centroid.lon >= 0 ? 'E' : 'W'}</figcaption>
        </figure>
        <div class="row-actions">
          <button class="etch-btn etch-btn--small" type="button" id="epic-match">Match this photo</button>
          <button class="etch-btn etch-btn--small" type="button" id="epic-play">Play the day · ${state.epic.length} frames</button>
        </div>
        <p class="src">"Match" sets the clock to the moment of exposure and flies you to DSCOVR's line of sight, so the 3-D globe and the real photograph can be compared.</p>
      ` : '<div class="skeleton"></div>'}

      <h3>Space weather <small>DONKI · geomagnetic storms</small></h3>
      ${kp ? `
        <dl class="stats">
          <div><dt>Latest storm Kp</dt><dd>${kp.storm ? n1(kp.value) : '—'}</dd></div>
          <div><dt>Storms · 30 days</dt><dd>${n0(state.gst?.length || 0)}</dd></div>
        </dl>
        <p class="note">${kp.storm
          ? `A geomagnetic storm reached <strong>Kp ${n1(kp.value)}</strong> ${esc(relTime(kp.at))}. The aurora ovals are drawn at the latitude that storm would push them to.`
          : kp.error ? 'DONKI did not answer, so the aurora ovals are drawn at a quiet level (Kp 3). <strong>Illustrative.</strong>'
            : 'No geomagnetic storm has been logged in the last three days, so the aurora ovals are drawn at a typical quiet level (Kp 3). <strong>Illustrative.</strong>'}</p>
        <div class="row-actions"><button class="etch-btn etch-btn--small" type="button" data-go="sun">See what the Sun is doing</button></div>
      ` : '<div class="skeleton"></div>'}

      <h3>Fireballs <small>JPL CNEOS · bolides</small></h3>
      ${state.fireballs.length ? `<p>${n0(state.fireballs.length)} of the most recent bright meteors that US government sensors detected exploding in the atmosphere, back to ${esc(fmtDate(state.fireballs[state.fireballs.length - 1].t))}. Hover the starbursts.</p>` : '<p>Loading…</p>'}

      <h3>The Moon <small>computed for the clock</small></h3>
      <dl class="stats">
        <div><dt>Phase</dt><dd>${esc(phase.name)}</dd></div>
        <div><dt>Illuminated</dt><dd>${n0(phase.illum * 100)}%</dd></div>
        <div><dt>Distance</dt><dd>${n0(A.moonEquatorial(clock.sim).km)} <small>km</small></dd></div>
        <div><dt>Light time</dt><dd>${n2s(A.moonEquatorial(clock.sim).km / 299792.458)} <small>s</small></dd></div>
      </dl>
      <div class="row-actions"><button class="etch-btn etch-btn--small" type="button" data-go="moon">Visit the Moon</button></div>
    `;
    const el = ui.setPanel(html);
    wireOverview(el);
  }

  const n2s = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—');

  function wireOverview(el) {
    el.querySelector('#e-date')?.addEventListener('change', async (e) => {
      const v = e.target.value;
      if (!v || v < VIIRS_FIRST_DAY || v > isoDay(Date.now())) return;
      state.date = v;
      renderPanel();
      try {
        await loadDaily(v);
        if (state.science !== 'none') await loadScience(state.science);
        ui.toast(`Earth on ${fmtDate(Date.parse(v))}`);
      } catch (err) {
        state.status.daily = 'error';
        ui.toast(`GIBS couldn't provide that day: ${err.message}`);
      }
      renderPanel();
    });
    el.querySelectorAll('[data-sci]').forEach((b) => b.addEventListener('click', () => loadScience(b.dataset.sci)));
    el.querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.layer;
      state.layers[k] = !state.layers[k];
      applyLayers();
      renderPanel();
    }));
    el.querySelectorAll('[data-sat]').forEach((b) => b.addEventListener('click', () => selectSat(Number(b.dataset.sat), true)));
    el.querySelectorAll('[data-event]').forEach((b) => b.addEventListener('click', () => {
      const ev = state.events.find((x) => x.id === b.dataset.event);
      if (ev) selectEvent(ev, true);
    }));
    el.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.cat;
      if (state.eventFilter.has(k)) state.eventFilter.delete(k); else state.eventFilter.add(k);
      buildEventPoints();
      renderPanel();
    }));
    el.querySelector('[data-cat-only]')?.addEventListener('click', (e) => {
      const k = e.currentTarget.dataset.catOnly;
      state.eventFilter = new Set([k]);
      buildEventPoints();
      renderPanel();
    });
    el.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => ctx.go(b.dataset.go)));
    el.querySelector('#epic-match')?.addEventListener('click', () => matchEpic(0));
    el.querySelector('#epic-play')?.addEventListener('click', playEpicDay);
  }

  function applyLayers() {
    if (satPoints) satPoints.visible = state.layers.sats;
    trail.visible = state.layers.sats && trailFor >= 0;
    if (eventPoints) eventPoints.visible = state.layers.events;
    stormTracks.visible = state.layers.events;
    if (firePoints) firePoints.visible = state.layers.fireballs;
    aurora.visible = state.layers.aurora;
    moon.visible = state.layers.moon;
  }

  function backButton() {
    return '<button class="etch-btn etch-btn--small" type="button" id="back" style="margin-bottom:14px">← Earth overview</button>';
  }

  function renderSatPanel(i) {
    const s = state.sats?.[i];
    if (!s) return renderOverview();
    const title = FEATURED.get(s.id) || s.name;
    const el = ui.setPanel(`
      ${backButton()}
      <h2>${esc(title)}</h2>
      <p class="lede">${esc(s.name)} · NORAD ${esc(s.id)} · ${esc({ LEO: 'low Earth orbit', MEO: 'medium Earth orbit', GEO: 'geostationary orbit', HEO: 'highly elliptical orbit' }[s.cls])}</p>
      <dl class="stats" id="sat-live">
        <div><dt>Altitude</dt><dd>—</dd></div><div><dt>Speed</dt><dd>—</dd></div>
        <div><dt>Latitude</dt><dd>—</dd></div><div><dt>Longitude</dt><dd>—</dd></div>
      </dl>
      <dl class="stats">
        <div><dt>Period</dt><dd>${n1(s.periodMin)} <small>min</small></dd></div>
        <div><dt>Inclination</dt><dd>${n1(s.incl)}°</dd></div>
        <div><dt>Eccentricity</dt><dd>${s.ecc.toFixed(4)}</dd></div>
        <div><dt>Orbits per day</dt><dd>${n1(1440 / s.periodMin)}</dd></div>
      </dl>
      <span class="src">Element set epoch ${esc(fmtUTC(Date.parse(s.epoch)))} (${esc(relTime(Date.parse(s.epoch)))}) · <a href="https://tle.ivanstanojevic.me/api/tle/${esc(s.id)}" target="_blank" rel="noopener">TLE API record</a></span>
      <h3>Passes over you <small>SGP4 · next 48 h</small></h3>
      <p>Uses your browser's location once, only on this device, to predict when this satellite climbs higher than 10° above your horizon.</p>
      <div class="row-actions"><button class="etch-btn etch-btn--small" type="button" id="passes">Find my passes</button></div>
      <div id="pass-out"></div>
    `);
    el.querySelector('#back').addEventListener('click', () => select(null));
    el.querySelector('#passes').addEventListener('click', () => findPasses(i, el.querySelector('#pass-out')));
    updateSatLive();
  }

  let satLiveTimer = 0;
  function updateSatLive() {
    const sel = state.selection;
    if (sel?.kind !== 'sat' || !satWorker) return;
    const i = sel.index;
    satCallbacks.set('info:' + i, (msg) => {
      const box = document.getElementById('sat-live');
      if (!box || !msg.ok) return;
      box.innerHTML = `
        <div><dt>Altitude</dt><dd>${n0(msg.altKm)} <small>km</small></dd></div>
        <div><dt>Speed</dt><dd>${n2s(msg.speed)} <small>km/s</small></dd></div>
        <div><dt>Latitude</dt><dd>${n2s(Math.abs(msg.lat))}° ${msg.lat >= 0 ? 'N' : 'S'}</dd></div>
        <div><dt>Longitude</dt><dd>${n2s(Math.abs(msg.lon))}° ${msg.lon >= 0 ? 'E' : 'W'}</dd></div>`;
    });
    satWorker.postMessage({ type: 'info', index: i, t: clock.sim });
  }

  function findPasses(i, out) {
    if (!('geolocation' in navigator)) { out.innerHTML = '<p class="err">This browser cannot share a location.</p>'; return; }
    out.innerHTML = '<div class="skeleton"></div><div class="skeleton w60"></div>';
    navigator.geolocation.getCurrentPosition((p) => {
      satCallbacks.set('passes:' + i, (msg) => {
        if (!msg.passes.length) { out.innerHTML = '<p class="note">No passes above 10° in the next 48 hours from where you are.</p>'; return; }
        const compass = (az) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((az % 360) + 360) % 360) / 45) % 8];
        out.innerHTML = `<ul class="list">${msg.passes.map((ps) => `<li><div class="row" style="display:grid;grid-template-columns:1fr auto;gap:2px 12px;padding:9px 4px">
          <span class="t">${esc(new Date(ps.start).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }))}</span>
          <span class="m">max ${n0(ps.maxEl)}°</span>
          <span class="s">${esc(compass(ps.startAz))} → ${esc(compass(ps.endAz))} · ${n0((ps.end - ps.start) / 60000)} min · your local time</span></div></li>`).join('')}</ul>
          <p class="src">Geometry only: a pass is visible to the eye when the satellite is sunlit and your sky is dark.</p>`;
      });
      satWorker.postMessage({ type: 'passes', index: i, lat: p.coords.latitude, lon: p.coords.longitude, altM: p.coords.altitude || 0, from: Date.now(), hours: 48 });
    }, (err) => {
      out.innerHTML = `<p class="err">${esc(err.code === 1 ? 'Location permission was declined, so passes cannot be predicted.' : 'Your location could not be determined.')}</p>`;
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  }

  function renderEventPanel(e) {
    const st = EVENT_STYLE[e.cat] || EVENT_STYLE.manmade;
    const el = ui.setPanel(`
      ${backButton()}
      <h2>${esc(e.title)}</h2>
      <p class="lede"><span class="dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:8px;background:rgb(${st.color.map((x) => Math.round(x * 255)).join(',')});box-shadow:0 0 0 1px var(--ink)"></span>${esc(e.catTitle)} · still open</p>
      <dl class="stats">
        <div><dt>Last observed</dt><dd>${esc(fmtDate(e.date))}</dd></div>
        <div><dt>Position</dt><dd>${n2s(Math.abs(e.lat))}°${e.lat >= 0 ? 'N' : 'S'} ${n2s(Math.abs(e.lon))}°${e.lon >= 0 ? 'E' : 'W'}</dd></div>
        ${e.mag != null ? `<div><dt>Magnitude</dt><dd>${esc(n1(e.mag))} <small>${esc(e.magUnit || '')}</small></dd></div>` : ''}
        <div><dt>Observations</dt><dd>${n0(e.track.length)}</dd></div>
      </dl>
      ${e.cat === 'severeStorms' && e.track.length > 1 ? `<p class="note">The line traces the storm's recorded path: ${n0(e.track.length)} fixes from ${esc(fmtDate(parseUTC(e.track[0].date)))} to ${esc(fmtDate(parseUTC(e.track[e.track.length - 1].date)))}.</p>` : ''}
      <h3>Sources</h3>
      <ul class="list">${e.sources.map((s) => `<li><a class="row" href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener"><span class="t">${esc(s.id)}</span><span class="m">open ↗</span></a></li>`).join('')}
        <li><a class="row" href="${esc(safeUrl(e.link))}" target="_blank" rel="noopener"><span class="t">EONET record</span><span class="m">${esc(e.id)} ↗</span></a></li></ul>
      <div class="row-actions">
        <button class="etch-btn etch-btn--small" type="button" id="e-fires">Show fire detections here</button>
      </div>
    `);
    el.querySelector('#back').addEventListener('click', () => select(null));
    el.querySelector('#e-fires').addEventListener('click', () => { loadScience(e.cat === 'severeStorms' ? 'cloud' : 'fires'); });
    el.querySelector('#e-fires').textContent = e.cat === 'severeStorms' ? 'Show cloud-top temperature' : 'Show fire detections';
  }

  function renderFireballPanel(b) {
    const el = ui.setPanel(`
      ${backButton()}
      <h2>Fireball over ${n1(Math.abs(b.lat))}°${b.lat >= 0 ? 'N' : 'S'} ${n1(Math.abs(b.lon))}°${b.lon >= 0 ? 'E' : 'W'}</h2>
      <p class="lede">${esc(fmtUTC(b.t))}: a small asteroid exploding in the upper atmosphere, seen by US government sensors.</p>
      <dl class="stats">
        <div><dt>Impact energy</dt><dd>${esc(b.impact)} <small>kt TNT</small></dd></div>
        <div><dt>Radiated</dt><dd>${esc(b.energy)} <small>×10¹⁰ J</small></dd></div>
        <div><dt>Altitude</dt><dd>${b.alt != null ? esc(b.alt) + ' <small>km</small>' : '—'}</dd></div>
        <div><dt>Velocity</dt><dd>${b.vel != null ? esc(b.vel) + ' <small>km/s</small>' : '—'}</dd></div>
      </dl>
      <span class="src">Source: <a href="https://cneos.jpl.nasa.gov/fireballs/" target="_blank" rel="noopener">JPL CNEOS Fireball Data API</a></span>
    `);
    el.querySelector('#back').addEventListener('click', () => select(null));
  }

  function selectSat(i, fly) {
    if (!state.sats?.[i]) return;
    select({ kind: 'sat', index: i });
    const p = satPosition(i);
    if (fly && p && p.lengthSq() > 0.5) {
      const alt = p.length();
      flyToPoint(p, Math.max(alt + 0.9, 2.2));
    }
    sound.ping(sound.note(clamp(state.sats[i].altKm / 36000, 0, 1), 330), { gain: 0.08 });
  }

  function selectEvent(e, fly) {
    select({ kind: 'event', event: e });
    if (fly) flyToPoint(new THREE.Vector3(...A.latLonToXYZ(e.lat, e.lon)), 2.4);
    sound.ping(sound.note(0.4, 196), { gain: 0.08 });
  }

  // ── EPIC ─────────────────────────────────────────────────────────────
  function epicDirection(frame) {
    const p = frame.dscovr;
    const r = Math.hypot(p.x, p.y, p.z);
    const ra = Math.atan2(p.y, p.x), dec = Math.asin(p.z / r);
    return new THREE.Vector3(...A.equatorialToEarthFixed(ra, dec, frame.t)).normalize();
  }

  function matchEpic(i) {
    const f = state.epic[i];
    if (!f) return;
    clock.pause();
    clock.set(f.t);
    select(null);
    engine.flyTo(epicDirection(f).multiplyScalar(engine.fit(3.6)), new THREE.Vector3(), { duration: 2.6 });
    ui.toast(`Clock set to ${fmtUTC(f.t)}: the moment EPIC took this photograph`, 4200);
  }

  let epicPlaying = false;
  async function playEpicDay() {
    if (epicPlaying || !state.epic.length) return;
    epicPlaying = true;
    const btn = document.getElementById('epic-play');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading frames…'; }
    const urls = state.epic.map((f) => `/api/epic-image/natural/${f.date}/${f.image}`);
    await Promise.allSettled(urls.map((u) => loadImage(u, 'epic', { crossOrigin: null })));
    if (btn) btn.textContent = 'Playing…';
    clock.pause();
    for (let i = 0; i < state.epic.length && epicPlaying; i++) {
      const f = state.epic[i];
      const img = document.getElementById('epic-img');
      const cap = document.getElementById('epic-cap');
      if (!img) break;
      img.src = urls[i];
      if (cap) cap.textContent = `${fmtUTC(f.t)} · frame ${i + 1} of ${state.epic.length}`;
      clock.set(f.t);
      const dir = epicDirection(f);
      engine.flyTo(dir.multiplyScalar(engine.fit(3.6)), new THREE.Vector3(), { duration: i === 0 ? 1.6 : 0.9 });
      sound.ping(sound.note(i / state.epic.length, 220), { gain: 0.06, dur: 1.2 });
      await new Promise((r) => setTimeout(r, i === 0 ? 1800 : 1100));
    }
    epicPlaying = false;
    const b2 = document.getElementById('epic-play');
    if (b2) { b2.disabled = false; b2.textContent = `Play the day · ${state.epic.length} frames`; }
  }

  // ── Scene API ────────────────────────────────────────────────────────
  const sunDir = new THREE.Vector3();
  const moonDir = new THREE.Vector3();
  const arr = [0, 0, 0];

  const api_ = {
    id: 'earth',
    title: 'Earth',
    scene,
    timeRange: [-3, 3],
    marks: [],

    async init() {
      const log = ctx.log || (() => {});
      log('gibs', 'GIBS · Earth imagery', 'requesting…');
      const base = loadImage(GIBS_URL('BlueMarble_ShadedRelief_Bathymetry'), 'gibs', { timeout: 45000 })
        .then((img) => { uniforms.uBase.value = toTexture(img); });
      const night = loadImage(GIBS_URL('VIIRS_Black_Marble'), 'gibs', { timeout: 45000 })
        .then((img) => { uniforms.uNight.value = toTexture(img); uniforms.uNightReady.value = 1; });
      const mask = loadImage(GIBS_URL('OSM_Land_Water_Map', { w: 2048, h: 1024, fmt: 'image/png' }), 'gibs', { timeout: 45000 })
        .then((img) => { uniforms.uMask.value = toTexture(img, { color: false, aniso: false }); uniforms.uMaskReady.value = 1; })
        .catch(() => {});
      const daily = loadDaily(state.date).catch(() => { state.status.daily = 'error'; });

      initSatellites(log);
      loadEvents(log);
      loadKp(log);
      loadEpic(log);
      loadFireballs();
      loadMoonTexture();

      const r = await Promise.allSettled([base, night, daily]);
      const failed = r.filter((x) => x.status === 'rejected').length;
      log('gibs', 'GIBS · Earth imagery', failed ? `${3 - failed} of 3 layers` : `VIIRS · ${fmtDate(Date.parse(state.date))}`, failed === 3);
      await mask;
    },

    enter(opts = {}) {
      const cam = engine.camera;
      cam.near = 0.01; cam.far = 3000; cam.updateProjectionMatrix();
      engine.controls.minDistance = 1.12;
      engine.controls.maxDistance = 90;
      engine.controls.enablePan = false;
      engine.bloom.strength = 0.5;
      engine.bloom.threshold = 0.92;
      engine.applyInset?.();
      const ss = A.subsolarPoint(clock.sim);
      const start = new THREE.Vector3(...A.latLonToXYZ(22, ss.lon - 52)).multiplyScalar(engine.fit(3.5));
      if (opts.fromTour || !api_.entered) {
        cam.position.copy(start).multiplyScalar(1.9);
        engine.controls.target.set(0, 0, 0);
        engine.flyTo(start, new THREE.Vector3(), { duration: 3.2 });
      } else {
        cam.position.copy(start);
        engine.controls.target.set(0, 0, 0);
      }
      api_.entered = true;
      ui.setTimeRange(api_.timeRange, api_.marks);
      renderPanel();
      api_.mood();
      if (opts.deep) api_.focus({ deep: opts.deep });
    },

    exit() { epicPlaying = false; },

    mood() { sound.mood({ base: 55, bright: 0.35, wind: 0.05 }); },

    update(dt, sim) {
      const ss = A.sunEquatorial(sim);
      A.equatorialToEarthFixed(ss.ra, ss.dec, sim, arr);
      sunDir.set(arr[0], arr[1], arr[2]);
      uniforms.uSun.value.copy(sunDir);
      sunGroup.position.copy(sunDir).multiplyScalar(900);
      sunLight.position.copy(sunDir).multiplyScalar(100);

      const m = A.moonEquatorial(sim);
      A.equatorialToEarthFixed(m.ra, m.dec, sim, arr);
      moonDir.set(arr[0], arr[1], arr[2]);
      moon.position.copy(moonDir).multiplyScalar(m.km / A.EARTH_RADIUS_KM);
      moon.lookAt(0, 0, 0);
      moon.rotateY(-Math.PI / 2);

      engine.sky.rotation.set(0, -A.gmst(sim), 0);

      eventMat.uniforms.uTime.value += dt;
      auroraMat.uniforms.uTime.value += dt;
      const camDist = engine.camera.position.length();
      satMat.uniforms.uScale.value = 3.0 * clamp(camDist / 3.2, 0.6, 3);
      stepSatellites();

      satLiveTimer += dt;
      if (satLiveTimer > 0.5) {
        satLiveTimer = 0;
        updateSatLive();
        const idx = state.selection?.kind === 'sat' ? state.selection.index : state.issIndex;
        if (idx >= 0) requestTrail(idx);
      }
    },

    pickables() {
      const out = [globe];
      if (satPoints?.visible) out.push(satPoints);
      if (eventPoints?.visible) out.push(eventPoints);
      if (firePoints?.visible) out.push(firePoints);
      if (moon.visible) out.push(moon);
      return out;
    },

    configureRaycaster(rc) {
      const d = engine.camera.position.length();
      rc.params.Points.threshold = 0.012 * clamp(d / 3, 0.4, 6);
    },

    filterHits(hits) {
      const globeHit = hits.find((h) => h.object === globe);
      const limit = globeHit ? globeHit.distance + 0.002 : Infinity;
      const cands = hits.filter((h) => h.object !== globe && h.distance < limit);
      if (!cands.length) return globeHit || null;
      const moonHit = cands.find((h) => h.object === moon);
      const pts = cands.filter((h) => h.object !== moon);
      if (!pts.length) return moonHit;
      // Events and fireballs win ties over the dense satellite cloud.
      const weight = (h) => (h.distanceToRay ?? 0) * (h.object === satPoints ? 1.6 : 1);
      return pts.sort((a, b) => weight(a) - weight(b))[0];
    },

    hover(hit) {
      if (hit.object === globe) {
        const p = hit.point.clone().normalize();
        const lat = Math.asin(p.y) * A.R2D, lon = Math.atan2(-p.z, p.x) * A.R2D;
        const lst = ((clock.sim / 3600000 + lon / 15) % 24 + 24) % 24;
        const hh = Math.floor(lst), mm = Math.floor((lst - hh) * 60);
        const sun = p.dot(sunDir) > 0 ? 'daylight' : 'night';
        return { title: `${n1(Math.abs(lat))}°${lat >= 0 ? 'N' : 'S'}  ${n1(Math.abs(lon))}°${lon >= 0 ? 'E' : 'W'}`, sub: `mean solar time ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · ${sun}` };
      }
      if (hit.object === moon) return { title: 'The Moon', sub: `${n0(A.moonEquatorial(clock.sim).km)} km · click to visit` };
      if (hit.object === satPoints) {
        const s = state.sats[hit.index];
        return s ? { title: FEATURED.get(s.id) || s.name, sub: `${s.cls} · ${n0(s.altKm)} km · NORAD ${s.id}` } : null;
      }
      if (hit.object === eventPoints) {
        const e = state.visibleEvents[hit.index];
        return e ? { title: e.title, sub: `${e.catTitle} · ${relTime(e.date)}` } : null;
      }
      if (hit.object === firePoints) {
        const b = state.fireballs[hit.index];
        return b ? { title: `Fireball · ${fmtDate(b.t)}`, sub: `${b.impact} kt impact energy` } : null;
      }
      return null;
    },

    click(hit) {
      if (hit.object === globe) return;
      if (hit.object === moon) { ctx.go('moon'); return; }
      if (hit.object === satPoints) selectSat(hit.index, false);
      else if (hit.object === eventPoints) selectEvent(state.visibleEvents[hit.index], false);
      else if (hit.object === firePoints) { select({ kind: 'fireball', fireball: state.fireballs[hit.index] }); sound.ping(660, { gain: 0.06 }); }
    },

    clickEmpty() { if (state.selection) select(null); },

    readouts() {
      const kp = state.kp;
      const phase = A.moonPhase(clock.sim);
      return [
        ['Imagery', state.status.daily === 'loading' ? 'loading…' : `VIIRS · ${fmtDate(Date.parse(state.date))}`, { loading: state.status.daily === 'loading' }],
        ['Satellites', state.sats ? `${n0(state.sats.length)} tracked` : 'loading…', { loading: !state.sats }],
        ['Natural events', state.events.length ? `${n0(state.events.length)} open` : '…', { loading: !state.events.length }],
        ['Geomagnetic', kp ? (kp.storm ? `Kp ${n1(kp.value)} · ${relTime(kp.at)}` : 'quiet · no storm 72 h') : '…'],
        ['Moon', `${phase.name} · ${n0(phase.illum * 100)}%`],
      ];
    },

    searchItems() {
      const items = [];
      (state.sats || []).forEach((s, i) => items.push({ kind: 'Satellite', title: FEATURED.get(s.id) || s.name, meta: `${s.cls} · ${n0(s.altKm)} km`, run: () => selectSat(i, true) }));
      state.events.forEach((e) => items.push({ kind: 'Event', title: e.title, meta: e.catTitle, run: () => { if (!state.eventFilter.has(e.cat)) { state.eventFilter.add(e.cat); buildEventPoints(); } selectEvent(e, true); } }));
      return items;
    },

    focus(opts = {}) {
      if (opts.deep === 'iss' && state.issIndex >= 0) selectSat(state.issIndex, true);
    },

    // Tour hooks
    tour: {
      overview() { select(null); const ss = A.subsolarPoint(clock.sim); engine.flyTo(new THREE.Vector3(...A.latLonToXYZ(20, ss.lon - 50)).multiplyScalar(engine.fit(3.5)), new THREE.Vector3(), { duration: 3 }); },
      iss() { if (state.issIndex >= 0) selectSat(state.issIndex, true); },
      storm() {
        const s = state.events.find((e) => e.cat === 'severeStorms') || state.events.find((e) => e.cat === 'volcanoes') || state.events[0];
        if (s) selectEvent(s, true);
        return s;
      },
      epic() { matchEpic(Math.floor(state.epic.length / 2)); return state.epic[Math.floor(state.epic.length / 2)]; },
      facts: () => ({ iss: state.sats?.[state.issIndex] || null, sats: state.sats?.length || 0, events: state.events.length, fires: state.eventCounts.wildfires || 0, storms: state.eventCounts.severeStorms || 0, date: state.date, kp: state.kp, epic: state.epic.length }),
    },
  };
  return api_;
}

// ── Procedural sprites ─────────────────────────────────────────────────
function radialTexture(stops) {
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

function starburstTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,240,1)');
  grad.addColorStop(0.15, 'rgba(255,220,150,0.8)');
  grad.addColorStop(1, 'rgba(255,160,60,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,235,190,0.8)';
  g.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI;
    g.beginPath();
    g.moveTo(64 - Math.cos(a) * 60, 64 - Math.sin(a) * 60);
    g.lineTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
