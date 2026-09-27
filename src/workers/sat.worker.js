// SGP4 propagation off the main thread. Positions come back in the Earth
// scene's Earth-fixed frame, in Earth radii (+Y north, +X lon 0°, −Z lon 90°E).
import { twoline2satrec, propagate, gstime, eciToEcf, ecfToLookAngles, eciToGeodetic, degreesLat, degreesLong } from 'satellite.js';

const RE = 6371.0;
const MU = 398600.4418;
let sats = [];

function classify(satrec) {
  const periodMin = (2 * Math.PI) / satrec.no;
  const a = Math.cbrt(MU * Math.pow((periodMin * 60) / (2 * Math.PI), 2));
  const alt = a - 6378.137;
  const e = satrec.ecco;
  let cls = 'LEO';
  if (e > 0.25) cls = 'HEO';
  else if (periodMin > 1400 && periodMin < 1480) cls = 'GEO';
  else if (alt > 2000) cls = 'MEO';
  return { periodMin, altKm: alt, cls, incl: (satrec.inclo * 180) / Math.PI, ecc: e };
}

function posAt(satrec, date) {
  const pv = propagate(satrec, date);
  if (!pv || !pv.position || typeof pv.position !== 'object') return null;
  const g = gstime(date);
  const ecf = eciToEcf(pv.position, g);
  if (!Number.isFinite(ecf.x)) return null;
  return { ecf, eci: pv.position, vel: pv.velocity, g };
}

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    const now = msg.now;
    const out = [];
    sats = [];
    for (const [id, name, l1, l2, date] of msg.tles) {
      const ageDays = (now - Date.parse(date)) / 86400000;
      if (!(ageDays < 30)) continue;
      let satrec;
      try { satrec = twoline2satrec(l1, l2); } catch { continue; }
      if (!satrec || satrec.error) continue;
      const test = posAt(satrec, new Date(now));
      if (!test) continue;
      const alt = Math.hypot(test.ecf.x, test.ecf.y, test.ecf.z) - RE;
      if (alt < 80 || alt > 500000) continue;
      const meta = classify(satrec);
      sats.push({ satrec, id, name });
      out.push({ id, name, epoch: date, ...meta });
    }
    self.postMessage({ type: 'ready', sats: out });
    return;
  }

  if (msg.type === 'prop') {
    const date = new Date(msg.t);
    const pos = new Float32Array(sats.length * 3);
    for (let i = 0; i < sats.length; i++) {
      const p = posAt(sats[i].satrec, date);
      if (!p) { pos[i * 3] = pos[i * 3 + 1] = pos[i * 3 + 2] = 0; continue; }
      pos[i * 3] = p.ecf.x / RE;
      pos[i * 3 + 1] = p.ecf.z / RE;
      pos[i * 3 + 2] = -p.ecf.y / RE;
    }
    self.postMessage({ type: 'pos', seq: msg.seq, t: msg.t, pos }, [pos.buffer]);
    return;
  }

  if (msg.type === 'track') {
    const s = sats[msg.index];
    if (!s) return;
    const n = msg.steps;
    const pts = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const t = msg.t0 + ((msg.t1 - msg.t0) * k) / (n - 1);
      const p = posAt(s.satrec, new Date(t));
      if (!p) continue;
      pts[k * 3] = p.ecf.x / RE;
      pts[k * 3 + 1] = p.ecf.z / RE;
      pts[k * 3 + 2] = -p.ecf.y / RE;
    }
    self.postMessage({ type: 'track', index: msg.index, pts }, [pts.buffer]);
    return;
  }

  if (msg.type === 'info') {
    const s = sats[msg.index];
    if (!s) return;
    const date = new Date(msg.t);
    const p = posAt(s.satrec, date);
    if (!p) { self.postMessage({ type: 'info', index: msg.index, ok: false }); return; }
    const geo = eciToGeodetic(p.eci, p.g);
    const speed = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
    self.postMessage({ type: 'info', index: msg.index, ok: true, lat: degreesLat(geo.latitude), lon: degreesLong(geo.longitude), altKm: geo.height, speed });
    return;
  }

  if (msg.type === 'passes') {
    const s = sats[msg.index];
    if (!s) return;
    const observer = { latitude: (msg.lat * Math.PI) / 180, longitude: (msg.lon * Math.PI) / 180, height: (msg.altM || 0) / 1000 };
    const passes = [];
    let cur = null;
    const step = 20000;
    for (let t = msg.from; t < msg.from + msg.hours * 3600000 && passes.length < 5; t += step) {
      const p = posAt(s.satrec, new Date(t));
      if (!p) continue;
      const look = ecfToLookAngles(observer, p.ecf);
      const el = (look.elevation * 180) / Math.PI;
      const az = (look.azimuth * 180) / Math.PI;
      if (el > 10) {
        if (!cur) cur = { start: t, max: t, maxEl: el, startAz: az, endAz: az, end: t };
        if (el > cur.maxEl) { cur.maxEl = el; cur.max = t; }
        cur.end = t;
        cur.endAz = az;
      } else if (cur) {
        passes.push(cur);
        cur = null;
      }
    }
    self.postMessage({ type: 'passes', index: msg.index, passes });
  }
};
