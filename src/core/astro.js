// Positional astronomy used across scenes. Low-precision but published
// algorithms (Astronomical Almanac; JPL "Approximate Positions of the
// Planets", E. M. Standish) — accurate to well under a degree, which is far
// finer than anything the scenes can show.
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const TAU = Math.PI * 2;

export const AU_KM = 149597870.7;
export const EARTH_RADIUS_KM = 6371.0;
export const LUNAR_DISTANCE_KM = 384400;
export const SUN_RADIUS_KM = 695700;

export const jd = (ms) => ms / 86400000 + 2440587.5;
export const msFromJd = (j) => (j - 2440587.5) * 86400000;
const norm360 = (d) => ((d % 360) + 360) % 360;
const norm180 = (d) => { const x = norm360(d); return x > 180 ? x - 360 : x; };

/** Greenwich mean sidereal time in radians (IAU 1982). */
export function gmst(ms) {
  const T = (jd(ms) - 2451545.0) / 36525;
  let s = 67310.54841 + (876600 * 3600 + 8640184.812866) * T + 0.093104 * T * T - 6.2e-6 * T * T * T;
  s = ((s % 86400) + 86400) % 86400;
  return (s / 86400) * TAU;
}

export const obliquity = (ms) => (23.439 - 0.0000004 * (jd(ms) - 2451545.0)) * D2R;

/** Sun: right ascension / declination (rad) and distance (AU). */
export function sunEquatorial(ms) {
  const n = jd(ms) - 2451545.0;
  const L = norm360(280.46 + 0.9856474 * n);
  const g = norm360(357.528 + 0.9856003 * n) * D2R;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R;
  const eps = obliquity(ms);
  return {
    ra: Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)),
    dec: Math.asin(Math.sin(eps) * Math.sin(lambda)),
    au: 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g),
  };
}

/** Geographic point directly beneath the Sun, degrees. */
export function subsolarPoint(ms) {
  const { ra, dec } = sunEquatorial(ms);
  return { lat: dec * R2D, lon: norm180((ra - gmst(ms)) * R2D) };
}

/** Moon: geocentric RA/Dec (rad) and distance (km). */
export function moonEquatorial(ms) {
  const T = (jd(ms) - 2451545.0) / 36525;
  const s = (a, b) => Math.sin((a + b * T) * D2R);
  const c = (a, b) => Math.cos((a + b * T) * D2R);
  const lon = 218.32 + 481267.881 * T + 6.29 * s(135.0, 477198.87) - 1.27 * s(259.3, -413335.36)
    + 0.66 * s(235.7, 890534.22) + 0.21 * s(269.9, 954397.74) - 0.19 * s(357.5, 35999.05) - 0.11 * s(186.5, 966404.03);
  const lat = 5.13 * s(93.3, 483202.02) + 0.28 * s(228.2, 960400.89) - 0.28 * s(318.3, 6003.15) - 0.17 * s(217.6, -407332.21);
  const par = 0.9508 + 0.0518 * c(135.0, 477198.87) + 0.0095 * c(259.3, -413335.36) + 0.0078 * c(235.7, 890534.22) + 0.0028 * c(269.9, 954397.74);
  const l = lon * D2R, b = lat * D2R, eps = obliquity(ms);
  const x = Math.cos(b) * Math.cos(l);
  const y = Math.cos(eps) * Math.cos(b) * Math.sin(l) - Math.sin(eps) * Math.sin(b);
  const z = Math.sin(eps) * Math.cos(b) * Math.sin(l) + Math.cos(eps) * Math.sin(b);
  return { ra: Math.atan2(y, x), dec: Math.asin(z), km: EARTH_RADIUS_KM / Math.sin(par * D2R) };
}

/** Illuminated fraction of the Moon (0..1) and phase angle name. */
export function moonPhase(ms) {
  const sun = sunEquatorial(ms), moon = moonEquatorial(ms);
  const cosPsi = Math.sin(sun.dec) * Math.sin(moon.dec) + Math.cos(sun.dec) * Math.cos(moon.dec) * Math.cos(sun.ra - moon.ra);
  const psi = Math.acos(Math.max(-1, Math.min(1, cosPsi)));
  const illum = (1 - Math.cos(psi)) / 2;
  const waxing = norm360((moon.ra - sun.ra) * R2D) < 180;
  let name;
  if (illum < 0.03) name = 'New Moon';
  else if (illum > 0.97) name = 'Full Moon';
  else if (Math.abs(illum - 0.5) < 0.06) name = waxing ? 'First quarter' : 'Last quarter';
  else if (illum < 0.5) name = waxing ? 'Waxing crescent' : 'Waning crescent';
  else name = waxing ? 'Waxing gibbous' : 'Waning gibbous';
  return { illum, name };
}

/**
 * Earth-fixed unit vector in scene space for an equatorial direction.
 * Scene convention (Earth scene): +Y = north pole, +X = lon 0°, −Z = lon 90°E.
 */
export function equatorialToEarthFixed(ra, dec, ms, out = [0, 0, 0]) {
  const lon = ra - gmst(ms);
  out[0] = Math.cos(dec) * Math.cos(lon);
  out[1] = Math.sin(dec);
  out[2] = -Math.cos(dec) * Math.sin(lon);
  return out;
}

export function latLonToXYZ(latDeg, lonDeg, r = 1, out = [0, 0, 0]) {
  const lat = latDeg * D2R, lon = lonDeg * D2R;
  out[0] = r * Math.cos(lat) * Math.cos(lon);
  out[1] = r * Math.sin(lat);
  out[2] = -r * Math.cos(lat) * Math.sin(lon);
  return out;
}

// ── Planets ───────────────────────────────────────────────────────────────
// a (AU), e, I, L, long.peri, long.node (deg) and their rates per Julian century.
// Valid 1800–2050 AD. Source: JPL SSD, Standish (1992), Table 1.
export const PLANETS = [
  { id: 'mercury', name: 'Mercury', radiusKm: 2439.7, color: 0x9a9187, el: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], rt: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081] },
  { id: 'venus', name: 'Venus', radiusKm: 6051.8, color: 0xe3c58e, el: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], rt: [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418] },
  { id: 'earth', name: 'Earth', radiusKm: 6371.0, color: 0x5d8fd6, el: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0], rt: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0] },
  { id: 'mars', name: 'Mars', radiusKm: 3389.5, color: 0xc8643b, el: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], rt: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343] },
  { id: 'jupiter', name: 'Jupiter', radiusKm: 69911, color: 0xd6b38c, el: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], rt: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106] },
  { id: 'saturn', name: 'Saturn', radiusKm: 58232, color: 0xe6d3a1, el: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], rt: [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794] },
  { id: 'uranus', name: 'Uranus', radiusKm: 25362, color: 0x9fd6dc, el: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], rt: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589] },
  { id: 'neptune', name: 'Neptune', radiusKm: 24622, color: 0x5b7fd6, el: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], rt: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.01262724] },
];

export function solveKepler(M, e) {
  // M in radians, elliptical orbits only.
  let E = e < 0.8 ? M + e * Math.sin(M) : Math.PI * Math.sign(M || 1);
  for (let i = 0; i < 40; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

/** Heliocentric ecliptic-J2000 position (AU) from classical elements (deg). */
export function orbitalPosition(a, e, iDeg, nodeDeg, periDeg, Mdeg, out = [0, 0, 0]) {
  const M = norm180(Mdeg) * D2R;
  const E = solveKepler(M, e);
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const w = periDeg * D2R, O = nodeDeg * D2R, I = iDeg * D2R;
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
  out[0] = (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp;
  out[1] = (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp;
  out[2] = sw * sI * xp + cw * sI * yp;
  return out;
}

export function planetElements(p, ms) {
  const T = (jd(ms) - 2451545.0) / 36525;
  const [a, e, I, L, wbar, O] = p.el.map((v, i) => v + p.rt[i] * T);
  return { a, e, i: I, node: O, peri: wbar - O, M: L - wbar };
}

export function planetPosition(p, ms, out) {
  const k = planetElements(p, ms);
  return orbitalPosition(k.a, k.e, k.i, k.node, k.peri, k.M, out);
}

/** Small-body position from SBDB-style elements (deg, AU, JD epoch, n deg/day). */
export function smallBodyPosition(el, ms, out) {
  const M = el.ma + el.n * (jd(ms) - el.epoch);
  return orbitalPosition(el.a, el.e, el.i, el.om, el.w, M, out);
}

/** Ecliptic (x, y, z) → orrery scene space (Y = ecliptic north). */
export const eclipticToScene = (v, scale = 1, out = [0, 0, 0]) => {
  out[0] = v[0] * scale;
  out[1] = v[2] * scale;
  out[2] = -v[1] * scale;
  return out;
};

/** Equatorial RA/Dec (deg) + distance → scene space (Y = celestial north). */
export function raDecToScene(raDeg, decDeg, dist, out = [0, 0, 0]) {
  const ra = raDeg * D2R, dec = decDeg * D2R;
  out[0] = dist * Math.cos(dec) * Math.cos(ra);
  out[1] = dist * Math.sin(dec);
  out[2] = -dist * Math.cos(dec) * Math.sin(ra);
  return out;
}

/** Approximate blackbody colour for a stellar effective temperature (K). */
export function kelvinToRgb(k) {
  const t = Math.max(1000, Math.min(40000, k || 5800)) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (v) => Math.max(0, Math.min(255, v)) / 255;
  return [c(r), c(g), c(b)];
}

export { D2R, R2D, TAU, norm180, norm360 };
