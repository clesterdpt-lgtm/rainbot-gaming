// =============================================================
// THE WEIGHT — Rainbot After Dark No. 002
// main.js — game controller: renderer, splash, state machine, loop
//
// State: boot → paralysis → (pull → astral → end)   [phase 2 = next step]
// This build delivers the Phase 1 foundation: the 3D engine, the
// bedroom, and the clamped pointer-lock "stiff neck" camera, with the
// audio context safely initialised from the Click-to-Begin gesture.
// =============================================================

(function () {
window.TW = window.TW || {};
const THREE = window.THREE;
const { CONFIG, AudioEngine, ClampedLook, BedroomScene, FX, AstralScene, AstralControls, Post, Touch } = TW;

class Game {
  constructor() {
    this.state = 'boot';
    this.stage = document.getElementById('stage');
    this._last = 0;
    this._elapsed = 0;
    this._raf = null;

    this._loop = this._loop.bind(this);
    this._onResize = this._onResize.bind(this);
  }

  init() {
    if (this._inited) return;
    this._inited = true;
    if (!THREE) return this._fail('WebGL library failed to load.');
    try {
      this._initRenderer();
    } catch (err) {
      return this._fail('Your browser could not open a WebGL context. ' +
        'Try a desktop browser with hardware acceleration enabled.');
    }

    this.fx = new FX();
    this.audio = new AudioEngine();
    this.bedroom = new BedroomScene(CONFIG);
    this.controls = new ClampedLook(this.bedroom.camera, this.renderer.domElement, CONFIG);
    this.controls.onLockChange = (locked) => this._onLockChange(locked);
    this.activeControls = this.controls;
    this._phase = 'paralysis';     // which world is being rendered

    // touch / mobile input
    this.touch = new Touch(
      document.getElementById('touch-layer'),
      document.getElementById('joy-base'),
      document.getElementById('joy-thumb'),
    );
    this.touch.onLook = (dx, dy) => {
      if (this.activeControls && this.activeControls.applyLookDelta) this.activeControls.applyLookDelta(dx, dy);
    };
    if (this.touch.enabled) document.body.classList.add('mobile');

    this._onResize();
    this._wireUI();
    window.addEventListener('resize', this._onResize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.audio.suspend();
    });

    // render one quiet frame behind the splash so it isn't a black void
    this.renderer.render(this.bedroom.scene, this.bedroom.camera);
  }

  _initRenderer() {
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.pixelRatioCap));
    r.outputEncoding = THREE.sRGBEncoding;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = CONFIG.exposure;
    if (CONFIG.shadows) {
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    this.stage.appendChild(r.domElement);
    this.renderer = r;
  }

  _wireUI() {
    document.getElementById('btn-enter').addEventListener('click', () => this._begin());
    document.getElementById('btn-resume').addEventListener('click', () => this._requestResume());
    document.getElementById('btn-restart').addEventListener('click', () => location.reload());
    document.getElementById('btn-again').addEventListener('click', () => location.reload());

    // pointer lock can be unavailable (some browsers / embedded views) — fall
    // back to relative-motion look so the game is always playable
    document.addEventListener('pointerlockerror', () => {
      this._fallback = true;
      if (this.fx) this.fx.subtitle('move the mouse to look around', 4500);
    });

    // any click on the game during play re-grabs the pointer lock, so a lost
    // or never-acquired lock (and its escaping cursor) is one click from fixed
    this.renderer.domElement.addEventListener('pointerdown', () => {
      if ((this.state === 'paralysis' || this.state === 'astral') &&
          !document.pointerLockElement &&
          this.activeControls && !(this.touch && this.touch.enabled)) {
        this.activeControls.requestLock();
      }
    });

    document.addEventListener('keydown', (e) => {
      // Space = blink (lets the entity lurch closer)
      if (e.code === 'Space' || e.key === ' ') {
        if (this.state === 'paralysis' && this._para && !this._para.lunged) {
          e.preventDefault();
          this._doBlink(false);
        }
        return;
      }
      // Esc toggles pause. In locked mode the browser exits the lock itself
      // (handled by _onLockChange); this covers the fallback / unlocked case.
      if (e.key !== 'Escape' && e.code !== 'Escape') return;
      if (document.pointerLockElement) return;
      if (this.state === 'paralysis' || this.state === 'astral') this._pause();
      else if (this.state === 'paused') this._resume();
    });

    const vol = document.getElementById('vol-slider');
    const read = document.getElementById('vol-readout');
    if (vol) {
      vol.addEventListener('input', () => {
        this.audio.setMaster(parseFloat(vol.value));
        read.textContent = Math.round(vol.value * 100) + '%';
      });
    }

    // on-screen buttons (mobile) — pointerdown for an instant, lag-free tap
    const blinkBtn = document.getElementById('btn-blink');
    if (blinkBtn) blinkBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.state === 'paralysis' && this._para && !this._para.lunged) this._doBlink(false);
    });
    const pauseBtn = document.getElementById('btn-pause');
    if (pauseBtn) pauseBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.state === 'paralysis' || this.state === 'astral') this._pause();
    });
  }

  _setTouchButtons(blink, pause) {
    if (!this.touch || !this.touch.enabled) return;
    const b = document.getElementById('btn-blink');
    const p = document.getElementById('btn-pause');
    if (b) b.classList.toggle('show', blink);
    if (p) p.classList.toggle('show', pause);
  }

  _requestResume() {
    // Try to re-grab the lock; if it isn't available, resume anyway so the
    // pause menu can never trap the player.
    this.activeControls.requestLock();
    if (this._fallback || (this.touch && this.touch.enabled) || !this.renderer.domElement.requestPointerLock) this._resume();
  }

  // ---- phase 1: the paralysis -----------------------------------------
  _begin() {
    if (this.state === 'paralysis') return;
    show('scr-boot', false);
    document.body.classList.add('playing');

    // Pointer lock MUST be requested synchronously inside the click gesture.
    // Awaiting anything first (e.g. audio) consumes the user activation and
    // the lock silently fails — so lock first, then everything else.
    this.controls.enabled = true;
    this.controls.requestLock();

    this.state = 'paralysis';
    this._stats = { t0: performance.now(), blinks: 0, pullAt: 0, chase0: 0 };
    this._setupParalysis();

    // Audio initialises in the background; it must never block game start.
    this.audio.unlock()
      .then(() => { this.audio.startDrone(41); this.audio.startBreathing(5.6); })
      .catch(() => {});

    // mobile: whole screen is look, blink + pause buttons (no joystick yet)
    this.touch.moveEnabled = false;
    this.touch.reset();
    this._setTouchButtons(true, true);

    fadeIn('fx-hint-paralysis', 900);
    setTimeout(() => fadeOut('fx-hint-paralysis'), 8500);

    this._last = performance.now();
    if (!this._raf) this._raf = requestAnimationFrame(this._loop);
  }

  _setupParalysis() {
    this._para = {
      t: 0,
      entityActive: false, entityProgress: 0, lunged: false, lungeT: 0, pulled: false,
      blinking: false, blink: 0, blinkT: 0, blinkDur: 0.3,
      blinkPressure: 0, maxOpen: 5.6,      // forced auto-blink after this many sec open
      creepLook: 0.011,                    // crawls while you look away (eyes open)
      creepBlind: 0.06,                    // crawls faster while your eyes are shut
      lurchManual: 0.055, lurchAuto: 0.095, // discrete jump on each blink
      blinkQueue: [],                      // scares that spring while the eyes are shut
    };
    // anomalies escalate, then the entity arrives; timings jitter a little
    // from run to run so a replay never plays out beat-for-beat the same
    const J = () => (Math.random() - 0.5) * 2;
    const onBlink = (fn) => this._para.blinkQueue.push(fn);
    this._anomalies = [
      { t: 6 + J(),  fn: () => { this.audio.creak(); this.bedroom.setDoor(0.17); } },
      { t: 12 + J(), fn: () => { this.audio.hallSteps(4, -0.35); this.bedroom.shadowFeet(2.2); this.fx.subtitle('something passed the door', 3200); } },
      { t: 18 + J(), fn: () => { this.audio.creak(); this.bedroom.setWardrobe(0.32); } },
      { t: 24 + J(), fn: () => { this.audio.tinnitus(7000, 4); this.bedroom.flicker(0.6); } },
      { t: 29 + J(), fn: () => { this.audio.knock(); this.bedroom.setDoor(0.4); this.fx.subtitle('the door was closed', 3200); } },
      { t: 34 + J(), fn: () => onBlink(() => {
        this.bedroom.hidePile();
        setTimeout(() => this.fx.subtitle('the clothes on the chair are gone', 3000), 800);
      }) },
      { t: 40 + J(), fn: () => { this.audio.skitter(); this.fx.subtitle('something is crossing the ceiling', 3200); } },
      { t: 46 + J(), fn: () => {
        this.bedroom.moonOut(3.5);
        this.audio.whisperWord(-0.5);
        this.fx.subtitle('the moon went out', 3000);
      } },
      { t: 52 + J(), fn: () => onBlink(() => {
        this.bedroom.moveChairCloser();
        this.audio.creak();
        setTimeout(() => this.fx.subtitle('the chair is closer now', 3000), 800);
      }) },
      { t: 58 + J(), fn: () => { this.audio.whisperWord(0.4); this.fx.subtitle('it said your name', 3200); } },
      { t: 63 + J(), fn: () => {
        this.bedroom.setDoor(0);
        this.audio.slam(-0.3);
        this.bedroom.flicker(0.35);
        this.fx.subtitle('the door slammed itself', 3200);
      } },
      { t: 68 + J(), fn: () => onBlink(() => {
        this.bedroom.showWardrobeEyes();
        this.audio.creak();
        setTimeout(() => this.fx.subtitle('the wardrobe is watching', 3200), 800);
      }) },
      { t: 73, fn: () => { this._activateEntity(); this.fx.subtitle('there is someone in the room', 4000); } },
    ];
  }

  _onLockChange(locked) {
    // the cursor only hides while the lock is really held (body.playing.locked)
    document.body.classList.toggle('locked', locked);
    if (locked && this.state === 'paused') this._resume();
    else if (!locked && (this.state === 'paralysis' || this.state === 'astral')) this._pause();
  }

  _pause() {
    if (this.state !== 'paralysis' && this.state !== 'astral') return;
    this._prePause = this.state;
    this.state = 'paused';
    this.activeControls.enabled = false;
    this.audio.suspend();
    this._setTouchButtons(false, false);
    if (this.touch) this.touch.reset();
    document.body.classList.remove('playing');
    show('scr-pause', true);
  }

  _resume() {
    show('scr-pause', false);
    document.body.classList.add('playing');
    this.activeControls.enabled = true;
    this.audio.resume();
    this.state = this._prePause || 'paralysis';
    if (this.touch) this.touch.reset();
    this._setTouchButtons(this.state === 'paralysis', true);
    this._last = performance.now();
  }

  // ---- main loop ------------------------------------------------------
  _loop(now) {
    this._raf = requestAnimationFrame(this._loop);
    const dt = Math.min((now - this._last) / 1000, 0.05);
    this._last = now;

    if (this.state === 'paralysis') {
      this._updateParalysis(dt);
      this.controls.update(dt);
      this.bedroom.update(dt, this.controls.breathPhase);
    } else if (this.state === 'astral') {
      this._updateAstral(dt);
    }

    this._render(dt);
  }

  _render(dt) {
    if (this._phase === 'astral' && this.post && this.astral) {
      this.post.render(this.astral.scene, this.astral.camera, dt, this._astralProx || 0);
    } else {
      this.renderer.render(this.bedroom.scene, this.bedroom.camera);
    }
  }

  // ---- the dread arc: anomalies → entity → blink advance → lunge ------
  _updateParalysis(dt) {
    const p = this._para;
    p.t += dt;

    // ----- blink: pressure builds until you must blink; space blinks early
    if (p.blinking) {
      p.blinkT += dt;
      const half = p.blinkDur / 2;
      p.blink = p.blinkT < half ? p.blinkT / half : 1 - (p.blinkT - half) / half;
      p.blink = Math.max(0, Math.min(1, p.blink));
      // things happen while the eyes are shut (at most one scare per blink)
      if (p.blinkT >= half && !p.blinkSprung && p.blinkQueue.length) {
        p.blinkSprung = true;
        p.blinkQueue.shift()();
      }
      if (p.blinkT >= p.blinkDur) { p.blinking = false; p.blink = 0; }
    } else {
      p.blinkPressure += dt / p.maxOpen;
      if (p.blinkPressure >= 1) this._doBlink(true);   // forced, long blink
    }
    this.fx.setEyelids(p.blink);

    // ----- timed anomalies
    while (this._anomalies.length && p.t >= this._anomalies[0].t) {
      this._anomalies.shift().fn();
    }

    // ----- the lunge, once it reaches the bed
    if (p.lunged) {
      p.lungeT += dt;
      const k = Math.min(1, p.lungeT / 0.7);
      this.bedroom.lunge(k);
      this.controls.shake = 0.05 + k * 0.07;
      if (k >= 1 && !p.pulled) { p.pulled = true; this._triggerPull(); }
      return;
    }

    // ----- entity advance
    if (p.entityActive) {
      const eyesOpen = p.blink < 0.45;
      const observed = eyesOpen && this._entityInView();
      if (!observed) {
        // it moves when you blink or look away — never while watched
        p.entityProgress += dt * (eyesOpen ? p.creepLook : p.creepBlind);
        p.entityProgress = Math.min(1, p.entityProgress);
      }
      this.bedroom.setEntityProgress(p.entityProgress);

      const prox = p.entityProgress;
      this.audio.setWhisperLevel(prox, this._entityPan());
      this.audio.setHeartbeat(58 + prox * 62);
      this.audio.setBreathRate(5.6 - prox * 3.4);
      this.audio.setDread(prox);
      this.controls.shake = prox > 0.5 ? (prox - 0.5) * 0.05 : 0;
      this.fx.bloodLevel(prox * 0.72);
      this.fx.updateGrain(0.05 + prox * 0.06);

      if (prox >= 1 && !p.lunged) { p.lunged = true; p.lungeT = 0; this._beginLunge(); }
    } else {
      this.fx.updateGrain(0.05);
    }
  }

  _doBlink(forced) {
    const p = this._para;
    if (p.blinking) return;
    p.blinking = true; p.blinkT = 0; p.blinkSprung = false;
    p.blinkDur = forced ? 0.6 : 0.3;
    p.blinkPressure = 0;
    if (this._stats) this._stats.blinks++;
    // each blink lets the entity lurch closer
    if (p.entityActive && !p.lunged) {
      p.entityProgress = Math.min(1, p.entityProgress + (forced ? p.lurchAuto : p.lurchManual));
    }
  }

  _activateEntity() {
    const p = this._para;
    if (p.entityActive) return;
    p.entityActive = true;
    p.entityProgress = 0.04;
    this.bedroom.setEntityProgress(p.entityProgress);
    this.audio.startWhispers();
    this.audio.startHeartbeat(58);
    fadeIn('fx-hint-paralysis', 600);
    document.getElementById('fx-hint-paralysis').textContent =
      'keep your eyes on it · space — blink · it moves when you look away';
    setTimeout(() => fadeOut('fx-hint-paralysis'), 7000);
  }

  _entityInView() {
    const ep = this.bedroom.getEntityPosition();
    if (!ep) return false;
    const cam = this.bedroom.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const to = ep.clone().sub(cam.position); to.y += 1.0; to.normalize();
    return fwd.dot(to) > 0.84;     // within ~33° of where you're looking
  }

  _entityPan() {
    const ep = this.bedroom.getEntityPosition();
    if (!ep) return 0;
    const cam = this.bedroom.camera;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const to = ep.clone().sub(cam.position).normalize();
    return Math.max(-1, Math.min(1, right.dot(to)));
  }

  _beginLunge() {
    this.controls.enabled = false;
    this.audio.stinger();
    this.audio.setWhisperLevel(0);
    this.fx.flashWhite(90);
  }

  _triggerPull() {
    if (this._stats) this._stats.pullAt = performance.now();
    this.audio.shatter();
    this.fx.flashWhite(150);
    this.fx.showTitle('YOU LEAVE YOUR BODY');
    this.audio.stopHeartbeat();
    setTimeout(() => this.fx.fadeTo(1, 1100), 650);
    setTimeout(() => this._startAstral(), 2200);
  }

  // ---- phase 2: the astral return -------------------------------------
  _startAstral() {
    // tear down phase 1 input + hide its entity
    this.controls.enabled = false;
    this.controls.shake = 0;
    this.controls.dispose();
    this.bedroom.setEntityProgress(0);
    this.fx.setEyelids(0);
    this.fx.bloodLevel(0);
    fadeOut('fx-hint-paralysis');
    if (this.fx.grain) this.fx.grain.style.opacity = '0';   // post does the grain now

    // build the astral world + free controls + post pipeline
    this.astral = new AstralScene(CONFIG);
    this.astral.setAspect(window.innerWidth / window.innerHeight);
    this.astralControls = new AstralControls(this.astral.camera, this.renderer.domElement, this.astral);
    this.astralControls.onLockChange = (l) => this._onLockChange(l);
    this.astralControls.setPosition(this.astral.playerStart);
    this.astralControls.enabled = true;
    this.activeControls = this.astralControls;

    // mobile: enable the movement joystick; pause button only (no blink here)
    this.touch.moveEnabled = true;
    this.touch.reset();
    this.astralControls.moveInput = this.touch.move;
    this._setTouchButtons(false, true);
    this.post = new Post(this.renderer);
    this.post.setSize(window.innerWidth, window.innerHeight);

    this.astral.setEntity(this.astral.entityStart.x, this.astral.entityStart.z, 0);
    this._huntT = 0;
    this._astralProx = 0;
    this._stepTimer = 0;
    this._rage = 0;
    this._slams = [];
    this._stunT = 0;
    this._rejectT = 0;
    this._prevPz = undefined;
    if (this._stats) this._stats.chase0 = performance.now();

    // audio: ambient drone continues; breath turns to panic, wind and the hunt
    this.audio.setBreathRate(3.8);
    this.audio.startWhispers();
    this.audio.startHeartbeat(72);
    this.audio.startWind();

    this._phase = 'astral';
    this.state = 'astral';

    // reveal the world out of the black
    this.fx.hideTitle();
    this.fx.fadeTo(0, 1700);
    const hud = document.getElementById('obe-hud');
    if (hud) hud.style.display = 'block';
    fadeIn('fx-hint-astral', 900);
    setTimeout(() => fadeOut('fx-hint-astral'), 9000);
    this._objEl = document.getElementById('obe-objective');
  }

  _updateAstral(dt) {
    const a = this.astral, c = this.astralControls;
    c.update(dt);
    a.update(dt);
    this._huntEntity(dt);

    const pp = c.position, ep = a.entityPos;
    const dist = Math.hypot(pp.x - ep.x, pp.z - ep.z);
    const prox = Math.max(0, Math.min(1, 1 - dist / 9));
    this._astralProx = prox;

    // proximity feedback (the distortion IS the threat meter)
    const pan = this._astralPanFor(ep);
    this.audio.setWhisperLevel(prox * 1.1, pan);
    this.audio.setHeartbeat(70 + prox * 72);
    this.audio.setBreathRate(3.8 - prox * 1.9);
    c.shake = prox > 0.4 ? (prox - 0.4) * 0.055 : 0;

    // entity footsteps, faster as it closes
    this._stepTimer -= dt;
    if (this._stepTimer <= 0) {
      this.audio.footstep(pan, 0.35 + prox * 0.65);
      this._stepTimer = 0.62 - prox * 0.34;
    }

    this._updateFragments(pp, ep);
    this._updateObjective(pp);
    this._updateDoorSlams(dt, pp, ep);

    // the player's soul-light follows them; the shared shard light sits on
    // the nearest uncollected shard
    if (a.soulLight) a.soulLight.position.set(pp.x, 2.1, pp.z);
    if (a.fragLight) {
      let near = null, nd = Infinity;
      for (const f of a.fragments) {
        if (f.taken) continue;
        const d = Math.hypot(pp.x - f.x, pp.z - f.z);
        if (d < nd) { nd = d; near = f; }
      }
      if (near) { a.fragLight.position.set(near.x, 1.6, near.z); a.fragLight.intensity = 1.1; }
      else a.fragLight.intensity = 0;
    }

    // win: reach your body with your soul whole — lose: it catches you
    const bp = a.bodyPosition;
    const bodyDist = Math.hypot(pp.x - bp.x, pp.z - bp.z);
    if (bodyDist < 1.5) {
      if (a.fragmentsCollected >= a.fragmentTotal) return this._escaped();
      // the body will not take an incomplete soul
      this._rejectT -= dt;
      if (this._rejectT <= 0) {
        this._rejectT = 3;
        const missing = a.fragmentTotal - a.fragmentsCollected;
        this.fx.subtitle('your body rejects you — ' + missing + (missing === 1 ? ' shard' : ' shards') + ' of your soul still missing', 2700);
        this.audio.knock();
      }
    }
    if (dist < 0.95) return this._caught(bodyDist);
  }

  // touching a shard restores it — and the release shoves the hunter back
  _updateFragments(pp, ep) {
    const a = this.astral;
    for (let i = 0; i < a.fragments.length; i++) {
      const f = a.fragments[i];
      if (f.taken || Math.hypot(pp.x - f.x, pp.z - f.z) > 1.5) continue;
      a.collectFragment(i);
      this.audio.fragmentChime();
      const got = a.fragmentsCollected, tot = a.fragmentTotal;
      if (got === tot) {
        this.fx.subtitle('you are whole — get back to your body', 3600);
      } else {
        this.fx.subtitle('a piece of you returns · ' + got + ' of ' + tot, 2600);
      }
      // shockwave: if the hunter is close, it is hurled back and stunned
      const dx = ep.x - pp.x, dz = ep.z - pp.z, dd = Math.hypot(dx, dz) || 1;
      if (dd < 16) {
        const push = new THREE.Vector3(ep.x + (dx / dd) * 9, 0, ep.z + (dz / dd) * 9);
        this.astral.resolve(push, 0.4);
        this.astral.setEntity(push.x, push.z, Math.atan2(pp.x - push.x, pp.z - push.z));
        this._stunT = 1.3;
        this.audio.stinger();
      }
    }
  }

  // doorways slam shut behind you; the hunter pounds them apart and comes
  // through angrier — each slam buys distance at the price of speed
  _updateDoorSlams(dt, pp, ep) {
    const a = this.astral;
    const prevZ = this._prevPz === undefined ? pp.z : this._prevPz;
    this._prevPz = pp.z;

    const gates = [99.5, 3.6, -4.4, -11.4];
    for (let i = 0; i < gates.length; i++) {
      const z = gates[i];
      if (pp.z < z && prevZ >= z && ep.z > z + 0.6 && a.sealDoor(i)) {
        const c = a.doorCenter(i);
        this.audio.slam(this._astralPanFor(c));
        this._slams.push({ i, started: false, t: 0, pounds: 0 });
        if (!this._slammedOnce) {
          this._slammedOnce = true;
          this.fx.subtitle('the door slams shut behind you', 3000);
        }
      }
    }

    for (let k = this._slams.length - 1; k >= 0; k--) {
      const s = this._slams[k];
      const c = a.doorCenter(s.i);
      if (!s.started) {
        // the pounding starts only once the hunter reaches the sealed door
        if (Math.hypot(ep.x - c.x, ep.z - c.z) < 2.6) s.started = true;
        else continue;
      }
      s.t += dt;
      const due = [0.35, 0.95, 1.55];
      while (s.pounds < due.length && s.t >= due[s.pounds]) {
        s.pounds++;
        this.audio.pound(this._astralPanFor(c));
      }
      if (s.t >= 2.1) {
        a.breakDoor(s.i);
        this.audio.crash(this._astralPanFor(c));
        this._rage += 0.35;
        this._slams.splice(k, 1);
      }
    }
  }

  _huntEntity(dt) {
    // a shard's shockwave leaves it reeling for a moment
    if (this._stunT > 0) { this._stunT -= dt; return; }
    const a = this.astral, ep = a.entityPos, pp = this.astralControls.position;
    this._huntT += dt;
    const distP = Math.hypot(pp.x - ep.x, pp.z - ep.z);
    // ease the hunt in over the first couple seconds so you can get your bearings
    const grace = Math.min(this._huntT / 2.5, 1);
    // base + slow ramp + rubber-band: it surges when you pull away and eases
    // off up close, so a long chase stays on your heels without being unfair
    const speed = (2.8 + Math.min(this._huntT * 0.018, 1.0) + Math.min(distP * 0.05, 1.9) + (this._rage || 0)) * grace;
    // steer toward the next doorway on the route (open chase outdoors)
    const tgt = a.entityTarget(ep.x, ep.z, pp.x, pp.z);
    const dx = tgt.x - ep.x, dz = tgt.z - ep.z;
    const d = Math.hypot(dx, dz) || 1;
    const next = new THREE.Vector3(ep.x + (dx / d) * speed * dt, 0, ep.z + (dz / d) * speed * dt);
    a.resolve(next, 0.4);
    // always turn to face the player
    a.setEntity(next.x, next.z, Math.atan2(pp.x - ep.x, pp.z - ep.z));
  }

  _astralPanFor(ep) {
    const cam = this.astral.camera;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const to = new THREE.Vector3(ep.x - cam.position.x, 0, ep.z - cam.position.z).normalize();
    return Math.max(-1, Math.min(1, right.dot(to)));
  }

  _updateObjective(pp) {
    if (!this._objEl) return;
    const a = this.astral;
    const z = pp.z;
    let msg;
    if (z > 150) msg = 'run';
    else if (z > 118) msg = 'through the trees';
    else if (z > 100) msg = 'through the graveyard';
    else if (z > 86) msg = 'cross the creek';
    else if (z > 16) msg = 'follow the road home';
    else if (z > 4.2) msg = 'get to your house';
    else if (z > -11) msg = 'find your bedroom';
    else msg = a.fragmentsCollected >= a.fragmentTotal ? 'reach your body' : 'your soul is not whole';
    const soul = a.fragmentsCollected >= a.fragmentTotal
      ? 'soul whole'
      : 'soul ' + a.fragmentsCollected + '/' + a.fragmentTotal;
    msg = msg + '  ·  ' + soul;
    if (msg !== this._objMsg) { this._objMsg = msg; this._objEl.textContent = msg; }
  }

  _fmt(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  _runStats() {
    const st = this._stats || {};
    const now = performance.now();
    return {
      blinks: st.blinks || 0,
      paraMs: (st.pullAt || now) - (st.t0 || now),
      chaseMs: st.chase0 ? now - st.chase0 : 0,
    };
  }

  _escaped() {
    if (this.state === 'end') return;
    this.state = 'end';
    this.astralControls.enabled = false;
    this.astralControls.shake = 0;
    this.audio.stopWhispers();
    this.audio.stopHeartbeat();
    this.audio.wakeChord();
    this.audio.setBreathRate(5.6);
    this.fx.flashWhite(220);
    const r = this._runStats();
    let best = null;
    try {
      const prev = parseInt(localStorage.getItem('tw_best_escape_v1'), 10);
      if (!isNaN(prev)) best = prev;
      if (best === null || r.chaseMs < best) {
        localStorage.setItem('tw_best_escape_v1', String(Math.round(r.chaseMs)));
      }
    } catch (e) {}
    const isBest = best === null || r.chaseMs < best;
    const stats = 'endured the room ' + this._fmt(r.paraMs) + ' · ' + r.blinks + ' blinks · soul made whole · escaped in ' +
      this._fmt(r.chaseMs) + (isBest ? ' · new best' : ' · best ' + this._fmt(best));
    this._showEnd('✶', 'YOU WAKE UP',
      '3:47 AM. The room is still.\nYou are back inside your own skin — for now.',
      stats, 'sleep is DLC');
  }

  _caught(bodyDist) {
    if (this.state === 'end') return;
    this.state = 'end';
    this.astralControls.enabled = false;
    this.astralControls.shake = 0;
    this.audio.stinger();
    this.audio.stopWhispers();
    this.audio.stopHeartbeat();
    this.fx.flashWhite(60);
    this.fx.fadeTo(1, 500);
    setTimeout(() => this.fx.fadeTo(0, 900), 700);
    const r = this._runStats();
    const shards = this.astral ? this.astral.fragmentsCollected + '/' + this.astral.fragmentTotal + ' shards · ' : '';
    const stats = 'endured the room ' + this._fmt(r.paraMs) + ' · ' + r.blinks +
      ' blinks · ' + shards + 'caught ' + Math.round(bodyDist || 0) + ' m from your body';
    this._showEnd('☓', 'IT HAS YOU',
      'You never made it back.\nThe body in the bed does not wake.',
      stats, 'try to wake again');
  }

  _showEnd(icon, title, sub, stats, warn) {
    if (document.exitPointerLock) document.exitPointerLock();  // free the cursor
    this._setTouchButtons(false, false);
    if (this.touch) this.touch.reset();
    this.audio.stopBreathing();
    this.audio.stopWind();
    this.audio.stopDrone(2);
    document.getElementById('end-icon').textContent = icon;
    document.getElementById('end-title').textContent = title;
    document.getElementById('end-sub').textContent = sub;
    document.getElementById('end-stats').textContent = stats;
    document.getElementById('end-warn').textContent = warn;
    document.body.classList.remove('playing');
    setTimeout(() => show('scr-end', true), 600);
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.bedroom.setAspect(w / h);
    if (this.astral) this.astral.setAspect(w / h);
    if (this.post) this.post.setSize(w, h);
    if (this.fx) this.fx.resize();
  }

  _fail(msg) {
    const el = document.getElementById('err-msg');
    if (el) el.textContent = msg;
    show('scr-boot', false);
    show('scr-error', true);
  }
}

// ---- tiny screen helpers --------------------------------------------
function show(id, on) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('scr--show', on);
}
function fadeIn(id, ms) {
  const el = document.getElementById(id);
  if (el) { el.style.transition = `opacity ${ms}ms`; el.style.opacity = '1'; }
}
function fadeOut(id) {
  const el = document.getElementById(id);
  if (el) el.style.opacity = '0';
}

// ---- boot -----------------------------------------------------------
const game = new Game();
window._weight = game; // debug handle
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => game.init());
} else {
  game.init();
}
})();
