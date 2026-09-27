// Generative sound, strictly opt-in. A slow drone sets each scene's mood and
// data events are sonified as pitched pings (flare class, asteroid distance,
// the year a planet was found…). Pure Web Audio — no samples to download.

const PENTA = [0, 2, 4, 7, 9];

class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.voices = [];
    this.lastPing = 0;
  }

  async enable() {
    if (!this.ctx) this.build();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.enabled = true;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0.9, t, 0.8);
  }

  disable() {
    this.enabled = false;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, 0.25);
  }

  build() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    // Reverb from a synthetic, exponentially decaying impulse.
    this.reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 4.5;
    const imp = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = imp.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    this.reverb.buffer = imp;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    this.reverb.connect(this.wet).connect(this.master);

    // Drone
    this.droneBus = ctx.createGain();
    this.droneBus.gain.value = 0.16;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 420;
    this.filter.Q.value = 0.7;
    this.droneBus.connect(this.filter);
    this.filter.connect(this.master);
    this.filter.connect(this.reverb);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(this.filter.frequency);
    lfo.start();

    const ratios = [1, 1.5, 2, 3.01];
    const types = ['sine', 'triangle', 'sine', 'sine'];
    this.voices = ratios.map((r, i) => {
      const o = ctx.createOscillator();
      o.type = types[i];
      o.frequency.value = 55 * r;
      o.detune.value = (i - 1.5) * 4;
      const g = ctx.createGain();
      g.gain.value = [0.5, 0.22, 0.28, 0.08][i];
      o.connect(g).connect(this.droneBus);
      o.start();
      return { o, r };
    });

    // Solar-wind bed: filtered noise whose level scenes can drive.
    const nlen = ctx.sampleRate * 2;
    const nbuf = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = nbuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < nlen; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; nd[i] = last * 3.5; }
    const noise = ctx.createBufferSource();
    noise.buffer = nbuf;
    noise.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.6;
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    noise.connect(this.windFilter).connect(this.wind).connect(this.master);
    noise.start();
  }

  /** base: drone root in Hz, bright: 0..1 filter opening, wind: 0..1 noise bed */
  mood({ base = 55, bright = 0.3, wind = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.voices.forEach(({ o, r }) => o.frequency.setTargetAtTime(base * r, t, 2.5));
    this.filter.frequency.setTargetAtTime(220 + bright * 1400, t, 2);
    this.wind.gain.setTargetAtTime(wind * 0.12, t, 1.5);
    this.windFilter.frequency.setTargetAtTime(300 + wind * 900, t, 2);
  }

  /** Map a 0..1 value onto a pentatonic scale across `octaves`. */
  note(v, root = 220, octaves = 3) {
    const steps = Math.max(0, Math.min(PENTA.length * octaves - 1, Math.round(v * (PENTA.length * octaves - 1))));
    const oct = Math.floor(steps / PENTA.length);
    return root * Math.pow(2, oct + PENTA[steps % PENTA.length] / 12);
  }

  ping(freq, { dur = 1.6, gain = 0.12, type = 'sine', pan = 0, minGap = 0.03 } = {}) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    if (t - this.lastPing < minGap) return;
    this.lastPing = t;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const o2 = this.ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2.001;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const g2 = this.ctx.createGain();
    g2.gain.value = 0.25;
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (p) p.pan.value = Math.max(-1, Math.min(1, pan));
    o.connect(g);
    o2.connect(g2).connect(g);
    const out = p ? g.connect(p) : g;
    out.connect(this.master);
    out.connect(this.reverb);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
  }

  /** A soft whoosh for transitions. */
  sweep() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.windFilter.frequency.cancelScheduledValues(t);
    this.windFilter.frequency.setValueAtTime(200, t);
    this.windFilter.frequency.exponentialRampToValueAtTime(2400, t + 0.6);
    this.windFilter.frequency.exponentialRampToValueAtTime(400, t + 1.6);
    this.wind.gain.cancelScheduledValues(t);
    this.wind.gain.setValueAtTime(this.wind.gain.value, t);
    this.wind.gain.linearRampToValueAtTime(0.09, t + 0.4);
    this.wind.gain.linearRampToValueAtTime(0.0, t + 1.8);
  }
}

export const sound = new Sound();

// ── Speech (narration + voice search) ──────────────────────────────────────

export const canSpeak = 'speechSynthesis' in window;

export function speak(text, { rate = 0.98, onend } = {}) {
  if (!canSpeak) { onend?.(); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = rate;
  u.pitch = 0.95;
  const voices = window.speechSynthesis.getVoices();
  const pick = voices.find((v) => /en[-_](GB|US)/i.test(v.lang) && /Daniel|Samantha|Google UK English|Serena|Karen|Moira/i.test(v.name))
    || voices.find((v) => /^en/i.test(v.lang));
  if (pick) u.voice = pick;
  if (onend) u.onend = onend;
  window.speechSynthesis.speak(u);
}

export const stopSpeaking = () => canSpeak && window.speechSynthesis.cancel();

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = !!Recognition;

export function listen() {
  return new Promise((resolve, reject) => {
    if (!Recognition) return reject(new Error('Voice search is not supported in this browser'));
    const r = new Recognition();
    r.lang = 'en-US';
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => resolve(e.results[0][0].transcript);
    r.onerror = (e) => reject(new Error(e.error === 'not-allowed' ? 'Microphone permission was declined' : `Voice search failed (${e.error})`));
    r.onend = () => resolve('');
    r.start();
  });
}
