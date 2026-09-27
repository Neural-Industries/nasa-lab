// The guided tour: ten stops, every sentence built from the live data.
import { $, n0, n1, n2, fmtUTC, fmtDate, relTime } from '../core/util.js';
import { speak, stopSpeaking } from '../core/audio.js';
import * as A from '../core/astro.js';

let running = false;
let token = 0;
let idx = 0;
let steps = [];
let advance = null;
let ctxRef = null;

export const isRunning = () => running;

const cap = () => ({ el: $('#caption'), title: $('#caption-title'), text: $('#caption-text'), progress: $('#caption-progress'), next: $('#caption-next'), stop: $('#caption-stop') });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 9000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeout) {
    try { const v = fn(); if (v) return v; } catch { /* keep waiting */ }
    await sleep(250);
  }
  return null;
}

async function scene(ctx, id) {
  await ctx.go(id, { fromTour: true });
  const inst = await ctx.getScene(id);
  await inst.ready;
  await sleep(300);
  return inst;
}

function buildSteps(ctx) {
  return [
    async () => {
      const s = await scene(ctx, 'earth');
      const f = await waitFor(() => { const x = s.tour.facts(); return x.sats && x.events ? x : null; }) || s.tour.facts();
      s.tour.overview();
      return { title: 'Earth, today', text: `This is Earth as the VIIRS camera on the Suomi NPP satellite photographed it on ${fmtDate(Date.parse(f.date))}, lit by the Sun for this exact moment. ${f.sats ? `${n0(f.sats)} satellites are being tracked around it in real time.` : ''}`, ms: 12000 };
    },
    async () => {
      const s = await scene(ctx, 'earth');
      s.tour.iss();
      const iss = s.tour.facts().iss;
      return { title: 'The International Space Station', text: iss ? `About ${n0(iss.altKm)} kilometres up, it circles the planet every ${n0(iss.periodMin)} minutes. The red line is its path half an orbit behind and ahead, propagated from its latest orbital elements.` : 'Its path is propagated live from the latest orbital elements.', ms: 12000 };
    },
    async () => {
      const s = await scene(ctx, 'earth');
      const e = s.tour.storm();
      const f = s.tour.facts();
      return { title: e ? e.title : 'Natural events', text: `NASA's Earth Observatory Natural Event Tracker is following ${n0(f.events)} events that are still unfolding, ${n0(f.fires)} of them wildfires.${e ? ` This one is filed under ${e.catTitle.toLowerCase()}, last observed ${relTime(e.date)}.` : ''}`, ms: 12000 };
    },
    async () => {
      const s = await scene(ctx, 'earth');
      const frame = s.tour.epic();
      return { title: 'The view from a million miles', text: frame ? `From a point between Earth and the Sun, DSCOVR's EPIC camera photographs the whole sunlit face of the planet. The clock is now set to ${fmtUTC(frame.t)}, when this picture was taken, and you are looking from DSCOVR's direction. Compare the globe with the photograph in the panel.` : 'EPIC photographs the whole sunlit Earth from a million miles away.', ms: 14000 };
    },
    async () => {
      const s = await scene(ctx, 'sun');
      const f = await waitFor(() => { const x = s.tour.facts(); return x.flares || x.cmes ? x : null; }) || s.tour.facts();
      s.tour.replay();
      return { title: 'The Sun, this month', text: `In the last thirty days the Sun fired ${n0(f.flares)} flares${f.strongest ? `, the strongest ${f.strongest.cls}` : ''}, and threw off ${n0(f.cmes)} coronal mass ejections, ${n0(f.earthward)} of them aimed close to Earth. They replay here at a day per second, at true scale: Earth is the blue dot 215 solar radii away.`, ms: 17000 };
    },
    async () => {
      const s = await scene(ctx, 'asteroids');
      await waitFor(() => s.tour.facts().closest, 12000);
      const r = s.tour.closest();
      const f = s.tour.facts();
      const ld = r ? r.distAu / (A.LUNAR_DISTANCE_KM / A.AU_KM) : null;
      return { title: r ? r.name : 'Close approaches', text: r ? `JPL predicts ${n0(f.count)} asteroid close approaches in the next sixty days. The nearest is ${r.name}: ${n2(ld)} lunar distances on ${fmtDate(r.t)}, at ${n1(r.vRel)} kilometres a second. The dashed ring is the Moon's distance. Watch it cross.` : 'JPL tracks every asteroid that passes close to Earth.', ms: 15000 };
    },
    async () => {
      ctx.clock.now();
      const s = await scene(ctx, 'moon');
      s.tour.site('Apollo 11');
      return { title: 'Tranquility Base', text: 'Apollo 11 landed here on 20 July 1969. This surface is the Lunar Reconnaissance Orbiter\'s global mosaic, stitched tile by tile from NASA Moon Trek.', ms: 11000 };
    },
    async () => {
      ctx.clock.now();
      const s = await scene(ctx, 'mars');
      s.tour.site('Perseverance');
      const e = A.planetPosition(A.PLANETS[2], Date.now()), m = A.planetPosition(A.PLANETS[3], Date.now());
      const km = Math.hypot(m[0] - e[0], m[1] - e[1], m[2] - e[2]) * A.AU_KM;
      return { title: 'Jezero crater, Mars', text: `Perseverance has been exploring this ancient river delta since February 2021. Mars is ${n0(km / 1e6)} million kilometres away right now, so a radio signal takes ${n1(km / 299792.458 / 60)} minutes to cross.`, ms: 12000 };
    },
    async () => {
      const s = await scene(ctx, 'exoplanets');
      const f = await waitFor(() => (s.tour.facts().total ? s.tour.facts() : null), 15000) || s.tour.facts();
      s.tour.timeline();
      return { title: 'Every known world', text: `Since 1992 astronomers have confirmed ${n0(f.total)} planets around other stars, in ${n0(f.systems)} systems. Watch them appear, year by year. With sound on, each chime is a year of discoveries.`, ms: 18000 };
    },
    async () => {
      const s = await scene(ctx, 'earth');
      ctx.clock.now();
      s.tour.overview();
      return { title: 'Your turn', text: 'Everything here is live NASA data. Drag to explore, click anything that glows, pick a destination at the bottom left, or open the Archive for thirty years of Astronomy Pictures of the Day.', ms: 12000 };
    },
  ];
}

export async function start(ctx) {
  if (running) return;
  ctxRef = ctx;
  running = true;
  const my = ++token;
  steps = buildSteps(ctx);
  const c = cap();
  c.el.hidden = false;
  c.next.onclick = () => advance?.();
  c.stop.onclick = () => stop();
  document.getElementById('btn-tour').textContent = 'End the tour';
  document.getElementById('btn-tour').onclick = (e) => { e.stopImmediatePropagation(); stop(); };
  for (idx = 0; idx < steps.length; idx++) {
    if (my !== token) return;
    c.title.textContent = 'Travelling…';
    c.text.textContent = '';
    c.progress.textContent = `${idx + 1} / ${steps.length}`;
    c.next.disabled = true;
    let step;
    try { step = await steps[idx](); } catch (err) { console.warn('tour step', err); continue; }
    if (my !== token) return;
    c.title.textContent = step.title;
    c.text.textContent = step.text;
    c.next.disabled = false;
    c.next.textContent = idx === steps.length - 1 ? 'Finish' : 'Next';
    await new Promise((resolve) => {
      let spoken = !ctx.sound.enabled;
      let timed = false;
      const done = () => { clearTimeout(t); advance = null; resolve(); };
      const t = setTimeout(() => { timed = true; if (spoken) done(); }, step.ms);
      advance = done;
      if (ctx.sound.enabled) speak(`${step.title}. ${step.text}`, { onend: () => { spoken = true; if (timed && advance === done) done(); } });
    });
    stopSpeaking();
  }
  if (my === token) stop();
}

export function stop() {
  if (!running) return;
  running = false;
  token++;
  advance = null;
  stopSpeaking();
  const c = cap();
  c.el.hidden = true;
  const btn = document.getElementById('btn-tour');
  btn.textContent = 'Begin the tour';
  btn.onclick = null;
  ctxRef?.clock.now();
}
