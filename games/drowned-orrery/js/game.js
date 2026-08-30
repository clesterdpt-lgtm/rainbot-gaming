(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const dom = {
    shell: $("game-shell"),
    canvas: $("game-canvas"),
    boot: $("boot-screen"),
    bootMeter: $("boot-meter"),
    bootStatus: $("boot-status"),
    menu: $("menu-screen"),
    start: $("start-button"),
    controls: $("controls-button"),
    controlsScreen: $("controls-screen"),
    controlsClose: $("controls-close"),
    hud: $("hud"),
    objective: $("objective-text"),
    objectiveCard: $("objective-card"),
    objectiveCardText: $("objective-card-text"),
    lensCount: $("lens-count"),
    lenses: [$("lens-1"), $("lens-2"), $("lens-3")],
    healthOrbit: $("health-orbit"),
    healthNumber: $("health-number"),
    chargeMeter: $("charge-meter"),
    chargeNumber: $("charge-number"),
    bearing: $("bearing-marker"),
    prompt: $("context-prompt"),
    subtitle: $("subtitle"),
    toastFeed: $("toast-feed"),
    bossHud: $("boss-hud"),
    bossMeter: $("boss-meter"),
    bossInstruction: $("boss-instruction"),
    lockReticle: $("lock-reticle"),
    damage: $("damage-flash"),
    prism: $("prism-flash"),
    pause: $("pause-screen"),
    resume: $("resume-button"),
    restart: $("restart-button"),
    volume: $("volume-slider"),
    motion: $("motion-toggle"),
    end: $("end-screen"),
    endTime: $("end-time"),
    replay: $("replay-button"),
    fullscreen: $("fullscreen-button"),
    quality: $("quality-badge"),
    performance: $("performance-readout"),
    touch: $("touch-ui"),
    touchStick: $("touch-stick"),
    touchKnob: $("touch-knob"),
  };

  const query = new URLSearchParams(location.search);
  const qaMode = query.get("qa") || "";
  const debugMode = query.get("debug") === "1";
  const systemReduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarsePointer = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
  const TAU = Math.PI * 2;
  const IDLE_FRAME_INTERVAL = 1000 / 24;

  let renderer;
  let scene;
  let camera;
  let world;
  let hero;
  let audio;
  let mode = "boot";
  let quality = 2;
  let animationId = 0;
  let previousFrame = performance.now();
  let lastIdleFrame = 0;
  let elapsed = 0;
  let missionElapsed = 0;
  let restored = false;
  let cinematicTimer = 0;
  let endingTimer = 0;
  let subtitleTimer = 0;
  let damageTimer = 0;
  let footstepTimer = 0;
  let cameraShake = 0;
  let frameAccumulator = 0;
  let frameCount = 0;
  let displayedFps = 60;
  let hitStopTimer = 0;
  let disposed = false;
  let hasPointerLocked = false;
  let pointerLockSuppressed = false;
  let reducedMotion = systemReduceMotion;
  let currentObjective = "WAKE THE MERIDIAN LENSES";
  let activeMechanisms = 0;
  let boss = null;
  let bossStarted = false;
  let bossShardGeometry = null;
  let bossShardMaterials = null;
  let checkpoint = new THREE.Vector3(0, 0, 68);
  let lockedTarget = null;

  const enemies = [];
  const effects = [];
  const projectiles = [];
  const tempA = new THREE.Vector3();
  const tempB = new THREE.Vector3();
  const tempC = new THREE.Vector3();
  const temp2 = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const audioFallbacks = Object.freeze({
    bosscharge: "charge",
    bossdeath: "enemydeath",
    bossslam: "bossattack",
    bossvolley: "bossattack",
    enemycharge: "charge",
    enemylunge: "attack",
    jump: "land",
    playerdown: "hurt",
  });

  const input = {
    keys: new Set(),
    moveX: 0,
    moveY: 0,
    lookX: 0,
    lookY: 0,
    attack: false,
    attackQueued: false,
    guard: false,
    mouseGuard: false,
    guardPressed: false,
    dodge: false,
    jump: false,
    pulse: false,
    interact: false,
    lock: false,
    gamepadButtons: [],
    gamepadX: 0,
    gamepadY: 0,
    touchMoveX: 0,
    touchMoveY: 0,
  };

  const player = {
    position: new THREE.Vector3(0, 0, 68),
    velocity: new THREE.Vector3(),
    yaw: 0,
    grounded: true,
    health: 5,
    maxHealth: 5,
    charge: 100,
    attackTimer: 0,
    attackDuration: 0.68,
    attackCombo: 0,
    attackHit: false,
    attackQueued: false,
    dodgeTimer: 0,
    dodgeCooldown: 0,
    invulnerable: 0,
    guarding: false,
    parryTimer: 0,
    hurtTimer: 0,
    interactTimer: 0,
    deadTimer: 0,
    lastMoveSpeed: 0,
  };

  const cameraState = {
    yaw: 0,
    pitch: 0.13,
    distance: 7.8,
    currentTarget: new THREE.Vector3(),
    desiredTarget: new THREE.Vector3(),
    currentPosition: new THREE.Vector3(0, 6, 78),
    forward: new THREE.Vector3(0, 0, -1),
    right: new THREE.Vector3(1, 0, 0),
  };

  function setBoot(progress, status) {
    dom.bootMeter.style.width = clamp(progress, 2, 100) + "%";
    dom.bootStatus.textContent = status;
  }

  function chooseQuality() {
    const requested = query.get("quality");
    if (requested === "low") return 0;
    if (requested === "medium") return 1;
    if (requested === "high") return 2;
    const memory = navigator.deviceMemory || 8;
    const cores = navigator.hardwareConcurrency || 8;
    if (coarsePointer || memory <= 4 || cores <= 4 || innerWidth < 740) return 1;
    return 2;
  }

  function showFatal(message) {
    mode = "fatal";
    cancelAnimationFrame(animationId);
    dom.shell.className = "game-shell is-booting";
    dom.bootStatus.textContent = message;
    dom.bootStatus.style.color = "#f0644d";
    dom.bootMeter.style.width = "100%";
    dom.bootMeter.style.background = "#f0644d";
    console.error("[The Drowned Orrery]", message);
  }

  function configureRenderer() {
    renderer = new THREE.WebGLRenderer({
      canvas: dom.canvas,
      antialias: quality > 0,
      alpha: false,
      powerPreference: "high-performance",
      precision: "highp",
      stencil: false,
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality === 2 ? 1.6 : 1.25));
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.setClearColor(0x081821, 1);
    renderer.shadowMap.enabled = quality > 0;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.14;
    renderer.physicallyCorrectLights = true;
    dom.canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      pauseGame(true);
      showSubtitle("INSTRUMENT", "The rendering signal was interrupted.", 8000);
    });
    dom.canvas.addEventListener("webglcontextrestored", () => location.reload());
  }

  async function initialize() {
    try {
      if (!window.THREE || !window.DrownedWorld || !window.DrownedActors || !window.DrownedAudio) {
        throw new Error("One or more local game systems did not load.");
      }
      quality = chooseQuality();
      dom.quality.textContent = "CELESTIAL // " + (quality === 2 ? "HIGH" : quality === 1 ? "MEDIUM" : "LOW");
      setBoot(10, "MEASURING THE STORM");
      configureRenderer();

      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0b202a);
      camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.08, 360);
      camera.position.copy(cameraState.currentPosition);

      setBoot(28, "RAISING THE ROOTS");
      world = DrownedWorld.create(THREE, scene, renderer, {
        quality: quality === 2 ? "high" : quality === 1 ? "medium" : "low",
        reduceMotion: reducedMotion,
      });

      if (window.DrownedGoldAssets && typeof window.DrownedGoldAssets.preload === "function") {
        setBoot(44, "RECOVERING THE MERIDIAN LOCK");
        try {
          await window.DrownedGoldAssets.preload(THREE);
          if (typeof window.DrownedGoldAssets.attachGateVisual === "function") {
            window.DrownedGoldAssets.attachGateVisual(THREE, world.gate);
          }
        } catch (error) {
          console.warn("[The Drowned Orrery] Gold slice unavailable; continuing with procedural art.", error);
        }
      }

      setBoot(56, "ASSEMBLING THE CARTOGRAPHER");
      hero = DrownedActors.createHero(THREE);
      player.position.set(0, world.heightAt(0, 68), 68);
      checkpoint.copy(player.position);
      hero.root.position.copy(player.position);
      scene.add(hero.root);

      setBoot(72, "WAKING THE HOLLOW");
      createEncounterPopulation();
      audio = new DrownedAudio();
      dom.volume.value = String(audio.volume == null ? 0.76 : audio.volume);

      createEventBindings();
      resize();
      setBoot(92, "ALIGNING THE MERIDIAN");

      world.update(0, 0, { restored: false, activeMechanisms: 0 });
      updateCamera(1 / 60, true);
      renderer.compile(scene, camera);
      setBoot(100, "THE VALLEY IS LISTENING");

      setTimeout(() => {
        if (disposed) return;
        mode = "menu";
        dom.shell.className = "game-shell is-menu";
        if (qaMode) startGame(true);
      }, 620);
      animate(performance.now());
    } catch (error) {
      console.error(error);
      showFatal(error && error.message ? error.message : "The Orrery could not be opened.");
    }
  }

  function createEventBindings() {
    dom.start.addEventListener("click", () => startGame(false));
    dom.controls.addEventListener("click", () => {
      dom.controlsScreen.classList.add("is-visible");
      dom.controlsScreen.setAttribute("aria-hidden", "false");
      safeAudio("uimove");
    });
    dom.controlsClose.addEventListener("click", closeControls);
    dom.controlsScreen.addEventListener("click", (event) => {
      if (event.target === dom.controlsScreen) closeControls();
    });
    dom.resume.addEventListener("click", resumeGame);
    dom.restart.addEventListener("click", restartGame);
    dom.replay.addEventListener("click", restartGame);
    dom.volume.addEventListener("input", () => audio && audio.setVolume(Number(dom.volume.value)));
    dom.motion.checked = reducedMotion;
    dom.motion.addEventListener("change", () => { reducedMotion = dom.motion.checked; });
    dom.fullscreen.addEventListener("click", toggleFullscreen);

    window.addEventListener("resize", resize);
    window.addEventListener("blur", () => {
      if (mode === "playing" && !qaMode) pauseGame(true);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && mode === "playing") pauseGame(true);
    });
    document.addEventListener("fullscreenchange", resize);
    document.addEventListener("pointerlockchange", () => {
      const locked = document.pointerLockElement === dom.canvas;
      if (locked) hasPointerLocked = true;
      if (!locked && hasPointerLocked && mode === "playing" && !pointerLockSuppressed && !coarsePointer && !qaMode) {
        pauseGame(true);
      }
    });

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    dom.canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mousemove", onMouseMove);
    dom.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    dom.canvas.addEventListener("click", () => {
      if (mode === "playing" && !coarsePointer && document.pointerLockElement !== dom.canvas) requestPointerLock();
    });

    bindTouchControls();
  }

  function closeControls() {
    dom.controlsScreen.classList.remove("is-visible");
    dom.controlsScreen.setAttribute("aria-hidden", "true");
    safeAudio("back");
  }

  function onKeyDown(event) {
    input.keys.add(event.code);
    if (["Tab", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault();
    if (event.repeat) return;
    if (event.code === "Escape") {
      if (dom.controlsScreen.classList.contains("is-visible")) closeControls();
      else if (mode === "playing") pauseGame(false);
      else if (mode === "paused") resumeGame();
      return;
    }
    if (mode === "menu" && (event.code === "Enter" || event.code === "Space")) {
      startGame(false);
      return;
    }
    if (mode !== "playing") return;
    if (event.code === "KeyE") input.interact = true;
    if (event.code === "KeyQ") input.pulse = true;
    if (event.code === "Tab") input.lock = true;
    if (event.code === "ControlLeft" || event.code === "ControlRight") input.dodge = true;
    if (event.code === "Space") input.jump = true;
  }

  function onKeyUp(event) {
    input.keys.delete(event.code);
  }

  function onMouseDown(event) {
    if (mode !== "playing") return;
    if (event.button === 0) {
      input.attack = true;
      if (player.attackTimer > 0) player.attackQueued = true;
    } else if (event.button === 2) {
      input.mouseGuard = true;
      input.guard = true;
      input.guardPressed = true;
    }
  }

  function onMouseUp(event) {
    if (event.button === 2) {
      input.mouseGuard = false;
      input.guard = false;
    }
  }

  function onMouseMove(event) {
    if (mode !== "playing") return;
    if (document.pointerLockElement === dom.canvas) {
      input.lookX += event.movementX;
      input.lookY += event.movementY;
    }
  }

  function bindTouchControls() {
    let stickId = null;
    let stickRect = null;
    let cameraTouchId = null;
    let cameraLastX = 0;
    let cameraLastY = 0;

    dom.touchStick.addEventListener("pointerdown", (event) => {
      stickId = event.pointerId;
      stickRect = dom.touchStick.getBoundingClientRect();
      dom.touchStick.setPointerCapture(event.pointerId);
      updateStick(event);
    });
    dom.touchStick.addEventListener("pointermove", (event) => {
      if (event.pointerId === stickId) updateStick(event);
    });
    const releaseStick = (event) => {
      if (event.pointerId !== stickId) return;
      stickId = null;
      input.touchMoveX = 0;
      input.touchMoveY = 0;
      dom.touchKnob.style.transform = "translate(0px, 0px)";
    };
    dom.touchStick.addEventListener("pointerup", releaseStick);
    dom.touchStick.addEventListener("pointercancel", releaseStick);

    function updateStick(event) {
      if (!stickRect) return;
      const centerX = stickRect.left + stickRect.width / 2;
      const centerY = stickRect.top + stickRect.height / 2;
      let dx = event.clientX - centerX;
      let dy = event.clientY - centerY;
      const radius = stickRect.width * 0.34;
      const length = Math.hypot(dx, dy);
      if (length > radius) {
        dx = dx / length * radius;
        dy = dy / length * radius;
      }
      input.touchMoveX = dx / radius;
      input.touchMoveY = dy / radius;
      dom.touchKnob.style.transform = "translate(" + dx + "px, " + dy + "px)";
    }

    dom.touch.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        const action = button.dataset.action;
        if (action === "pause") pauseGame(false);
        if (action === "attack") input.attack = true;
        if (action === "dodge") input.dodge = true;
        if (action === "pulse") input.pulse = true;
        if (action === "interact") input.interact = true;
      });
    });

    dom.canvas.addEventListener("pointerdown", (event) => {
      if (!coarsePointer || mode !== "playing" || event.clientX < innerWidth * 0.42) return;
      cameraTouchId = event.pointerId;
      cameraLastX = event.clientX;
      cameraLastY = event.clientY;
      dom.canvas.setPointerCapture(event.pointerId);
    });
    dom.canvas.addEventListener("pointermove", (event) => {
      if (event.pointerId !== cameraTouchId) return;
      input.lookX += (event.clientX - cameraLastX) * 2.2;
      input.lookY += (event.clientY - cameraLastY) * 2.2;
      cameraLastX = event.clientX;
      cameraLastY = event.clientY;
    });
    const releaseCamera = (event) => {
      if (event.pointerId === cameraTouchId) cameraTouchId = null;
    };
    dom.canvas.addEventListener("pointerup", releaseCamera);
    dom.canvas.addEventListener("pointercancel", releaseCamera);
  }

  function requestPointerLock() {
    if (coarsePointer || qaMode) return;
    pointerLockSuppressed = false;
    const request = dom.canvas.requestPointerLock && dom.canvas.requestPointerLock();
    if (request && typeof request.catch === "function") request.catch(() => {});
  }

  function startGame(automatic) {
    if (mode !== "menu" && mode !== "boot") return;
    closeControls();
    mode = "playing";
    missionElapsed = 0;
    cinematicTimer = reducedMotion ? 0.35 : 3.4;
    dom.shell.className = "game-shell is-playing is-cinematic";
    safeAudio("startgame");
    if (audio) {
      const started = audio.start();
      if (started && typeof started.catch === "function") started.catch(() => {});
    }
    if (!automatic) requestPointerLock();
    currentObjective = "WAKE THE MERIDIAN LENSES";
    dom.objective.textContent = currentObjective;
    showSubtitle("VEY", "Three lenses. One buried axis. Let us see what the storm tried to hide.", 4200);
    if (qaMode) applyQaMode();
  }

  function applyQaMode() {
    if (qaMode === "vista") {
      cinematicTimer = 0;
      player.position.set(-3.5, world.heightAt(-3.5, 56), 56);
      cameraState.yaw = 0.03;
      cameraState.pitch = 0.11;
      enemies.forEach((enemy) => { enemy.root.visible = false; enemy.disabled = true; });
      dom.shell.classList.remove("is-cinematic");
      dom.shell.classList.add("is-qa-vista");
      dom.subtitle.classList.remove("is-visible");
      dom.objectiveCard.classList.remove("is-visible");
    } else if (qaMode === "mechanism") {
      cinematicTimer = 0;
      const firstMechanism = world.mechanisms[0];
      const mechanismPosition = firstMechanism.position || firstMechanism.root.position;
      player.position.copy(mechanismPosition);
      player.position.z += 3.1;
      player.position.y = world.heightAt(player.position.x, player.position.z);
      cameraState.yaw = 0;
      cameraState.pitch = 0.12;
      enemies.forEach((enemy) => { enemy.root.visible = false; enemy.disabled = true; });
      dom.shell.classList.remove("is-cinematic");
    } else if (qaMode === "gate" || qaMode === "gate-open") {
      cinematicTimer = 0;
      player.position.set(-2.7, world.heightAt(-2.7, -17.5), -17.5);
      player.yaw = 0;
      cameraState.yaw = -0.02;
      cameraState.pitch = 0.12;
      cameraState.distance = 9.8;
      world.gate.setOpen(qaMode === "gate-open");
      if (world.orrery) world.orrery.visible = false;
      world.mechanisms.forEach((mechanism) => { mechanism.root.visible = false; });
      enemies.forEach((enemy) => { enemy.root.visible = false; enemy.disabled = true; });
      dom.shell.classList.remove("is-cinematic");
      dom.objectiveCard.classList.remove("is-visible");
      dom.subtitle.classList.remove("is-visible");
    } else if (qaMode === "combat") {
      cinematicTimer = 0;
      player.position.set(-3.1, world.heightAt(-3.1, -20.5), -20.5);
      player.yaw = 0.28;
      cameraState.yaw = 0.2;
      cameraState.pitch = 0.11;
      cameraState.distance = 9.4;
      world.gate.setOpen(false);
      if (world.orrery) world.orrery.visible = false;
      world.mechanisms.forEach((mechanism) => { mechanism.root.visible = false; });
      const combatTarget = enemies.find((enemy) => enemy.kind === "warden");
      enemies.forEach((enemy) => {
        const featured = enemy === combatTarget;
        enemy.disabled = true;
        enemy.root.visible = featured;
        if (featured) {
          enemy.position.set(-1.2, world.heightAt(-1.2, -22.6), -22.6);
          enemy.root.position.copy(enemy.position);
          enemy.facing = Math.atan2(player.position.x - enemy.position.x, -(player.position.z - enemy.position.z));
          enemy.root.rotation.y = -enemy.facing;
          enemy.disabled = false;
          enemy.qaFrozen = true;
          enemy.alert = 1;
          DrownedActors.updateEnemy(enemy.actor, { speed: 0, alert: 1, facing: -enemy.facing }, 1 / 60, elapsed);
        }
      });
      lockedTarget = null;
      dom.shell.classList.remove("is-cinematic");
      dom.objectiveCard.classList.remove("is-visible");
      dom.subtitle.classList.remove("is-visible");
    } else if (qaMode === "boss") {
      activateAllMechanisms();
      // Stage the deterministic review shot just inside the front monoliths.
      // The centered ritual-axis sightline keeps both full silhouettes clear
      // and turns the floor inlays into leading lines instead of visual noise.
      player.position.set(0, world.heightAt(0, -55.5), -55.5);
      player.yaw = 0;
      cameraState.yaw = 0;
      cameraState.pitch = 0.1;
      cameraState.distance = 13.4;
      startBossBattle(true);
      cinematicTimer = 0;
      if (boss) {
        // Keep the critic view repeatable: preserve the authored idle motion,
        // but hold the encounter lead on-axis so target lock cannot pan back
        // toward either foreground monolith while screenshots are settling.
        boss.state = "intro";
        boss.stateTimer = 3600;
      }
      dom.shell.classList.remove("is-cinematic");
      dom.objectiveCard.classList.remove("is-visible");
      dom.subtitle.classList.remove("is-visible");
    } else if (qaMode === "finale") {
      cinematicTimer = 0;
      activateAllMechanisms();
      player.position.set(3, world.heightAt(3, -62), -62);
      missionElapsed = 9 * 60 + 37;
      completeExpedition(true);
    }
    hero.root.position.copy(player.position);
    updateCamera(1 / 60, true);
  }

  function pauseGame(fromSystem) {
    if (mode !== "playing") return;
    mode = "paused";
    resetHeldInput();
    dom.shell.className = "game-shell is-paused" + (bossStarted && boss && !boss.dead ? " is-boss" : "");
    dom.pause.setAttribute("aria-hidden", "false");
    pointerLockSuppressed = true;
    if (document.pointerLockElement) document.exitPointerLock();
    pointerLockSuppressed = false;
    if (audio) audio.pause();
    if (!fromSystem) safeAudio("back");
  }

  function resumeGame() {
    if (mode !== "paused") return;
    mode = "playing";
    dom.shell.className = "game-shell is-playing"
      + (cinematicTimer > 0 ? " is-cinematic" : "")
      + (bossStarted && boss && !boss.dead ? " is-boss" : "");
    dom.pause.setAttribute("aria-hidden", "true");
    previousFrame = performance.now();
    if (audio) audio.resume().catch(() => {});
    requestPointerLock();
  }

  function restartGame() {
    const url = new URL(location.href);
    url.searchParams.delete("qa");
    url.searchParams.set("fresh", "1");
    location.href = url.toString();
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      const result = dom.shell.requestFullscreen && dom.shell.requestFullscreen();
      if (result && result.catch) result.catch(() => {});
    } else {
      document.exitFullscreen();
    }
  }

  function resize() {
    if (!renderer || !camera) return;
    camera.aspect = innerWidth / Math.max(1, innerHeight);
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality === 2 ? 1.6 : 1.25));
    renderer.setSize(innerWidth, innerHeight, false);
  }

  function createEncounterPopulation() {
    spawnEnemy("rootbound", -5.5, 40, 0);
    spawnEnemy("rootbound", 8.8, 31, 1);
    spawnEnemy("rootbound", -18.5, 17, 2);
    spawnEnemy("warden", 20.5, -2, 0);
    spawnEnemy("rootbound", -8, -14, 3);
    spawnEnemy("warden", 4, -28, 1);
  }

  function spawnEnemy(kind, x, z, variant) {
    const actor = kind === "warden"
      ? DrownedActors.createWarden(THREE, variant)
      : DrownedActors.createRootbound(THREE, variant);
    const position = new THREE.Vector3(x, world.heightAt(x, z), z);
    actor.root.position.copy(position);
    scene.add(actor.root);
    const enemy = {
      actor,
      root: actor.root,
      kind,
      position,
      velocity: new THREE.Vector3(),
      hp: kind === "warden" ? 4 : 2,
      maxHp: kind === "warden" ? 4 : 2,
      state: "idle",
      stateTimer: 0,
      attackTimer: 0,
      attackHit: false,
      cooldown: 0.5 + Math.random(),
      hurtTimer: 0,
      staggerTimer: 0,
      dead: false,
      disabled: false,
      alert: 0,
      facing: 0,
      speed: 0,
    };
    enemies.push(enemy);
    return enemy;
  }

  function activateAllMechanisms() {
    world.mechanisms.forEach((mechanism) => {
      if (!mechanism.active) mechanism.activate();
      mechanism.active = true;
    });
    activeMechanisms = 3;
    world.gate.setOpen(true);
    updateLensHud();
  }

  function pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && Array.from(pads).find(Boolean);
    if (!pad) {
      input.gamepadX = 0;
      input.gamepadY = 0;
      input.guard = input.mouseGuard;
      input.gamepadButtons = [];
      return;
    }
    const dead = (value) => Math.abs(value) > 0.16 ? value : 0;
    const axisX = dead(pad.axes[0] || 0);
    const axisY = dead(pad.axes[1] || 0);
    input.gamepadX = axisX;
    input.gamepadY = axisY;
    input.lookX += dead(pad.axes[2] || 0) * 14;
    input.lookY += dead(pad.axes[3] || 0) * 11;

    const previousButtons = input.gamepadButtons;
    const nextButtons = pad.buttons.map((button) => button.pressed);
    const pressed = (index) => !!nextButtons[index];
    const justPressed = (index) => pressed(index) && !previousButtons[index];

    if (justPressed(9)) {
      input.gamepadButtons = nextButtons;
      if (mode === "playing") pauseGame(false);
      else if (mode === "paused") resumeGame();
      else if (mode === "menu") startGame(false);
      return;
    }
    if (mode === "menu" && justPressed(0)) {
      input.gamepadButtons = nextButtons;
      startGame(false);
      return;
    }
    if (mode === "paused" && justPressed(0)) {
      input.gamepadButtons = nextButtons;
      resumeGame();
      return;
    }
    if (mode === "ended" && justPressed(0)) {
      input.gamepadButtons = nextButtons;
      restartGame();
      return;
    }
    if (mode !== "playing") {
      input.gamepadButtons = nextButtons;
      input.gamepadX = 0;
      input.gamepadY = 0;
      input.guard = input.mouseGuard;
      return;
    }
    if (justPressed(0)) input.jump = true;
    if (justPressed(2)) input.attack = true;
    if (justPressed(1)) input.dodge = true;
    if (justPressed(3)) input.pulse = true;
    if (justPressed(5)) input.lock = true;
    if (justPressed(12)) input.interact = true;
    input.guard = input.mouseGuard || pressed(6);
    if (pressed(6) && !previousButtons[6]) input.guardPressed = true;
    input.gamepadButtons = nextButtons;
  }

  function readMovementInput() {
    let x = 0;
    let y = 0;
    if (input.keys.has("KeyA") || input.keys.has("ArrowLeft")) x -= 1;
    if (input.keys.has("KeyD") || input.keys.has("ArrowRight")) x += 1;
    if (input.keys.has("KeyW") || input.keys.has("ArrowUp")) y -= 1;
    if (input.keys.has("KeyS") || input.keys.has("ArrowDown")) y += 1;
    x += input.touchMoveX;
    y += input.touchMoveY;
    x += input.gamepadX;
    y += input.gamepadY;
    input.moveX = clamp(x, -1, 1);
    input.moveY = clamp(y, -1, 1);
  }

  function updatePlayer(dt) {
    readMovementInput();
    if (input.lock) toggleTargetLock();
    player.interactTimer = Math.max(0, player.interactTimer - dt);

    cameraState.yaw += input.lookX * 0.0017;
    cameraState.pitch = clamp(cameraState.pitch + input.lookY * 0.00135, 0.05, 0.78);
    input.lookX = 0;
    input.lookY = 0;

    if (player.deadTimer > 0) {
      player.deadTimer -= dt;
      if (player.deadTimer <= 0) revivePlayer();
      updateHeroVisual(dt);
      clearTransientInput();
      return;
    }

    player.invulnerable = Math.max(0, player.invulnerable - dt);
    player.dodgeCooldown = Math.max(0, player.dodgeCooldown - dt);
    player.hurtTimer = Math.max(0, player.hurtTimer - dt);
    player.parryTimer = Math.max(0, player.parryTimer - dt);
    player.charge = Math.min(100, player.charge + dt * (bossStarted ? 10 : 7));
    player.guarding = input.guard && player.attackTimer <= 0 && player.dodgeTimer <= 0;
    if (input.guardPressed && player.guarding) player.parryTimer = 0.2;

    const controlsEnabled = cinematicTimer <= 0.25 && mode === "playing";
    if (controlsEnabled && input.pulse) usePrismPulse();
    if (controlsEnabled && input.dodge) beginDodge();
    if (controlsEnabled && input.attack) beginAttack();
    if (controlsEnabled && input.interact) tryInteract();

    cameraState.forward.set(Math.sin(cameraState.yaw), 0, -Math.cos(cameraState.yaw));
    cameraState.right.set(Math.cos(cameraState.yaw), 0, Math.sin(cameraState.yaw));
    const move = tempA.set(0, 0, 0);
    if (controlsEnabled && player.attackTimer <= 0 && player.hurtTimer <= 0) {
      move.addScaledVector(cameraState.right, input.moveX);
      move.addScaledVector(cameraState.forward, -input.moveY);
      if (move.lengthSq() > 1) move.normalize();
    }

    const sprinting = (input.keys.has("ShiftLeft") || input.keys.has("ShiftRight")) && move.lengthSq() > 0.1;
    let targetSpeed = sprinting ? 9.2 : 5.8;
    if (player.guarding) targetSpeed *= 0.42;
    if (player.attackTimer > 0) targetSpeed *= 0.28;
    if (player.interactTimer > 0) targetSpeed *= 0.18;

    if (player.dodgeTimer > 0) {
      player.dodgeTimer -= dt;
      const phase = 1 - player.dodgeTimer / 0.47;
      targetSpeed = 13.5 * (1 - phase * 0.42);
      const dodgeDir = player.velocity.lengthSq() > 0.2 ? tempB.copy(player.velocity).setY(0).normalize() : directionFromYaw(player.yaw, tempB);
      player.velocity.x = dodgeDir.x * targetSpeed;
      player.velocity.z = dodgeDir.z * targetSpeed;
    } else {
      const accel = move.lengthSq() > 0.01 ? 13 : 9;
      player.velocity.x = damp(player.velocity.x, move.x * targetSpeed, accel, dt);
      player.velocity.z = damp(player.velocity.z, move.z * targetSpeed, accel, dt);
      if (move.lengthSq() > 0.08 && player.attackTimer <= 0 && !lockedTarget) {
        player.yaw = dampAngle(player.yaw, Math.atan2(move.x, -move.z), 13, dt);
      }
      if (lockedTarget && !lockedTarget.dead) {
        tempB.subVectors(lockedTarget.position, player.position);
        player.yaw = dampAngle(player.yaw, Math.atan2(tempB.x, -tempB.z), 15, dt);
      }
    }

    if (controlsEnabled && input.jump && player.grounded && player.dodgeTimer <= 0) {
      player.velocity.y = 6.3;
      player.grounded = false;
      safeAudio("jump");
    }
    player.velocity.y -= 17 * dt;

    const previous = tempA.copy(player.position);
    const desired = tempB.copy(player.position).addScaledVector(player.velocity, dt);
    const resolved = world.resolvePosition(previous, desired, 0.55);
    const groundY = world.heightAt(resolved.x, resolved.z);
    if (desired.y <= groundY) {
      resolved.y = groundY;
      player.velocity.y = Math.max(0, player.velocity.y);
      player.grounded = true;
    } else {
      resolved.y = desired.y;
      player.grounded = false;
    }
    player.position.copy(resolved);

    if (bossStarted && boss && !boss.dead) {
      const distanceFromCenter = horizontalDistance(player.position, world.arena.center);
      if (distanceFromCenter > world.arena.radius - 1.1) {
        tempB.subVectors(player.position, world.arena.center).setY(0).normalize();
        player.position.copy(world.arena.center).addScaledVector(tempB, world.arena.radius - 1.1);
        player.position.y = world.heightAt(player.position.x, player.position.z);
      }
    }

    player.lastMoveSpeed = Math.hypot(player.velocity.x, player.velocity.z) / 9.2;
    if (player.grounded && player.lastMoveSpeed > 0.24 && player.attackTimer <= 0 && player.dodgeTimer <= 0) {
      footstepTimer -= dt * (sprinting ? 1.45 : 1);
      if (footstepTimer <= 0) {
        footstepTimer = sprinting ? 0.31 : 0.43;
        safeAudio("footstep", { volume: sprinting ? 0.52 : 0.34, pan: clamp(player.position.x / 45, -0.5, 0.5) });
        if (quality > 0) spawnGroundPuff(player.position, 2);
      }
    }

    updateAttack(dt);
    updateHeroVisual(dt);
    hero.root.position.copy(player.position);
    updateContextPrompt();
    clearTransientInput();
  }

  function beginAttack() {
    if (player.dodgeTimer > 0 || player.hurtTimer > 0 || player.guarding) return;
    if (player.attackTimer > 0) {
      player.attackQueued = true;
      return;
    }
    player.attackCombo = player.attackCombo % 3 + 1;
    player.attackDuration = player.attackCombo === 3 ? 0.88 : 0.68;
    player.attackTimer = player.attackDuration;
    player.attackHit = false;
    if (lockedTarget && !lockedTarget.dead) {
      tempA.subVectors(lockedTarget.position, player.position);
      player.yaw = Math.atan2(tempA.x, -tempA.z);
    }
    safeAudio(player.attackCombo === 3 ? "chargedattack" : "attack", { volume: 0.72 });
    spawnSlashArc(player.attackCombo);
  }

  function updateAttack(dt) {
    if (player.attackTimer <= 0) return;
    player.attackTimer -= dt;
    const progress = 1 - player.attackTimer / player.attackDuration;
    if (!player.attackHit && progress >= (player.attackCombo === 3 ? 0.41 : 0.33)) {
      player.attackHit = true;
      performMeleeHit(player.attackCombo === 3 ? 2 : 1, player.attackCombo === 3 ? 3.45 : 3.0);
    }
    if (player.attackTimer <= 0) {
      if (player.attackQueued) {
        player.attackQueued = false;
        beginAttack();
      } else {
        player.attackCombo = 0;
      }
    }
  }

  function performMeleeHit(damage, range) {
    const forward = directionFromYaw(player.yaw, tempA);
    let connected = false;
    const targets = boss && !boss.dead ? enemies.concat([boss]) : enemies;
    targets.forEach((enemy) => {
      if (!enemy || enemy.dead || enemy.disabled) return;
      tempB.subVectors(enemy.position, player.position).setY(0);
      const distance = tempB.length();
      if (distance > range) return;
      const dot = distance > 0.001 ? tempB.normalize().dot(forward) : 1;
      if (dot < -0.05) return;
      if (enemy === boss && boss.state !== "stagger") {
        spawnImpact(enemy.position, 0x72e0db, 5);
        safeAudio("guard");
        if (progressiveHintAllowed()) showSubtitle("VEY", "The plates are phase-locked. The prism must catch them while they converge.", 2200);
        return;
      }
      connected = true;
      damageEnemy(enemy, damage, "melee");
    });
    if (connected) {
      player.charge = Math.min(100, player.charge + 7);
      cameraShake = Math.max(cameraShake, reducedMotion ? 0.02 : 0.11);
      hitStopTimer = Math.max(hitStopTimer, reducedMotion ? 0.025 : 0.055);
      safeAudio("hit", { volume: 0.72 });
    }
  }

  function beginDodge() {
    if (player.dodgeCooldown > 0 || player.attackTimer > 0 || player.hurtTimer > 0) return;
    player.dodgeTimer = 0.47;
    player.dodgeCooldown = 0.62;
    player.invulnerable = 0.5;
    player.guarding = false;
    if (Math.hypot(player.velocity.x, player.velocity.z) < 0.3) {
      directionFromYaw(player.yaw, tempA);
      player.velocity.x = tempA.x * 12.5;
      player.velocity.z = tempA.z * 12.5;
    }
    spawnPrismEcho(player.position);
    safeAudio("dodge");
  }

  function usePrismPulse() {
    if (player.charge < 35 || player.hurtTimer > 0 || player.dodgeTimer > 0) {
      if (player.charge < 35) toast("PRISM CHARGE INCOMPLETE");
      return;
    }
    player.charge -= 35;
    dom.prism.classList.remove("is-active");
    void dom.prism.offsetWidth;
    dom.prism.classList.add("is-active");
    spawnPrismPulse(player.position);
    safeAudio("prismpulse", { volume: 0.92 });

    let affected = 0;
    enemies.forEach((enemy) => {
      if (enemy.dead || enemy.disabled || horizontalDistance(enemy.position, player.position) > 7.4) return;
      enemy.staggerTimer = Math.max(enemy.staggerTimer, 1.55);
      enemy.hurtTimer = Math.max(enemy.hurtTimer, 0.35);
      damageEnemy(enemy, 1, "prism");
      affected += 1;
    });

    const bossPulseRange = boss && boss.state === "charge" ? 17 : 11.5;
    if (boss && !boss.dead && horizontalDistance(boss.position, player.position) < bossPulseRange) {
      if (boss.state === "charge") {
        boss.state = "stagger";
        boss.stateTimer = 3.8;
        boss.staggerTimer = 3.8;
        boss.staggerDamage = 0;
        boss.cycle += 1;
        clearHostileProjectiles();
        dom.bossInstruction.textContent = "THE CORE IS EXPOSED // STRIKE";
        showSubtitle("VEY", "Now—the center has nowhere left to hide.", 1700);
        spawnImpact(boss.position, 0xffd17c, 24);
        safeAudio("bossstagger");
        affected += 1;
      } else if (boss.state !== "stagger") {
        dom.bossInstruction.textContent = "PULSE WHEN THE PLATES CONVERGE";
        toast("THE CORE REFRACTS THE PULSE");
      }
    }
    if (!affected) toast("THE LIGHT DISSIPATES");
  }

  function damageEnemy(enemy, amount, source) {
    if (!enemy || enemy.dead) return;
    if (enemy === boss && boss.state !== "stagger" && source === "melee") return;
    let appliedAmount = amount;
    if (enemy === boss && source === "melee") {
      const remainingExposureDamage = Math.max(0, 3 - boss.staggerDamage);
      if (remainingExposureDamage <= 0) return;
      appliedAmount = Math.min(appliedAmount, remainingExposureDamage);
      boss.staggerDamage += appliedAmount;
    }
    enemy.hp -= appliedAmount;
    enemy.hurtTimer = Math.max(enemy.hurtTimer, 0.38);
    enemy.staggerTimer = Math.max(enemy.staggerTimer, source === "prism" ? 1.3 : 0.25);
    spawnImpact(enemy.position, enemy === boss ? 0xffd17c : 0xb866a7, enemy === boss ? 12 : 7);
    if (source === "melee") spawnImpactRing(enemy.position, 0xffd17c);
    safeAudio(enemy === boss ? "bosshit" : "enemyhit", { volume: 0.68 });
    if (enemy.hp <= 0) killEnemy(enemy);
    else if (enemy === boss && source === "melee" && boss.staggerDamage >= 3) finishBossExposure(true);
  }

  function killEnemy(enemy) {
    enemy.dead = true;
    enemy.state = "dead";
    enemy.stateTimer = 2.2;
    player.charge = Math.min(100, player.charge + (enemy === boss ? 0 : 18));
    if (lockedTarget === enemy) lockedTarget = null;
    if (enemy === boss) {
      defeatBoss();
    } else {
      safeAudio("enemydeath");
      spawnImpact(enemy.position, 0x9b4f93, 13);
    }
  }

  function updateHeroVisual(dt) {
    const attackPhase = player.attackTimer > 0 ? 1 - player.attackTimer / player.attackDuration : 0;
    DrownedActors.updateHero(hero, {
      speed: clamp(player.lastMoveSpeed, 0, 1),
      grounded: player.grounded,
      attackPhase,
      combo: player.attackCombo,
      guarding: player.guarding,
      dodging: player.dodgeTimer > 0,
      interacting: player.interactTimer > 0,
      hurt: player.hurtTimer > 0 ? player.hurtTimer / 0.45 : 0,
      dead: player.deadTimer > 0,
      facing: -player.yaw,
    }, dt, elapsed);
  }

  function updateEnemies(dt) {
    for (let i = enemies.length - 1; i >= 0; i -= 1) {
      const enemy = enemies[i];
      if (enemy.disabled) continue;
      if (enemy.qaFrozen) {
        enemy.hurtTimer = Math.max(0, enemy.hurtTimer - dt);
        enemy.root.position.copy(enemy.position);
        DrownedActors.updateEnemy(enemy.actor, {
          speed: 0,
          hurt: enemy.hurtTimer > 0 ? clamp(enemy.hurtTimer / 0.38, 0, 1) : 0,
          alert: 1,
          facing: -enemy.facing,
        }, dt, elapsed);
        continue;
      }
      if (enemy.dead) {
        enemy.stateTimer -= dt;
        enemy.root.position.y -= dt * 0.08;
        DrownedActors.updateEnemy(enemy.actor, { dead: true, hurt: 0, facing: -enemy.facing }, dt, elapsed);
        if (enemy.stateTimer <= 0) {
          scene.remove(enemy.root);
          if (enemy.actor.dispose) enemy.actor.dispose();
          enemies.splice(i, 1);
        }
        continue;
      }

      enemy.cooldown = Math.max(0, enemy.cooldown - dt);
      enemy.hurtTimer = Math.max(0, enemy.hurtTimer - dt);
      enemy.staggerTimer = Math.max(0, enemy.staggerTimer - dt);
      tempA.subVectors(player.position, enemy.position).setY(0);
      const distance = tempA.length();
      const canSee = distance < (enemy.kind === "warden" ? 22 : 17) || enemy.alert > 0.5 || bossStarted;
      enemy.alert = damp(enemy.alert, canSee ? 1 : 0, canSee ? 7 : 0.5, dt);

      if (player.deadTimer > 0 || cinematicTimer > 0.2) {
        enemy.speed = damp(enemy.speed, 0, 8, dt);
      } else if (enemy.staggerTimer > 0 || enemy.hurtTimer > 0.18) {
        enemy.speed = damp(enemy.speed, 0, 12, dt);
        enemy.state = "stagger";
      } else if (enemy.state === "attack") {
        enemy.attackTimer -= dt;
        const attackDuration = enemy.kind === "warden" ? 1.08 : 0.82;
        const progress = 1 - enemy.attackTimer / attackDuration;
        enemy.speed = 0;
        if (!enemy.attackHit && progress > (enemy.kind === "warden" ? 0.64 : 0.55)) {
          enemy.attackHit = true;
          if (distance < (enemy.kind === "warden" ? 3.25 : 2.55)) hitPlayer(enemy.kind === "warden" ? 2 : 1, enemy);
        }
        if (enemy.attackTimer <= 0) {
          enemy.state = "chase";
          enemy.cooldown = enemy.kind === "warden" ? 1.65 : 1.1;
        }
      } else if (canSee) {
        enemy.facing = Math.atan2(tempA.x, -tempA.z);
        if (distance < (enemy.kind === "warden" ? 3.0 : 2.25) && enemy.cooldown <= 0) {
          enemy.state = "attack";
          enemy.attackTimer = enemy.kind === "warden" ? 1.08 : 0.82;
          enemy.attackHit = false;
          safeAudio(enemy.kind === "warden" ? "enemycharge" : "enemylunge", { volume: 0.54 });
        } else {
          enemy.state = "chase";
          const speed = enemy.kind === "warden" ? 2.25 : 3.45;
          enemy.speed = damp(enemy.speed, speed, 6, dt);
          if (distance > 0.1) enemy.velocity.copy(tempA).normalize().multiplyScalar(enemy.speed);
          const desired = tempB.copy(enemy.position).addScaledVector(enemy.velocity, dt);
          const resolved = world.resolvePosition(enemy.position, desired, enemy.kind === "warden" ? 0.75 : 0.62);
          enemy.position.copy(resolved);
        }
      } else {
        enemy.state = "idle";
        enemy.speed = damp(enemy.speed, 0, 5, dt);
        enemy.facing += Math.sin(elapsed * 0.27 + i) * dt * 0.05;
      }

      separateEnemy(enemy, i);
      enemy.position.y = world.heightAt(enemy.position.x, enemy.position.z);
      enemy.root.position.copy(enemy.position);
      const attackDuration = enemy.kind === "warden" ? 1.08 : 0.82;
      const attackPhase = enemy.state === "attack" ? 1 - enemy.attackTimer / attackDuration : 0;
      DrownedActors.updateEnemy(enemy.actor, {
        speed: clamp(enemy.speed / (enemy.kind === "warden" ? 2.25 : 3.45), 0, 1),
        attackPhase,
        charge: enemy.state === "attack" ? clamp(attackPhase * 1.7, 0, 1) : 0,
        hurt: enemy.hurtTimer > 0 ? clamp(enemy.hurtTimer / 0.38, 0, 1) : 0,
        staggered: enemy.staggerTimer > 0,
        alert: enemy.alert,
        facing: -enemy.facing,
      }, dt, elapsed);
    }
  }

  function separateEnemy(enemy, index) {
    for (let j = index + 1; j < enemies.length; j += 1) {
      const other = enemies[j];
      if (other.dead || other.disabled) continue;
      tempA.subVectors(enemy.position, other.position).setY(0);
      const distanceSq = tempA.lengthSq();
      const min = enemy.kind === "warden" || other.kind === "warden" ? 1.55 : 1.2;
      if (distanceSq > 0.0001 && distanceSq < min * min) {
        const push = (min - Math.sqrt(distanceSq)) * 0.5;
        tempA.normalize();
        enemy.position.addScaledVector(tempA, push);
        other.position.addScaledVector(tempA, -push);
      }
    }
  }

  function hitPlayer(amount, source) {
    if (player.invulnerable > 0 || player.deadTimer > 0) return;
    if (player.guarding) {
      if (player.parryTimer > 0) {
        player.parryTimer = 0;
        player.charge = Math.min(100, player.charge + 24);
        if (source) source.staggerTimer = 1.6;
        spawnImpact(player.position, 0xffd17c, 14);
        safeAudio("parry", { volume: 0.88 });
        toast("MERIDIAN PARRY");
        cameraShake = Math.max(cameraShake, reducedMotion ? 0.02 : 0.12);
      } else {
        player.charge = Math.max(0, player.charge - 9);
        safeAudio("guard");
        cameraShake = Math.max(cameraShake, reducedMotion ? 0.01 : 0.07);
      }
      return;
    }
    player.health -= amount;
    player.hurtTimer = 0.48;
    player.invulnerable = 0.8;
    damageTimer = 0.26;
    dom.damage.classList.add("is-active");
    safeAudio("hurt", { volume: 0.82 });
    cameraShake = Math.max(cameraShake, reducedMotion ? 0.025 : 0.22);
    if (source) {
      tempA.subVectors(player.position, source.position).setY(0).normalize();
      player.velocity.addScaledVector(tempA, source.kind === "warden" ? 5.4 : 3.8);
    }
    if (player.health <= 0) downPlayer();
  }

  function downPlayer() {
    player.health = 0;
    player.deadTimer = 2.7;
    player.velocity.set(0, 0, 0);
    lockedTarget = null;
    showSubtitle("INSTRUMENT", "Bearing lost. Reconstructing the last stable chart…", 2600);
    safeAudio("playerdown");
  }

  function revivePlayer() {
    player.health = player.maxHealth;
    player.charge = Math.max(65, player.charge);
    player.position.copy(checkpoint);
    player.position.y = world.heightAt(player.position.x, player.position.z);
    player.velocity.set(0, 0, 0);
    player.hurtTimer = 0;
    player.invulnerable = 1.2;
    if (bossStarted && boss && !boss.dead) {
      boss.position.copy(world.arena.center);
      boss.position.y += 3.2;
      boss.state = "orbit";
      boss.stateTimer = 2.5;
    }
    showSubtitle("VEY", "The bracer held the line. Again.", 1700);
  }

  function tryInteract() {
    let nearest = null;
    let nearestDistance = Infinity;
    world.mechanisms.forEach((mechanism) => {
      if (mechanism.active) return;
      const position = mechanism.position || mechanism.root.position;
      const distance = horizontalDistance(position, player.position);
      if (distance < nearestDistance) {
        nearest = mechanism;
        nearestDistance = distance;
      }
    });
    if (nearest && nearestDistance < 4.3) {
      if (mechanismGuarded(nearest)) {
        toast("VIOLET INTERFERENCE // GUARDIAN REMAINS");
        showSubtitle("VEY", "The lens is phase-locked to the creature nearby. Still it first.", 1900);
        safeAudio("back");
      } else {
        activateMechanism(nearest);
      }
    }
  }

  function mechanismGuarded(mechanism) {
    const position = mechanism.position || mechanism.root.position;
    return enemies.some((enemy) => !enemy.dead && !enemy.disabled && horizontalDistance(enemy.position, position) < 9.2);
  }

  function activateMechanism(mechanism) {
    if (!mechanism || mechanism.active) return;
    mechanism.activate();
    mechanism.active = true;
    player.interactTimer = 0.72;
    activeMechanisms = world.mechanisms.filter((entry) => entry.active).length;
    checkpoint.copy(mechanism.position || mechanism.root.position);
    checkpoint.z += 3.2;
    checkpoint.y = world.heightAt(checkpoint.x, checkpoint.z);
    spawnMechanismBurst(mechanism.position || mechanism.root.position);
    safeAudio("mechanism", { volume: 1 });
    updateLensHud();
    toast("MERIDIAN " + ["NORTH", "EAST", "NADIR"][Math.min(2, activeMechanisms - 1)] + " // AWAKE");
    if (activeMechanisms === 1) {
      showObjective("WAKE TWO REMAINING LENSES");
      showSubtitle("VEY", "The root carries light as if it were water.", 2400);
    } else if (activeMechanisms === 2) {
      showObjective("WAKE THE FINAL LENS");
      showSubtitle("VEY", "One more. Something at the center has begun to turn.", 2600);
    } else {
      world.gate.setOpen(true);
      showObjective("ENTER THE ORRERY COURT");
      showSubtitle("THE ORRERY", "Three meridians answer. The drowned axis opens.", 3200);
      safeAudio("gateopen");
    }
  }

  function updateLensHud() {
    dom.lensCount.textContent = activeMechanisms + " / 3";
    dom.lenses.forEach((lens, index) => lens.classList.toggle("is-active", index < activeMechanisms));
  }

  function updateContextPrompt() {
    let text = "";
    let nearest = Infinity;
    world.mechanisms.forEach((mechanism) => {
      if (mechanism.active) return;
      const distance = horizontalDistance(mechanism.position || mechanism.root.position, player.position);
      if (distance < 4.3 && distance < nearest) {
        nearest = distance;
        text = mechanismGuarded(mechanism) ? "VIOLET INTERFERENCE // CLEAR THE GUARDIAN" : "E  //  REFRACT MERIDIAN LENS";
      }
    });
    if (activeMechanisms < 3 && player.position.z < -40 && Math.abs(player.position.x) < 8) {
      text = "THREE LENSES MUST AGREE";
    }
    dom.prompt.textContent = text;
    dom.prompt.classList.toggle("is-visible", !!text);
  }

  function startBossBattle(force) {
    if (bossStarted || (!force && activeMechanisms < 3)) return;
    bossStarted = true;
    enemies.forEach((enemy) => {
      enemy.disabled = true;
      enemy.alert = 0;
      enemy.state = "retired";
      enemy.attackTimer = 0;
      enemy.attackHit = true;
      enemy.velocity.set(0, 0, 0);
      enemy.root.visible = false;
    });
    lockedTarget = null;
    checkpoint.set(0, world.heightAt(0, -51), -51);
    const actor = DrownedActors.createBoss(THREE);
    const position = world.arena.center.clone();
    position.y += 3.25;
    actor.root.position.copy(position);
    scene.add(actor.root);
    boss = {
      actor,
      root: actor.root,
      kind: "boss",
      position,
      velocity: new THREE.Vector3(),
      hp: 9,
      maxHp: 9,
      state: "intro",
      stateTimer: reducedMotion ? 1.3 : 3.1,
      attackTimer: 0,
      attackHit: false,
      hurtTimer: 0,
      staggerTimer: 0,
      staggerDamage: 0,
      cycle: 0,
      phase: 1,
      dead: false,
      facing: 0,
    };
    lockedTarget = boss;
    cinematicTimer = reducedMotion ? 0.7 : 3.2;
    dom.shell.classList.add("is-cinematic", "is-boss");
    dom.bossHud.classList.add("is-visible");
    dom.bossInstruction.textContent = "WAIT FOR THE CORE TO CONVERGE";
    showObjective("STILL THE HOLLOW ASTRONOMER");
    showSubtitle("THE HOLLOW ASTRONOMER", "Your sky is an error I was built to correct.", 3900);
    safeAudio("bossintro");
  }

  function updateBoss(dt) {
    if (!boss || boss.dead) return;
    boss.hurtTimer = Math.max(0, boss.hurtTimer - dt);
    boss.staggerTimer = Math.max(0, boss.staggerTimer - dt);
    boss.stateTimer -= dt;
    const center = world.arena.center;
    const toPlayer = tempA.subVectors(player.position, boss.position).setY(0);
    const distance = toPlayer.length();
    boss.facing = Math.atan2(toPlayer.x, -toPlayer.z);

    if (boss.state === "intro") {
      boss.position.x = damp(boss.position.x, center.x, 2, dt);
      boss.position.z = damp(boss.position.z, center.z, 2, dt);
      boss.position.y = center.y + 3.2 + Math.sin(elapsed * 1.2) * 0.25;
      if (boss.stateTimer <= 0) {
        boss.state = "orbit";
        boss.stateTimer = 3.6;
        dom.shell.classList.remove("is-cinematic");
      }
    } else if (boss.state === "orbit") {
      const angle = elapsed * (0.28 + boss.phase * 0.04);
      const radius = 6.3 + Math.sin(elapsed * 0.7) * 1.2;
      boss.position.x = damp(boss.position.x, center.x + Math.sin(angle) * radius, 2.5, dt);
      boss.position.z = damp(boss.position.z, center.z + Math.cos(angle) * radius, 2.5, dt);
      boss.position.y = center.y + 3.1 + Math.sin(elapsed * 1.7) * 0.38;
      if (boss.stateTimer <= 0) {
        if (Math.random() < 0.55 || boss.cycle === 0) {
          boss.state = "volley";
          boss.stateTimer = 1.6;
          boss.attackTimer = 0.65;
          boss.attackHit = false;
          dom.bossInstruction.textContent = "PLATES DISCHARGING // MOVE";
          safeAudio("bosscharge");
        } else {
          beginBossCharge();
        }
      }
    } else if (boss.state === "volley") {
      boss.position.y = center.y + 4.0;
      boss.attackTimer -= dt;
      if (!boss.attackHit && boss.attackTimer <= 0) {
        boss.attackHit = true;
        launchBossVolley(3 + boss.phase * 2);
      }
      if (boss.stateTimer <= 0) beginBossCharge();
    } else if (boss.state === "charge") {
      boss.position.x = damp(boss.position.x, center.x, 3, dt);
      boss.position.z = damp(boss.position.z, center.z, 3, dt);
      boss.position.y = center.y + 2.7 + Math.sin(elapsed * 4) * 0.12;
      if (boss.stateTimer <= 0) {
        spawnBossShockwave();
        if (horizontalDistance(player.position, center) < 10.5) hitPlayer(2, boss);
        boss.state = "orbit";
        boss.stateTimer = 2.8;
        dom.bossInstruction.textContent = "WAIT FOR THE CORE TO CONVERGE";
      }
    } else if (boss.state === "stagger") {
      boss.position.y = damp(boss.position.y, center.y + 1.15, 5, dt);
      if (boss.stateTimer <= 0) finishBossExposure(false);
    }

    boss.position.y = Math.max(center.y + 0.8, boss.position.y);
    boss.root.position.copy(boss.position);
    const chargeAmount = boss.state === "charge" ? 1 - boss.stateTimer / 2.6 : 0;
    const attackPhase = boss.state === "volley" ? 1 - boss.stateTimer / 1.6 : 0;
    DrownedActors.updateBoss(boss.actor, {
      phase: boss.phase,
      charge: clamp(chargeAmount, 0, 1),
      attackPhase: clamp(attackPhase, 0, 1),
      stagger: boss.state === "stagger" ? clamp(boss.stateTimer / 3.8, 0, 1) : 0,
      hurt: boss.hurtTimer > 0 ? boss.hurtTimer / 0.38 : 0,
      dead: false,
      facing: -boss.facing,
    }, dt, elapsed);
    dom.bossMeter.style.transform = "scaleX(" + clamp(boss.hp / boss.maxHp, 0, 1) + ")";
  }

  function finishBossExposure(forced) {
    if (!boss || boss.dead) return;
    boss.state = "orbit";
    boss.phase = Math.min(3, 1 + Math.floor((boss.maxHp - boss.hp) / 3));
    boss.stateTimer = 2.7 - boss.phase * 0.2;
    boss.staggerTimer = 0;
    boss.staggerDamage = 0;
    dom.bossInstruction.textContent = forced
      ? "PLATES RELOCKED // WAIT FOR CONVERGENCE"
      : "WAIT FOR THE CORE TO CONVERGE";
    if (forced) toast("EXPOSURE LIMIT REACHED // CORE RELOCKED");
  }

  function beginBossCharge() {
    boss.state = "charge";
    boss.stateTimer = 2.6;
    boss.attackHit = false;
    dom.bossInstruction.textContent = "CORE CONVERGING // PRISM PULSE";
    showSubtitle("VEY", "The plates are aligning—catch the center with the prism.", 2100);
    safeAudio("prismcharge");
  }

  function ensureBossShardAssets() {
    if (bossShardGeometry && bossShardMaterials) return;
    bossShardGeometry = new THREE.OctahedronGeometry(0.32, 0);
    bossShardGeometry.scale(0.56, 1.5, 0.48);
    bossShardMaterials = [
      new THREE.MeshStandardMaterial({
        name: "Astronomer violet star-glass",
        color: 0xe5b7d6,
        emissive: 0x74315f,
        emissiveIntensity: 1.55,
        metalness: 0.34,
        roughness: 0.24,
        flatShading: true,
        transparent: true,
        opacity: 0.94,
      }),
      new THREE.MeshStandardMaterial({
        name: "Astronomer drowned-cyan star-glass",
        color: 0xa8d8d2,
        emissive: 0x285f63,
        emissiveIntensity: 1.45,
        metalness: 0.38,
        roughness: 0.21,
        flatShading: true,
        transparent: true,
        opacity: 0.92,
      }),
    ];
  }

  function launchBossVolley(count) {
    ensureBossShardAssets();
    for (let i = 0; i < count; i += 1) {
      const mesh = new THREE.Mesh(bossShardGeometry, bossShardMaterials[i % bossShardMaterials.length]);
      mesh.position.copy(boss.position);
      mesh.position.y += Math.sin(i) * 0.4;
      mesh.rotation.set(i * 0.67, i * 1.13, Math.PI * 0.25 + i * 0.21);
      const shardScale = 0.82 + (i % 3) * 0.11;
      mesh.scale.setScalar(shardScale);
      mesh.castShadow = quality > 0;
      scene.add(mesh);
      const direction = tempA.subVectors(player.position, boss.position).setY(0.15).normalize();
      const spread = (i - (count - 1) / 2) * 0.12;
      direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
      projectiles.push({ mesh, velocity: direction.clone().multiplyScalar(8.2 + boss.phase), life: 5, hostile: true, sharedVisual: true });
    }
    safeAudio("bossvolley");
  }

  function spawnBossShockwave() {
    const shockOpacity = 0.5;
    const ring = createRingMesh(0x9b4f93, 1.2, 0.12, shockOpacity);
    ring.position.copy(world.arena.center);
    ring.position.y += 0.16;
    scene.add(ring);
    effects.push({ mesh: ring, life: 0.9, maxLife: 0.9, type: "shockwave", speed: 15, opacity: shockOpacity });
    safeAudio("bossslam");
    cameraShake = Math.max(cameraShake, reducedMotion ? 0.03 : 0.25);
  }

  function defeatBoss() {
    if (!boss) return;
    boss.dead = true;
    boss.state = "dead";
    boss.stateTimer = 4;
    lockedTarget = null;
    dom.bossInstruction.textContent = "THE AXIS IS STILL";
    showSubtitle("THE HOLLOW ASTRONOMER", "Then chart… what comes after me.", 3100);
    safeAudio("bossdeath");
    for (let i = 0; i < 5; i += 1) {
      const delay = i * 160;
      setTimeout(() => {
        if (!disposed) spawnImpact(boss.position, i % 2 ? 0x72e0db : 0xffd17c, 18);
      }, delay);
    }
    endingTimer = reducedMotion ? 2 : 5.5;
    mode = "ending";
    dom.shell.className = "game-shell is-ending is-cinematic";
    world.setRestored(true);
    restored = true;
    if (audio) audio.setRestored(true);
    showObjective("THE AXIS REMEMBERS");
  }

  function completeExpedition(immediate) {
    if (!restored) {
      restored = true;
      world.setRestored(true);
      if (audio) audio.setRestored(true);
    }
    mode = "ended";
    dom.shell.className = "game-shell is-ended";
    dom.end.setAttribute("aria-hidden", "false");
    dom.endTime.textContent = formatTime(missionElapsed);
    dom.bossHud.classList.remove("is-visible");
    if (document.pointerLockElement) {
      pointerLockSuppressed = true;
      document.exitPointerLock();
      setTimeout(() => { pointerLockSuppressed = false; }, 50);
    }
    safeAudio("finale");
    cameraState.yaw = 0;
    cameraState.pitch = 0.16;
    cameraState.distance = 10.2;
  }

  function updateEnding(dt) {
    if (!boss) return;
    boss.stateTimer -= dt;
    boss.root.rotation.y += dt * 0.8;
    boss.root.scale.multiplyScalar(Math.max(0.95, 1 - dt * 0.22));
    boss.root.position.y += dt * 0.3;
    DrownedActors.updateBoss(boss.actor, { dead: true, stagger: 1, phase: 3, facing: boss.root.rotation.y }, dt, elapsed);
    endingTimer -= dt;
    if (endingTimer <= 0) completeExpedition(false);
  }

  function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i -= 1) {
      const projectile = projectiles[i];
      projectile.life -= dt;
      projectile.mesh.position.addScaledVector(projectile.velocity, dt);
      projectile.mesh.rotation.x += dt * 5;
      projectile.mesh.rotation.y += dt * 7;
      if (projectile.hostile && horizontalDistance(projectile.mesh.position, player.position) < 0.75 && Math.abs(projectile.mesh.position.y - (player.position.y + 1)) < 1.5) {
        hitPlayer(1, boss);
        projectile.life = 0;
        spawnImpact(projectile.mesh.position, 0x9b4f93, 6);
      }
      const ground = world.heightAt(projectile.mesh.position.x, projectile.mesh.position.z);
      if (projectile.mesh.position.y < ground + 0.1) {
        projectile.life = 0;
        spawnImpact(projectile.mesh.position, 0x9b4f93, 4);
      }
      if (projectile.life <= 0) {
        scene.remove(projectile.mesh);
        if (!projectile.sharedVisual) {
          projectile.mesh.geometry.dispose();
          projectile.mesh.material.dispose();
        }
        projectiles.splice(i, 1);
      }
    }
  }

  function clearHostileProjectiles() {
    for (let i = projectiles.length - 1; i >= 0; i -= 1) {
      const projectile = projectiles[i];
      if (!projectile.hostile) continue;
      scene.remove(projectile.mesh);
      if (!projectile.sharedVisual) {
        projectile.mesh.geometry.dispose();
        if (Array.isArray(projectile.mesh.material)) {
          projectile.mesh.material.forEach((material) => material.dispose());
        } else {
          projectile.mesh.material.dispose();
        }
      }
      projectiles.splice(i, 1);
    }
  }

  function updateEffects(dt) {
    for (let i = effects.length - 1; i >= 0; i -= 1) {
      const effect = effects[i];
      effect.life -= dt;
      const progress = 1 - effect.life / effect.maxLife;
      if (effect.type === "particle") {
        effect.velocity.y -= (effect.gravity || 0) * dt;
        effect.mesh.position.addScaledVector(effect.velocity, dt);
        effect.mesh.rotation.x += effect.spinX * dt;
        effect.mesh.rotation.y += effect.spinY * dt;
        effect.mesh.material.opacity = clamp(1 - progress, 0, 1);
        effect.mesh.scale.setScalar(1 - progress * 0.45);
      } else if (effect.type === "ring" || effect.type === "shockwave") {
        const scale = 1 + progress * (effect.speed || 8);
        effect.mesh.scale.setScalar(scale);
        effect.mesh.material.opacity = (1 - progress) * effect.opacity;
      } else if (effect.type === "slash") {
        effect.mesh.rotation.y += effect.direction * dt * 5.2;
        effect.mesh.material.opacity = (1 - progress) * 0.86;
        effect.mesh.scale.setScalar(0.8 + progress * 0.72);
      } else if (effect.type === "echo") {
        effect.mesh.material.opacity = (1 - progress) * 0.24;
        effect.mesh.scale.multiplyScalar(1 + dt * 0.85);
      }
      if (effect.life <= 0) {
        scene.remove(effect.mesh);
        effect.mesh.geometry.dispose();
        effect.mesh.material.dispose();
        effects.splice(i, 1);
      }
    }
  }

  function spawnImpact(position, color, count) {
    const amount = quality === 0 ? Math.ceil(count * 0.45) : count;
    for (let i = 0; i < amount; i += 1) {
      const size = 0.035 + Math.random() * 0.09;
      const geometry = new THREE.TetrahedronGeometry(size, 0);
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);
      mesh.position.y += 0.8 + Math.random() * 1.3;
      scene.add(mesh);
      effects.push({
        mesh,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 4.2, 1.6 + Math.random() * 3.4, (Math.random() - 0.5) * 4.2),
        gravity: 5.5,
        spinX: (Math.random() - 0.5) * 9,
        spinY: (Math.random() - 0.5) * 9,
        life: 0.55 + Math.random() * 0.4,
        maxLife: 0.95,
        type: "particle",
      });
    }
  }

  function spawnImpactRing(position, color) {
    const geometry = new THREE.TorusGeometry(0.48, 0.055, 6, 28);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.position.y += 1.35;
    mesh.quaternion.copy(camera.quaternion);
    mesh.renderOrder = 14;
    scene.add(mesh);
    effects.push({ mesh, life: 0.3, maxLife: 0.3, type: "shockwave", speed: 1.45, opacity: 0.92 });
  }

  function spawnGroundPuff(position, count) {
    for (let i = 0; i < count; i += 1) {
      const geometry = new THREE.CircleGeometry(0.09 + Math.random() * 0.08, 8);
      const material = new THREE.MeshBasicMaterial({ color: 0xb7c2aa, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);
      mesh.position.y += 0.06;
      mesh.rotation.x = -Math.PI / 2;
      scene.add(mesh);
      effects.push({
        mesh,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.1, (Math.random() - 0.5) * 0.4),
        gravity: 0,
        spinX: 0,
        spinY: 0,
        life: 0.4,
        maxLife: 0.4,
        type: "particle",
      });
    }
  }

  function spawnSlashArc(combo) {
    const geometry = new THREE.TorusGeometry(1.45 + combo * 0.12, 0.035, 5, 42, Math.PI * 0.92);
    const material = new THREE.MeshBasicMaterial({
      color: combo === 3 ? 0xffd17c : 0xf0644d,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geometry, material);
    const forward = directionFromYaw(player.yaw, tempA);
    mesh.position.copy(player.position).addScaledVector(forward, 1.05);
    mesh.position.y += 1.05;
    mesh.rotation.set(Math.PI / 2, -player.yaw + Math.PI * 0.1, combo % 2 ? -0.5 : 0.4);
    scene.add(mesh);
    effects.push({ mesh, life: 0.34, maxLife: 0.34, type: "slash", direction: combo % 2 ? 1 : -1 });
  }

  function createRingMesh(color, radius, tube, opacity) {
    const geometry = new THREE.TorusGeometry(radius, tube, 8, 64);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = Math.PI / 2;
    return mesh;
  }

  function spawnPrismPulse(position) {
    [
      { radius: 0.95, color: 0x72e0db, opacity: 0.34, speed: 5.2, life: 0.72 },
      { radius: 1.42, color: 0xffd17c, opacity: 0.26, speed: 6.4, life: 0.82 },
    ].forEach((spec, index) => {
      const ring = createRingMesh(spec.color, spec.radius, 0.03, spec.opacity);
      ring.position.copy(position);
      ring.position.y += 0.18 + index * 0.05;
      scene.add(ring);
      effects.push({
        mesh: ring,
        life: spec.life,
        maxLife: spec.life,
        type: "ring",
        speed: spec.speed,
        opacity: spec.opacity,
      });
    });
    spawnImpact(position, 0x72e0db, quality === 2 ? 20 : 10);
  }

  function spawnMechanismBurst(position) {
    const p = tempC.copy(position);
    p.y += 1.2;
    spawnImpact(p, 0xffd17c, quality === 2 ? 28 : 14);
    for (let i = 0; i < 3; i += 1) {
      const ringOpacity = 0.48;
      const ring = createRingMesh(i === 1 ? 0xffd17c : 0x72e0db, 0.7 + i * 0.35, 0.025, ringOpacity);
      ring.position.copy(position);
      ring.position.y += 0.4 + i * 0.5;
      ring.rotation.set(i === 0 ? Math.PI / 2 : Math.PI * 0.4, i * 0.7, i * 0.4);
      scene.add(ring);
      effects.push({ mesh: ring, life: 1.2 + i * 0.18, maxLife: 1.55, type: "ring", speed: 3.2 + i, opacity: ringOpacity });
    }
  }

  function spawnPrismEcho(position) {
    if (quality === 0) return;
    const geometry = new THREE.CylinderGeometry(0.45, 0.62, 1.55, 8);
    const material = new THREE.MeshBasicMaterial({ color: 0x72e0db, transparent: true, opacity: 0.2, wireframe: true, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.position.y += 0.85;
    scene.add(mesh);
    effects.push({ mesh, life: 0.38, maxLife: 0.38, type: "echo" });
  }

  function updateCamera(dt, snap) {
    const cameraDt = snap ? 1 : dt;
    const cinematic = cinematicTimer > 0;
    if (cinematicTimer > 0 && mode !== "ended") {
      cinematicTimer = Math.max(0, cinematicTimer - dt);
      if (cinematicTimer <= 0) dom.shell.classList.remove("is-cinematic");
    }

    let focusPosition = player.position;
    if (cinematic && bossStarted && boss && !boss.dead) {
      focusPosition = tempC.copy(player.position).lerp(boss.position, 0.58);
      cameraState.yaw = dampAngle(cameraState.yaw, 0.08, 1.8, cameraDt);
      cameraState.pitch = damp(cameraState.pitch, 0.22, 2.2, cameraDt);
    } else if (qaMode === "boss" && boss && !boss.dead) {
      focusPosition = tempC.copy(player.position).lerp(boss.position, 0.32);
    } else if (mode === "ending" && boss) {
      focusPosition = tempC.copy(world.arena.center);
      focusPosition.y += 2.2;
      cameraState.yaw += dt * 0.08;
      cameraState.pitch = damp(cameraState.pitch, 0.16, 1.4, cameraDt);
    } else if (mode === "ended") {
      focusPosition = tempC.copy(player.position);
    }

    if (lockedTarget && !lockedTarget.dead && mode === "playing") {
      const lockDirection = tempA.subVectors(lockedTarget.position, player.position).setY(0);
      if (lockDirection.lengthSq() > 0.1) {
        const lockYaw = Math.atan2(lockDirection.x, -lockDirection.z);
        cameraState.yaw = dampAngle(cameraState.yaw, lockYaw, 3.6, cameraDt);
      }
    }

    cameraState.forward.set(Math.sin(cameraState.yaw), 0, -Math.cos(cameraState.yaw));
    cameraState.right.set(Math.cos(cameraState.yaw), 0, Math.sin(cameraState.yaw));
    cameraState.desiredTarget.copy(focusPosition);
    cameraState.desiredTarget.y += cinematic ? 1.9 : 1.35;
    if (!cinematic && !lockedTarget) {
      cameraState.desiredTarget.addScaledVector(cameraState.right, mode === "ended" ? -2.6 : 1.12);
    }

    const horizontal = Math.cos(cameraState.pitch) * cameraState.distance;
    const desiredPosition = tempA.copy(cameraState.desiredTarget)
      .addScaledVector(cameraState.forward, -horizontal);
    desiredPosition.y += Math.sin(cameraState.pitch) * cameraState.distance + 0.7;

    const ground = world.heightAt(desiredPosition.x, desiredPosition.z);
    desiredPosition.y = Math.max(desiredPosition.y, ground + 0.75);

    const targetRate = snap ? 100 : (cinematic ? 2.8 : 10);
    const positionRate = snap ? 100 : (cinematic ? 2.3 : 8.4);
    cameraState.currentTarget.lerp(cameraState.desiredTarget, 1 - Math.exp(-targetRate * cameraDt));
    cameraState.currentPosition.lerp(desiredPosition, 1 - Math.exp(-positionRate * cameraDt));

    cameraShake = damp(cameraShake, 0, 10, dt);
    const shake = reducedMotion ? 0 : cameraShake;
    camera.position.copy(cameraState.currentPosition);
    if (shake > 0.001) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake * 0.6;
    }
    camera.lookAt(cameraState.currentTarget);
    const targetFov = bossStarted && boss && !boss.dead ? 58 : player.lastMoveSpeed > 0.82 ? 56 : 52;
    camera.fov = damp(camera.fov, targetFov, 4, dt);
    camera.updateProjectionMatrix();
  }

  function updateHud() {
    dom.healthNumber.textContent = String(Math.max(0, player.health));
    Array.from(dom.healthOrbit.querySelectorAll("i")).forEach((segment, index) => {
      segment.classList.toggle("is-empty", index >= player.health);
    });
    dom.chargeMeter.style.transform = "scaleX(" + clamp(player.charge / 100, 0, 1) + ")";
    dom.chargeNumber.textContent = String(Math.round(player.charge));

    let targetPosition = null;
    const nextMechanism = world.mechanisms.find((mechanism) => !mechanism.active);
    if (nextMechanism) targetPosition = nextMechanism.position || nextMechanism.root.position;
    else if (!bossStarted) targetPosition = world.arena.center;
    else if (boss && !boss.dead) targetPosition = boss.position;
    if (targetPosition) {
      tempA.subVectors(targetPosition, player.position).setY(0);
      const targetYaw = Math.atan2(tempA.x, -tempA.z);
      const delta = shortestAngle(targetYaw - cameraState.yaw);
      const percent = clamp(50 + delta / Math.PI * 48, 7, 93);
      dom.bearing.style.left = percent + "%";
    }

    updateLockReticle();
    updateLensHud();
  }

  function updateLockReticle() {
    if (!lockedTarget || lockedTarget.dead || !lockedTarget.root.visible) {
      dom.lockReticle.classList.remove("is-visible");
      return;
    }
    tempA.copy(lockedTarget.position);
    tempA.y += lockedTarget === boss ? 1.4 : lockedTarget.kind === "warden" ? 1.55 : 0.8;
    tempA.project(camera);
    if (tempA.z > 1 || Math.abs(tempA.x) > 1.1 || Math.abs(tempA.y) > 1.1) {
      dom.lockReticle.classList.remove("is-visible");
      return;
    }
    dom.lockReticle.style.left = ((tempA.x * 0.5 + 0.5) * innerWidth) + "px";
    dom.lockReticle.style.top = ((-tempA.y * 0.5 + 0.5) * innerHeight) + "px";
    dom.lockReticle.classList.add("is-visible");
  }

  function toggleTargetLock() {
    if (lockedTarget && !lockedTarget.dead) {
      lockedTarget = null;
      safeAudio("back");
      return;
    }
    let nearest = null;
    let nearestScore = Infinity;
    const candidates = boss && !boss.dead ? enemies.concat([boss]) : enemies;
    candidates.forEach((enemy) => {
      if (enemy.dead || enemy.disabled || !enemy.root.visible) return;
      const distance = horizontalDistance(enemy.position, player.position);
      if (distance > 22) return;
      tempA.copy(enemy.position).project(camera);
      if (tempA.z > 1 || Math.abs(tempA.x) > 1.2 || Math.abs(tempA.y) > 1.2) return;
      const score = distance + Math.abs(tempA.x) * 9;
      if (score < nearestScore) {
        nearest = enemy;
        nearestScore = score;
      }
    });
    lockedTarget = nearest;
    if (nearest) safeAudio("lock");
  }

  function checkMissionProgress() {
    if (!bossStarted && activeMechanisms >= 3 && player.position.z < -47 && Math.abs(player.position.x) < 15) {
      startBossBattle(false);
    }
  }

  function showObjective(text) {
    currentObjective = text;
    dom.objective.textContent = text;
    dom.objectiveCardText.textContent = text;
    dom.objectiveCard.classList.remove("is-visible");
    void dom.objectiveCard.offsetWidth;
    dom.objectiveCard.classList.add("is-visible");
    safeAudio("objective");
  }

  function showSubtitle(speaker, text, duration) {
    clearTimeout(subtitleTimer);
    dom.subtitle.innerHTML = "<b>" + escapeHtml(speaker) + "</b> &nbsp; " + escapeHtml(text);
    dom.subtitle.classList.add("is-visible");
    subtitleTimer = setTimeout(() => dom.subtitle.classList.remove("is-visible"), duration || 2600);
  }

  function toast(text) {
    const span = document.createElement("span");
    span.textContent = text;
    dom.toastFeed.appendChild(span);
    setTimeout(() => span.remove(), 2600);
  }

  function safeAudio(name, options) {
    if (!audio) return;
    try { audio.play(audioFallbacks[name] || name, options || {}); } catch (_) {}
  }

  function clearTransientInput() {
    input.attack = false;
    input.guardPressed = false;
    input.dodge = false;
    input.jump = false;
    input.pulse = false;
    input.interact = false;
    input.lock = false;
    input.moveX = 0;
    input.moveY = 0;
  }

  function resetHeldInput() {
    input.keys.clear();
    input.mouseGuard = false;
    input.guard = false;
    input.gamepadX = 0;
    input.gamepadY = 0;
    input.touchMoveX = 0;
    input.touchMoveY = 0;
    if (dom.touchKnob) dom.touchKnob.style.transform = "translate(0px, 0px)";
    clearTransientInput();
  }

  function animate(now) {
    if (disposed) return;
    animationId = requestAnimationFrame(animate);
    const idleMode = mode === "menu" || mode === "paused" || mode === "ended";
    if (idleMode && now - lastIdleFrame < IDLE_FRAME_INTERVAL) return;
    lastIdleFrame = now;
    const dt = Math.min(0.05, Math.max(0.001, (now - previousFrame) / 1000));
    previousFrame = now;
    elapsed += dt;
    pollGamepad();

    if (mode === "playing" || mode === "ending") {
      missionElapsed += dt;
      if (mode === "playing") {
        const simulationPaused = hitStopTimer > 0;
        hitStopTimer = Math.max(0, hitStopTimer - dt);
        if (!simulationPaused) {
          updatePlayer(dt);
          updateEnemies(dt);
          updateBoss(dt);
          updateProjectiles(dt);
        }
        updateEffects(dt);
        checkMissionProgress();
      } else {
        updateEnding(dt);
        updateProjectiles(dt);
        updateEffects(dt);
      }
      if (damageTimer > 0) {
        damageTimer -= dt;
        if (damageTimer <= 0) dom.damage.classList.remove("is-active");
      }
      const intensity = bossStarted && boss && !boss.dead ? 0.85 : Math.min(0.7, enemies.filter((enemy) => !enemy.dead && enemy.alert > 0.5).length * 0.18);
      if (audio) audio.setIntensity(intensity);
    } else if (mode === "menu" || mode === "ended") {
      updateEffects(dt);
    }

    world.update(dt, elapsed, {
      restored,
      activeMechanisms,
      playerPosition: player.position,
      bossActive: bossStarted && boss && !boss.dead,
    });
    updateCamera(dt, false);
    updateHud();
    renderer.render(scene, camera);

    if (debugMode) updatePerformance(dt);
  }

  function updatePerformance(dt) {
    frameAccumulator += dt;
    frameCount += 1;
    if (frameAccumulator >= 0.5) {
      displayedFps = Math.round(frameCount / frameAccumulator);
      frameAccumulator = 0;
      frameCount = 0;
      const info = renderer.info.render;
      dom.performance.textContent = displayedFps + " FPS // " + info.calls + " CALLS // " + info.triangles.toLocaleString() + " TRIS";
    }
  }

  function directionFromYaw(yaw, target) {
    return target.set(Math.sin(yaw), 0, -Math.cos(yaw));
  }

  function shortestAngle(angle) {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }

  function dampAngle(current, target, rate, dt) {
    return current + shortestAngle(target - current) * (1 - Math.exp(-rate * dt));
  }

  function horizontalDistance(a, b) {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.hypot(dx, dz);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
  }

  function progressiveHintAllowed() {
    return !dom.subtitle.classList.contains("is-visible");
  }

  window.DrownedOrreryQA = {
    get state() {
      return {
        mode,
        quality,
        fps: displayedFps,
        player: {
          x: Number(player.position.x.toFixed(2)),
          y: Number(player.position.y.toFixed(2)),
          z: Number(player.position.z.toFixed(2)),
          health: player.health,
          charge: Math.round(player.charge),
        },
        activeMechanisms,
        enemies: enemies.filter((enemy) => !enemy.dead).length,
        boss: boss ? {
          state: boss.state,
          hp: boss.hp,
          phase: boss.phase,
          cycle: boss.cycle,
          exposureDamage: boss.staggerDamage,
        } : null,
        restored,
        drawCalls: renderer ? renderer.info.render.calls : 0,
        triangles: renderer ? renderer.info.render.triangles : 0,
      };
    },
    teleport(x, z) {
      player.position.set(Number(x) || 0, world.heightAt(Number(x) || 0, Number(z) || 0), Number(z) || 0);
      hero.root.position.copy(player.position);
      updateCamera(1 / 60, true);
    },
    activateAll: activateAllMechanisms,
    startBoss: () => startBossBattle(true),
    restore: () => completeExpedition(true),
    damageBoss(amount) {
      if (boss) {
        boss.state = "stagger";
        damageEnemy(boss, Number(amount) || 1, "qa");
      }
    },
    screenshotState() {
      return JSON.stringify(this.state, null, 2);
    },
  };

  window.addEventListener("beforeunload", () => {
    disposed = true;
    cancelAnimationFrame(animationId);
    if (bossShardGeometry) bossShardGeometry.dispose();
    if (bossShardMaterials) bossShardMaterials.forEach((material) => material.dispose());
    if (audio && audio.dispose) audio.dispose();
  });

  initialize();
})();
