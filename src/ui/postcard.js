// Save the current view as a postcard with a captioned band.
import { download, fmtUTC, isoDay } from '../core/util.js';

const CREDITS = {
  earth: 'NASA GIBS · EONET · EPIC · DONKI · TLE API · JPL CNEOS',
  sun: 'NASA DONKI (CCMC)',
  asteroids: 'JPL SSD/CNEOS · NASA NeoWs',
  moon: 'NASA Moon Trek · LRO',
  mars: 'NASA Mars Trek · Viking · MOLA',
  vesta: 'NASA Vesta Trek · Dawn',
  exoplanets: 'NASA Exoplanet Archive',
};

export async function postcard(ctx) {
  const scene = ctx.active;
  if (!scene) return;
  await document.fonts.ready;
  const shot = new Image();
  shot.src = ctx.engine.capture(scene.scene);
  await shot.decode();
  const W = shot.naturalWidth, H = shot.naturalHeight;
  const band = Math.round(Math.max(90, H * 0.11));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H + band;
  const g = c.getContext('2d');
  g.drawImage(shot, 0, 0);
  // Caption band in the interface's own language: black, Inter, DM Mono, a red mark.
  g.fillStyle = '#000';
  g.fillRect(0, H, W, band);
  g.fillStyle = 'rgba(255,255,255,0.2)';
  g.fillRect(0, H, W, Math.max(1, band / 90));
  const pad = band * 0.32;
  const dot = band * 0.07;
  g.fillStyle = '#f64137';
  g.beginPath();
  g.arc(pad + dot, H + band * 0.38, dot, 0, Math.PI * 2);
  g.fill();
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  g.font = `800 ${Math.round(band * 0.28)}px Inter, Helvetica, sans-serif`;
  const x0 = pad + dot * 2 + band * 0.12;
  g.fillText('NASA', x0, H + band * 0.38);
  const wNasa = g.measureText('NASA ').width;
  g.font = `400 ${Math.round(band * 0.28)}px Inter, Helvetica, sans-serif`;
  g.fillStyle = '#b9b9bb';
  g.fillText('Lab', x0 + wNasa, H + band * 0.38);
  g.font = `600 ${Math.round(band * 0.14)}px Inter, Helvetica, sans-serif`;
  g.fillStyle = '#fff';
  g.fillText(`${scene.title} · ${fmtUTC(ctx.clock.sim)}`, pad, H + band * 0.74);
  g.textAlign = 'right';
  g.font = `500 ${Math.round(band * 0.11)}px "DM Mono", Menlo, monospace`;
  g.fillStyle = '#959599';
  g.fillText(`DATA: ${(CREDITS[scene.id] || 'NASA open data').toUpperCase()}`, W - pad, H + band * 0.74);
  download(c.toDataURL('image/png'), `nasa-lab-${scene.id}-${isoDay(ctx.clock.sim)}.png`);
  ctx.ui.toast('Postcard saved to your downloads');
}
