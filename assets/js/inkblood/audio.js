/* ============================================================
   INKBLOOD — audio.js
   Everything is synthesised; there are no sound files.

   Palette: taiko-ish membrane hits (pitch-swept sine through a
   short decay), steel (filtered noise burst), and sparse taiko and
   breath cues. There is deliberately no continuous oscillator bed:
   on small speakers it read as an electrical hum.
   ============================================================ */

"use strict";

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.enabled = true;
    this.started = false;
    this.musicNodes = [];
    this.lastSlash = 0;
    this.voices = 0;
  }

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.75;
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.62;
    this.sfxGain.connect(this.master);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.0;
    this.musicGain.connect(this.master);
    this.noiseBuf = this.makeNoise(1.2);
  }

  resume() {
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.75 : 0;
  }

  makeNoise(seconds) {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  /** Hard cap on simultaneous voices — hundreds of hits per second
   *  will otherwise saturate the graph and turn to mud. */
  budget() {
    if (!this.ctx || !this.enabled) return false;
    if (this.voices > 18) return false;
    this.voices++;
    setTimeout(() => { this.voices--; }, 220);
    return true;
  }

  tone(freq, dur, opts = {}) {
    if (!this.budget()) return;
    const t = this.t;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = opts.type || "sine";
    o.frequency.setValueAtTime(freq, t);
    if (opts.sweep) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.sweep), t + dur);
    const vol = (opts.gain == null ? 0.3 : opts.gain);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (opts.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    if (opts.filter) {
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = opts.filter;
      g.connect(f); f.connect(this.sfxGain);
    } else g.connect(this.sfxGain);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, opts = {}) {
    if (!this.budget()) return;
    const t = this.t;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.playbackRate.value = opts.rate || 1;
    const f = this.ctx.createBiquadFilter();
    f.type = opts.type || "bandpass";
    f.frequency.setValueAtTime(opts.freq || 2200, t);
    if (opts.sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, opts.sweep), t + dur);
    f.Q.value = opts.q || 1.1;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(opts.gain == null ? 0.25 : opts.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfxGain);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  /* --- game sounds ------------------------------------------ */

  slash(power = 1) {
    // Rate-limit: the arc weapon can fire five times in one frame.
    if (this.t - this.lastSlash < 0.035) return;
    this.lastSlash = this.t;
    this.noise(0.16 * power, { freq: 3400, sweep: 700, q: 0.9, gain: 0.2 * power, rate: 1.5 });
    this.tone(320 * power, 0.1, { type: "triangle", sweep: 120, gain: 0.1 });
  }

  dodge() {
    this.noise(0.14, { type: "highpass", freq: 1800, sweep: 6200, q: 0.8, gain: 0.14, rate: 1.9 });
    this.tone(410, 0.12, { type: "triangle", sweep: 120, gain: 0.08 });
  }

  specialReady() {
    this.tone(392, 0.22, { type: "triangle", sweep: 784, gain: 0.1 });
    setTimeout(() => this.tone(784, 0.34, { type: "sine", sweep: 1046, gain: 0.12 }), 85);
  }

  special() {
    this.tone(92, 0.52, { type: "sine", sweep: 36, gain: 0.3 });
    this.noise(0.34, { type: "bandpass", freq: 2400, sweep: 520, q: 1.4, gain: 0.16, rate: 0.78 });
    setTimeout(() => this.tone(311, 0.28, { type: "sawtooth", sweep: 74, gain: 0.13, filter: 1100 }), 170);
  }

  throwHit(power = 1) {
    this.noise(0.07, { freq: 5200, sweep: 1800, q: 2.2, gain: 0.11 * power, rate: 2 });
  }

  impact(power = 1) {
    this.tone(160, 0.09, { type: "sine", sweep: 55, gain: 0.1 * power });
    this.noise(0.05, { freq: 1400, sweep: 300, gain: 0.07 * power });
  }

  pop(power = 1) {
    this.tone(520 * power, 0.14, { type: "square", sweep: 130, gain: 0.07, filter: 1800 });
  }

  boom(power = 1) {
    this.tone(120, 0.42 * power, { type: "sine", sweep: 34, gain: 0.36 * power });
    this.noise(0.3 * power, { type: "lowpass", freq: 900, sweep: 120, gain: 0.2 });
  }

  thunder() {
    this.noise(0.34, { type: "highpass", freq: 900, sweep: 2600, gain: 0.16, rate: 1.4 });
    this.tone(70, 0.4, { type: "sine", sweep: 30, gain: 0.24 });
  }

  chain() {
    this.noise(0.13, { freq: 3800, sweep: 2400, q: 3.4, gain: 0.09, rate: 1.8 });
  }

  hurt() {
    this.tone(220, 0.2, { type: "sawtooth", sweep: 70, gain: 0.2, filter: 900 });
    this.noise(0.12, { freq: 700, sweep: 180, gain: 0.14 });
  }

  gem() {
    this.tone(880, 0.09, { type: "triangle", gain: 0.05 });
    this.tone(1320, 0.1, { type: "sine", gain: 0.035 });
  }

  coin() { this.tone(1180, 0.08, { type: "square", gain: 0.04, filter: 3000 }); }

  levelUp() {
    const notes = [523, 622, 784, 1046];
    notes.forEach((f, i) => setTimeout(() => this.tone(f, 0.34, { type: "triangle", gain: 0.16 }), i * 72));
    this.tone(98, 0.7, { type: "sine", sweep: 60, gain: 0.26 });
  }

  swarm(power = 1) {
    this.noise(0.7, { type: "lowpass", freq: 420, sweep: 160, gain: 0.14 * power, rate: 0.6 });
    this.tone(58, 0.8, { type: "sine", gain: 0.18 });
  }

  bossRoar() {
    this.tone(64, 1.5, { type: "sawtooth", sweep: 32, gain: 0.34, filter: 420 });
    this.noise(1.2, { type: "lowpass", freq: 700, sweep: 110, gain: 0.28, rate: 0.5 });
    setTimeout(() => this.tone(48, 1.2, { type: "sine", sweep: 26, gain: 0.3 }), 220);
  }

  death() {
    this.tone(180, 1.4, { type: "sine", sweep: 40, gain: 0.32 });
    this.noise(1.0, { type: "lowpass", freq: 500, sweep: 90, gain: 0.2, rate: 0.5 });
  }

  /* --- music ------------------------------------------------- */

  /** Sparse taiko pulse whose tempo is driven by `intensity` (0..1). */
  startMusic() {
    if (!this.ctx || this.started) return;
    this.started = true;
    this.musicGain.gain.linearRampToValueAtTime(0.5, this.t + 3);
    this.musicNodes = [];

    this.intensity = 0;
    this.pulseAcc = 0;
  }

  setIntensity(v) { this.intensity = Math.max(0, Math.min(1, v)); }

  /** Called from the game loop; drives the taiko pulse. */
  updateMusic(dt) {
    if (!this.started || !this.enabled) return;
    const period = 1.05 - this.intensity * 0.5;
    this.pulseAcc += dt;
    if (this.pulseAcc >= period) {
      this.pulseAcc -= period;
      this.beat = (this.beat || 0) + 1;
      const strong = this.beat % 4 === 0;
      const t = this.t;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(strong ? 96 : 76, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.28);
      const vol = (strong ? 0.4 : 0.22) * (0.5 + this.intensity * 0.7);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      o.connect(g); g.connect(this.musicGain);
      o.start(t); o.stop(t + 0.4);

      // A shakuhachi-ish breath on the downbeat of every other bar.
      if (this.beat % 8 === 0) {
        const scale = [293.66, 311.13, 392.0, 440.0, 523.25];
        const f = scale[(Math.random() * scale.length) | 0];
        const o2 = this.ctx.createOscillator();
        const g2 = this.ctx.createGain();
        const flt = this.ctx.createBiquadFilter();
        o2.type = "sine";
        o2.frequency.setValueAtTime(f * 0.995, t);
        o2.frequency.linearRampToValueAtTime(f, t + 0.25);
        flt.type = "lowpass";
        flt.frequency.value = 1400;
        g2.gain.setValueAtTime(0.0001, t);
        g2.gain.exponentialRampToValueAtTime(0.09, t + 0.3);
        g2.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
        o2.connect(flt); flt.connect(g2); g2.connect(this.musicGain);
        o2.start(t); o2.stop(t + 2.4);
      }
    }
  }

  stopMusic() {
    if (!this.started) return;
    this.musicGain.gain.linearRampToValueAtTime(0.0001, this.t + 1.2);
    const nodes = this.musicNodes;
    setTimeout(() => nodes.forEach((n) => { try { n.o.stop(); } catch (e) { /* already stopped */ } }), 1400);
    this.musicNodes = [];
    this.started = false;
  }
}
