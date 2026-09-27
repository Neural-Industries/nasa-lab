// The one simulation clock every scene reads — the "chase light" of the
// interface. Real time by default; the time bar can speed it up, pause it,
// scrub it, or snap back to now.

export const RATES = [
  { v: 1, label: '1×', long: 'real time' },
  { v: 60, label: '1m', long: '1 minute / second' },
  { v: 3600, label: '1h', long: '1 hour / second' },
  { v: 86400, label: '1d', long: '1 day / second' },
  { v: 604800, label: '1w', long: '1 week / second' },
];

class Clock {
  constructor() {
    this.sim = Date.now();
    this.rate = 1;
    this.playing = true;
    this.listeners = new Set();
    this.min = -Infinity;
    this.max = Infinity;
  }

  get offset() { return this.sim - Date.now(); }
  get isLive() { return this.playing && this.rate === 1 && Math.abs(this.offset) < 5000; }

  tick(dtSeconds) {
    if (!this.playing) return;
    this.sim += dtSeconds * 1000 * this.rate;
    if (this.sim > this.max) { this.sim = this.max; this.playing = false; this.emit(); }
    if (this.sim < this.min) this.sim = this.min;
  }

  set(ms, { silent = false } = {}) {
    this.sim = Math.min(this.max, Math.max(this.min, ms));
    if (!silent) this.emit();
  }

  setRate(v) { this.rate = v; this.playing = true; this.emit(); }
  toggle() { this.playing = !this.playing; this.emit(); }
  play() { this.playing = true; this.emit(); }
  pause() { this.playing = false; this.emit(); }
  now() { this.sim = Date.now(); this.rate = 1; this.playing = true; this.emit(); }

  setBounds(min = -Infinity, max = Infinity) {
    this.min = min;
    this.max = max;
    this.set(this.sim, { silent: true });
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach((fn) => fn(this)); }
}

export const clock = new Clock();
