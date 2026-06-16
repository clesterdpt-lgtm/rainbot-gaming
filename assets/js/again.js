/* ============================================================
   AGAIN. — Rainbot After Dark · No. 001
   ------------------------------------------------------------
   A first-person loop-horror experience in the spirit of P.T.
   One hallway. It repeats. It remembers.

   - three.js (r128, UMD) loaded at runtime from CDN w/ fallback
   - 100% synthesized audio (Web Audio API) — no sound files
   - No build step. No backend. No mercy.
   ============================================================ */
(() => {
  "use strict";

  /* ------------------------------------------------ config */
  const CFG = {
    eyeY: 1.62,
    walkSpeed: 1.95,
    strafeSpeed: 1.6,
    mouseSens: 0.0023,
    touchLookSens: 0.0042,
    playerR: 0.32,
    fov: 70,
    fogDensity: 0.052,
    dprCap: 1.75,
  };

  // Two overlapping rectangles forming the L-shaped hallway.
  // A runs along Z (player walks toward -Z), B branches right (+X).
  const RECT_A = { x0: -1.3, x1: 1.3, z0: -10.0, z1: 7.4 };
  const RECT_B = { x0: -1.3, x1: 8.0, z0: -10.0, z1: -7.4 };
  const START_POS = { x: 0, z: 6.2 };
  const EXIT_X = 7.35;          // crossing this (inside B) ends the loop
  const CEIL_Y = 3.0;

  const TOTAL_LOOPS = 8;
  const SAVE_KEY = "rainbot_game_save:again";

  /* ------------------------------------------------ dom */
  const $ = (id) => document.getElementById(id);
  const el = {
    app: $("app"), boot: $("scr-boot"), pause: $("scr-pause"), end: $("scr-end"),
    err: $("scr-error"), errMsg: $("err-msg"),
    enter: $("btn-enter"), resume: $("btn-resume"), restart: $("btn-restart"),
    again: $("btn-again"), vol: $("vol-slider"), volPause: $("vol-readout"),
    fade: $("fx-fade"), flash: $("fx-flash"), vig: $("fx-vignette"),
    grain: $("fx-grain"), sub: $("fx-sub"), title: $("fx-title"),
    hint: $("fx-hint"), pauseBtn: $("btn-touch-pause"),
    endStats: $("end-stats"), endLine: $("end-line"),
  };

  const isTouch = (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || "ontouchstart" in window;

  /* ------------------------------------------------ utils */
  const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist2d = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
  function readSave() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
      return saved && saved.version === 1 ? saved : null;
    } catch (error) {
      return null;
    }
  }
  function writeSave(data) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 1, savedAt: Date.now(), data }));
    } catch (error) {}
  }
  function clearSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch (error) {}
  }

  /* ============================================================
     three.js loader — CDN with fallback, graceful failure
     ============================================================ */
  const THREE_CDNS = [
    "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
    "https://unpkg.com/three@0.128.0/build/three.min.js",
    "https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js",
  ];
  function loadThree(i, ok, fail) {
    if (window.THREE) return ok();
    if (i >= THREE_CDNS.length) return fail();
    const s = document.createElement("script");
    s.src = THREE_CDNS[i];
    s.onload = () => (window.THREE ? ok() : loadThree(i + 1, ok, fail));
    s.onerror = () => loadThree(i + 1, ok, fail);
    document.head.appendChild(s);
  }

  function fatal(msg) {
    el.err.classList.add("scr--show");
    el.errMsg.textContent = msg;
    el.boot.classList.remove("scr--show");
  }

  /* ============================================================
     FX — grain, vignette, fades, flashes, subtitles, shake
     ============================================================ */
  const FX = (() => {
    const gctx = el.grain.getContext("2d");
    el.grain.width = 160; el.grain.height = 90;
    let grainAmt = 0.06, last = 0;
    function drawGrain(t) {
      if (t - last > 80) {
        last = t;
        const img = gctx.createImageData(160, 90);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const v = (Math.random() * 255) | 0;
          d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
        }
        gctx.putImageData(img, 0, 0);
      }
      el.grain.style.opacity = grainAmt.toFixed(3);
    }
    function setGrain(v) { grainAmt = v; }
    function setVignette(v) { el.vig.style.opacity = clamp(v, 0, 1).toFixed(3); }
    function fade(toBlack, ms, cb) {
      el.fade.style.transitionDuration = ms + "ms";
      el.fade.style.opacity = toBlack ? "1" : "0";
      if (cb) setTimeout(cb, ms + 30);
    }
    function holdBlack() { el.fade.style.transitionDuration = "0ms"; el.fade.style.opacity = "1"; }
    function flash(color, ms) {
      el.flash.style.background = color;
      el.flash.style.opacity = "0.92";
      setTimeout(() => { el.flash.style.opacity = "0"; }, ms);
    }
    let subT = null;
    function sub(text, ms) {
      el.sub.textContent = text;
      el.sub.style.opacity = "1";
      clearTimeout(subT);
      subT = setTimeout(() => { el.sub.style.opacity = "0"; }, ms || 3200);
    }
    function titleCard(text, ms) {
      el.title.textContent = text;
      el.title.style.opacity = "1";
      setTimeout(() => { el.title.style.opacity = "0"; }, ms || 2600);
    }
    return { drawGrain, setGrain, setVignette, fade, holdBlack, flash, sub, titleCard };
  })();

  /* ============================================================
     SFX — fully synthesized horror audio engine
     ============================================================ */
  class Sfx {
    constructor() {
      this.ok = false;
      this.tension = 0; this._tensionTarget = 0;
      this.hbNext = 0; this.hbLevel = 0;
      this.volume = parseFloat(localStorage.getItem("again_vol") || "0.9");
      this.muted = false;
      this._voiceOn = false;
      this._murmurTimer = null;
    }

    init() {
      if (this.ok) return true;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        const c = this.ctx;

        this.master = c.createGain();
        this.master.gain.value = this.volume;
        this.comp = c.createDynamicsCompressor();
        this.comp.threshold.value = -18; this.comp.ratio.value = 6;
        this.master.connect(this.comp); this.comp.connect(c.destination);

        // bus -> master, plus parallel synthesized-impulse reverb
        this.bus = c.createGain();
        this.bus.connect(this.master);
        this.verb = c.createConvolver();
        this.verb.buffer = this._impulse(2.4, 2.6);
        this.verbGain = c.createGain(); this.verbGain.gain.value = 0.16;
        this.bus.connect(this.verb); this.verb.connect(this.verbGain); this.verbGain.connect(this.master);

        this.noiseBuf = this._noise(1.5);

        this._beds();
        this.ok = true;
      } catch (e) { this.ok = false; }
      return this.ok;
    }

    now() { return this.ctx.currentTime; }

    setVolume(v) {
      this.volume = clamp(v, 0, 1);
      localStorage.setItem("again_vol", String(this.volume));
      if (this.ok && !this.muted) this.master.gain.setTargetAtTime(this.volume, this.now(), 0.05);
    }
    setMuted(m) {
      this.muted = m;
      if (this.ok) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.now(), 0.03);
    }
    suspend() { if (this.ok) this.ctx.suspend(); }
    resume() { if (this.ok) this.ctx.resume(); }

    _noise(sec) {
      const c = this.ctx, b = c.createBuffer(1, (sec * c.sampleRate) | 0, c.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return b;
    }
    _impulse(sec, decay) {
      const c = this.ctx, n = (sec * c.sampleRate) | 0, b = c.createBuffer(2, n, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = b.getChannelData(ch);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
      }
      return b;
    }
    _panner(x, y, z) {
      const c = this.ctx;
      let p;
      try { p = new PannerNode(c, { panningModel: "HRTF", distanceModel: "inverse", refDistance: 1, maxDistance: 40, rolloffFactor: 1.35 }); }
      catch (e) {
        p = c.createPanner();
        try { p.panningModel = "HRTF"; } catch (_) {}
        p.distanceModel = "inverse"; p.refDistance = 1; p.maxDistance = 40; p.rolloffFactor = 1.35;
      }
      this._setPan(p, x, y, z);
      p.connect(this.bus);
      return p;
    }
    _setPan(p, x, y, z) {
      if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
      else p.setPosition(x, y, z);
    }
    syncListener(cam) {
      if (!this.ok) return;
      const L = this.ctx.listener;
      const m = cam.matrixWorld.elements;
      const fx = -m[8], fy = -m[9], fz = -m[10];
      const ux = m[4], uy = m[5], uz = m[6];
      const p = cam.position;
      if (L.positionX) {
        L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
        L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz;
        L.upX.value = ux; L.upY.value = uy; L.upZ.value = uz;
      } else {
        L.setPosition(p.x, p.y, p.z);
        L.setOrientation(fx, fy, fz, ux, uy, uz);
      }
    }

    /* ---- constant beds: room tone + tension drone ---- */
    _beds() {
      const c = this.ctx;
      // room tone — filtered noise + sub sine
      const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
      const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 110;
      const ng = c.createGain(); ng.gain.value = 0.05;
      n.connect(lp); lp.connect(ng); ng.connect(this.bus); n.start();
      const sub = c.createOscillator(); sub.frequency.value = 43;
      const sg = c.createGain(); sg.gain.value = 0.016;
      sub.connect(sg); sg.connect(this.bus); sub.start();
      this.roomGain = ng;

      // dissonant drone — minor-second saw pair, swells with tension
      const o1 = c.createOscillator(), o2 = c.createOscillator(), o3 = c.createOscillator();
      o1.type = "sawtooth"; o2.type = "sawtooth"; o3.type = "sine";
      o1.frequency.value = 55; o2.frequency.value = 58.27; o3.frequency.value = 110.6;
      const dlp = c.createBiquadFilter(); dlp.type = "lowpass"; dlp.frequency.value = 320; dlp.Q.value = 1.2;
      this.droneGain = c.createGain(); this.droneGain.gain.value = 0;
      o1.connect(dlp); o2.connect(dlp); o3.connect(dlp);
      dlp.connect(this.droneGain); this.droneGain.connect(this.bus);
      o1.start(); o2.start(); o3.start();

      // high shimmer — barely audible airy dread
      const sh = c.createBufferSource(); sh.buffer = this.noiseBuf; sh.loop = true; sh.playbackRate.value = 0.7;
      const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 5800; bp.Q.value = 2.4;
      this.shimGain = c.createGain(); this.shimGain.gain.value = 0;
      sh.connect(bp); bp.connect(this.shimGain); this.shimGain.connect(this.bus); sh.start();
    }

    setTension(v) { this._tensionTarget = clamp(v, 0, 1); }
    setRoomTone(v) { if (this.ok) this.roomGain.gain.setTargetAtTime(0.05 * v, this.now(), 0.6); }

    /* ---- lamp hum (positional, per lamp) ---- */
    lampHum(x, y, z) {
      if (!this.ok) return { setLevel() {} };
      const c = this.ctx;
      const o1 = c.createOscillator(); o1.frequency.value = 120;
      const o2 = c.createOscillator(); o2.frequency.value = 240;
      const g2 = c.createGain(); g2.gain.value = 0.35;
      const g = c.createGain(); g.gain.value = 0.012;
      const p = this._panner(x, y, z);
      o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(p);
      o1.start(); o2.start();
      return { setLevel(v) { g.gain.value = 0.012 * clamp(v, 0, 1); } };
    }

    /* ---- footsteps ---- */
    footstep(vol) {
      if (!this.ok) return;
      const c = this.ctx, t = this.now();
      const s = c.createBufferSource(); s.buffer = this.noiseBuf;
      s.playbackRate.value = rand(0.85, 1.2);
      const bp = c.createBiquadFilter(); bp.type = "bandpass";
      bp.frequency.value = rand(300, 540); bp.Q.value = 1.1;
      const lo = c.createBiquadFilter(); lo.type = "lowshelf"; lo.frequency.value = 110; lo.gain.value = 7;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + rand(0.07, 0.11));
      s.connect(bp); bp.connect(lo); lo.connect(g); g.connect(this.bus);
      s.start(t, rand(0, 1)); s.stop(t + 0.2);
      if (Math.random() < 0.13) this.floorCreak();
    }
    floorCreak() {
      const c = this.ctx, t = this.now();
      const o = c.createOscillator(); o.type = "sawtooth";
      o.frequency.setValueAtTime(rand(82, 120), t);
      o.frequency.linearRampToValueAtTime(rand(55, 80), t + rand(0.25, 0.5));
      const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 380; bp.Q.value = 9;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.045, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(bp); bp.connect(g); g.connect(this.bus);
      o.start(t); o.stop(t + 0.55);
    }

    /* ---- radio: static + unintelligible voice ---- */
    radioStart(x, y, z) {
      if (!this.ok) return;
      const c = this.ctx;
      this.radioPan = this._panner(x, y, z);
      // static
      const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
      const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1500; bp.Q.value = 0.8;
      this.radioGain = c.createGain(); this.radioGain.gain.value = 0;
      s.connect(bp); bp.connect(this.radioGain); this.radioGain.connect(this.radioPan);
      s.start();
      // voice chain (fed by murmur driver)
      this.voiceOsc = c.createOscillator(); this.voiceOsc.type = "sawtooth"; this.voiceOsc.frequency.value = 102;
      this.voiceF1 = c.createBiquadFilter(); this.voiceF1.type = "bandpass"; this.voiceF1.frequency.value = 520; this.voiceF1.Q.value = 7;
      this.voiceF2 = c.createBiquadFilter(); this.voiceF2.type = "bandpass"; this.voiceF2.frequency.value = 1600; this.voiceF2.Q.value = 9;
      this.voiceGain = c.createGain(); this.voiceGain.gain.value = 0;
      const vmix = c.createGain(); vmix.gain.value = 1;
      this.voiceOsc.connect(this.voiceF1); this.voiceOsc.connect(this.voiceF2);
      this.voiceF1.connect(vmix); this.voiceF2.connect(vmix);
      const tel = c.createBiquadFilter(); tel.type = "bandpass"; tel.frequency.value = 1200; tel.Q.value = 1.4;
      vmix.connect(tel); tel.connect(this.voiceGain); this.voiceGain.connect(this.radioPan);
      this.voiceOsc.start();
      this._murmurDrive();
    }
    setRadio(staticLvl, voiceOn) {
      if (!this.ok || !this.radioGain) return;
      this.radioGain.gain.setTargetAtTime(0.055 * staticLvl, this.now(), 0.4);
      this._voiceOn = !!voiceOn;
    }
    _murmurDrive() {
      const tick = () => {
        if (this._voiceOn && this.ctx.state === "running" && !this.muted) {
          const c = this.ctx, t = this.now();
          const syls = 3 + (Math.random() * 6) | 0;
          let st = t + 0.05;
          this.voiceOsc.frequency.setValueAtTime(rand(92, 118), st);
          for (let i = 0; i < syls; i++) {
            const d = rand(0.07, 0.22);
            this.voiceGain.gain.setValueAtTime(0.0001, st);
            this.voiceGain.gain.exponentialRampToValueAtTime(rand(0.05, 0.1), st + 0.03);
            this.voiceGain.gain.exponentialRampToValueAtTime(0.0001, st + d);
            this.voiceF1.frequency.setValueAtTime(rand(380, 700), st);
            this.voiceF2.frequency.setValueAtTime(rand(1100, 2200), st);
            this.voiceOsc.frequency.setValueAtTime(rand(88, 124), st);
            st += d + rand(0.02, 0.1);
          }
        }
        this._murmurTimer = setTimeout(tick, rand(900, 3400));
      };
      tick();
    }

    /* ---- whisper — breathy syllabic noise near the listener ---- */
    whisper(x, y, z, dur) {
      if (!this.ok) return;
      const c = this.ctx, t = this.now();
      const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
      const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 3.2;
      bp.frequency.setValueAtTime(2600, t);
      bp.frequency.linearRampToValueAtTime(rand(3000, 4200), t + dur);
      const g = c.createGain(); g.gain.value = 0;
      let st = t + 0.02;
      const end = t + dur;
      while (st < end) {
        const d = rand(0.05, 0.16);
        g.gain.setValueAtTime(0.0001, st);
        g.gain.linearRampToValueAtTime(rand(0.02, 0.05), st + 0.025);
        g.gain.linearRampToValueAtTime(0.0001, st + d);
        st += d + rand(0.02, 0.12);
      }
      const p = this._panner(x, y, z);
      s.connect(bp); bp.connect(g); g.connect(p);
      s.start(t, rand(0, 1)); s.stop(end + 0.1);
    }

    /* ---- knocks / thuds / rattles ---- */
    knock(x, y, z, n, gap, loud) {
      if (!this.ok) return;
      const c = this.ctx, p = this._panner(x, y, z);
      for (let i = 0; i < n; i++) {
        const t = this.now() + i * gap;
        const o = c.createOscillator(); o.frequency.setValueAtTime(88, t);
        o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(loud, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        const s = c.createBufferSource(); s.buffer = this.noiseBuf;
        const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 1;
        const g2 = c.createGain();
        g2.gain.setValueAtTime(0.0001, t);
        g2.gain.exponentialRampToValueAtTime(loud * 0.45, t + 0.004);
        g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
        o.connect(g); g.connect(p);
        s.connect(bp); bp.connect(g2); g2.connect(p);
        o.start(t); o.stop(t + 0.3); s.start(t, rand(0, 1)); s.stop(t + 0.1);
      }
    }
    thudFar(x, y, z) { this.knock(x, y, z, 1, 0, 0.18); }
    handleRattle(x, y, z) {
      if (!this.ok) return;
      const c = this.ctx, p = this._panner(x, y, z);
      for (let i = 0; i < 6; i++) {
        const t = this.now() + i * rand(0.05, 0.085);
        const o = c.createOscillator(); o.type = "square"; o.frequency.value = rand(260, 420);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1700; bp.Q.value = 2;
        o.connect(bp); bp.connect(g); g.connect(p);
        o.start(t); o.stop(t + 0.07);
      }
    }

    /* ---- door creak ---- */
    doorCreak(x, y, z, dur) {
      if (!this.ok) return;
      const c = this.ctx, t = this.now();
      const o = c.createOscillator(); o.type = "sawtooth";
      o.frequency.setValueAtTime(70, t);
      const seg = 6;
      for (let i = 1; i <= seg; i++) o.frequency.linearRampToValueAtTime(rand(58, 132), t + (dur * i) / seg);
      const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 480; bp.Q.value = 14;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.075, t + dur * 0.25);
      g.gain.setValueAtTime(0.075, t + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const p = this._panner(x, y, z);
      o.connect(bp); bp.connect(g); g.connect(p);
      o.start(t); o.stop(t + dur + 0.1);
    }

    /* ---- light pop (a bulb dying) ---- */
    lightPop(x, y, z) {
      if (!this.ok) return;
      const c = this.ctx, t = this.now(), p = this._panner(x, y, z);
      const s = c.createBufferSource(); s.buffer = this.noiseBuf;
      const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 2400;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      const o = c.createOscillator(); o.frequency.setValueAtTime(2300, t);
      o.frequency.exponentialRampToValueAtTime(900, t + 0.2);
      const g2 = c.createGain();
      g2.gain.setValueAtTime(0.0001, t);
      g2.gain.exponentialRampToValueAtTime(0.03, t + 0.01);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      s.connect(hp); hp.connect(g); g.connect(p);
      o.connect(g2); g2.connect(p);
      s.start(t, rand(0, 1)); s.stop(t + 0.1); o.start(t); o.stop(t + 0.35);
    }

    /* ---- stinger — dissonant swell ---- */
    stinger(power) {
      if (!this.ok) return;
      const c = this.ctx, t = this.now();
      const sh = c.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(2.8 * x); }
      sh.curve = curve;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.38 * power, t + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.25);
      for (let i = 0; i < 5; i++) {
        const o = c.createOscillator(); o.type = "sawtooth";
        const f0 = rand(170, 240), f1 = rand(560, 880);
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f1, t + 0.85);
        const og = c.createGain(); og.gain.value = 0.2;
        o.connect(og); og.connect(sh);
        o.start(t); o.stop(t + 1.3);
      }
      const s = c.createBufferSource(); s.buffer = this.noiseBuf;
      const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 800; bp.Q.value = 0.6;
      const ng = c.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.exponentialRampToValueAtTime(0.2 * power, t + 0.6);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      s.connect(bp); bp.connect(ng); ng.connect(sh);
      s.start(t); s.stop(t + 1.3);
      sh.connect(g); g.connect(this.bus);
      // sub drop
      const o2 = c.createOscillator(); o2.frequency.setValueAtTime(62, t);
      o2.frequency.exponentialRampToValueAtTime(28, t + 1.0);
      const g2 = c.createGain();
      g2.gain.setValueAtTime(0.0001, t);
      g2.gain.exponentialRampToValueAtTime(0.3 * power, t + 0.1);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      o2.connect(g2); g2.connect(this.bus);
      o2.start(t); o2.stop(t + 1.2);
    }

    /* ---- the scream — final jumpscare, then dead silence ---- */
    scream() {
      if (!this.ok) return;
      const c = this.ctx, t = this.now();
      const sh = c.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(6 * x); }
      sh.curve = curve;
      const out = c.createGain();
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
      out.gain.setValueAtTime(0.5, t + 0.5);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 0.68);
      for (let i = 0; i < 3; i++) {
        const o = c.createOscillator(); o.type = i === 1 ? "square" : "sawtooth";
        o.frequency.setValueAtTime(rand(540, 660), t);
        o.frequency.linearRampToValueAtTime(rand(820, 980), t + 0.3);
        o.frequency.linearRampToValueAtTime(rand(420, 560), t + 0.65);
        const vib = c.createOscillator(); vib.frequency.value = rand(22, 34);
        const vg = c.createGain(); vg.gain.value = 60;
        vib.connect(vg); vg.connect(o.frequency);
        const og = c.createGain(); og.gain.value = 0.25;
        o.connect(og); og.connect(sh);
        o.start(t); o.stop(t + 0.7); vib.start(t); vib.stop(t + 0.7);
      }
      const s = c.createBufferSource(); s.buffer = this.noiseBuf;
      const bp = c.createBiquadFilter(); bp.type = "bandpass";
      bp.frequency.setValueAtTime(1500, t);
      bp.frequency.linearRampToValueAtTime(620, t + 0.6);
      bp.Q.value = 1.2;
      const ng = c.createGain(); ng.gain.value = 0.5;
      s.connect(bp); bp.connect(ng); ng.connect(sh);
      s.start(t); s.stop(t + 0.7);
      sh.connect(out); out.connect(this.bus);
      // duck the world, then leave silence
      this.droneGain.gain.cancelScheduledValues(t);
      this.droneGain.gain.setTargetAtTime(0, t + 0.6, 0.05);
      this.roomGain.gain.setTargetAtTime(0.004, t + 0.6, 0.1);
    }

    /* ---- running footsteps that close in ---- */
    runnerSteps(fromX, fromZ, toX, toZ, dur) {
      if (!this.ok) return;
      const steps = 9;
      for (let i = 0; i < steps; i++) {
        const k = i / (steps - 1);
        const tt = Math.pow(k, 0.8) * dur * 1000;
        setTimeout(() => {
          const c = this.ctx, t0 = this.now();
          const x = lerp(fromX, toX, k), z = lerp(fromZ, toZ, k);
          const p = this._panner(x, 0.2, z);
          const s = c.createBufferSource(); s.buffer = this.noiseBuf;
          const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = rand(260, 420); bp.Q.value = 1;
          const lo = c.createBiquadFilter(); lo.type = "lowshelf"; lo.frequency.value = 90; lo.gain.value = 10;
          const g = c.createGain();
          const v = 0.12 + 0.5 * k;
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.exponentialRampToValueAtTime(v, t0 + 0.008);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
          s.connect(bp); bp.connect(lo); lo.connect(g); g.connect(p);
          s.start(t0, rand(0, 1)); s.stop(t0 + 0.12);
        }, tt);
      }
    }

    /* ---- per-frame: heartbeat & tension smoothing ---- */
    tick(dt) {
      if (!this.ok) return;
      this.tension = lerp(this.tension, this._tensionTarget, 1 - Math.exp(-1.6 * dt));
      const T = this.tension;
      this.droneGain.gain.value = T * 0.11;
      this.shimGain.gain.value = Math.max(0, T - 0.35) * 0.035;
      // heartbeat
      const hb = Math.max(0, T - 0.3) / 0.7;
      this.hbLevel = hb;
      if (hb > 0.02) {
        const period = lerp(1.15, 0.42, hb);
        const t = this.now();
        if (this.hbNext < t) this.hbNext = t + 0.05;
        while (this.hbNext < t + 0.25) {
          this._thump(this.hbNext, 0.16 * hb + 0.04);
          this._thump(this.hbNext + period * 0.24, 0.1 * hb + 0.02);
          this.hbNext += period;
        }
      }
    }
    _thump(t, v) {
      const c = this.ctx;
      const o = c.createOscillator();
      o.frequency.setValueAtTime(58, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.09);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o.connect(g); g.connect(this.bus);
      o.start(t); o.stop(t + 0.16);
    }
  }

  /* ============================================================
     Procedural textures (canvas)
     ============================================================ */
  function makeTex(draw, w, h) {
    const cv = document.createElement("canvas");
    cv.width = w || 256; cv.height = h || 256;
    draw(cv.getContext("2d"), cv.width, cv.height);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }
  function speckle(g, w, h, n, a) {
    for (let i = 0; i < n; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? "0,0,0" : "255,255,255"},${rand(0.02, a)})`;
      g.fillRect(rand(0, w), rand(0, h), rand(1, 3), rand(1, 3));
    }
  }
  const Tex = {
    wallpaper() {
      return makeTex((g, w, h) => {
        g.fillStyle = "#37322a"; g.fillRect(0, 0, w, h);
        for (let x = 0; x < w; x += 26) {
          g.fillStyle = "rgba(0,0,0,0.10)"; g.fillRect(x, 0, 9, h);
          g.fillStyle = "rgba(255,255,240,0.025)"; g.fillRect(x + 14, 0, 2, h);
        }
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, "rgba(0,0,0,0.32)");
        gr.addColorStop(0.25, "rgba(0,0,0,0)");
        gr.addColorStop(0.8, "rgba(0,0,0,0.05)");
        gr.addColorStop(1, "rgba(0,0,0,0.42)");
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
        speckle(g, w, h, 700, 0.05);
        for (let i = 0; i < 5; i++) {
          g.fillStyle = `rgba(20,14,8,${rand(0.04, 0.1)})`;
          g.beginPath();
          g.ellipse(rand(0, w), rand(h * 0.5, h), rand(14, 60), rand(20, 90), 0, 0, 7);
          g.fill();
        }
      });
    },
    floor() {
      return makeTex((g, w, h) => {
        g.fillStyle = "#241a11"; g.fillRect(0, 0, w, h);
        const plank = 64;
        for (let y = 0; y < h; y += plank) {
          g.fillStyle = `rgba(${30 + rand(0, 22) | 0},${20 + rand(0, 14) | 0},${10 + rand(0, 8) | 0},0.55)`;
          g.fillRect(0, y, w, plank - 2);
          g.fillStyle = "rgba(0,0,0,0.75)"; g.fillRect(0, y + plank - 2, w, 2);
          for (let i = 0; i < 26; i++) {
            g.strokeStyle = `rgba(0,0,0,${rand(0.04, 0.14)})`;
            g.lineWidth = rand(0.5, 1.4);
            const yy = y + rand(2, plank - 4);
            g.beginPath(); g.moveTo(0, yy); g.lineTo(w, yy + rand(-3, 3)); g.stroke();
          }
          g.fillStyle = "rgba(0,0,0,0.8)";
          g.fillRect(rand(0, w), y, 1.5, plank);
        }
        speckle(g, w, h, 500, 0.06);
      });
    },
    ceiling() {
      return makeTex((g, w, h) => {
        g.fillStyle = "#262321"; g.fillRect(0, 0, w, h);
        speckle(g, w, h, 800, 0.04);
        for (let i = 0; i < 7; i++) {
          g.fillStyle = `rgba(14,11,7,${rand(0.05, 0.13)})`;
          g.beginPath();
          g.ellipse(rand(0, w), rand(0, h), rand(20, 80), rand(14, 60), rand(0, 3), 0, 7);
          g.fill();
        }
      });
    },
    door() {
      return makeTex((g, w, h) => {
        g.fillStyle = "#2b1d11"; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 60; i++) {
          g.strokeStyle = `rgba(0,0,0,${rand(0.05, 0.16)})`;
          g.lineWidth = rand(0.5, 2);
          g.beginPath(); g.moveTo(rand(0, w), 0); g.lineTo(rand(0, w), h); g.stroke();
        }
        const panel = (x, y, pw, ph) => {
          g.fillStyle = "rgba(0,0,0,0.4)"; g.fillRect(x, y, pw, ph);
          g.fillStyle = "#241809"; g.fillRect(x + 6, y + 6, pw - 12, ph - 12);
          g.strokeStyle = "rgba(255,230,190,0.07)"; g.lineWidth = 2;
          g.strokeRect(x + 1, y + 1, pw - 2, ph - 2);
        };
        panel(w * 0.16, h * 0.08, w * 0.68, h * 0.36);
        panel(w * 0.16, h * 0.52, w * 0.68, h * 0.4);
        speckle(g, w, h, 280, 0.06);
      });
    },
    // family photo variants: 0 normal · 1 scratched · 2 empty · 3 watcher
    photo(variant, seed) {
      return makeTex((g, w, h) => {
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, "#5e5443"); gr.addColorStop(1, "#2e2417");
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
        g.fillStyle = "rgba(255,240,200,0.06)";
        g.fillRect(0, 0, w, h * 0.3);
        const figures = 2 + (seed % 3);
        if (variant !== 2) {
          for (let i = 0; i < figures; i++) {
            const fx = w * (0.22 + (i * 0.56) / Math.max(1, figures - 1));
            const fy = h * 0.62, hr = w * rand(0.07, 0.09);
            g.fillStyle = "#0d0a07";
            g.beginPath(); g.arc(fx, fy - hr * 2.4, hr, 0, 7); g.fill();
            g.beginPath();
            g.ellipse(fx, fy + hr * 0.8, hr * 1.9, hr * 2.6, 0, Math.PI, 0);
            g.fill();
            g.fillRect(fx - hr * 1.9, fy + hr * 0.8, hr * 3.8, h * 0.45);
            if (variant === 3 && i === figures - 1) {
              // one of them is looking at you now
              g.fillStyle = "#cfc8ba";
              g.beginPath(); g.arc(fx - hr * 0.3, fy - hr * 2.5, hr * 0.13, 0, 7); g.fill();
              g.beginPath(); g.arc(fx + hr * 0.3, fy - hr * 2.5, hr * 0.13, 0, 7); g.fill();
            }
          }
        }
        if (variant === 1) {
          g.strokeStyle = "rgba(10,6,4,0.9)";
          for (let i = 0; i < 14; i++) {
            g.lineWidth = rand(1.5, 4);
            g.beginPath();
            g.moveTo(rand(0, w), rand(0, h * 0.55));
            g.lineTo(rand(0, w), rand(0, h * 0.7));
            g.stroke();
          }
        }
        const vg = g.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.75);
        vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.55)");
        g.fillStyle = vg; g.fillRect(0, 0, w, h);
        speckle(g, w, h, 300, 0.08);
      }, 128, 160);
    },
    radio() {
      return makeTex((g, w, h) => {
        g.fillStyle = "#191008"; g.fillRect(0, 0, w, h);
        g.fillStyle = "#0c0805"; g.fillRect(w * 0.08, h * 0.16, w * 0.5, h * 0.68);
        g.fillStyle = "rgba(200,170,120,0.18)";
        for (let y = h * 0.2; y < h * 0.8; y += 5)
          for (let x = w * 0.1; x < w * 0.56; x += 5) g.fillRect(x, y, 2, 2);
        g.fillStyle = "#241a10";
        g.beginPath(); g.arc(w * 0.74, h * 0.4, w * 0.07, 0, 7); g.fill();
        g.beginPath(); g.arc(w * 0.74, h * 0.7, w * 0.05, 0, 7); g.fill();
        g.fillStyle = "rgba(255,120,60,0.5)";
        g.fillRect(w * 0.66, h * 0.14, w * 0.16, 2);
      }, 128, 64);
    },
  };

  /* ============================================================
     World construction
     ============================================================ */
  function buildWorld(scene, sfx) {
    const W = {};
    const wallTexBase = Tex.wallpaper();
    const floorTex = Tex.floor();
    const ceilTex = Tex.ceiling();
    const doorTex = Tex.door();

    const mat = {
      floor(len, alongX) {
        const t = floorTex.clone(); t.needsUpdate = true;
        t.repeat.set(alongX ? len / 1.1 : 2.4, alongX ? 2.4 : len / 1.1);
        return new THREE.MeshStandardMaterial({ map: t, roughness: 0.92, dithering: true });
      },
      wall(len) {
        const t = wallTexBase.clone(); t.needsUpdate = true;
        t.repeat.set(Math.max(1, len / 1.4), 1.45);
        return new THREE.MeshStandardMaterial({ map: t, roughness: 0.97, dithering: true });
      },
      ceil(len, alongX) {
        const t = ceilTex.clone(); t.needsUpdate = true;
        t.repeat.set(alongX ? len / 1.6 : 1.6, alongX ? 1.6 : len / 1.6);
        return new THREE.MeshStandardMaterial({ map: t, roughness: 1, dithering: true });
      },
      door: new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.85 }),
      trim: new THREE.MeshStandardMaterial({ color: 0x17110b, roughness: 0.9 }),
      black: new THREE.MeshBasicMaterial({ color: 0x000000 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.6, metalness: 0.6 }),
    };

    const box = (wd, ht, dp, m) => new THREE.Mesh(new THREE.BoxGeometry(wd, ht, dp), m);
    const add = (mesh, x, y, z, recv, cast) => {
      mesh.position.set(x, y, z);
      mesh.receiveShadow = !!recv; mesh.castShadow = !!cast;
      scene.add(mesh); return mesh;
    };

    /* floors & ceilings */
    add(box(2.9, 0.1, 17.7, mat.floor(17.7, false)), 0, -0.05, -1.3, true);
    add(box(6.9, 0.1, 2.6, mat.floor(6.9, true)), 4.65, -0.05, -8.7, true);
    add(box(2.9, 0.1, 17.7, mat.ceil(17.7, false)), 0, CEIL_Y + 0.05, -1.3, true);
    add(box(6.9, 0.1, 2.6, mat.ceil(6.9, true)), 4.65, CEIL_Y + 0.05, -8.7, true);

    /* walls */
    add(box(0.15, 3, 17.7, mat.wall(17.7)), -1.375, 1.5, -1.3, true);          // west (full length of A)
    add(box(0.15, 3, 4.9, mat.wall(4.9)), 1.375, 1.5, -4.95, true);            // east A (south of side door… north segment)
    add(box(0.15, 3, 8.95, mat.wall(8.95)), 1.375, 1.5, 2.925, true);          // east A (rest)
    add(box(0.15, 0.85, 0.95, mat.wall(1)), 1.375, 2.575, -2.025, true);       // lintel over side door
    add(box(9.75, 3, 0.15, mat.wall(9.75)), 3.3, 1.5, -10.075, true);          // north (A end + B)
    add(box(6.85, 3, 0.15, mat.wall(6.85)), 4.725, 1.5, -7.325, true);         // B south
    // start wall w/ door gap
    add(box(0.975, 3, 0.15, mat.wall(1)), -0.9625, 1.5, 7.475, true);
    add(box(0.975, 3, 0.15, mat.wall(1)), 0.9625, 1.5, 7.475, true);
    add(box(0.95, 0.85, 0.15, mat.wall(1)), 0, 2.575, 7.475, true);
    // end wall (B) w/ exit door gap
    add(box(0.15, 3, 0.95, mat.wall(1)), 8.075, 1.5, -9.6, true);
    add(box(0.15, 3, 0.9, mat.wall(1)), 8.075, 1.5, -7.85, true);
    add(box(0.15, 0.85, 0.95, mat.wall(1)), 8.075, 2.575, -8.7, true);

    /* baseboards */
    const base = (len, x, z, rotY) => {
      const b = box(len, 0.14, 0.035, mat.trim);
      b.position.set(x, 0.07, z); b.rotation.y = rotY || 0;
      scene.add(b);
    };
    base(17.7, -1.285, -1.3, Math.PI / 2);
    base(13.9, 1.285, 0.45, Math.PI / 2);
    base(9.4, 3.25, -9.985, 0);
    base(6.7, 4.65, -7.415, 0);

    /* doors — hinged groups; positive angle swings away from the hall, into darkness */
    function hingedDoor(hx, hz) {
      const FACE = -Math.PI / 2;
      const g = new THREE.Group();
      g.position.set(hx, 0, hz);
      g.rotation.y = FACE;
      const d = box(0.9, 2.12, 0.055, mat.door);
      d.position.set(0.468, 1.06, 0);
      d.castShadow = true;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), mat.metal);
      knob.position.set(0.84, 1.02, 0.05);
      g.add(d); g.add(knob);
      scene.add(g);
      return { group: g, a: 0, hx, hz, set angle(v) { this.a = v; g.rotation.y = FACE + v; } };
    }
    // exit door: hinge on the end wall at x=8, z=-9.175 (door faces -X into hall B)
    W.exitDoor = hingedDoor(8.0, -9.175);
    W.exitDoorPos = { x: 7.95, y: 1.2, z: -8.7 };
    // side door on east A wall, hinge z=-2.5
    W.sideDoor = hingedDoor(1.37, -2.5);
    W.sideDoorPos = { x: 1.35, y: 1.2, z: -2.0 };
    // start door (behind player) — never opens
    const sd = box(0.9, 2.12, 0.055, mat.door);
    add(sd, 0, 1.06, 7.45, false, true);

    /* dark voids behind doors */
    add(box(2.4, 3.2, 2.4, mat.black), 2.7, 1.5, -2.0);     // beyond side door
    add(box(2.4, 3.2, 2.4, mat.black), 9.4, 1.5, -8.7);     // beyond exit door
    // pale doorway glow used in the final loop
    W.exitGlow = add(new THREE.Mesh(new THREE.PlaneGeometry(0.86, 2.05),
      new THREE.MeshBasicMaterial({ color: 0xb8c4d4, transparent: true, opacity: 0.0 })), 8.12, 1.1, -8.7);
    W.exitGlow.rotation.y = -Math.PI / 2;
    W.exitLight = new THREE.PointLight(0x9fb6cc, 0, 6, 2);
    W.exitLight.position.set(7.7, 1.4, -8.7);
    scene.add(W.exitLight);

    /* the wall that should not be there (loop 7 trap) */
    W.blockWall = add(box(2.9, 3, 0.18, mat.wall(2.9)), 0, 1.5, 3.4, true);
    W.blockWall.visible = false;

    /* hanging lamps */
    W.lamps = [];
    const lampDefs = [
      { x: 0, z: 3.5 }, { x: 0, z: -1.5 }, { x: 0, z: -6.5 },
      { x: 0, z: -8.7, corner: true },
      { x: 3.2, z: -8.7 }, { x: 6.6, z: -8.7 },
    ];
    const shadeGeo = new THREE.ConeGeometry(0.17, 0.16, 12, 1, true);
    const shadeMat = new THREE.MeshStandardMaterial({ color: 0x14110d, roughness: 0.7, side: THREE.DoubleSide });
    const rodGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.52, 6);
    lampDefs.forEach((d, i) => {
      const g = new THREE.Group();
      g.position.set(d.x, CEIL_Y, d.z);
      const rod = new THREE.Mesh(rodGeo, mat.metal); rod.position.y = -0.26;
      const shade = new THREE.Mesh(shadeGeo, shadeMat); shade.position.y = -0.56;
      const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd9a4 });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 8), bulbMat);
      bulb.position.y = -0.62;
      const light = new THREE.PointLight(0xffd2a0, 1.0, 8.5, 2);
      light.position.y = -0.68;
      if (i === 1 || i === 3) {
        light.castShadow = true;
        light.shadow.mapSize.set(512, 512);
        light.shadow.camera.near = 0.1; light.shadow.camera.far = 11;
        light.shadow.bias = -0.005;
      }
      g.add(rod, shade, bulb, light);
      scene.add(g);
      W.lamps.push({
        group: g, light, bulb, bulbMat,
        x: d.x, z: d.z, baseI: 1.0,
        mode: "steady", level: 1, seed: rand(0, 100), humOn: true,
        hum: sfx.lampHum(d.x, 2.3, d.z),
        swing: 0, swingV: 0,
      });
    });

    /* picture frames */
    W.frames = [];
    const frameDefs = [
      { x: -1.29, z: 5.0, ry: Math.PI / 2, seed: 1 },
      { x: -1.29, z: 1.0, ry: Math.PI / 2, seed: 2 },
      { x: -1.29, z: -3.2, ry: Math.PI / 2, seed: 3 },
      { x: 1.29, z: 2.6, ry: -Math.PI / 2, seed: 4 },
      { x: 4.6, z: -9.99, ry: 0, seed: 5 },
    ];
    const frameGeo = new THREE.BoxGeometry(0.5, 0.64, 0.035);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1d150c, roughness: 0.7 });
    frameDefs.forEach((d) => {
      const g = new THREE.Group();
      g.position.set(d.x, 1.55, d.z); g.rotation.y = d.ry;
      const fr = new THREE.Mesh(frameGeo, frameMat); fr.castShadow = true;
      const texes = [Tex.photo(0, d.seed), Tex.photo(1, d.seed), Tex.photo(2, d.seed), Tex.photo(3, d.seed)];
      const pm = new THREE.MeshStandardMaterial({ map: texes[0], roughness: 0.6 });
      const ph = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.56), pm);
      ph.position.z = 0.02;
      g.add(fr, ph);
      scene.add(g);
      W.frames.push({ group: g, setVariant(v) { pm.map = texes[v]; pm.needsUpdate = true; }, tilt(a) { g.rotation.z = a; } });
    });

    /* table + radio in the corner */
    const table = new THREE.Group();
    const top = box(0.6, 0.045, 0.42, mat.door); top.position.y = 0.78; top.castShadow = true;
    table.add(top);
    const legGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.78, 8);
    [[-0.25, -0.16], [0.25, -0.16], [-0.25, 0.16], [0.25, 0.16]].forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(legGeo, mat.trim);
      leg.position.set(lx, 0.39, lz);
      table.add(leg);
    });
    table.position.set(-0.62, 0, -9.62);
    scene.add(table);
    const radioMat = new THREE.MeshStandardMaterial({ map: Tex.radio(), roughness: 0.65 });
    const radio = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.17, 0.13),
      [mat.trim, mat.trim, mat.trim, mat.trim, radioMat, mat.trim]);
    radio.position.set(-0.62, 0.89, -9.6);
    radio.rotation.y = 0.5;
    radio.castShadow = true;
    scene.add(radio);
    W.radioPos = { x: -0.62, y: 0.9, z: -9.6 };

    /* ambient + player glow */
    W.ambient = new THREE.AmbientLight(0x232028, 0.55);
    scene.add(W.ambient);
    W.playerGlow = new THREE.PointLight(0x96aac4, 0, 4.5, 2);
    scene.add(W.playerGlow);

    return W;
  }

  /* ============================================================
     Her.
     ============================================================ */
  class Ghost {
    constructor(scene) {
      const g = new THREE.Group();
      this.group = g;
      const gownMat = new THREE.MeshStandardMaterial({ color: 0x8a8071, roughness: 1, emissive: 0x2c2822, emissiveIntensity: 0.16 });
      const skinMat = new THREE.MeshStandardMaterial({ color: 0xb0a294, roughness: 0.95, emissive: 0x2e2822, emissiveIntensity: 0.14 });
      const hairMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 });

      const gown = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.36, 1.52, 12), gownMat);
      gown.position.y = 0.81; gown.castShadow = true;
      this.head = new THREE.Group();
      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.108, 14, 12), skinMat);
      skull.scale.set(0.92, 1.18, 0.95);
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.123, 14, 12), hairMat);
      hair.scale.set(1.02, 1.42, 1.05);
      hair.position.set(0, 0.03, 0.025);
      this.eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.009, 6, 6), new THREE.MeshBasicMaterial({ color: 0xe8e4da }));
      this.eyeR = this.eyeL.clone();
      this.eyeL.position.set(-0.036, 0.01, -0.095);
      this.eyeR.position.set(0.036, 0.01, -0.095);
      this.eyeL.visible = this.eyeR.visible = false;
      this.mouth = new THREE.Mesh(new THREE.CircleGeometry(0.024, 10), new THREE.MeshBasicMaterial({ color: 0x000000 }));
      this.mouth.position.set(0, -0.052, -0.1);
      this.mouth.scale.set(1, 1.7, 1);
      this.mouth.visible = false;
      this.head.add(skull, hair, this.eyeL, this.eyeR, this.mouth);
      this.head.position.y = 1.655;
      this.head.rotation.z = 0.42;

      const armGeo = new THREE.CylinderGeometry(0.024, 0.022, 0.56, 8);
      const armL = new THREE.Mesh(armGeo, gownMat);
      armL.position.set(-0.165, 1.13, 0); armL.rotation.z = 0.16; // tops tuck into the gown
      const armR = armL.clone(); armR.position.x = 0.165; armR.rotation.z = -0.16;
      const handGeo = new THREE.SphereGeometry(0.03, 8, 8);
      const handL = new THREE.Mesh(handGeo, skinMat); handL.position.set(-0.215, 0.84, 0);
      const handR = handL.clone(); handR.position.x = 0.215;

      // a pale cold light that has no source — it is hers
      this.light = new THREE.PointLight(0x7d8a99, 0, 3.4, 2);
      this.light.position.set(0, 1.55, -0.55);
      g.add(gown, this.head, armL, armR, handL, handR, this.light);
      g.visible = false;
      g.position.y = 0.02; // she does not quite touch the floor
      scene.add(g);
      this.tw = 0; this.nextTw = 0;
      this._mats = [gownMat, skinMat];
    }
    glow(v) {
      this._mats.forEach((m) => { m.emissiveIntensity = v; });
      this.light.intensity = v > 0.2 ? (v - 0.2) * 2.4 : 0;
    }
    show(x, z, faceRotY) {
      this.group.position.x = x; this.group.position.z = z;
      this.group.rotation.y = faceRotY;
      this.group.visible = true;
    }
    hide() { this.group.visible = false; this.eyeL.visible = this.eyeR.visible = this.mouth.visible = false; }
    get visible() { return this.group.visible; }
    faceToward(x, z) {
      // her face is on the group's -Z side, hence the half turn
      this.group.rotation.y = Math.atan2(x - this.group.position.x, z - this.group.position.z) + Math.PI;
    }
    update(dt, t) {
      if (!this.group.visible) return;
      this.group.rotation.z = Math.sin(t * 0.9) * 0.018;
      this.group.position.y = 0.02 + Math.sin(t * 1.3) * 0.006;
      if (t > this.nextTw) {
        this.head.rotation.y = rand(-0.16, 0.16);
        this.head.rotation.z = 0.42 + rand(-0.12, 0.1);
        this.nextTw = t + rand(0.9, 2.8);
      }
    }
    scareFace(on) {
      this.eyeL.visible = this.eyeR.visible = this.mouth.visible = on;
      if (on) { this.head.rotation.z = -0.5; this.head.rotation.y = 0; }
    }
  }

  /* ============================================================
     Player + input
     ============================================================ */
  const Input = {
    keys: {}, lookDX: 0, lookDY: 0,
    joy: { active: false, id: -1, ox: 0, oy: 0, dx: 0, dy: 0 },
    look: { active: false, id: -1, lx: 0, ly: 0 },
    drag: { active: false, lx: 0, ly: 0 },
    locked: false, lockBroken: false,
  };

  class Player {
    constructor(cam) {
      this.cam = cam;
      this.x = START_POS.x; this.z = START_POS.z;
      this.yaw = 0; this.pitch = 0;
      this.vx = 0; this.vz = 0;
      this.bob = 0; this.stepCb = null;
      this.frozen = false;
    }
    reset() {
      this.x = START_POS.x; this.z = START_POS.z;
      this.yaw = 0; this.pitch = 0; this.vx = 0; this.vz = 0;
    }
    forward() { return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }; }
    facingDot(dx, dz) {
      const f = this.forward();
      const l = Math.hypot(dx, dz) || 1;
      return (f.x * dx + f.z * dz) / l;
    }
    update(dt, t) {
      // look
      this.yaw -= Input.lookDX * CFG.mouseSens;
      this.pitch = clamp(this.pitch - Input.lookDY * CFG.mouseSens, -1.45, 1.45);
      Input.lookDX = 0; Input.lookDY = 0;

      // move
      let mx = 0, mz = 0;
      if (!this.frozen) {
        if (Input.keys.KeyW || Input.keys.ArrowUp) mz += 1;
        if (Input.keys.KeyS || Input.keys.ArrowDown) mz -= 1;
        if (Input.keys.KeyA || Input.keys.ArrowLeft) mx -= 1;
        if (Input.keys.KeyD || Input.keys.ArrowRight) mx += 1;
        if (Input.joy.active) {
          mx += clamp(Input.joy.dx / 48, -1, 1);
          mz += clamp(-Input.joy.dy / 48, -1, 1);
        }
      }
      const ml = Math.hypot(mx, mz);
      if (ml > 1) { mx /= ml; mz /= ml; }
      const f = this.forward();
      const rx = -f.z, rz = f.x; // right vector
      const tvx = (f.x * mz + rx * mx) * (mz !== 0 ? CFG.walkSpeed : CFG.strafeSpeed);
      const tvz = (f.z * mz + rz * mx) * (mz !== 0 ? CFG.walkSpeed : CFG.strafeSpeed);
      const k = 1 - Math.exp(-9 * dt);
      this.vx = lerp(this.vx, tvx, k); this.vz = lerp(this.vz, tvz, k);
      let nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;

      // collide with the L (clamp to whichever rectangle fits best)
      const r = CFG.playerR;
      const cA = {
        x: clamp(nx, RECT_A.x0 + r, RECT_A.x1 - r),
        z: clamp(nz, RECT_A.z0 + r, blockZ(RECT_A.z1) - r),
      };
      const cB = {
        x: clamp(nx, RECT_B.x0 + r, RECT_B.x1 - r),
        z: clamp(nz, RECT_B.z0 + r, RECT_B.z1 - r),
      };
      const dA = (cA.x - nx) ** 2 + (cA.z - nz) ** 2;
      const dB = (cB.x - nx) ** 2 + (cB.z - nz) ** 2;
      const c = dA <= dB ? cA : cB;
      this.x = c.x; this.z = c.z;

      // head bob + breathing
      const speed = Math.hypot(this.vx, this.vz);
      const sf = clamp(speed / CFG.walkSpeed, 0, 1);
      const prev = this.bob;
      this.bob += dt * 11.5 * sf;
      if (sf > 0.25 && Math.floor(prev / Math.PI) !== Math.floor(this.bob / Math.PI)) {
        if (this.stepCb) this.stepCb();
      }
      const bobY = Math.sin(this.bob) * 0.034 * sf;
      const breathe = Math.sin(t * 1.6) * 0.007;

      this.cam.position.set(this.x, CFG.eyeY + bobY + breathe, this.z);
      this.cam.rotation.order = "YXZ";
      this.cam.rotation.y = this.yaw;
      this.cam.rotation.x = this.pitch;
      this.cam.rotation.z = Math.sin(this.bob * 0.5) * 0.0045 * sf;
    }
  }
  // loop 7 trap: the hallway behind you is shorter than it was
  let _blockActive = false;
  function blockZ(z1) { return _blockActive ? 3.28 : z1; }

  /* ============================================================
     Main
     ============================================================ */
  function main() {
    if (!window.WebGLRenderingContext) return fatal("This experience needs WebGL.");
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch (e) { return fatal("WebGL could not start on this device."); }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CFG.dprCap));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    el.app.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, CFG.fogDensity);

    const camera = new THREE.PerspectiveCamera(CFG.fov, window.innerWidth / window.innerHeight, 0.05, 60);
    const sfx = new Sfx();
    const world = buildWorld(scene, sfx);
    const ghost = new Ghost(scene);
    const player = new Player(camera);

    const stats = { t0: 0, sightings: 0 };
    let state = "boot"; // boot | play | paused | end
    let shakeAmp = 0;
    const continueBtn = document.createElement("button");
    continueBtn.className = "ebtn";
    continueBtn.id = "btn-continue";
    continueBtn.type = "button";
    continueBtn.textContent = "continue";
    continueBtn.hidden = true;
    el.enter.insertAdjacentElement("beforebegin", continueBtn);

    /* -------------------------------------------- fx helpers */
    function shake(a) { shakeAmp = Math.max(shakeAmp, a); }
    function strobe(times) {
      let i = 0;
      const burst = () => {
        FX.flash("rgba(235,238,255,0.95)", 55);
        if (++i < times) setTimeout(burst, 150);
      };
      burst();
    }

    /* -------------------------------------------- lamps */
    function lampSet(idx, mode, level) {
      const L = world.lamps[idx];
      L.mode = mode;
      if (level !== undefined) L.level = level;
    }
    function lampsAll(mode, level) { world.lamps.forEach((_, i) => lampSet(i, mode, level)); }
    function killLamp(idx, silent) {
      const L = world.lamps[idx];
      if (L.mode === "dead") return;
      L.mode = "dead";
      if (!silent) sfx.lightPop(L.x, 2.3, L.z);
    }
    function updateLamps(t) {
      world.lamps.forEach((L) => {
        let v = L.level;
        if (L.mode === "dead") v = 0;
        else if (L.mode === "flicker") {
          const n = Math.sin(t * 31 + L.seed) * Math.sin(t * 17.3 + L.seed * 2) * 0.5 + 0.5;
          v = L.level * (0.55 + 0.45 * n);
          if (Math.sin(t * 13.7 + L.seed * 5) > 0.94) v *= 0.12;
        } else if (L.mode === "unsteady") {
          v = L.level * (0.9 + 0.1 * Math.sin(t * 8 + L.seed));
        }
        L.light.intensity = L.baseI * v;
        L.bulb.visible = v > 0.05;
        L.hum.setLevel(L.humOn ? v : 0);
        // swing physics (corner lamp incident)
        if (Math.abs(L.swingV) > 0.0001 || Math.abs(L.swing) > 0.0001) {
          L.swingV += -L.swing * 6.5 * 0.016;
          L.swingV *= 0.995;
          L.swing += L.swingV * 0.016;
          L.group.rotation.x = L.swing;
        }
      });
    }

    /* -------------------------------------------- audio-reactive fx */
    function fxTick(t) {
      const T = sfx.tension;
      FX.setGrain(0.05 + T * 0.12);
      FX.setVignette(0.45 + T * 0.4 + Math.sin(t * 2.2) * 0.02 * T);
    }

    /* -------------------------------------------- director */
    const D = {
      loop: 0, t: 0, timers: [], conds: [], flags: {},
      after(s, fn) { this.timers.push({ t: this.t + s, fn }); },
      when(c, fn) { this.conds.push({ c, fn }); },
      update(dt) {
        this.t += dt;
        for (let i = this.timers.length - 1; i >= 0; i--)
          if (this.t >= this.timers[i].t) { const f = this.timers[i].fn; this.timers.splice(i, 1); f(); }
        for (let i = this.conds.length - 1; i >= 0; i--)
          if (this.conds[i].c()) { const f = this.conds[i].fn; this.conds.splice(i, 1); f(); }
        const L = LOOPS[this.loop];
        if (L && L.update) L.update(dt);
      },
      start(i) {
        this.loop = i; this.t = 0; this.timers = []; this.conds = []; this.flags = {};
        resetLoopDefaults();
        const L = LOOPS[i];
        if (L && L.setup) L.setup();
        // generic exit→next-loop trigger (loops that allow leaving)
        if (!L.noExit) this.when(() => player.x > EXIT_X && player.z < -7.4, () => transition());
      },
    };

    function resetLoopDefaults() {
      lampsAll("steady", 1);
      world.lamps.forEach((L) => { L.swing = 0; L.swingV = 0; L.group.rotation.x = 0; L.humOn = true; });
      world.frames.forEach((f) => { f.setVariant(0); f.tilt(0); });
      world.sideDoor.angle = 0;
      world.exitDoor.angle = 0.85;
      world.exitGlow.material.opacity = 0;
      world.exitLight.intensity = 0;
      world.playerGlow.intensity = 0;
      world.ambient.intensity = 0.55;
      _blockActive = false; world.blockWall.visible = false;
      ghost.hide(); ghost.scareFace(false); ghost.glow(0.16);
      sfx.setRadio(0.15, false);
      sfx.setRoomTone(1);
      sfx.setTension(0.06);
      player.frozen = false;
      exitDoorTarget = 0.85;
      sideDoorTarget = 0;
    }

    let exitDoorTarget = 0.85, sideDoorTarget = 0;

    function transition() {
      if (state !== "play") return;
      state = "transition";
      FX.fade(true, 320, () => {
        player.reset();
        D.start(D.loop + 1);
        sfx.knock(0, 1.2, 7.4, 1, 0, 0.12); // the door shuts behind you
        FX.fade(false, 420);
        state = "play";
      });
    }

    function endGame() {
      state = "end";
      clearSave();
      document.exitPointerLock && document.exitPointerLock();
      const secs = ((performance.now() - stats.t0) / 1000) | 0;
      const mm = (secs / 60) | 0, ss = String(secs % 60).padStart(2, "0");
      el.endStats.textContent = `you walked the hallway ${TOTAL_LOOPS} times · ${mm}:${ss} · she saw you ${stats.sightings} time${stats.sightings === 1 ? "" : "s"}`;
      el.end.classList.add("scr--show");
      document.body.classList.remove("playing");
    }

    /* ---- the loops ---- */
    const nearSideDoor = () => dist2d(player.x, player.z, 1.3, -2.0) < 2.4;

    const LOOPS = [
      /* L0 — nothing is wrong. */
      {
        setup() {
          sfx.setTension(0.05);
          sfx.setRadio(0.12, false);
          D.after(1.2, () => FX.titleCard("AGAIN.", 2800));
          D.after(4.5, () => FX.sub("the light at the end is the way out.", 3400));
        },
      },
      /* L1 — small wrongness. */
      {
        setup() {
          sfx.setTension(0.14);
          lampSet(1, "flicker", 1);
          D.when(() => player.z < 4, () => {
            sfx.setRadio(0.45, true);
            FX.sub("radio: “—was found in the hallway of her own home—”", 4200);
          });
          D.when(() => player.z < -6.5, () => {
            sfx.thudFar(0, 1.5, 7.0);
            shake(0.004);
          });
          D.when(() => player.x > 2.5, () => sfx.setRadio(0.2, false));
        },
      },
      /* L2 — the side door is open. */
      {
        setup() {
          sfx.setTension(0.22);
          world.frames[1].setVariant(1);
          world.frames[3].tilt(0.09);
          sideDoorTarget = 0.32;
          D.when(() => nearSideDoor(), () => {
            sfx.doorCreak(1.35, 1.2, -2.0, 2.6);
            sideDoorTarget = 0.6;
          });
          D.when(() => player.z < -7.5, () => {
            sfx.whisper(player.x - 0.4, 1.5, player.z + 1.2, 1.6);
            D.after(1.1, () => sfx.whisper(player.x + 0.5, 1.5, player.z + 1.0, 1.4));
          });
        },
      },
      /* L3 — the knocking. */
      {
        setup() {
          sfx.setTension(0.36);
          killLamp(0, true); killLamp(4, true);
          lampSet(2, "unsteady", 0.9);
          sfx.setRadio(0.3, true);
          D.when(() => Math.abs(player.z + 2.0) < 1.7 && player.x < 1.3, () => {
            sfx.knock(1.4, 1.1, -2.0, 3, 0.48, 0.5);
            shake(0.006);
            D.after(2.0, () => FX.sub("radio: “—if it knocks, you do not answer—”", 3800));
          });
          D.when(() => player.z < -7.8, () => {
            const L = world.lamps[3];
            L.swingV = 0.65;
            sfx.doorCreak(0, 2.6, -8.7, 1.8);
          });
        },
      },
      /* L4 — she is at the end of the hall. */
      {
        setup() {
          sfx.setTension(0.3);
          ghost.show(0.15, -8.9, 0);            // facing away (toward exit hall)
          lampSet(3, "flicker", 0.9);
          this.seen = false;
          D.when(() => dist2d(player.x, player.z, 0.15, -8.9) < 4.6, () => {
            stats.sightings++;
            killLamp(3, false); killLamp(4, true); killLamp(5, true);
            sfx.stinger(0.85);
            shake(0.012);
            D.after(0.7, () => {
              ghost.hide();
              lampSet(3, "steady", 0.85); lampSet(4, "steady", 1); lampSet(5, "steady", 1);
              sfx.setTension(0.42);
              D.after(2.5, () => sfx.setTension(0.25));
            });
          });
        },
        update() {
          if (ghost.visible) {
            const d = dist2d(player.x, player.z, 0.15, -8.9);
            sfx.setTension(clamp(0.3 + (10 - d) * 0.035, 0.3, 0.62));
          }
        },
      },
      /* L5 — don't look behind you. */
      {
        setup() {
          sfx.setTension(0.4);
          killLamp(0, true); killLamp(1, true); killLamp(2, true); killLamp(5, true);
          lampSet(3, "flicker", 0.5); lampSet(4, "unsteady", 0.4);
          world.ambient.intensity = 0.18;
          world.playerGlow.intensity = 0.75;
          world.frames.forEach((f, i) => f.setVariant(i === 2 ? 3 : 0));
          this.phase = 0; this.lookT = 0;
          D.after(3, () => sfx.whisper(player.x, 1.6, player.z - 1.5, 2.2));
          D.after(9, () => sfx.whisper(player.x + 0.6, 1.5, player.z + 0.8, 1.8));
          // she appears behind you if you turn around mid-hall
          D.when(() => this.phase === 0 && player.z < 2.5 && player.z > -4 && player.facingDot(0, 1) > 0.55, () => {
            this.phase = 1;
            ghost.show(0, 6.9, Math.PI);
            ghost.faceToward(player.x, player.z);
            ghost.glow(0.55);
            // the lamp between you and her wakes up to show you what is there
            world.lamps[0].mode = "flicker"; world.lamps[0].level = 0.6;
            stats.sightings++;
          });
          // fallback if they never look back: she waits near the exit
          D.when(() => this.phase === 0 && player.x > 1.5, () => {
            this.phase = 3;
            ghost.show(6.7, -8.75, 0);
            ghost.faceToward(player.x, player.z); // facing the player down hall B
            ghost.glow(0.45);
            stats.sightings++;
            lampSet(5, "flicker", 0.5);
            D.when(() => dist2d(player.x, player.z, 6.7, -8.75) < 3.4, () => {
              killLamp(5, false);
              sfx.stinger(0.7);
              D.after(0.45, () => { ghost.hide(); lampSet(5, "steady", 0.9); });
            });
          });
        },
        update(dt) {
          if (this.phase === 1 || this.phase === 2) {
            const looking = player.facingDot(ghost.group.position.x - player.x, ghost.group.position.z - player.z) > 0.93;
            if (looking) this.lookT += dt; else this.lookT = Math.max(0, this.lookT - dt * 2);
            if (this.phase === 1 && this.lookT > 0.7) {
              this.phase = 2; this.lookT = 0;
              // she is closer now.
              const gx = ghost.group.position.x, gz = ghost.group.position.z;
              const k = 3.2 / Math.max(1, dist2d(gx, gz, player.x, player.z));
              ghost.show(lerp(gx, player.x, k), lerp(gz, player.z, k), ghost.group.rotation.y);
              ghost.faceToward(player.x, player.z);
              sfx.stinger(0.6);
              strobe(2);
              shake(0.01);
            } else if (this.phase === 2 && this.lookT > 0.55) {
              this.phase = 4;
              ghost.hide();
              killLamp(0, true);
              FX.flash("rgba(0,0,0,0.96)", 420);
              sfx.whisper(player.x, 1.6, player.z + 0.4, 1.2);
              sfx.setTension(0.5);
              D.after(3, () => sfx.setTension(0.35));
            }
          }
        },
      },
      /* L6 — the silent one. the door is locked. */
      {
        noExit: true,
        setup() {
          sfx.setTension(0.1);
          sfx.setRoomTone(0.4);
          world.lamps.forEach((L) => { L.humOn = false; }); // total hum silence
          sfx.setRadio(0, false);
          this.trapArmed = false; this.done = false;
          D.when(() => player.x > 6.7 && !this.done, () => {
            sfx.handleRattle(7.95, 1.05, -8.7);
            exitDoorTarget = 0.06;
            FX.sub("it is locked.", 2600);
            this.trapArmed = true;
            _blockActive = true;
            world.blockWall.visible = true; // the hallway behind you ends now
          });
          // walk back into the dark → the cascade
          D.when(() => this.trapArmed && player.x < 3.0 && !this.done, () => this.cascade());
          // failsafe: don't let the loop stall forever
          D.after(50, () => { if (!this.done) this.cascade(); });
        },
        cascade() {
          if (this.done) return;
          this.done = true;
          const order = [5, 4, 3, 2, 1, 0];
          order.forEach((idx, i) => D.after(i * 0.16, () => killLamp(idx, false)));
          D.after(1.1, () => {
            world.ambient.intensity = 0.02;
            sfx.setTension(0.85);
          });
          D.after(1.9, () => {
            sfx.runnerSteps(0, 6.5, player.x, player.z, 1.25);
            shake(0.004);
          });
          D.after(3.15, () => {
            // she is in your face
            const f = player.forward();
            ghost.show(player.x + f.x * 0.85, player.z + f.z * 0.85, 0);
            ghost.faceToward(player.x, player.z);
            ghost.scareFace(true);
            ghost.glow(0.7);
            world.playerGlow.intensity = 1.6;
            player.frozen = true;
            stats.sightings++;
            strobe(3);
            sfx.scream();
            shake(0.05);
          });
          D.after(3.8, () => {
            FX.holdBlack();
            ghost.hide(); ghost.scareFace(false);
            world.playerGlow.intensity = 0;
          });
          D.after(5.6, () => {
            player.reset();
            D.start(7);
            FX.fade(false, 900);
            state = "play";
          });
        },
      },
      /* L7 — it lets you go. */
      {
        setup() {
          sfx.setTension(0.6);
          sfx.setRoomTone(0.8);
          killLamp(0, true); killLamp(1, true); killLamp(2, true); killLamp(4, true);
          lampSet(3, "unsteady", 0.3);
          const endLamp = world.lamps[5];
          endLamp.light.color.setHex(0xbfd2e8);
          endLamp.bulbMat.color.setHex(0xcfdcef);
          lampSet(5, "unsteady", 0.8);
          world.ambient.intensity = 0.12;
          world.playerGlow.intensity = 0.35;
          world.frames.forEach((f) => f.setVariant(2)); // everyone has left the photographs
          exitDoorTarget = 1.45;
          world.exitGlow.material.opacity = 0.5;
          world.exitLight.intensity = 0.9;
          ghost.show(-0.55, -9.3, 0);
          ghost.faceToward(0, 0); // she watches the corner you must turn
          ghost.glow(0.4);
          this.gone = false;
          D.after(2, () => FX.sub("leave.", 2400));
          D.when(() => !this.gone && dist2d(player.x, player.z, -0.55, -9.3) < 2.1, () => {
            this.gone = true;
            ghost.hide(); // no sound. she is simply not there.
            stats.sightings++;
          });
          D.when(() => player.x > EXIT_X && player.z < -7.4, () => {
            FX.fade(true, 700, () => endGame());
            state = "ending";
          });
        },
        update() {
          if (ghost.visible) ghost.faceToward(player.x, player.z);
        },
        noExit: true,
      },
    ];

    /* -------------------------------------------- input wiring */
    const canvas = renderer.domElement;
    document.addEventListener("keydown", (e) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
      Input.keys[e.code] = true;
      if (e.code === "KeyM") sfx.setMuted(!sfx.muted);
      if (e.code === "KeyP" && state === "play") openPause();
    });
    document.addEventListener("keyup", (e) => { Input.keys[e.code] = false; });
    // a key released while the window is unfocused never sends keyup — drop everything
    window.addEventListener("blur", () => { Input.keys = {}; Input.drag.active = false; });

    document.addEventListener("mousemove", (e) => {
      if (state !== "play") return;
      if (Input.locked) {
        Input.lookDX += e.movementX || 0;
        Input.lookDY += e.movementY || 0;
      } else if (Input.drag.active) {
        Input.lookDX += e.clientX - Input.drag.lx;
        Input.lookDY += e.clientY - Input.drag.ly;
        Input.drag.lx = e.clientX; Input.drag.ly = e.clientY;
      }
    });
    canvas.addEventListener("mousedown", (e) => {
      if (state !== "play" || Input.locked || isTouch) return;
      Input.drag.active = true; Input.drag.lx = e.clientX; Input.drag.ly = e.clientY;
      if (!Input.lockBroken) requestLock();
    });
    document.addEventListener("mouseup", () => { Input.drag.active = false; });

    function requestLock() {
      if (isTouch || Input.locked) return;
      try {
        const p = canvas.requestPointerLock && canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => { Input.lockBroken = true; });
      } catch (e) { Input.lockBroken = true; }
    }
    document.addEventListener("pointerlockchange", () => {
      Input.locked = document.pointerLockElement === canvas;
      if (!Input.locked && state === "play" && !Input.lockBroken && !isTouch) openPause();
    });
    document.addEventListener("pointerlockerror", () => { Input.lockBroken = true; });

    // touch: left half joystick, right half look
    canvas.addEventListener("touchstart", (e) => {
      if (state !== "play") return;
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth / 2 && !Input.joy.active) {
          Input.joy.active = true; Input.joy.id = t.identifier;
          Input.joy.ox = t.clientX; Input.joy.oy = t.clientY;
          Input.joy.dx = 0; Input.joy.dy = 0;
        } else if (!Input.look.active) {
          Input.look.active = true; Input.look.id = t.identifier;
          Input.look.lx = t.clientX; Input.look.ly = t.clientY;
        }
      }
    }, { passive: false });
    canvas.addEventListener("touchmove", (e) => {
      if (state !== "play") return;
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (Input.joy.active && t.identifier === Input.joy.id) {
          Input.joy.dx = t.clientX - Input.joy.ox;
          Input.joy.dy = t.clientY - Input.joy.oy;
        } else if (Input.look.active && t.identifier === Input.look.id) {
          Input.lookDX += (t.clientX - Input.look.lx) * (CFG.touchLookSens / CFG.mouseSens);
          Input.lookDY += (t.clientY - Input.look.ly) * (CFG.touchLookSens / CFG.mouseSens);
          Input.look.lx = t.clientX; Input.look.ly = t.clientY;
        }
      }
    }, { passive: false });
    const touchEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === Input.joy.id) { Input.joy.active = false; Input.joy.dx = Input.joy.dy = 0; }
        if (t.identifier === Input.look.id) Input.look.active = false;
      }
    };
    canvas.addEventListener("touchend", touchEnd);
    canvas.addEventListener("touchcancel", touchEnd);
    document.addEventListener("contextmenu", (e) => { if (state === "play") e.preventDefault(); });

    /* -------------------------------------------- screens */
    function startGame() {
      clearSave();
      if (!sfx.init()) { /* audio may be blocked; the dark still works */ }
      sfx.resume();
      sfx.radioStart(world.radioPos.x, world.radioPos.y, world.radioPos.z);
      el.boot.classList.remove("scr--show");
      document.body.classList.add("playing");
      stats.t0 = performance.now();
      state = "play";
      D.start(0);
      FX.fade(false, 1400);
      requestLock();
      if (isTouch) {
        el.pauseBtn.style.display = "block";
        FX.sub("left thumb: walk · right thumb: look", 4200);
      } else {
        el.hint.style.opacity = "1";
        setTimeout(() => { el.hint.style.opacity = "0"; }, 5200);
      }
    }

    function saveProgress() {
      if (state !== "play" && state !== "transition") return;
      writeSave({
        loop: D.loop,
        player: {
          x: player.x,
          z: player.z,
          yaw: player.yaw,
          pitch: player.pitch,
        },
        sightings: stats.sightings,
      });
    }

    function updateContinueButton() {
      const saved = readSave();
      continueBtn.hidden = !saved;
      el.enter.textContent = saved ? "start over" : "enter";
    }

    function continueGame() {
      const saved = readSave();
      const data = saved && saved.data;
      if (!data) {
        updateContinueButton();
        return;
      }
      if (!sfx.init()) { /* audio may be blocked; the dark still works */ }
      sfx.resume();
      sfx.radioStart(world.radioPos.x, world.radioPos.y, world.radioPos.z);
      el.boot.classList.remove("scr--show");
      document.body.classList.add("playing");
      stats.t0 = performance.now();
      stats.sightings = Number(data.sightings) || 0;
      state = "play";
      D.start(clamp(Number(data.loop) || 0, 0, TOTAL_LOOPS - 1));
      if (data.player) {
        player.x = clamp(Number(data.player.x) || START_POS.x, RECT_A.x0, RECT_B.x1);
        player.z = clamp(Number(data.player.z) || START_POS.z, RECT_A.z0, RECT_A.z1);
        player.yaw = Number(data.player.yaw) || 0;
        player.pitch = clamp(Number(data.player.pitch) || 0, -1.45, 1.45);
        player.vx = 0;
        player.vz = 0;
      }
      FX.fade(false, 900);
      requestLock();
      if (isTouch) el.pauseBtn.style.display = "block";
    }

    function openPause() {
      if (state !== "play") return;
      state = "paused";
      if (document.exitPointerLock) document.exitPointerLock();
      sfx.suspend();
      el.pause.classList.add("scr--show");
      document.body.classList.remove("playing");
    }
    function closePause() {
      el.pause.classList.remove("scr--show");
      document.body.classList.add("playing");
      sfx.resume();
      state = "play";
      requestLock();
    }

    el.enter.addEventListener("click", startGame);
    continueBtn.addEventListener("click", continueGame);
    el.resume.addEventListener("click", closePause);
    el.restart.addEventListener("click", () => { clearSave(); location.reload(); });
    el.again.addEventListener("click", () => { clearSave(); location.reload(); });
    el.pauseBtn.addEventListener("click", openPause);
    el.vol.value = String(sfx.volume);
    el.vol.addEventListener("input", () => {
      sfx.setVolume(parseFloat(el.vol.value));
      el.volPause.textContent = Math.round(sfx.volume * 100) + "%";
    });
    el.volPause.textContent = Math.round(sfx.volume * 100) + "%";
    updateContinueButton();
    setInterval(saveProgress, 2500);
    window.addEventListener("beforeunload", saveProgress);

    document.addEventListener("visibilitychange", () => {
      Input.keys = {};
      if (document.hidden && state === "play") openPause();
    });

    /* -------------------------------------------- frame loop */
    player.stepCb = () => sfx.footstep(0.1);
    let lastT = performance.now();

    function animate() {
      requestAnimationFrame(animate);
      const nowMs = performance.now();
      let dt = Math.min(0.05, (nowMs - lastT) / 1000);
      lastT = nowMs;
      const t = nowMs / 1000;

      FX.drawGrain(nowMs);
      if (state === "play" || state === "transition" || state === "ending") {
        player.update(dt, t);
        D.update(dt);
        ghost.update(dt, t);
        updateLamps(t);
        fxTick(t);
        sfx.tick(dt);
        sfx.syncListener(camera);

        // doors ease toward their targets
        world.exitDoor.angle = lerp(world.exitDoor.a, exitDoorTarget, 1 - Math.exp(-3 * dt));
        world.sideDoor.angle = lerp(world.sideDoor.a, sideDoorTarget, 1 - Math.exp(-2 * dt));

        world.playerGlow.position.set(player.x, 1.4, player.z);

        // camera shake
        if (shakeAmp > 0.0004) {
          camera.rotation.x += rand(-shakeAmp, shakeAmp);
          camera.rotation.y += rand(-shakeAmp, shakeAmp);
          shakeAmp *= Math.exp(-3.2 * dt);
        }
      }
      renderer.render(scene, camera);
    }
    animate();

    window.addEventListener("resize", () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // debug/QA hook
    window.__AGAIN = { D, player, sfx, world, ghost, startGame, Input, get state() { return state; } };
  }

  /* ------------------------------------------------ boot */
  loadThree(0, main, () =>
    fatal("Couldn't load the 3D engine. Check your connection and reload — the hallway will wait.")
  );
})();
