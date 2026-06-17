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
const { CONFIG, AudioEngine, ClampedLook, BedroomScene, FX, AstralScene, AstralControls, Post } = TW;

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
    // back to absolute-position look so the game is always playable
    document.addEventListener('pointerlockerror', () => {
      this._fallback = true;
      if (this.fx) this.fx.subtitle('move the mouse to look around', 4500);
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
      if (this.state === 'paralysis') this._pause();
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
  }

  _requestResume() {
    // Try to re-grab the lock; if it isn't available, resume anyway so the
    // pause menu can never trap the player.
    this.activeControls.requestLock();
    if (this._fallback || !this.renderer.domElement.requestPointerLock) this._resume();
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
    this._setupParalysis();

    // Audio initialises in the background; it must never block game start.
    this.audio.unlock()
      .then(() => { this.audio.startDrone(41); this.audio.startBreathing(5.6); })
      .catch(() => {});

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
    };
    // anomalies escalate, then the entity arrives
    this._anomalies = [
      { t: 6,  fn: () => { this.audio.creak(); this.bedroom.setDoor(0.17); } },
      { t: 13, fn: () => { this.audio.creak(); this.bedroom.setWardrobe(0.32); } },
      { t: 20, fn: () => { this.audio.tinnitus(7000, 4); this.bedroom.flicker(0.6); } },
      { t: 27, fn: () => { this.audio.knock(); this.bedroom.setDoor(0.4); this.fx.subtitle('the door was closed', 3200); } },
      { t: 34, fn: () => { this.bedroom.flicker(0.5); this.audio.knock(); } },
      { t: 39, fn: () => { this._activateEntity(); this.fx.subtitle('there is someone in the room', 4000); } },
    ];
  }

  _onLockChange(locked) {
    if (locked && this.state === 'paused') this._resume();
    else if (!locked && (this.state === 'paralysis' || this.state === 'astral')) this._pause();
  }

  _pause() {
    if (this.state !== 'paralysis' && this.state !== 'astral') return;
    this._prePause = this.state;
    this.state = 'paused';
    this.activeControls.enabled = false;
    this.audio.suspend();
    document.body.classList.remove('playing');
    show('scr-pause', true);
  }

  _resume() {
    show('scr-pause', false);
    document.body.classList.add('playing');
    this.activeControls.enabled = true;
    this.audio.resume();
    this.state = this._prePause || 'paralysis';
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
    p.blinking = true; p.blinkT = 0;
    p.blinkDur = forced ? 0.6 : 0.3;
    p.blinkPressure = 0;
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
    this.post = new Post(this.renderer);
    this.post.setSize(window.innerWidth, window.innerHeight);

    this.astral.setEntity(this.astral.entityStart.x, this.astral.entityStart.z, 0);
    this._huntT = 0;
    this._astralProx = 0;
    this._stepTimer = 0;

    // audio: ambient drone continues; breath turns to panic, the hunt resumes
    this.audio.setBreathRate(3.8);
    this.audio.startWhispers();
    this.audio.startHeartbeat(72);

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

    this._updateObjective(pp);

    // win: reach your body — lose: it catches you
    const bp = a.bodyPosition;
    if (Math.hypot(pp.x - bp.x, pp.z - bp.z) < 1.5) return this._escaped();
    if (dist < 0.95) return this._caught();
  }

  _huntEntity(dt) {
    const a = this.astral, ep = a.entityPos, pp = this.astralControls.position;
    this._huntT += dt;
    const distP = Math.hypot(pp.x - ep.x, pp.z - ep.z);
    // base + slow ramp + rubber-band: it surges when you pull away and eases
    // off up close, so a long chase stays on your heels without being unfair
    const speed = 2.8 + Math.min(this._huntT * 0.018, 1.0) + Math.min(distP * 0.05, 1.9);
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
    const z = pp.z;
    let msg;
    if (z > 55) msg = 'run';
    else if (z > 16) msg = 'follow the road home';
    else if (z > 4.2) msg = 'get to your house';
    else if (z > -11) msg = 'find your bedroom';
    else msg = 'reach your body';
    if (msg !== this._objMsg) { this._objMsg = msg; this._objEl.textContent = msg; }
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
    this._showEnd('✶', 'YOU WAKE UP',
      '3:47 AM. The room is still.\nYou are back inside your own skin — for now.',
      'rainbot after dark · no. 002', 'sleep is DLC');
  }

  _caught() {
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
    this._showEnd('☓', 'IT HAS YOU',
      'You never made it back.\nThe body in the bed does not wake.',
      'rainbot after dark · no. 002', 'try to wake again');
  }

  _showEnd(icon, title, sub, stats, warn) {
    if (document.exitPointerLock) document.exitPointerLock();  // free the cursor
    this.audio.stopBreathing();
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
