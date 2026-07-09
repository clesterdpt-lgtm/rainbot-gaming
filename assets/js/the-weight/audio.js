// =============================================================
// audio.js — fully synthesised sound via the Web Audio API
//
// No external audio files. The context is created lazily and only
// resumed from the "Click to Begin" gesture (browser autoplay rules).
// Phase 1 lives here: a low ambient drone and slow, heavy breathing.
// Later phases extend this (positional whispers, the shatter, gasps).
// =============================================================

(function () {
window.TW = window.TW || {};
TW.AudioEngine = class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.drone = null;
    this._breathTimer = null;
    this._breathRate = 5.6;   // seconds per full breath (slow / laboured)
    this.ready = false;
  }

  /** Create + resume the context. Must run inside a user gesture. */
  async unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.ready = true;
  }

  setMaster(v) {
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // ---- low continuous ambient drone -----------------------------------
  startDrone(freq = 41) {
    if (!this.ctx || this.drone) return;
    const t = this.ctx.currentTime;

    const oscA = this.ctx.createOscillator();
    const oscB = this.ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscB.type = 'sine';
    oscA.frequency.value = freq;
    oscB.frequency.value = freq * 1.005;   // slow beating
    oscB.detune.value = -6;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    lp.Q.value = 0.6;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.06, t + 5);

    // a slow sub-oscillation on the filter for an uneasy "swell"
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.06;
    lfoGain.gain.value = 60;
    lfo.connect(lfoGain).connect(lp.frequency);

    oscA.connect(lp); oscB.connect(lp);
    lp.connect(gain).connect(this.master);
    oscA.start(t); oscB.start(t); lfo.start(t);

    this.drone = { oscA, oscB, lfo, gain, lp };
  }

  /** push the drone darker/louder as dread mounts (0..1) */
  setDread(x) {
    if (!this.drone) return;
    const t = this.ctx.currentTime;
    this.drone.gain.gain.setTargetAtTime(0.06 + x * 0.07, t, 1.5);
    this.drone.lp.frequency.setTargetAtTime(220 + x * 240, t, 1.5);
  }

  stopDrone(fade = 2) {
    if (!this.drone) return;
    const t = this.ctx.currentTime;
    const d = this.drone; this.drone = null;
    d.gain.gain.setTargetAtTime(0.0001, t, fade / 3);
    setTimeout(() => {
      try { d.oscA.stop(); d.oscB.stop(); d.lfo.stop(); } catch (e) {}
    }, fade * 1000 + 200);
  }

  // ---- slow heavy breathing -------------------------------------------
  startBreathing(rate = 5.6) {
    this._breathRate = rate;
    if (this._breathTimer) return;
    const loop = () => {
      this._breath();
      this._breathTimer = setTimeout(loop, this._breathRate * 1000);
    };
    loop();
  }

  /** quicken the breath (Phase 2 panic). rate = seconds per breath */
  setBreathRate(rate) { this._breathRate = rate; }

  stopBreathing() {
    if (this._breathTimer) clearTimeout(this._breathTimer);
    this._breathTimer = null;
  }

  _breath() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const dur = Math.min(this._breathRate * 0.85, 4.2);

    // shaped noise = breath; bandpass gives it an airy, throaty quality
    const len = Math.ceil(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 480;
    bp.Q.value = 0.9;

    const g = this.ctx.createGain();
    // inhale (rise) ... hold ... exhale (fall)
    const inhale = dur * 0.42, exhale = dur * 0.5;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + inhale);
    bp.frequency.setValueAtTime(360, t);
    bp.frequency.linearRampToValueAtTime(560, t + inhale);
    g.gain.setTargetAtTime(0.0001, t + inhale + 0.1, exhale / 3);
    bp.frequency.linearRampToValueAtTime(300, t + dur);

    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // ---- short one-shot effects -----------------------------------------
  _noise(dur) {
    const len = Math.ceil(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  creak() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(72, t);
    osc.frequency.exponentialRampToValueAtTime(27, t + 1.1);
    osc.detune.value = (Math.random() - 0.5) * 50;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 230; bp.Q.value = 4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.09);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    osc.connect(bp).connect(g).connect(this.master);
    osc.start(t); osc.stop(t + 1.3);
  }

  knock() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + 0.3);
  }

  tinnitus(freq = 7400, dur = 4) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine'; osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.022, t + 0.7);
    g.gain.setValueAtTime(0.022, t + dur - 1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  // ---- heartbeat (double thump; rate rises with dread) ----------------
  startHeartbeat(bpm = 58) {
    this._hbBpm = bpm;
    if (this._hbTimer) return;
    const beat = () => {
      this._heartThump();
      this._hbTimer = setTimeout(beat, 60000 / this._hbBpm);
    };
    beat();
  }
  setHeartbeat(bpm) { this._hbBpm = bpm; }
  stopHeartbeat() { if (this._hbTimer) clearTimeout(this._hbTimer); this._hbTimer = null; }
  _heartThump() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const thump = (at, amp) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(60, at);
      o.frequency.exponentialRampToValueAtTime(28, at + 0.14);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(amp, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
      o.connect(g).connect(this.master);
      o.start(at); o.stop(at + 0.25);
    };
    thump(t, 0.5);          // lub
    thump(t + 0.17, 0.32);  // dub
  }

  // ---- entity whispers (level + pan follow proximity) -----------------
  startWhispers() {
    if (!this.ctx || this._whisper) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise(3); src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 3.6;
    const lfo = this.ctx.createOscillator();
    const lfoG = this.ctx.createGain();
    lfo.frequency.value = 3.1; lfoG.gain.value = 620;
    lfo.connect(lfoG).connect(bp.frequency);
    const g = this.ctx.createGain(); g.gain.value = 0.0001;
    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    src.connect(bp).connect(g);
    if (pan) g.connect(pan).connect(this.master); else g.connect(this.master);
    src.start(); lfo.start();
    this._whisper = { src, g, pan, lfo };
  }
  setWhisperLevel(x, pan = 0) {
    if (!this._whisper) return;
    const t = this.ctx.currentTime;
    this._whisper.g.gain.setTargetAtTime(Math.max(0, x) * 0.07, t, 0.25);
    if (this._whisper.pan) this._whisper.pan.pan.setTargetAtTime(pan, t, 0.25);
  }
  stopWhispers() {
    if (!this._whisper) return;
    const w = this._whisper; this._whisper = null;
    try { w.src.stop(); w.lfo.stop(); } catch (e) {}
  }

  // ---- jumpscare hit + the shatter into phase 2 -----------------------
  stinger() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(24, t + 0.5);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 950;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
    o.connect(lp).connect(g).connect(this.master);
    o.start(t); o.stop(t + 1);
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise(0.5);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.4, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    src.connect(ng).connect(this.master);
    src.start(t); src.stop(t + 0.5);
  }

  shatter() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise(0.7);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 1900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    src.connect(hp).connect(g).connect(this.master);
    src.start(t); src.stop(t + 0.72);
    [1500, 2050, 2700].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.4, t + 0.5);
      const og = this.ctx.createGain();
      og.gain.setValueAtTime(0.0001, t + i * 0.02);
      og.gain.exponentialRampToValueAtTime(0.11, t + i * 0.02 + 0.02);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(og).connect(this.master);
      o.start(t); o.stop(t + 0.65);
    });
  }

  // soft, panned footstep for the hunting entity in phase 2
  footstep(pan = 0, level = 0.5) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18 * level, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    const scuff = this.ctx.createBufferSource();
    scuff.buffer = this._noise(0.1);
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0.06 * level, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    const out = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (out) {
      out.pan.value = Math.max(-1, Math.min(1, pan));
      o.connect(g).connect(out); scuff.connect(sg).connect(out); out.connect(this.master);
    } else {
      o.connect(g).connect(this.master); scuff.connect(sg).connect(this.master);
    }
    o.start(t); o.stop(t + 0.2); scuff.start(t); scuff.stop(t + 0.1);
  }

  // rapid dry ticks crossing overhead, left to right — nails on the ceiling
  skitter() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const n = 10;
    for (let i = 0; i < n; i++) {
      const at = t0 + 0.1 + i * 0.13 + Math.random() * 0.04;
      const src = this.ctx.createBufferSource();
      src.buffer = this._noise(0.03);
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 2600;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.045 + Math.random() * 0.02, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.045);
      const pan = -0.8 + (i / (n - 1)) * 1.6;      // travels across the room
      src.connect(hp).connect(g).connect(this._panNode(pan));
      src.start(at); src.stop(at + 0.06);
    }
  }

  // a breathy half-word right at the ear — noise pushed through moving formants
  whisperWord(pan = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._panNode(pan);
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise(1.0);
    const f1 = this.ctx.createBiquadFilter();
    f1.type = 'bandpass'; f1.Q.value = 7;
    f1.frequency.setValueAtTime(320, t);
    f1.frequency.linearRampToValueAtTime(720, t + 0.35);
    f1.frequency.linearRampToValueAtTime(420, t + 0.9);
    const f2 = this.ctx.createBiquadFilter();
    f2.type = 'bandpass'; f2.Q.value = 7;
    f2.frequency.setValueAtTime(1700, t);
    f2.frequency.linearRampToValueAtTime(950, t + 0.45);
    f2.frequency.linearRampToValueAtTime(1400, t + 0.9);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.055, t + 0.18);
    g.gain.setValueAtTime(0.055, t + 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
    src.connect(f1).connect(g);
    src.connect(f2).connect(g);
    g.connect(out);
    src.start(t); src.stop(t + 1.0);
  }

  // ---- night wind for the astral outdoors ------------------------------
  startWind() {
    if (!this.ctx || this._wind) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise(3); src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 340; lp.Q.value = 0.4;
    const g = this.ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(0.045, this.ctx.currentTime, 2);
    const lfo = this.ctx.createOscillator();
    const lfoG = this.ctx.createGain();
    lfo.frequency.value = 0.09; lfoG.gain.value = 160;
    lfo.connect(lfoG).connect(lp.frequency);
    src.connect(lp).connect(g).connect(this.master);
    src.start(); lfo.start();
    this._wind = { src, lfo, g };
  }
  stopWind() {
    if (!this._wind) return;
    const w = this._wind; this._wind = null;
    w.g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.6);
    setTimeout(() => { try { w.src.stop(); w.lfo.stop(); } catch (e) {} }, 2500);
  }

  // a soft two-note bell — a shard of the soul returns
  fragmentChime() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [[660, 0], [990, 0.14], [1320, 0.14]].forEach(([f, dl]) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const g = this.ctx.createGain();
      const at = t + dl;
      const amp = f > 1000 ? 0.035 : 0.09;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(amp, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 1.3);
      o.connect(g).connect(this.master);
      o.start(at); o.stop(at + 1.35);
    });
  }

  /** small helper: a panned output node routed into the master bus */
  _panNode(pan = 0) {
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      p.connect(this.master);
      return p;
    }
    return this.master;
  }

  // muffled footsteps out in the hallway (phase 1 anomaly)
  hallSteps(count = 4, pan = -0.3) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < count; i++) {
      const at = t0 + 0.15 + i * 0.42;
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(74, at);
      o.frequency.exponentialRampToValueAtTime(34, at + 0.14);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.07 + Math.random() * 0.02, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.24);
      o.connect(g).connect(this._panNode(pan));
      o.start(at); o.stop(at + 0.3);
    }
  }

  // heavy door slam (phase 2 — a doorway seals itself behind you)
  slam(pan = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._panNode(pan);
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(85, t);
    o.frequency.exponentialRampToValueAtTime(26, t + 0.22);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.55);
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise(0.16);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.3, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(lp).connect(ng).connect(out);
    src.start(t); src.stop(t + 0.18);
  }

  // the hunter beating on a sealed door
  pound(pan = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._panNode(pan);
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.32);
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise(0.08);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 700;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.12, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    src.connect(lp).connect(ng).connect(out);
    src.start(t); src.stop(t + 0.1);
  }

  // splintering crash — the sealed door gives way
  crash(pan = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._panNode(pan);
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise(0.55);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    src.connect(hp).connect(g).connect(out);
    src.start(t); src.stop(t + 0.57);
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(60, t);
    o.frequency.exponentialRampToValueAtTime(24, t + 0.3);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.4, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + 0.52);
  }

  // ascending release — you make it back to your body
  wakeChord() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [392, 523, 659, 784].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const g = this.ctx.createGain();
      const at = t + i * 0.16;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.12, at + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 1.4);
      o.connect(g).connect(this.master);
      o.start(at); o.stop(at + 1.5);
    });
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
};
})();
