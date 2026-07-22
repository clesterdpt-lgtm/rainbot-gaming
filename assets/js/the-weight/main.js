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
    if (window.ResizeObserver) {
      this._stageObserver = new ResizeObserver(() => this._onResize());
      this._stageObserver.observe(this.stage);
    }
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
    document.getElementById('btn-main-menu').addEventListener('click', () => location.reload());
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

    // Blink stays on pointerdown for an instant mobile response. Pause uses a
    // regular click so the shared three-line game menu can invoke it too.
    const blinkBtn = document.getElementById('btn-blink');
    if (blinkBtn) blinkBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.state === 'paralysis' && this._para && !this._para.lunged) this._doBlink(false);
    });
    const pauseBtn = document.getElementById('btn-pause');
    if (pauseBtn) pauseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (this.state === 'paralysis' || this.state === 'astral') this._pause();
      else if (this.state === 'paused') this._requestResume();
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
      falseWakes: 0, falseWakeActive: false,
      blinking: false, blink: 0, blinkT: 0, blinkDur: 0.36,
      blinkCloseDur: 0.12, blinkHoldDur: 0.1, blinkOpenDur: 0.14,
      eyesFullyClosed: false, blinkLurch: 0,
      blinkPressure: 0, maxOpen: 5.6,      // forced auto-blink after this many sec open
      creepBlind: 0.06,                    // crawls only during the fully black hold
      lurchManual: 0.055, lurchAuto: 0.095, // discrete jump on each blink
      blinkQueue: [],                      // scares that spring while the eyes are shut
    };
    this._anomalyUsed = new Set();
    this._nextAnomalyAt = 5.5;

    // Nothing here describes itself to the player. Visual changes wait until
    // their location is outside the camera, and stronger violations happen
    // only behind fully closed eyelids.
    this._anomalyPool = [
      { id: 'door-sliver', minLoop: 0, maxLoop: 0, target: [-0.7, 1.1, -2.72], run: () => {
        this.bedroom.setDoor(0.18); this.audio.creak();
      } },
      { id: 'hall-feet', minLoop: 0, maxLoop: 0, target: [-0.7, 0.1, -2.72], run: () => {
        this.bedroom.shadowFeet(2.5); this.audio.hallSteps(5, -0.35);
      } },
      { id: 'wardrobe-crack', minLoop: 0, maxLoop: 0, target: [1.7, 1.3, -2.3], run: () => {
        this.bedroom.setWardrobe(0.22); this.audio.creak();
      } },
      { id: 'wrong-minute', minLoop: 0, maxLoop: 0, target: [1.7, 0.7, 1.5], run: () => {
        this.bedroom.setClockTime('3:48');
      } },
      { id: 'picture-tilt', minLoop: 0, maxLoop: 0, target: [2.1, 1.6, 0.4], run: () => {
        this.bedroom.tiltPicture(0.18);
      } },
      { id: 'curtains-narrow', minLoop: 0, maxLoop: 0, target: [-2.1, 1.5, -0.4], run: () => {
        this.bedroom.drawCurtains(0.24);
      } },
      { id: 'pile-slump', minLoop: 0, maxLoop: 0, target: [-1.65, 0.75, -2.25], run: () => {
        this.bedroom.slumpPile(); this.audio.creak();
      } },
      { id: 'three-knocks', minLoop: 0, maxLoop: 1, run: () => {
        this.audio.knock(); setTimeout(() => this.audio.knock(), 520); setTimeout(() => this.audio.knock(), 1180);
      } },

      { id: 'bed-weight', minLoop: 1, blackout: true, target: [-0.46, 0.68, 0.72], run: () => {
        this.bedroom.showBedDent(); this.audio.creak();
      } },
      { id: 'empty-chair', minLoop: 1, blackout: true, target: [-1.65, 0.75, -2.25], run: () => {
        this.bedroom.hidePile();
      } },
      { id: 'chair-turn', minLoop: 1, blackout: true, target: [-1.65, 0.75, -2.25], run: () => {
        this.bedroom.moveChairCloser(); this.audio.creak();
      } },
      { id: 'window-watcher', minLoop: 1, target: [-2.08, 1.5, -0.25], run: () => {
        this.bedroom.showWindowWatcher();
      } },
      { id: 'jamb-fingers', minLoop: 1, target: [-0.25, 1.3, -2.68], run: () => {
        this.bedroom.showDoorFingers();
      } },
      { id: 'steady-dark', minLoop: 1, run: () => {
        this.bedroom.moonOut(6); this.audio.whisperWord(-0.7);
      } },
      { id: 'dead-clock', minLoop: 1, target: [1.7, 0.7, 1.5], run: () => {
        this.bedroom.setClockTime('    ');
      } },
      { id: 'ceiling-crossing', minLoop: 1, run: () => this.audio.skitter() },

      { id: 'wardrobe-eyes', minLoop: 2, blackout: true, target: [1.7, 1.5, -2.3], run: () => {
        this.bedroom.showWardrobeEyes(); this.audio.creak();
      } },
      { id: 'door-wide', minLoop: 2, blackout: true, target: [-0.7, 1.1, -2.72], run: () => {
        this.bedroom.setDoor(0.7); this.bedroom.showDoorFingers(false); this.audio.creak();
      } },
      { id: 'chair-bedside', minLoop: 2, blackout: true, target: [-1.2, 0.7, -1.5], run: () => {
        this.bedroom.moveChairCloser(); this.audio.creak();
      } },
      { id: 'breath-missing', minLoop: 2, run: () => {
        this.audio.stopBreathing();
        setTimeout(() => { if (this.state === 'paralysis') this.audio.startBreathing(5.2); }, 3400);
      } },
      { id: 'name-at-ear', minLoop: 2, run: () => {
        this.audio.nearBreath(0.88); setTimeout(() => this.audio.whisperWord(0.82), 950);
      } },
      { id: 'door-shut', minLoop: 2, target: [-0.7, 1.1, -2.72], run: () => {
        this.bedroom.setDoor(0); this.audio.slam(-0.3);
      } },
    ];
  }

  _pointInView(point, threshold = 0.79) {
    if (!point) return false;
    const cam = this.bedroom.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const to = new THREE.Vector3(point[0], point[1], point[2]).sub(cam.position).normalize();
    return fwd.dot(to) > threshold;
  }

  _updateAnomalyDirector() {
    const p = this._para;
    if (p.falseWakeActive || p.entityActive || p.t < this._nextAnomalyAt) return;
    const candidates = this._anomalyPool
      .filter((a) => !this._anomalyUsed.has(a.id))
      .filter((a) => p.falseWakes >= (a.minLoop || 0) && p.falseWakes <= (a.maxLoop === undefined ? 99 : a.maxLoop))
      .filter((a) => !(a.blackout && p.blinkQueue.length))
      .sort(() => Math.random() - 0.5);
    const chosen = candidates.find((a) => a.blackout || !a.target || !this._pointInView(a.target));
    if (!chosen) {
      this._nextAnomalyAt = p.t + 0.75;
      return;
    }
    this._anomalyUsed.add(chosen.id);
    if (chosen.blackout) p.blinkQueue.push(chosen.run);
    else chosen.run();
    this._nextAnomalyAt = p.t + 5.5 + Math.random() * 5.5;
  }

  _beginFalseWake() {
    const p = this._para;
    if (p.falseWakeActive) return;
    p.falseWakeActive = true;
    p.blinkQueue.length = 0;
    this.controls.enabled = false;
    this.audio.setWhisperLevel(0);
    this.fx.fadeTo(1, 780);
    setTimeout(() => {
      p.falseWakes++;
      this.bedroom.resetForFalseWake(p.falseWakes);
      if (this.controls.resetGaze) this.controls.resetGaze();
      p.blinkPressure = 0;
      this._nextAnomalyAt = p.t + 4.5;
      this.fx.showTitle('3:47 AM');
      setTimeout(() => {
        this.fx.fadeTo(0, 1050);
        setTimeout(() => this.fx.hideTitle(), 900);
        p.falseWakeActive = false;
        if (this.state === 'paralysis') this.controls.enabled = true;
      }, 520);
    }, 820);
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
      this.bedroom.update(dt, this.controls.breathPhase, this._para && this._para.eyesFullyClosed);
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
    if (p.falseWakeActive) {
      this.fx.updateGrain(0.04);
      return;
    }

    // ----- blink: pressure builds until you must blink; space blinks early
    if (p.blinking) {
      p.blinkT += dt;
      const closeEnd = p.blinkCloseDur;
      const holdEnd = closeEnd + p.blinkHoldDur;
      p.eyesFullyClosed = false;

      if (p.blinkT < closeEnd) {
        p.blink = p.blinkT / closeEnd;
      } else if (p.blinkT < holdEnd) {
        // Hold at complete blackness. Entity advances and queued scares are
        // applied only here, never while either eyelid is still visible.
        p.blink = 1;
        p.eyesFullyClosed = true;
        if (!p.blinkSprung) {
          p.blinkSprung = true;
          if (p.entityActive && !p.lunged) {
            p.entityProgress = Math.min(1, p.entityProgress + p.blinkLurch);
          }
          if (p.blinkQueue.length) p.blinkQueue.shift()();
        }
      } else {
        p.blink = 1 - (p.blinkT - holdEnd) / p.blinkOpenDur;
      }
      p.blink = Math.max(0, Math.min(1, p.blink));
      if (p.blinkT >= p.blinkDur) {
        p.blinking = false;
        p.blink = 0;
        p.eyesFullyClosed = false;
      }
    } else {
      p.eyesFullyClosed = false;
      p.blinkPressure += dt / p.maxOpen;
      if (p.blinkPressure >= 1) this._doBlink(true);   // forced, long blink
    }
    this.fx.setEyelids(p.blink);

    // Two almost-normal resets teach the player that waking up is not safety.
    const wakeTimes = [42, 82];
    if (p.falseWakes < wakeTimes.length && p.t >= wakeTimes[p.falseWakes] && !p.blinking) {
      this._beginFalseWake();
      return;
    }
    this._updateAnomalyDirector();
    if (!p.entityActive && p.falseWakes >= 2 && p.t >= 112) this._activateEntity();

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
      if (p.eyesFullyClosed) {
        // Positional movement is impossible until the viewport is solid black.
        p.entityProgress += dt * p.creepBlind;
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
    p.eyesFullyClosed = false;
    p.blinkCloseDur = forced ? 0.18 : 0.12;
    p.blinkHoldDur = forced ? 0.24 : 0.1;
    p.blinkOpenDur = forced ? 0.18 : 0.14;
    p.blinkDur = p.blinkCloseDur + p.blinkHoldDur + p.blinkOpenDur;
    p.blinkLurch = forced ? p.lurchAuto : p.lurchManual;
    p.blinkPressure = 0;
    if (this._stats) this._stats.blinks++;
  }

  _activateEntity() {
    const p = this._para;
    if (p.entityActive) return;
    p.entityActive = true;
    p.entityProgress = 0.04;
    this.bedroom.setEntityProgress(p.entityProgress);
    this.bedroom.showWindowWatcher(false);
    this.audio.startWhispers();
    this.audio.startHeartbeat(58);
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
    this.fx.fadeTo(0.24, 420);
  }

  _triggerPull() {
    if (this._stats) this._stats.pullAt = performance.now();
    this.audio.shatter();
    this.fx.showTitle('YOU LEAVE YOUR BODY');
    this.audio.stopHeartbeat();
    this.fx.fadeTo(1, 1000);
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
    const stageRect = this.stage.getBoundingClientRect();
    const stageW = Math.max(1, Math.round(stageRect.width || window.innerWidth));
    const stageH = Math.max(1, Math.round(stageRect.height || window.innerHeight));
    this.astral.setAspect(stageW / stageH);
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
    this.post.setSize(stageW, stageH);

    this.astral.setEntity(this.astral.entityStart.x, this.astral.entityStart.z, 0);
    this._huntT = 0;
    this._stalkDecisionT = 7;
    this._stalkSeenT = 0;
    this._hunterMoved = false;
    this._mimicStepT = 5 + Math.random() * 4;
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
    this._huntEntity(dt);
    a.update(dt, this._hunterMoved);

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

    // Real footsteps occur only while it is actually moving. During long
    // freezes, an occasional step sounds from the wrong side of the player.
    this._stepTimer -= dt;
    this._mimicStepT -= dt;
    if (this._hunterMoved && this._stepTimer <= 0) {
      this.audio.footstep(pan, 0.25 + prox * 0.6);
      this._stepTimer = 0.72 - prox * 0.3;
    } else if (!this._hunterMoved && this._mimicStepT <= 0 && dist > 6) {
      this.audio.footstep(-pan || (Math.random() < 0.5 ? -0.7 : 0.7), 0.28);
      this._mimicStepT = 7 + Math.random() * 7;
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
      for (const f of a.falseFragments || []) {
        if (f.sprung) continue;
        const d = Math.hypot(pp.x - f.x, pp.z - f.z);
        if (d < nd) { nd = d; near = f; }
      }
      if (near) { a.fragLight.position.set(near.x, 1.45, near.z); a.fragLight.intensity = 0.72; }
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
        this.fx.subtitle('your body does not know you', 2400);
        this.audio.knock();
      }
    }
    if (dist < 0.95) return this._caught(bodyDist);
  }

  // Every fragment is a location-specific encounter, not a repeated pickup.
  _updateFragments(pp, ep) {
    const a = this.astral;
    for (let i = 0; i < a.fragments.length; i++) {
      const f = a.fragments[i];
      if (f.taken || Math.hypot(pp.x - f.x, pp.z - f.z) > 1.5) continue;
      a.collectFragment(i);
      a.triggerFragmentEncounter(i, pp);
      this.audio.fragmentChime();
      this.fx.subtitle(f.line, 3300);
      // shockwave: if the hunter is close, it is hurled back and stunned
      const dx = ep.x - pp.x, dz = ep.z - pp.z, dd = Math.hypot(dx, dz) || 1;
      if (dd < 16) {
        const push = new THREE.Vector3(ep.x + (dx / dd) * 9, 0, ep.z + (dz / dd) * 9);
        this.astral.resolve(push, 0.4);
        this.astral.setEntity(push.x, push.z, Math.atan2(pp.x - push.x, pp.z - push.z));
        this._stunT = 1.6;
      }
      this._stalkDecisionT = 3 + Math.random() * 3;
    }

    for (let i = 0; i < (a.falseFragments || []).length; i++) {
      const f = a.falseFragments[i];
      if (f.sprung || Math.hypot(pp.x - f.x, pp.z - f.z) > 1.35) continue;
      if (a.springFalseFragment(i)) {
        const falsePan = this._astralPanFor(f);
        this.audio.nearBreath(-falsePan || 0.75);
        setTimeout(() => this.audio.whisperWord(falsePan), 650);
        this._forceFlank = true;
        this._stalkDecisionT = 0;
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
        this._slammedOnce = true;
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
    this._hunterMoved = false;
    // A recovered fragment leaves it reeling for a moment.
    if (this._stunT > 0) { this._stunT -= dt; return; }
    const a = this.astral, ep = a.entityPos, pp = this.astralControls.position;
    this._huntT += dt;
    let distP = Math.hypot(pp.x - ep.x, pp.z - ep.z);
    const seen = this._astralEntityInView(ep);
    this._stalkDecisionT -= dt;

    // Relocation is allowed only while the old position is outside the view.
    // It chooses a side or shallow point ahead, so checking behind never gives
    // the player a reliable picture of where it will be next.
    if ((this._forceFlank || this._stalkDecisionT <= 0) && !seen && distP > 7 && pp.z > 5) {
      if (this._flankHunter(pp)) distP = Math.hypot(pp.x - ep.x, pp.z - ep.z);
      this._forceFlank = false;
      this._stalkDecisionT = 8 + Math.random() * 7;
    }

    // At range it becomes completely still under direct observation. Once it
    // is dangerously close, staring only slows it; escape remains necessary.
    if (seen && distP > 4.2) {
      this._stalkSeenT += dt;
      return;
    }
    this._stalkSeenT = 0;

    const grace = Math.min(this._huntT / 5, 1);
    const corruption = a.corruption || 0;
    const seenPenalty = seen ? 0.22 : 1;
    const speed = (1.75 + corruption * 1.65 + Math.min(this._huntT * 0.009, 0.7) + (this._rage || 0)) * grace * seenPenalty;
    const tgt = a.entityTarget(ep.x, ep.z, pp.x, pp.z);
    const dx = tgt.x - ep.x, dz = tgt.z - ep.z;
    const d = Math.hypot(dx, dz) || 1;
    const step = Math.min(d, speed * dt);
    const next = new THREE.Vector3(ep.x + (dx / d) * step, 0, ep.z + (dz / d) * step);
    a.resolve(next, 0.4);
    a.setEntity(next.x, next.z, Math.atan2(pp.x - ep.x, pp.z - ep.z));
    this._hunterMoved = step > 0.001;
  }

  _astralEntityInView(ep) {
    const cam = this.astral.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const to = new THREE.Vector3(ep.x - cam.position.x, 1.1 - cam.position.y, ep.z - cam.position.z);
    const dist = to.length();
    if (dist > 46) return false;
    return fwd.dot(to.normalize()) > 0.72;
  }

  _flankHunter(pp) {
    const a = this.astral, cam = a.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const side = Math.random() < 0.5 ? -1 : 1;
    const sideDist = 8 + Math.random() * 3.5;
    const foreDist = (a.corruption || 0) > 0.58 ? 2.5 : -2.5;
    const candidate = new THREE.Vector3(
      pp.x + right.x * side * sideDist + fwd.x * foreDist,
      0,
      pp.z + right.z * side * sideDist + fwd.z * foreDist,
    );
    a.resolve(candidate, 0.45);
    if (Math.hypot(candidate.x - pp.x, candidate.z - pp.z) < 5.5) return false;
    a.setEntity(candidate.x, candidate.z, Math.atan2(pp.x - candidate.x, pp.z - candidate.z));
    this.audio.whisperWord(side * 0.72);
    return true;
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
    let nearest = Infinity;
    for (const f of a.fragments) {
      if (!f.taken) nearest = Math.min(nearest, Math.hypot(pp.x - f.x, pp.z - f.z));
    }
    let msg;
    if (nearest < 9) msg = 'something of you is near';
    else if (z > 118) msg = 'the trees open toward home';
    else if (z > 100) msg = 'the graves are listening';
    else if (z > 86) msg = 'the water knows the way';
    else if (z > 16) msg = 'follow the road you remember';
    else if (z > 4.2) msg = 'your house is awake';
    else if (z > -11) msg = 'your breathing is behind the wall';
    else msg = a.fragmentsCollected >= a.fragmentTotal ? 'get inside your body' : 'it does not know you yet';
    const missing = a.fragmentTotal - a.fragmentsCollected;
    msg += missing ? '  ·  ' + missing + (missing === 1 ? ' piece missing' : ' pieces missing') : '  ·  whole';
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
    this.fx.fadeTo(1, 800);
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
    this.fx.fadeTo(1, 520);
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
    const rect = this.stage.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width || window.innerWidth));
    const h = Math.max(1, Math.round(rect.height || window.innerHeight));
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
