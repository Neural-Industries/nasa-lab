// Renderer, post-processing, camera flights, the shared sky, DOM labels and
// picking. Scenes plug into this through a small interface (see main.js).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { clamp, easeInOutCubic, prefersReducedMotion } from './util.js';
import { D2R, kelvinToRgb } from './astro.js';

export function createEngine(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x020203, 1);

  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.01, 5000);
  camera.position.set(0, 0, 4);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.9;
  controls.enablePan = false;
  controls.autoRotateSpeed = 0.25;

  // ── Sky: a separate scene drawn behind everything, camera at its centre ──
  const skyScene = new THREE.Scene();
  const skyCamera = new THREE.PerspectiveCamera(42, camera.aspect, 0.1, 100);
  const sky = buildSky();
  skyScene.add(sky);

  const composer = new EffectComposer(renderer);
  const skyPass = new RenderPass(skyScene, skyCamera);
  const mainPass = new RenderPass(new THREE.Scene(), camera);
  mainPass.clear = false;
  mainPass.clearDepth = true;
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.7, 0.55, 0.82);
  composer.addPass(skyPass);
  composer.addPass(mainPass);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    skyCamera.aspect = w / h;
    skyCamera.updateProjectionMatrix();
    bloom.resolution.set(w, h);
  }
  window.addEventListener('resize', resize);

  // ── Camera flights ──
  let flight = null;
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();

  /** Fly the camera to `pos`, looking at `target`. Arcs around the target and zooms logarithmically. */
  function flyTo(pos, target, { duration = 2.4, onDone } = {}) {
    const fromT = controls.target.clone();
    const toT = target.clone();
    const fromOff = camera.position.clone().sub(fromT);
    const toOff = pos.clone().sub(toT);
    const r0 = Math.max(1e-6, fromOff.length()), r1 = Math.max(1e-6, toOff.length());
    const d0 = fromOff.clone().normalize(), d1 = toOff.clone().normalize();
    const reduced = prefersReducedMotion();
    flight = { t: 0, duration: reduced ? 0.01 : duration, fromT, toT, r0, r1, d0, d1, onDone };
    controls.enabled = false;
  }

  function stepFlight(dt) {
    if (!flight) return;
    flight.t = Math.min(1, flight.t + dt / flight.duration);
    const k = easeInOutCubic(flight.t);
    const target = tmpA.copy(flight.fromT).lerp(flight.toT, k);
    // Slerp the viewing direction; if the directions are opposite, pass over the pole.
    const dot = clamp(flight.d0.dot(flight.d1), -1, 1);
    let dir;
    if (dot > 0.9999) dir = tmpB.copy(flight.d1);
    else {
      const omega = Math.acos(dot);
      const s = Math.sin(omega) || 1e-6;
      dir = tmpB.copy(flight.d0).multiplyScalar(Math.sin((1 - k) * omega) / s)
        .add(flight.d1.clone().multiplyScalar(Math.sin(k * omega) / s));
      if (dot < -0.999) dir.add(new THREE.Vector3(0, Math.sin(k * Math.PI), 0)).normalize();
    }
    const r = Math.exp(Math.log(flight.r0) + (Math.log(flight.r1) - Math.log(flight.r0)) * k);
    controls.target.copy(target);
    camera.position.copy(target).add(dir.normalize().multiplyScalar(r));
    camera.lookAt(target);
    if (flight.t >= 1) {
      const done = flight.onDone;
      flight = null;
      controls.enabled = true;
      done?.();
    }
  }
  const cancelFlight = () => { if (flight) { flight = null; controls.enabled = true; } };
  controls.addEventListener('start', cancelFlight);

  // ── Labels (DOM anchored to 3-D points) ──
  const labelLayer = document.getElementById('labels');
  const labels = new Set();
  const proj = new THREE.Vector3();

  /**
   * @param {string} html  already-escaped markup
   * @param {() => THREE.Vector3} getPos  world position provider
   * @param {{ occluder?: (p: THREE.Vector3) => boolean, below?: boolean }} opts
   */
  function addLabel(html, getPos, opts = {}) {
    const el = document.createElement('div');
    el.className = 'label' + (opts.below ? ' label--below' : '');
    el.innerHTML = html;
    labelLayer.append(el);
    const rec = { el, getPos, opts, visible: true };
    labels.add(rec);
    return {
      el,
      remove() { el.remove(); labels.delete(rec); },
      set visible(v) { rec.visible = v; },
      set html(v) { el.innerHTML = v; },
    };
  }

  function updateLabels() {
    const w = window.innerWidth, h = window.innerHeight;
    for (const rec of labels) {
      const p = rec.getPos();
      let show = rec.visible && !!p;
      if (show) {
        proj.copy(p).project(camera);
        show = proj.z < 1 && Math.abs(proj.x) < 1.05 && Math.abs(proj.y) < 1.05;
        if (show && rec.opts.occluder) show = !rec.opts.occluder(p);
      }
      rec.el.classList.toggle('is-hidden', !show);
      if (show) rec.el.style.transform = `translate(${((proj.x + 1) / 2) * w}px, ${((1 - proj.y) / 2) * h}px) ${rec.opts.below ? 'translate(-50%, 14px)' : 'translate(-50%, calc(-100% - 12px))'}`;
    }
  }

  return {
    THREE,
    renderer,
    camera,
    controls,
    composer,
    bloom,
    sky,
    skyScene,
    mainPass,
    flyTo,
    cancelFlight,
    get flying() { return !!flight; },
    addLabel,
    resize,
    /** Scale a framing distance so the subject still fits on narrow (portrait) screens. */
    fit: (d) => d / Math.min(1, camera.aspect * 1.05),
    frame(dt, scene) {
      stepFlight(dt);
      if (!flight) controls.update();
      skyCamera.quaternion.copy(camera.quaternion);
      skyCamera.fov = camera.fov;
      skyCamera.updateProjectionMatrix();
      sky.material.uniforms.uTime.value += dt;
      mainPass.scene = scene;
      composer.render(dt);
      updateLabels();
    },
    /** Render one frame synchronously and return a PNG data URL of the canvas. */
    capture(scene) {
      mainPass.scene = scene;
      composer.render(0);
      return renderer.domElement.toDataURL('image/png');
    },
  };
}

// A decorative sky. Individual stars are synthetic, but the Milky Way band is
// laid along the real galactic plane in equatorial coordinates, so each scene
// can orient it truthfully for its own reference frame.
function buildSky() {
  const N = 14000;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const size = new Float32Array(N);
  const seed = new Float32Array(N);

  // Galactic north pole (J2000): RA 192.85948°, Dec +27.12825°
  const ngpRa = 192.85948 * D2R, ngpDec = 27.12825 * D2R;
  const ngp = new THREE.Vector3(Math.cos(ngpDec) * Math.cos(ngpRa), Math.sin(ngpDec), -Math.cos(ngpDec) * Math.sin(ngpRa));
  const u = new THREE.Vector3(0, 1, 0).cross(ngp).normalize();
  const v = ngp.clone().cross(u).normalize();
  const tmp = new THREE.Vector3();

  let rng = 1234567;
  const rand = () => ((rng = (rng * 1664525 + 1013904223) >>> 0) / 4294967296);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());

  for (let i = 0; i < N; i++) {
    const inBand = i < N * 0.55;
    if (inBand) {
      const a = rand() * Math.PI * 2;
      const b = gauss() * 0.13 * (1 + 0.6 * Math.cos(a));
      tmp.copy(u).multiplyScalar(Math.cos(a) * Math.cos(b)).addScaledVector(v, Math.sin(a) * Math.cos(b)).addScaledVector(ngp, Math.sin(b));
    } else {
      const z = rand() * 2 - 1, t = rand() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      tmp.set(r * Math.cos(t), z, r * Math.sin(t));
    }
    tmp.normalize().multiplyScalar(50);
    pos.set([tmp.x, tmp.y, tmp.z], i * 3);
    const mag = Math.pow(rand(), inBand ? 5 : 3.2);
    size[i] = 0.6 + mag * (inBand ? 2.4 : 3.8);
    const teff = 3000 + Math.pow(rand(), 1.6) * 20000;
    const [r, g, b] = kelvinToRgb(teff);
    const bright = 0.35 + mag * 1.6;
    col.set([r * bright, g * bright, b * bright], i * 3);
    seed[i] = rand() * 100;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixel: { value: Math.min(window.devicePixelRatio, 2) }, uFade: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec3 color; attribute float size; attribute float seed;
      uniform float uTime; uniform float uPixel;
      varying vec3 vColor; varying float vTw;
      void main() {
        vColor = color;
        vTw = 0.82 + 0.18 * sin(uTime * (0.6 + fract(seed) * 1.8) + seed);
        gl_PointSize = size * uPixel;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      varying vec3 vColor; varying float vTw;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float a = smoothstep(0.5, 0.0, d);
        a = a * a;
        gl_FragColor = vec4(vColor * vTw * uFade, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}
