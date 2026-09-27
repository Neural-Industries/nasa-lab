// Keeps the destination rail honest: each distance is re-measured from live data.
import { api } from '../core/api.js';
import * as A from '../core/astro.js';
import { n0, n1 } from '../core/util.js';

const LY_KM = 9.4607e12;
const PC_KM = 3.0857e13;

const fmtKm = (km) => {
  if (km < 2e6) return `${n0(km)} km`;
  const au = km / A.AU_KM;
  return `${au < 10 ? n1(au) : n0(au)} AU`;
};

export async function liveDistances(ctx) {
  const { ui, clock } = ctx;
  const vec = (p) => A.planetPosition(p, clock.sim);
  const earthP = A.PLANETS.find((p) => p.id === 'earth');
  const marsP = A.PLANETS.find((p) => p.id === 'mars');
  let vesta = null;

  const update = () => {
    const m = A.moonEquatorial(clock.sim);
    ui.setDestinationDistance('moon', m.km, `${n0(m.km)} km`);
    const e = vec(earthP);
    const mars = vec(marsP);
    const dm = Math.hypot(mars[0] - e[0], mars[1] - e[1], mars[2] - e[2]) * A.AU_KM;
    ui.setDestinationDistance('mars', dm, fmtKm(dm));
    const s = A.sunEquatorial(clock.sim);
    ui.setDestinationDistance('sun', s.au * A.AU_KM, `${s.au.toFixed(3)} AU`);
    if (vesta) {
      const v = A.smallBodyPosition(vesta, clock.sim);
      const dv = Math.hypot(v[0] - e[0], v[1] - e[1], v[2] - e[2]) * A.AU_KM;
      ui.setDestinationDistance('vesta', dv, fmtKm(dv));
    }
  };

  update();
  setInterval(update, 60000);

  try {
    const s = await api('/api/sbdb?des=4', 'ssd');
    const el = Object.fromEntries(s.orbit.elements.map((x) => [x.name, Number(x.value)]));
    vesta = { a: el.a, e: el.e, i: el.i, om: el.om, w: el.w, ma: el.ma, n: el.n, epoch: Number(s.orbit.epoch) };
    update();
  } catch { /* keep static label */ }

  try {
    const cad = await api('/api/cad?days=60&dist=0.05', 'ssd');
    const iDist = cad.fields.indexOf('dist');
    const closest = Math.min(...cad.data.map((r) => Number(r[iDist])));
    if (Number.isFinite(closest)) {
      const km = closest * A.AU_KM;
      ui.setDestinationDistance('asteroids', km, `${n0(km)} km`);
    }
  } catch { /* keep static label */ }

  try {
    const exo = await api('/api/exoplanets', 'exoplanet');
    const d = exo.columns.sy_dist.filter((x) => x != null && x > 0);
    const min = Math.min(...d);
    ui.setDestinationDistance('exoplanets', min * PC_KM, `${n1((min * PC_KM) / LY_KM)} ly`);
  } catch { /* keep static label */ }
}
