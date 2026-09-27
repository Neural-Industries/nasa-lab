// The opening: each NASA feed checks in while a red progress line fills.
import { $, esc } from '../core/util.js';

const EXPECTED = 6; // gateway + the Earth scene's five logged feeds

export async function runBoot(work) {
  const boot = $('#boot');
  const logEl = boot.querySelector('.boot__log');
  const bar = boot.querySelector('.boot__bar i');

  const rows = new Map();
  const log = (key, label, value = '', bad = false) => {
    let li = rows.get(key);
    if (!li) {
      li = document.createElement('li');
      rows.set(key, li);
      logEl.append(li);
    }
    li.classList.toggle('is-bad', bad);
    li.innerHTML = `<span>${esc(label)}</span><b>${esc(value)}</b>`;
    const settled = [...rows.values()].filter((r) => !/…$/.test(r.textContent)).length;
    if (bar) bar.style.transform = `scaleX(${Math.min(0.92, 0.08 + (settled / EXPECTED) * 0.84)})`;
  };

  log('gateway', 'Gateway', 'connecting…');
  try {
    const h = await fetch('/api/health').then((r) => r.json());
    log('gateway', 'Gateway', h.keyConfigured ? 'online · key held server-side' : 'online · DEMO_KEY');
  } catch {
    log('gateway', 'Gateway', 'unreachable', true);
    boot.querySelector('.boot__sub').textContent = "The NASA Lab gateway isn't answering. Start it with npm run dev (or npm start after a build), then reload.";
    throw new Error('Gateway unreachable');
  }

  try {
    await work(log);
  } catch (err) {
    console.error(err);
    log('fatal', 'Start-up', err.message || 'failed', true);
    const btn = boot.querySelector('.boot__enter');
    btn.hidden = false;
    btn.textContent = 'Try again';
    btn.onclick = () => location.reload();
    throw err;
  }
  if (bar) bar.style.transform = 'scaleX(1)';
  await new Promise((r) => setTimeout(r, 450));
  boot.classList.add('is-done');
  setTimeout(() => boot.remove(), 1300);
}
