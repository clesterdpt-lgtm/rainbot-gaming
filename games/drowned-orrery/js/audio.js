(() => {
  "use strict";

  const STORAGE_KEY = "drowned-orrery:volume";
  const EPSILON = 0.0001;

  const clamp = (value, minimum = 0, maximum = 1) =>
    Math.max(minimum, Math.min(maximum, Number.isFinite(Number(value)) ? Number(value) : minimum));

  const normalizeName = (value) => String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  class DrownedAudio {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.compressor = null;
      this.sfxBus = null;
      this.musicBus = null;
      this.ambienceBus = null;
      this.scoreFilter = null;
      this.unrestBus = null;
      this.restoredBus = null;
      this.pulseBus = null;
      this.reverb = null;
      this.reverbReturn = null;

      this.initialized = false;
      this.started = false;
      this.paused = false;
      this.intensity = 0;
      this.restored = false;
      this.volume = this._readVolume();

      this._sources = new Set();
      this._oneShots = new Set();
      this._noiseBuffers = new Map();
      this._scoreTimer = 0;
      this._scoreStep = 0;
      this._pauseToken = 0;
      this._unlockBound = false;
      this._unlockHandler = () => {
        this.resume().catch(() => {});
      };

      this._windGain = null;
      this._windFilter = null;
      this._waterGain = null;
      this._waterFilter = null;
      this._rootGain = null;
      this._pulseGain = null;
      this._pulseLfo = null;
      this._orbitGain = null;

      this._aliases = Object.freeze({
        startgame: "confirm",
        menuconfirm: "confirm",
        uiconfirm: "confirm",
        select: "uimove",
        uimove: "uimove",
        hover: "uimove",
        click: "uimove",
        cancel: "back",
        close: "back",
        step: "footstep",
        runstep: "footstep",
        spear: "attack",
        swing: "attack",
        slash: "attack",
        spearswing: "attack",
        lightattack: "attack",
        heavyattack: "chargedattack",
        chargeattack: "chargedattack",
        weaponhit: "hit",
        impact: "hit",
        meleehit: "hit",
        enemyhurt: "enemyhit",
        kill: "enemydeath",
        enemykill: "enemydeath",
        playerhurt: "hurt",
        damage: "hurt",
        block: "guard",
        shield: "guard",
        perfectguard: "parry",
        target: "lock",
        targetlock: "lock",
        lockon: "lock",
        prismcharge: "charge",
        powercharge: "charge",
        chargedpulse: "pulse",
        prismpulse: "pulse",
        interact: "confirm",
        activation: "mechanism",
        activate: "mechanism",
        mechanismactivate: "mechanism",
        staractivate: "mechanism",
        gateopen: "gate",
        bossintro: "bossroar",
        bosshurt: "bosshit",
        bossattack: "bossattack",
        bossstagger: "bossstagger",
        complete: "victory",
        finale: "victory",
        restoration: "restore",
        restored: "restore",
        checkpoint: "objective",
        item: "pickup",
      });

      this._known = new Set([
        "uimove", "confirm", "back", "error", "pause", "resume",
        "footstep", "land", "water", "attack", "chargedattack", "hit",
        "enemyhit", "enemydeath", "guard", "parry", "dodge", "hurt",
        "lock", "charge", "pulse", "mechanism", "gate", "bossroar",
        "bossattack", "bosshit", "bossstagger", "objective", "pickup",
        "restore", "victory",
      ]);
    }

    _readVolume() {
      try {
        const stored = window.localStorage?.getItem(STORAGE_KEY);
        if (stored !== null && stored !== undefined) {
          const parsed = Number(stored);
          if (Number.isFinite(parsed)) return clamp(parsed);
        }
      } catch (_error) {
        // Storage can be unavailable in private or hardened contexts.
      }
      return 0.76;
    }

    _writeVolume() {
      try {
        window.localStorage?.setItem(STORAGE_KEY, String(this.volume));
      } catch (_error) {
        // Session volume still works when persistence is denied.
      }
    }

    start() {
      this.started = true;
      this.paused = false;
      if (!this._ensureGraph()) return false;
      this._installUnlockListeners();
      this._attemptResume().catch(() => {});
      return true;
    }

    setVolume(value) {
      this.volume = clamp(value);
      this._writeVolume();
      if (this.master && this.ctx && !this.paused) {
        this._smooth(this.master.gain, this.volume, 0.025);
      }
      return this.volume;
    }

    setIntensity(value) {
      this.intensity = clamp(value);
      this._applyState(false);
      return this.intensity;
    }

    setRestored(value) {
      const next = Boolean(value);
      if (next === this.restored) return this.restored;
      this.restored = next;
      this._applyState(false);
      return this.restored;
    }

    play(name, options = {}) {
      const normalized = normalizeName(name);
      const key = this._aliases[normalized] || normalized;
      if (!this._known.has(key)) return false;
      if (!this._ensureGraph()) return false;

      const trigger = () => {
        if (!this.ctx || this.ctx.state !== "running" || this.paused) return;
        this._playNamed(key, options && typeof options === "object" ? options : {});
      };

      if (this.ctx.state === "running" && !this.paused) {
        trigger();
      } else if (!this.paused) {
        this._installUnlockListeners();
        this._attemptResume().then((ready) => {
          if (ready) trigger();
        }).catch(() => {});
      }
      return true;
    }

    pause() {
      this.paused = true;
      const token = ++this._pauseToken;
      if (!this.ctx || this.ctx.state === "closed") return false;
      if (this.master) this._smooth(this.master.gain, 0, 0.018);
      window.setTimeout(() => {
        if (
          token !== this._pauseToken ||
          !this.paused ||
          !this.ctx ||
          this.ctx.state !== "running"
        ) return;
        this.ctx.suspend?.().catch?.(() => {});
      }, 90);
      return true;
    }

    resume() {
      this.started = true;
      this.paused = false;
      this._pauseToken += 1;
      if (!this._ensureGraph()) return Promise.resolve(false);
      this._installUnlockListeners();
      return this._attemptResume();
    }

    dispose() {
      this._pauseToken += 1;
      this._removeUnlockListeners();
      if (this._scoreTimer) window.clearInterval(this._scoreTimer);
      this._scoreTimer = 0;

      for (const entry of [...this._oneShots]) entry.cleanup();
      for (const source of this._sources) {
        try { source.stop(); } catch (_error) {}
        try { source.disconnect(); } catch (_error) {}
      }
      this._sources.clear();
      this._oneShots.clear();
      this._noiseBuffers.clear();

      const context = this.ctx;
      this.ctx = null;
      this.master = null;
      this.compressor = null;
      this.sfxBus = null;
      this.musicBus = null;
      this.ambienceBus = null;
      this.scoreFilter = null;
      this.unrestBus = null;
      this.restoredBus = null;
      this.pulseBus = null;
      this.reverb = null;
      this.reverbReturn = null;
      this._windGain = null;
      this._windFilter = null;
      this._waterGain = null;
      this._waterFilter = null;
      this._rootGain = null;
      this._pulseGain = null;
      this._pulseLfo = null;
      this._orbitGain = null;
      this.initialized = false;
      this.started = false;
      this.paused = false;
      context?.close?.().catch?.(() => {});
    }

    _ensureGraph() {
      if (this.initialized && this.ctx && this.ctx.state !== "closed") return true;
      try {
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) return false;

        try {
          this.ctx = new AudioContextCtor({ latencyHint: "interactive" });
        } catch (_optionsError) {
          // Older WebKit builds expose AudioContext but reject constructor options.
          this.ctx = new AudioContextCtor();
        }
        const c = this.ctx;
        this.master = c.createGain();
        this.compressor = c.createDynamicsCompressor();
        this.sfxBus = c.createGain();
        this.musicBus = c.createGain();
        this.ambienceBus = c.createGain();
        this.scoreFilter = c.createBiquadFilter();
        this.unrestBus = c.createGain();
        this.restoredBus = c.createGain();
        this.pulseBus = c.createGain();
        this.reverb = c.createConvolver();
        this.reverbReturn = c.createGain();

        this.master.gain.value = this.volume;
        this.compressor.threshold.value = -17;
        this.compressor.knee.value = 15;
        this.compressor.ratio.value = 5;
        this.compressor.attack.value = 0.004;
        this.compressor.release.value = 0.28;
        this.sfxBus.gain.value = 0.9;
        this.musicBus.gain.value = 0.28;
        this.ambienceBus.gain.value = 0.34;
        this.scoreFilter.type = "lowpass";
        this.scoreFilter.frequency.value = 760;
        this.scoreFilter.Q.value = 0.55;
        this.reverb.buffer = this._createImpulse(3.8, 2.45);
        this.reverbReturn.gain.value = 0.25;

        this.sfxBus.connect(this.compressor);
        this.musicBus.connect(this.compressor);
        this.ambienceBus.connect(this.compressor);
        this.unrestBus.connect(this.scoreFilter);
        this.restoredBus.connect(this.scoreFilter);
        this.pulseBus.connect(this.scoreFilter);
        this.scoreFilter.connect(this.musicBus);
        const scoreSend = c.createGain();
        scoreSend.gain.value = 0.42;
        this.scoreFilter.connect(scoreSend);
        scoreSend.connect(this.reverb);
        this.reverb.connect(this.reverbReturn);
        this.reverbReturn.connect(this.compressor);
        this.compressor.connect(this.master);
        this.master.connect(c.destination);

        this._startAmbience();
        this._startScore();
        this.initialized = true;
        this._applyState(true);
        this._startScoreClock();
        return true;
      } catch (error) {
        console.warn("The Drowned Orrery audio is unavailable:", error);
        this.initialized = false;
        return false;
      }
    }

    _attemptResume() {
      if (!this.ctx || this.ctx.state === "closed" || this.paused) {
        return Promise.resolve(false);
      }
      const c = this.ctx;
      const request = c.state === "running" ? Promise.resolve() : Promise.resolve(c.resume?.());
      return request.then(() => {
        const ready = c.state === "running" && !this.paused;
        if (ready) {
          this._smooth(this.master.gain, this.volume, 0.024);
          this._removeUnlockListeners();
        } else {
          this._installUnlockListeners();
        }
        return ready;
      }).catch(() => {
        this._installUnlockListeners();
        return false;
      });
    }

    _installUnlockListeners() {
      if (this._unlockBound || typeof document === "undefined") return;
      this._unlockBound = true;
      document.addEventListener("pointerdown", this._unlockHandler, { capture: true, passive: true });
      document.addEventListener("touchend", this._unlockHandler, { capture: true, passive: true });
      document.addEventListener("keydown", this._unlockHandler, { capture: true });
    }

    _removeUnlockListeners() {
      if (!this._unlockBound || typeof document === "undefined") return;
      this._unlockBound = false;
      document.removeEventListener("pointerdown", this._unlockHandler, true);
      document.removeEventListener("touchend", this._unlockHandler, true);
      document.removeEventListener("keydown", this._unlockHandler, true);
    }

    _smooth(parameter, value, timeConstant = 0.08, immediate = false) {
      if (!parameter || !this.ctx) return;
      const now = this.ctx.currentTime;
      parameter.cancelScheduledValues(now);
      if (immediate) parameter.setValueAtTime(value, now);
      else parameter.setTargetAtTime(value, now, Math.max(0.001, timeConstant));
    }

    _applyState(immediate = false) {
      if (!this.ctx || !this.initialized && !immediate) return;
      const intensity = this.intensity;
      const restored = this.restored ? 1 : 0;
      const duration = immediate ? 0.001 : 0.7;

      this._smooth(this.unrestBus?.gain, 0.2 - restored * 0.165 + intensity * 0.025, duration, immediate);
      this._smooth(this.restoredBus?.gain, restored ? 0.19 : EPSILON, duration, immediate);
      this._smooth(this.pulseBus?.gain, 0.018 + intensity * 0.15, 0.22, immediate);
      this._smooth(this.musicBus?.gain, 0.23 + intensity * 0.09 + restored * 0.025, 0.28, immediate);
      this._smooth(this.ambienceBus?.gain, 0.31 + restored * 0.045, 0.5, immediate);
      this._smooth(this.scoreFilter?.frequency, 620 + intensity * 1750 + restored * 1150, 0.3, immediate);
      this._smooth(this.reverbReturn?.gain, 0.22 + restored * 0.1 + intensity * 0.035, 0.55, immediate);

      this._smooth(this._windGain?.gain, 0.067 + intensity * 0.018 - restored * 0.012, 0.7, immediate);
      this._smooth(this._windFilter?.frequency, 1450 + restored * 2300 + intensity * 420, 0.8, immediate);
      this._smooth(this._waterGain?.gain, 0.018 + restored * 0.037 + intensity * 0.008, 0.75, immediate);
      this._smooth(this._waterFilter?.frequency, 3050 + restored * 1850, 0.75, immediate);
      this._smooth(this._rootGain?.gain, 0.026 + intensity * 0.018 - restored * 0.017, 0.65, immediate);
      this._smooth(this._pulseGain?.gain, 0.004 + intensity * 0.048, 0.2, immediate);
      this._smooth(this._pulseLfo?.frequency, 0.42 + intensity * 1.25, 0.25, immediate);
      this._smooth(this._orbitGain?.gain, 0.002 + intensity * 0.008 + restored * 0.012, 0.55, immediate);
    }

    _createImpulse(seconds, decay) {
      const c = this.ctx;
      const length = Math.max(1, Math.floor(c.sampleRate * seconds));
      const buffer = c.createBuffer(2, length, c.sampleRate);
      for (let channel = 0; channel < 2; channel += 1) {
        const data = buffer.getChannelData(channel);
        let previous = 0;
        for (let index = 0; index < length; index += 1) {
          const envelope = Math.pow(1 - index / length, decay);
          const white = Math.random() * 2 - 1;
          previous = previous * 0.18 + white * 0.82;
          data[index] = previous * envelope * (channel ? 0.92 : 1);
        }
      }
      return buffer;
    }

    _noiseBuffer(kind = "white") {
      if (this._noiseBuffers.has(kind)) return this._noiseBuffers.get(kind);
      const c = this.ctx;
      const seconds = kind === "brown" ? 4 : 3;
      const length = Math.max(1, Math.floor(c.sampleRate * seconds));
      const buffer = c.createBuffer(1, length, c.sampleRate);
      const data = buffer.getChannelData(0);
      let brown = 0;
      let pinkA = 0;
      let pinkB = 0;
      for (let index = 0; index < length; index += 1) {
        const white = Math.random() * 2 - 1;
        brown = (brown + white * 0.021) / 1.021;
        pinkA = pinkA * 0.985 + white * 0.015;
        pinkB = pinkB * 0.92 + white * 0.08;
        data[index] = kind === "brown"
          ? clamp(brown * 3.4 + white * 0.04, -1, 1)
          : kind === "pink"
            ? clamp(pinkA * 2.1 + pinkB * 0.72 + white * 0.22, -1, 1)
            : white;
      }
      this._noiseBuffers.set(kind, buffer);
      return buffer;
    }

    _trackSource(source) {
      this._sources.add(source);
      return source;
    }

    _startAmbience() {
      const c = this.ctx;

      const wind = this._trackSource(c.createBufferSource());
      const windHigh = c.createBiquadFilter();
      const windLow = c.createBiquadFilter();
      const windGain = c.createGain();
      wind.buffer = this._noiseBuffer("pink");
      wind.loop = true;
      windHigh.type = "highpass";
      windHigh.frequency.value = 85;
      windLow.type = "lowpass";
      windLow.frequency.value = 1450;
      windLow.Q.value = 0.7;
      windGain.gain.value = 0.067;
      wind.connect(windHigh);
      windHigh.connect(windLow);
      windLow.connect(windGain);
      windGain.connect(this.ambienceBus);
      wind.start();
      this._windGain = windGain;
      this._windFilter = windLow;

      const windLfo = this._trackSource(c.createOscillator());
      const windDepth = c.createGain();
      windLfo.type = "sine";
      windLfo.frequency.value = 0.071;
      windDepth.gain.value = 0.018;
      windLfo.connect(windDepth);
      windDepth.connect(windGain.gain);
      windLfo.start();

      const water = this._trackSource(c.createBufferSource());
      const waterHigh = c.createBiquadFilter();
      const waterBand = c.createBiquadFilter();
      const waterGain = c.createGain();
      water.buffer = this._noiseBuffer("white");
      water.loop = true;
      waterHigh.type = "highpass";
      waterHigh.frequency.value = 1050;
      waterBand.type = "bandpass";
      waterBand.frequency.value = 3050;
      waterBand.Q.value = 0.65;
      waterGain.gain.value = 0.018;
      water.connect(waterHigh);
      waterHigh.connect(waterBand);
      waterBand.connect(waterGain);
      waterGain.connect(this.ambienceBus);
      water.start();
      this._waterGain = waterGain;
      this._waterFilter = waterBand;

      const waterLfo = this._trackSource(c.createOscillator());
      const waterDepth = c.createGain();
      waterLfo.type = "sine";
      waterLfo.frequency.value = 0.113;
      waterDepth.gain.value = 720;
      waterLfo.connect(waterDepth);
      waterDepth.connect(waterBand.frequency);
      waterLfo.start();

      const rootGain = c.createGain();
      rootGain.gain.value = 0.026;
      rootGain.connect(this.ambienceBus);
      [31.7, 47.55].forEach((frequency, index) => {
        const oscillator = this._trackSource(c.createOscillator());
        oscillator.type = index ? "triangle" : "sine";
        oscillator.frequency.value = frequency;
        oscillator.detune.value = index ? 4 : -3;
        oscillator.connect(rootGain);
        oscillator.start();
      });
      this._rootGain = rootGain;
    }

    _startScore() {
      const c = this.ctx;
      const createVoice = (destination, frequency, type, volume, detune = 0, cutoff = 1000) => {
        const oscillator = this._trackSource(c.createOscillator());
        const filter = c.createBiquadFilter();
        const gain = c.createGain();
        oscillator.type = type;
        oscillator.frequency.value = frequency;
        oscillator.detune.value = detune;
        filter.type = "lowpass";
        filter.frequency.value = cutoff;
        filter.Q.value = 0.8;
        gain.gain.value = volume;
        oscillator.connect(filter);
        filter.connect(gain);
        gain.connect(destination);
        oscillator.start();
        return oscillator;
      };

      // Inharmonic ratios keep the celestial bed textural rather than melodic.
      const unrestBase = 46.25;
      [1, 1.498, 2.244, 2.827].forEach((ratio, index) => {
        createVoice(
          this.unrestBus,
          unrestBase * ratio,
          index < 2 ? "triangle" : "sine",
          index < 2 ? 0.072 : 0.035,
          index % 2 ? 5 : -4,
          330 + index * 180,
        );
      });

      const restoredBase = 55;
      [1, 1.333, 1.682, 2.378, 2.828].forEach((ratio, index) => {
        createVoice(
          this.restoredBus,
          restoredBase * ratio,
          index < 2 ? "sine" : "triangle",
          index < 2 ? 0.056 : 0.027,
          index % 2 ? -3 : 4,
          520 + index * 240,
        );
      });

      const pulseOscillator = this._trackSource(c.createOscillator());
      const pulseGain = c.createGain();
      pulseOscillator.type = "triangle";
      pulseOscillator.frequency.value = 69.3;
      pulseGain.gain.value = 0.004;
      pulseOscillator.connect(pulseGain);
      pulseGain.connect(this.pulseBus);
      pulseOscillator.start();
      this._pulseGain = pulseGain;

      const pulseLfo = this._trackSource(c.createOscillator());
      const pulseDepth = c.createGain();
      pulseLfo.type = "sine";
      pulseLfo.frequency.value = 0.42;
      pulseDepth.gain.value = 0.0035;
      pulseLfo.connect(pulseDepth);
      pulseDepth.connect(pulseGain.gain);
      pulseLfo.start();
      this._pulseLfo = pulseLfo;

      const orbitGain = c.createGain();
      orbitGain.gain.value = 0.002;
      orbitGain.connect(this.pulseBus);
      [293.7, 415.3, 523.9].forEach((frequency, index) => {
        createVoice(orbitGain, frequency, "sine", 0.34 - index * 0.07, index * 3 - 3, 1700);
      });
      this._orbitGain = orbitGain;
    }

    _startScoreClock() {
      if (this._scoreTimer) return;
      this._scoreTimer = window.setInterval(() => this._scoreTick(), 1150);
    }

    _scoreTick() {
      if (!this.ctx || this.ctx.state !== "running" || this.paused) return;
      this._scoreStep += 1;
      const intensity = this.intensity;
      const ratios = this.restored
        ? [1, 1.333, 1.682, 2.378, 2.828]
        : [1, 1.187, 1.414, 1.781, 2.125, 2.827];

      if (Math.random() < 0.28 + intensity * 0.32) {
        const ratio = ratios[Math.floor(Math.random() * ratios.length)];
        const base = this.restored ? 110 : 92.5;
        this._tone({
          frequency: base * ratio,
          endFrequency: base * ratio * (this.restored ? 1.006 : 0.992),
          duration: 1.25 + Math.random() * 1.15,
          volume: 0.008 + intensity * 0.007 + (this.restored ? 0.006 : 0),
          type: Math.random() > 0.42 ? "sine" : "triangle",
          attack: 0.055,
          pan: Math.random() * 1.2 - 0.6,
          destination: this.musicBus,
          send: 0.72,
        });
      }

      if (intensity > 0.34 && this._scoreStep % 2 === 0) {
        const strength = (intensity - 0.28) / 0.72;
        this._tone({
          frequency: 62 + intensity * 14,
          endFrequency: 39,
          duration: 0.18,
          volume: 0.012 + strength * 0.026,
          type: "sine",
          destination: this.musicBus,
          send: 0.12,
        });
        this._noiseSweep({
          duration: 0.075,
          volume: 0.005 + strength * 0.012,
          fromFrequency: 900,
          toFrequency: 170,
          highpass: 65,
          destination: this.musicBus,
          send: 0.08,
        });
      }
    }

    _registerOneShot(source, nodes) {
      let cleaned = false;
      const entry = {
        cleanup: () => {
          if (cleaned) return;
          cleaned = true;
          this._oneShots.delete(entry);
          for (const node of nodes) {
            try { node.disconnect(); } catch (_error) {}
          }
        },
      };
      this._oneShots.add(entry);
      source.addEventListener?.("ended", entry.cleanup, { once: true });
      return entry;
    }

    _tone({
      frequency = 220,
      endFrequency = frequency,
      duration = 0.12,
      volume = 0.08,
      type = "sine",
      delay = 0,
      attack = 0.005,
      pan = 0,
      destination = this.sfxBus,
      send = 0.08,
    } = {}) {
      if (!this.ctx || !destination) return;
      const c = this.ctx;
      const at = c.currentTime + Math.max(0, delay);
      const length = Math.max(0.025, duration);
      const oscillator = c.createOscillator();
      const gain = c.createGain();
      const panner = c.createStereoPanner ? c.createStereoPanner() : null;
      const sendGain = c.createGain();
      const output = panner || gain;

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(Math.max(12, frequency), at);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(12, endFrequency), at + length);
      gain.gain.setValueAtTime(EPSILON, at);
      gain.gain.exponentialRampToValueAtTime(Math.max(EPSILON, volume), at + Math.min(length * 0.45, Math.max(0.002, attack)));
      gain.gain.exponentialRampToValueAtTime(EPSILON, at + length);
      if (panner) panner.pan.value = clamp(pan, -1, 1);
      sendGain.gain.value = Math.max(0, send);

      oscillator.connect(gain);
      if (panner) gain.connect(panner);
      output.connect(destination);
      output.connect(sendGain);
      sendGain.connect(this.reverb);
      const nodes = [oscillator, gain, sendGain];
      if (panner) nodes.push(panner);
      this._registerOneShot(oscillator, nodes);
      oscillator.start(at);
      oscillator.stop(at + length + 0.04);
    }

    _noiseSweep({
      duration = 0.12,
      volume = 0.08,
      fromFrequency = 5200,
      toFrequency = 420,
      highpass = 80,
      kind = "white",
      delay = 0,
      pan = 0,
      destination = this.sfxBus,
      send = 0.06,
    } = {}) {
      if (!this.ctx || !destination) return;
      const c = this.ctx;
      const at = c.currentTime + Math.max(0, delay);
      const length = Math.max(0.025, duration);
      const source = c.createBufferSource();
      const high = c.createBiquadFilter();
      const sweep = c.createBiquadFilter();
      const gain = c.createGain();
      const panner = c.createStereoPanner ? c.createStereoPanner() : null;
      const sendGain = c.createGain();
      const output = panner || gain;

      source.buffer = this._noiseBuffer(kind);
      high.type = "highpass";
      high.frequency.value = Math.max(10, highpass);
      sweep.type = "lowpass";
      sweep.Q.value = 0.8;
      sweep.frequency.setValueAtTime(Math.max(20, fromFrequency), at);
      sweep.frequency.exponentialRampToValueAtTime(Math.max(20, toFrequency), at + length);
      gain.gain.setValueAtTime(Math.max(EPSILON, volume), at);
      gain.gain.exponentialRampToValueAtTime(EPSILON, at + length);
      if (panner) panner.pan.value = clamp(pan, -1, 1);
      sendGain.gain.value = Math.max(0, send);

      source.connect(high);
      high.connect(sweep);
      sweep.connect(gain);
      if (panner) gain.connect(panner);
      output.connect(destination);
      output.connect(sendGain);
      sendGain.connect(this.reverb);
      const nodes = [source, high, sweep, gain, sendGain];
      if (panner) nodes.push(panner);
      this._registerOneShot(source, nodes);
      const maxOffset = Math.max(0, source.buffer.duration - length - 0.05);
      source.start(at, Math.random() * maxOffset);
      source.stop(at + length + 0.035);
    }

    _spatialScale(options) {
      const requested = Number(options.volume);
      const volume = Number.isFinite(requested) ? clamp(requested, 0, 2) : 1;
      const distance = Math.max(0, Number(options.distance) || 0);
      const falloff = distance > 0 ? 1 / (1 + distance * 0.075) : 1;
      const strength = Number.isFinite(Number(options.strength))
        ? clamp(Number(options.strength), 0.1, 2)
        : 1;
      return volume * falloff * strength;
    }

    _playNamed(name, options) {
      const scale = this._spatialScale(options);
      const pan = clamp(Number(options.pan) || 0, -1, 1);
      const delay = Math.max(0, Number(options.delay) || 0);

      switch (name) {
        case "uimove":
          this._tone({ frequency: 510, endFrequency: 690, duration: 0.045, volume: 0.024 * scale, type: "triangle", pan, delay, send: 0.12 });
          break;
        case "confirm":
          this._tone({ frequency: 196, endFrequency: 294, duration: 0.13, volume: 0.052 * scale, type: "triangle", pan, delay, send: 0.24 });
          this._tone({ frequency: 415, endFrequency: 554, duration: 0.22, volume: 0.025 * scale, pan, delay: delay + 0.07, send: 0.42 });
          break;
        case "back":
          this._tone({ frequency: 330, endFrequency: 185, duration: 0.095, volume: 0.036 * scale, type: "triangle", pan, delay, send: 0.16 });
          break;
        case "error":
          this._tone({ frequency: 112, endFrequency: 78, duration: 0.18, volume: 0.065 * scale, type: "square", pan, delay, send: 0.06 });
          break;
        case "pause":
          this._tone({ frequency: 262, endFrequency: 131, duration: 0.24, volume: 0.04 * scale, type: "sine", pan, delay, send: 0.25 });
          break;
        case "resume":
          this._tone({ frequency: 131, endFrequency: 262, duration: 0.24, volume: 0.04 * scale, type: "sine", pan, delay, send: 0.25 });
          break;
        case "footstep":
          this._playFootstep(options, scale, pan, delay);
          break;
        case "land":
          this._noiseSweep({ duration: 0.16, volume: 0.075 * scale, fromFrequency: 920, toFrequency: 110, highpass: 34, kind: "brown", pan, delay, send: 0.03 });
          this._tone({ frequency: 86, endFrequency: 38, duration: 0.16, volume: 0.07 * scale, type: "sine", pan, delay, send: 0.03 });
          break;
        case "water":
          this._noiseSweep({ duration: 0.23, volume: 0.07 * scale, fromFrequency: 5200, toFrequency: 1100, highpass: 650, pan, delay, send: 0.38 });
          this._tone({ frequency: 620, endFrequency: 390, duration: 0.3, volume: 0.018 * scale, pan, delay: delay + 0.025, send: 0.7 });
          break;
        case "attack":
          this._noiseSweep({ duration: 0.19, volume: 0.105 * scale, fromFrequency: 6800, toFrequency: 360, highpass: 190, pan, delay, send: 0.09 });
          this._tone({ frequency: 240, endFrequency: 82, duration: 0.16, volume: 0.052 * scale, type: "triangle", pan, delay, send: 0.06 });
          break;
        case "chargedattack":
          this._noiseSweep({ duration: 0.31, volume: 0.15 * scale, fromFrequency: 8200, toFrequency: 240, highpass: 95, pan, delay, send: 0.12 });
          this._tone({ frequency: 310, endFrequency: 52, duration: 0.34, volume: 0.11 * scale, type: "sawtooth", pan, delay, send: 0.1 });
          break;
        case "hit":
          this._noiseSweep({ duration: 0.09, volume: 0.12 * scale, fromFrequency: 1900, toFrequency: 240, highpass: 80, kind: "brown", pan, delay, send: 0.05 });
          this._tone({ frequency: 164, endFrequency: 64, duration: 0.1, volume: 0.08 * scale, type: "triangle", pan, delay, send: 0.04 });
          break;
        case "enemyhit":
          this._noiseSweep({ duration: 0.11, volume: 0.09 * scale, fromFrequency: 1300, toFrequency: 170, highpass: 70, kind: "brown", pan, delay, send: 0.08 });
          this._tone({ frequency: 128, endFrequency: 73, duration: 0.13, volume: 0.055 * scale, type: "sawtooth", pan, delay, send: 0.12 });
          break;
        case "enemydeath":
          this._tone({ frequency: 138, endFrequency: 35, duration: 0.43, volume: 0.075 * scale, type: "sawtooth", pan, delay, send: 0.25 });
          this._noiseSweep({ duration: 0.38, volume: 0.075 * scale, fromFrequency: 1600, toFrequency: 90, highpass: 32, kind: "brown", pan, delay, send: 0.2 });
          break;
        case "guard":
          this._noiseSweep({ duration: 0.075, volume: 0.11 * scale, fromFrequency: 3200, toFrequency: 480, highpass: 240, pan, delay, send: 0.08 });
          this._tone({ frequency: 246, endFrequency: 173, duration: 0.16, volume: 0.07 * scale, type: "triangle", pan, delay, send: 0.14 });
          break;
        case "parry":
          this._noiseSweep({ duration: 0.12, volume: 0.13 * scale, fromFrequency: 9000, toFrequency: 1500, highpass: 900, pan, delay, send: 0.3 });
          [740, 1047, 1480].forEach((frequency, index) => {
            this._tone({ frequency, endFrequency: frequency * 0.82, duration: 0.28 + index * 0.06, volume: (0.052 - index * 0.01) * scale, pan, delay: delay + index * 0.018, send: 0.72 });
          });
          break;
        case "dodge":
          this._noiseSweep({ duration: 0.28, volume: 0.11 * scale, fromFrequency: 460, toFrequency: 5400, highpass: 110, pan, delay, send: 0.16 });
          this._tone({ frequency: 96, endFrequency: 210, duration: 0.24, volume: 0.045 * scale, type: "triangle", pan, delay, send: 0.1 });
          break;
        case "hurt":
          this._tone({ frequency: 104, endFrequency: 39, duration: 0.26, volume: 0.12 * scale, type: "sawtooth", pan, delay, send: 0.08 });
          this._noiseSweep({ duration: 0.18, volume: 0.09 * scale, fromFrequency: 1200, toFrequency: 100, highpass: 28, kind: "brown", pan, delay, send: 0.04 });
          break;
        case "lock":
          this._tone({ frequency: 392, endFrequency: 784, duration: 0.12, volume: 0.036 * scale, type: "sine", pan, delay, send: 0.34 });
          this._tone({ frequency: 554, endFrequency: 555, duration: 0.18, volume: 0.018 * scale, type: "triangle", pan, delay: delay + 0.045, send: 0.52 });
          break;
        case "charge":
          this._tone({ frequency: 72, endFrequency: 720, duration: Number(options.duration) || 0.62, volume: 0.075 * scale, type: "sawtooth", pan, delay, attack: 0.08, send: 0.48 });
          this._tone({ frequency: 311, endFrequency: 1244, duration: Number(options.duration) || 0.66, volume: 0.025 * scale, type: "sine", pan, delay, attack: 0.12, send: 0.8 });
          break;
        case "pulse":
          this._noiseSweep({ duration: 0.65, volume: 0.18 * scale, fromFrequency: 9000, toFrequency: 320, highpass: 38, pan, delay, send: 0.5 });
          this._tone({ frequency: 96, endFrequency: 29, duration: 0.72, volume: 0.18 * scale, type: "sawtooth", pan, delay, send: 0.28 });
          [277, 392, 659].forEach((frequency, index) => {
            this._tone({ frequency, endFrequency: frequency * 1.045, duration: 0.72 + index * 0.16, volume: (0.045 - index * 0.008) * scale, pan, delay: delay + index * 0.035, attack: 0.016, send: 0.82 });
          });
          break;
        case "mechanism":
          this._playMechanism(scale, pan, delay);
          break;
        case "gate":
          this._noiseSweep({ duration: 1.5, volume: 0.17 * scale, fromFrequency: 880, toFrequency: 55, highpass: 19, kind: "brown", pan, delay, send: 0.18 });
          this._tone({ frequency: 62, endFrequency: 24, duration: 1.65, volume: 0.17 * scale, type: "sawtooth", pan, delay, attack: 0.025, send: 0.22 });
          this._tone({ frequency: 224, endFrequency: 84, duration: 1.3, volume: 0.045 * scale, type: "triangle", pan, delay: delay + 0.12, send: 0.46 });
          break;
        case "bossroar":
          this._tone({ frequency: 91, endFrequency: 29, duration: 1.08, volume: 0.18 * scale, type: "sawtooth", pan, delay, attack: 0.04, send: 0.35 });
          this._tone({ frequency: 137, endFrequency: 47, duration: 0.9, volume: 0.1 * scale, type: "square", pan, delay: delay + 0.08, attack: 0.03, send: 0.3 });
          this._noiseSweep({ duration: 1.16, volume: 0.13 * scale, fromFrequency: 1900, toFrequency: 75, highpass: 24, kind: "brown", pan, delay, send: 0.28 });
          break;
        case "bossattack":
          this._tone({ frequency: 132, endFrequency: 36, duration: 0.48, volume: 0.17 * scale, type: "sawtooth", pan, delay, send: 0.13 });
          this._noiseSweep({ duration: 0.42, volume: 0.15 * scale, fromFrequency: 6100, toFrequency: 180, highpass: 45, pan, delay, send: 0.16 });
          break;
        case "bosshit":
          this._tone({ frequency: 82, endFrequency: 31, duration: 0.34, volume: 0.13 * scale, type: "triangle", pan, delay, send: 0.15 });
          this._noiseSweep({ duration: 0.3, volume: 0.14 * scale, fromFrequency: 2300, toFrequency: 80, highpass: 28, kind: "brown", pan, delay, send: 0.12 });
          break;
        case "bossstagger":
          this._noiseSweep({ duration: 0.9, volume: 0.2 * scale, fromFrequency: 7200, toFrequency: 90, highpass: 22, pan, delay, send: 0.3 });
          [196, 139, 98, 69].forEach((frequency, index) => {
            this._tone({ frequency, endFrequency: frequency * 0.56, duration: 0.38 + index * 0.11, volume: (0.09 - index * 0.012) * scale, type: index % 2 ? "triangle" : "sawtooth", pan, delay: delay + index * 0.08, send: 0.32 });
          });
          break;
        case "objective":
          this._tone({ frequency: 185, endFrequency: 277, duration: 0.24, volume: 0.045 * scale, type: "triangle", pan, delay, send: 0.45 });
          this._tone({ frequency: 392, endFrequency: 587, duration: 0.42, volume: 0.032 * scale, pan, delay: delay + 0.14, send: 0.7 });
          break;
        case "pickup":
          this._tone({ frequency: 440, endFrequency: 932, duration: 0.2, volume: 0.04 * scale, type: "sine", pan, delay, send: 0.58 });
          this._tone({ frequency: 622, endFrequency: 1244, duration: 0.28, volume: 0.018 * scale, pan, delay: delay + 0.06, send: 0.72 });
          break;
        case "restore":
          this._playRestoration(scale, delay, false);
          break;
        case "victory":
          this._playRestoration(scale, delay, true);
          break;
        default:
          break;
      }
    }

    _playFootstep(options, scale, pan, delay) {
      const surface = normalizeName(options.surface || "grass");
      if (surface.includes("water")) {
        this._noiseSweep({ duration: 0.12, volume: 0.052 * scale, fromFrequency: 5100, toFrequency: 850, highpass: 620, pan, delay, send: 0.25 });
        return;
      }
      const stone = surface.includes("stone") || surface.includes("basalt") || surface.includes("bronze");
      this._noiseSweep({
        duration: stone ? 0.07 : 0.095,
        volume: (stone ? 0.052 : 0.038) * scale,
        fromFrequency: stone ? 1600 : 740,
        toFrequency: stone ? 250 : 120,
        highpass: stone ? 90 : 45,
        kind: stone ? "white" : "brown",
        pan,
        delay,
        send: stone ? 0.12 : 0.04,
      });
      this._tone({
        frequency: stone ? 112 : 78,
        endFrequency: stone ? 54 : 36,
        duration: 0.085,
        volume: (stone ? 0.035 : 0.028) * scale,
        type: "triangle",
        pan,
        delay,
        send: 0.025,
      });
    }

    _playMechanism(scale, pan, delay) {
      this._noiseSweep({ duration: 0.42, volume: 0.075 * scale, fromFrequency: 6100, toFrequency: 420, highpass: 160, pan, delay, send: 0.42 });
      [110, 155.6, 233.1, 329.6].forEach((frequency, index) => {
        this._tone({
          frequency,
          endFrequency: frequency * 1.035,
          duration: 0.62 + index * 0.21,
          volume: (0.065 - index * 0.008) * scale,
          type: index < 2 ? "triangle" : "sine",
          pan,
          delay: delay + index * 0.105,
          attack: 0.018,
          send: 0.78,
        });
      });
    }

    _playRestoration(scale, delay, extended) {
      const ratios = [1, 1.333, 1.682, 2.378, 2.828];
      ratios.forEach((ratio, index) => {
        const frequency = 110 * ratio;
        this._tone({
          frequency,
          endFrequency: frequency * 1.012,
          duration: (extended ? 2.4 : 1.65) + index * 0.2,
          volume: (0.052 - index * 0.005) * scale,
          type: index % 2 ? "triangle" : "sine",
          delay: delay + index * 0.14,
          attack: 0.08,
          pan: (index - 2) * 0.18,
          send: 0.88,
        });
      });
      this._noiseSweep({
        duration: extended ? 2.8 : 1.8,
        volume: 0.055 * scale,
        fromFrequency: 380,
        toFrequency: 9200,
        highpass: 80,
        kind: "pink",
        delay,
        send: 0.72,
      });
      this._tone({
        frequency: 46.25,
        endFrequency: 92.5,
        duration: extended ? 2.5 : 1.7,
        volume: 0.09 * scale,
        type: "sine",
        delay,
        attack: 0.12,
        send: 0.48,
      });
    }
  }

  window.DrownedAudio = DrownedAudio;
})();
