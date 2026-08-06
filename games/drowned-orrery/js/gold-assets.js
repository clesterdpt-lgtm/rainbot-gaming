(function registerDrownedGoldAssets(global) {
  "use strict";

  const MODEL_ROOT = "drowned-orrery/models/gold-slice/";
  const MODEL_VERSION = "20260805-8";
  const MANIFEST_URL = MODEL_ROOT + "manifest.json?v=" + MODEL_VERSION;
  const fallbackFiles = Object.freeze({
    hero: "hero.glb",
    sentinel: "sentinel.glb",
    gate: "orrery_gate.glb",
  });

  const cache = {
    THREE: null,
    promise: null,
    hero: null,
    sentinel: null,
    gate: null,
    manifest: null,
    failures: [],
  };

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function assetDescriptor(key) {
    return cache.manifest && cache.manifest.assets ? cache.manifest.assets[key] : null;
  }

  function clipEvent(assetKey, clipName, eventName, fallback) {
    const descriptor = assetDescriptor(assetKey);
    const clip = descriptor && descriptor.clips ? descriptor.clips[clipName] : null;
    const value = clip ? Number(clip[eventName]) : NaN;
    return Number.isFinite(value) ? value : fallback;
  }

  function modelFile(key) {
    const descriptor = assetDescriptor(key);
    const candidate = descriptor && typeof descriptor.file === "string" ? descriptor.file : fallbackFiles[key];
    return /^[a-z0-9_.-]+$/i.test(candidate) ? candidate : fallbackFiles[key];
  }

  function loadManifest() {
    if (typeof global.fetch !== "function") return Promise.resolve(null);
    return global.fetch(MANIFEST_URL, { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error("Gold-slice manifest returned HTTP " + response.status + ".");
      return response.json();
    }).then((manifest) => {
      if (!manifest || manifest.schema !== 1 || !manifest.assets) throw new Error("Gold-slice manifest is invalid.");
      return manifest;
    });
  }

  function retimePhaseWithContactHold(phase, gameplayHit, authoredHit, holdFraction) {
    const value = clamp01(phase);
    const source = Math.max(0.08, Math.min(0.92, gameplayHit));
    const target = Math.max(0.08, Math.min(0.92, authoredHit));
    const halfHold = Math.max(0.02, Math.min(0.12, holdFraction || 0.08)) * 0.5;
    const holdStart = Math.max(0.001, source - halfHold);
    const holdEnd = Math.min(0.999, source + halfHold);
    if (value < holdStart) return value / holdStart * target;
    if (value <= holdEnd) return target;
    return target + (value - holdEnd) / (1 - holdEnd) * (1 - target);
  }

  function loadGltf(loader, url) {
    return new Promise((resolve, reject) => {
      loader.load(url, resolve, undefined, reject);
    });
  }

  function materialList(object) {
    return Array.isArray(object.material) ? object.material : [object.material];
  }

  function configureTexture(THREE, texture, colorTexture) {
    if (!texture) return;
    if (colorTexture) texture.encoding = THREE.sRGBEncoding;
    texture.anisotropy = Math.max(texture.anisotropy || 1, 4);
    texture.needsUpdate = true;
  }

  function configureScene(THREE, root, cloneMaterials) {
    const materials = [];
    const materialCopies = new Map();
    root.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = true;
      if (cloneMaterials) {
        if (Array.isArray(object.material)) {
          object.material = object.material.map((source) => {
            if (!materialCopies.has(source)) materialCopies.set(source, source.clone());
            return materialCopies.get(source);
          });
        } else if (object.material) {
          if (!materialCopies.has(object.material)) materialCopies.set(object.material, object.material.clone());
          object.material = materialCopies.get(object.material);
        }
      }
      materialList(object).forEach((material) => {
        if (!material || materials.indexOf(material) !== -1) return;
        materials.push(material);
        configureTexture(THREE, material.map, true);
        configureTexture(THREE, material.emissiveMap, true);
        configureTexture(THREE, material.normalMap, false);
        configureTexture(THREE, material.roughnessMap, false);
        configureTexture(THREE, material.metalnessMap, false);
        configureTexture(THREE, material.aoMap, false);
        const materialName = material.name || "";
        if (/Salted Ivory Canvas/i.test(materialName)) {
          material.roughness = 0.92;
          material.metalness = 0.0;
        } else if (/Indigo Oilskin/i.test(materialName)) {
          material.roughness = 0.42;
          material.metalness = 0.04;
          if (material.color) material.color.offsetHSL(-0.01, 0.08, 0.025);
        } else if (/Dark Oiled Leather/i.test(materialName)) {
          material.roughness = 0.58;
          material.metalness = 0.02;
        } else if (/Aged Meridian Bronze/i.test(materialName)) {
          material.roughness = 0.31;
          material.metalness = 0.84;
        } else if (/Pressure Black Iron/i.test(materialName)) {
          material.roughness = 0.46;
          material.metalness = 0.72;
        } else if (/Wet Tide Stone/i.test(materialName)) {
          material.roughness = 0.66;
          material.metalness = 0.03;
        } else if (/Drowned Mineral Stone/i.test(materialName)) {
          material.roughness = 0.82;
          material.metalness = 0.0;
        }
        if (material.normalScale && material.normalMap) material.normalScale.multiplyScalar(1.18);
        if (typeof material.envMapIntensity === "number") material.envMapIntensity = 0.9;
        material.needsUpdate = true;
      });
    });
    return materials;
  }

  function prepareSource(THREE, gltf) {
    if (!gltf || !gltf.scene) return null;
    configureScene(THREE, gltf.scene, false);
    return gltf;
  }

  function preload(THREE) {
    if (cache.promise) return cache.promise;
    cache.THREE = THREE;
    cache.failures.length = 0;
    cache.promise = Promise.resolve().then(() => {
      if (!THREE || typeof THREE.GLTFLoader !== "function") {
        throw new Error("The self-hosted Three.js GLTFLoader is unavailable.");
      }
      if (!THREE.SkeletonUtils || typeof THREE.SkeletonUtils.clone !== "function") {
        throw new Error("The self-hosted Three.js SkeletonUtils addon is unavailable.");
      }
      return loadManifest().catch((error) => {
        cache.failures.push({ key: "manifest", error: error });
        console.warn("[The Drowned Orrery] Gold-slice manifest unavailable; using the embedded fallback contract.", error);
        return null;
      });
    }).then((manifest) => {
      cache.manifest = manifest;
      const loader = new THREE.GLTFLoader();
      const entries = Object.keys(fallbackFiles);
      return Promise.all(entries.map((key) => loadGltf(loader, MODEL_ROOT + modelFile(key) + "?v=" + MODEL_VERSION)
        .then((gltf) => {
          cache[key] = prepareSource(THREE, gltf);
          return true;
        })
        .catch((error) => {
          cache[key] = null;
          cache.failures.push({ key: key, error: error });
          console.warn("[The Drowned Orrery] Gold asset fallback:", key, error);
          return false;
        })));
    }).then(() => ({
      hero: !!cache.hero,
      sentinel: !!cache.sentinel,
      gate: !!cache.gate,
      failures: cache.failures.slice(),
    })).catch((error) => {
      cache.failures.push({ key: "runtime", error: error });
      console.warn("[The Drowned Orrery] Gold asset runtime unavailable; using procedural actors.", error);
      return { hero: false, sentinel: false, gate: false, failures: cache.failures.slice() };
    });
    return cache.promise;
  }

  function makeContactShadow(THREE, radiusX, radiusZ, opacity) {
    const material = new THREE.MeshBasicMaterial({
      color: 0x020607,
      transparent: true,
      opacity: opacity,
      depthWrite: false,
      toneMapped: false,
    });
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 32), material);
    shadow.name = "gold-slice-contact-shadow";
    shadow.rotation.x = -Math.PI * 0.5;
    shadow.position.y = 0.012;
    shadow.scale.set(radiusX, radiusZ, 1);
    shadow.renderOrder = -1;
    shadow.receiveShadow = false;
    shadow.castShadow = false;
    return shadow;
  }

  function buildActions(THREE, mixer, clips) {
    const actions = Object.create(null);
    const clipMap = Object.create(null);
    (clips || []).forEach((clip) => {
      clipMap[clip.name] = clip;
      const action = mixer.clipAction(clip);
      action.enabled = true;
      actions[clip.name] = action;
    });
    return { actions: actions, clips: clipMap };
  }

  function createActor(kind, variant, gltf) {
    const THREE = cache.THREE;
    if (!THREE || !gltf || !gltf.scene || !THREE.SkeletonUtils) return null;
    const descriptor = assetDescriptor(kind === "hero" ? "hero" : "sentinel");
    const fallbackClips = kind === "hero"
      ? ["hero_idle", "hero_walk", "hero_run", "hero_turn_l", "hero_turn_r", "hero_dodge", "hero_strike_light", "hero_strike_heavy", "hero_gate_interact", "hero_hit", "hero_defeat"]
      : ["sentinel_idle", "sentinel_patrol", "sentinel_turn", "sentinel_alert", "sentinel_sweep", "sentinel_slam", "sentinel_hit", "sentinel_stagger", "sentinel_collapse"];
    const requiredClips = descriptor && descriptor.clips ? Object.keys(descriptor.clips) : fallbackClips;
    const availableClips = (gltf.animations || []).map((clip) => clip.name);
    const missingClip = requiredClips.find((name) => availableClips.indexOf(name) === -1);
    if (missingClip) throw new Error("Required animation clip is missing: " + missingClip);
    const model = THREE.SkeletonUtils.clone(gltf.scene);
    model.name = kind === "hero" ? "Tidemark Surveyor - Gold Slice" : "Bell Warden - Gold Slice";
    // Both authored marker_forward nodes resolve to local +Z after glTF axis
    // conversion while gameplay yaw zero faces -Z. The correction lives in the
    // manifest so model and adapter cannot silently diverge.
    const manifestYaw = descriptor ? Number(descriptor.runtimeYawRadians) : NaN;
    model.rotation.y = Number.isFinite(manifestYaw) ? manifestYaw : Math.PI;
    const materials = configureScene(THREE, model, true);
    const root = new THREE.Group();
    root.name = kind === "hero" ? "Vey - Gold Slice Actor" : "Bell Warden - Gold Slice Actor";
    root.add(model);
    const shadow = makeContactShadow(THREE, kind === "hero" ? 0.58 : 0.82, kind === "hero" ? 0.34 : 0.55, kind === "hero" ? 0.27 : 0.31);
    root.add(shadow);
    const mixer = new THREE.AnimationMixer(model);
    const animation = buildActions(THREE, mixer, gltf.animations);
    materials.forEach((material) => {
      if (!material || !material.emissive) return;
      material.userData = material.userData || {};
      material.userData.goldBaseEmissive = material.emissive.clone();
      material.userData.goldBaseEmissiveIntensity = Number(material.emissiveIntensity) || 0;
    });
    const actor = {
      root: root,
      body: model,
      shadow: shadow,
      hitParts: [],
      materials: materials,
      kind: kind,
      variant: Math.max(0, Math.floor(Number(variant) || 0)),
      rig: Object.create(null),
      _rig: Object.create(null),
      _gold: {
        mixer: mixer,
        model: model,
        actions: animation.actions,
        clips: animation.clips,
        currentName: "",
        currentAction: null,
        phaseDriven: false,
        lastFacing: null,
        turnDirection: 0,
        turnTimer: 0,
        lastAlert: 0,
        alertTimer: 0,
        accentMaterials: materials.filter((material) => /Compass Cyan|Sentinel Amber/i.test(material.name || "")),
        hitColor: new THREE.Color(kind === "hero" ? 0x72e0db : 0xff9fc8),
      },
    };
    model.traverse((object) => {
      if (object.isMesh && object.visible) actor.hitParts.push(object);
    });
    root.userData.actor = actor;
    root.userData.kind = kind;
    actor.dispose = function disposeActor() {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      materials.forEach((material) => material.dispose());
      shadow.geometry.dispose();
      shadow.material.dispose();
    };
    return actor;
  }

  function createHeroActor() {
    try {
      return createActor("hero", 0, cache.hero);
    } catch (error) {
      console.warn("[The Drowned Orrery] Hero import failed; using the procedural cartographer.", error);
      return null;
    }
  }

  function createWardenActor(THREE, variant) {
    // Keep the THREE argument for parity with the procedural actor factory contract.
    if (!cache.THREE && THREE) cache.THREE = THREE;
    try {
      return createActor("warden", variant, cache.sentinel);
    } catch (error) {
      console.warn("[The Drowned Orrery] Bell Warden import failed; using the procedural warden.", error);
      return null;
    }
  }

  function transition(actor, name, options) {
    const gold = actor._gold;
    const action = gold.actions[name];
    const clip = gold.clips[name];
    if (!action || !clip) return null;
    const settings = options || {};
    const loop = settings.loop !== false;
    const phaseDriven = typeof settings.phase === "number";
    if (gold.currentAction !== action) {
      const previous = gold.currentAction;
      action.reset();
      action.enabled = true;
      action.setLoop(loop ? cache.THREE.LoopRepeat : cache.THREE.LoopOnce, loop ? Infinity : 1);
      action.clampWhenFinished = !loop;
      action.setEffectiveWeight(1);
      action.setEffectiveTimeScale(typeof settings.timeScale === "number" ? settings.timeScale : 1);
      action.paused = phaseDriven;
      action.play();
      if (previous) previous.crossFadeTo(action, Math.max(0.04, settings.fade || 0.14), true);
      else action.fadeIn(Math.max(0.04, settings.fade || 0.14));
      gold.currentAction = action;
      gold.currentName = name;
    } else {
      action.setEffectiveTimeScale(typeof settings.timeScale === "number" ? settings.timeScale : 1);
      action.paused = phaseDriven;
    }
    gold.phaseDriven = phaseDriven;
    if (phaseDriven) action.time = clamp01(settings.phase) * clip.duration;
    return action;
  }

  function updateAccent(actor, intensity) {
    const pulse = 0.88 + Math.sin((actor._elapsed || 0) * 5.3 + actor.variant * 0.7) * 0.12;
    actor._gold.accentMaterials.forEach((material) => {
      material.emissiveIntensity = 1.35 + pulse + intensity;
    });
  }

  function updateSurfaceFlash(actor, hurt) {
    actor.materials.forEach((material) => {
      if (!material || !material.emissive || !material.userData || !material.userData.goldBaseEmissive) return;
      const isAccent = actor._gold.accentMaterials.indexOf(material) !== -1;
      material.emissive.copy(material.userData.goldBaseEmissive);
      if (!isAccent) material.emissiveIntensity = material.userData.goldBaseEmissiveIntensity;
    });
  }

  function signedAngleDelta(current, previous) {
    let delta = current - previous;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  }

  function updateTurnSignal(actor, state, dt, speed) {
    const gold = actor._gold;
    const facing = Number(state.facing);
    const step = Math.max(0, Number(dt) || 0);
    gold.turnTimer = Math.max(0, gold.turnTimer - step);
    if (!Number.isFinite(facing)) return;
    if (gold.lastFacing !== null) {
      const delta = signedAngleDelta(facing, gold.lastFacing);
      if (speed < 0.12 && Math.abs(delta) > 0.025) {
        gold.turnDirection = delta < 0 ? -1 : 1;
        gold.turnTimer = 0.34;
      }
    }
    gold.lastFacing = facing;
  }

  function updateHero(actor, state, dt, elapsed) {
    if (!actor || !actor._gold) return;
    state = state || {};
    actor._elapsed = typeof elapsed === "number" ? elapsed : (actor._elapsed || 0) + (dt || 0);
    const speed = clamp01(state.speed);
    const attack = clamp01(state.attackPhase);
    const hurt = clamp01(state.hurt);
    const combo = Math.max(0, Math.floor(Number(state.combo) || 0));
    updateTurnSignal(actor, state, dt, speed);
    let settings;
    if (state.dead) {
      settings = { name: "hero_defeat", loop: false, fade: 0.18 };
    } else if (attack > 0) {
      const heavyHit = clipEvent("hero", "hero_strike_heavy", "hit", 0.62);
      const lightHit = clipEvent("hero", "hero_strike_light", "hit", 0.46);
      settings = combo === 3
        ? { name: "hero_strike_heavy", loop: false, phase: retimePhaseWithContactHold(attack, 0.41, heavyHit, 0.12), fade: 0.07 }
        : { name: "hero_strike_light", loop: false, phase: retimePhaseWithContactHold(attack, 0.33, lightHit, 0.18), fade: 0.07 };
    } else if (state.interacting) {
      settings = { name: "hero_gate_interact", loop: false, fade: 0.09 };
    } else if (state.dodging) {
      settings = { name: "hero_dodge", loop: false, fade: 0.08 };
    } else if (hurt > 0) {
      settings = { name: "hero_hit", loop: false, phase: 1 - hurt, fade: 0.06 };
    } else if (actor._gold.turnTimer > 0) {
      settings = { name: actor._gold.turnDirection < 0 ? "hero_turn_l" : "hero_turn_r", loop: false, fade: 0.1 };
    } else if (speed > 0.62) {
      settings = { name: "hero_run", loop: true, timeScale: 0.76 + speed * 0.42, fade: 0.13 };
    } else if (speed > 0.045) {
      settings = { name: "hero_walk", loop: true, timeScale: 0.58 + speed * 0.78, fade: 0.16 };
    } else {
      settings = { name: "hero_idle", loop: true, timeScale: state.guarding ? 0.62 : 1, fade: 0.2 };
    }
    const action = transition(actor, settings.name, settings);
    actor._gold.mixer.update(Math.min(Math.max(Number(dt) || 0, 0), 0.08));
    if (action && typeof settings.phase === "number") {
      action.time = clamp01(settings.phase) * actor._gold.clips[settings.name].duration;
      actor._gold.mixer.update(0);
    }
    updateSurfaceFlash(actor, hurt);
    updateAccent(actor, clamp01(state.charge) * 1.8 + hurt * 1.2);
    actor.shadow.material.opacity = state.dead ? 0.14 : (state.grounded === false ? 0.12 : 0.27);
  }

  function updateWarden(actor, state, dt, elapsed) {
    if (!actor || !actor._gold) return;
    state = state || {};
    actor._elapsed = typeof elapsed === "number" ? elapsed : (actor._elapsed || 0) + (dt || 0);
    const speed = clamp01(state.speed);
    const attack = clamp01(state.attackPhase);
    const hurt = clamp01(state.hurt);
    const alert = clamp01(state.alert);
    const step = Math.max(0, Number(dt) || 0);
    updateTurnSignal(actor, state, dt, speed);
    actor._gold.alertTimer = Math.max(0, actor._gold.alertTimer - step);
    if (alert > 0.55 && actor._gold.lastAlert <= 0.55) actor._gold.alertTimer = 0.72;
    actor._gold.lastAlert = alert;
    let settings;
    if (state.dead) {
      settings = { name: "sentinel_collapse", loop: false, fade: 0.2 };
    } else if (attack > 0) {
      const slamHit = clipEvent("sentinel", "sentinel_slam", "hit", 0.64);
      const sweepHit = clipEvent("sentinel", "sentinel_sweep", "hit", 0.55);
      settings = actor.variant % 2
        ? { name: "sentinel_slam", loop: false, phase: retimePhaseWithContactHold(attack, 0.64, slamHit, 0.09), fade: 0.08 }
        : { name: "sentinel_sweep", loop: false, phase: retimePhaseWithContactHold(attack, 0.64, sweepHit, 0.07), fade: 0.08 };
    } else if (state.staggered) {
      settings = { name: "sentinel_stagger", loop: false, fade: 0.08 };
    } else if (hurt > 0) {
      settings = { name: "sentinel_hit", loop: false, phase: 1 - hurt, fade: 0.06 };
    } else if (actor._gold.alertTimer > 0) {
      settings = { name: "sentinel_alert", loop: false, fade: 0.08 };
    } else if (actor._gold.turnTimer > 0) {
      settings = { name: "sentinel_turn", loop: false, fade: 0.1 };
    } else if (speed > 0.045) {
      settings = { name: "sentinel_patrol", loop: true, timeScale: 0.62 + speed * 0.72, fade: 0.17 };
    } else {
      settings = { name: "sentinel_idle", loop: true, timeScale: 0.92, fade: 0.22 };
    }
    const action = transition(actor, settings.name, settings);
    actor._gold.mixer.update(Math.min(Math.max(Number(dt) || 0, 0), 0.08));
    if (action && typeof settings.phase === "number") {
      action.time = clamp01(settings.phase) * actor._gold.clips[settings.name].duration;
      actor._gold.mixer.update(0);
    }
    const recoilEase = 1 - Math.exp(-24 * step);
    const recoilSide = actor.variant % 2 ? 1 : -1;
    actor.body.position.y += (hurt * 0.08 - actor.body.position.y) * recoilEase;
    actor.body.position.z += (hurt * 0.24 - actor.body.position.z) * recoilEase;
    actor.body.rotation.x += (-hurt * 0.09 - actor.body.rotation.x) * recoilEase;
    actor.body.rotation.z += (hurt * 0.075 * recoilSide - actor.body.rotation.z) * recoilEase;
    updateAccent(actor, clamp01(state.charge) * 2.2 + hurt * 0.65 + (state.staggered ? 0.35 : 0));
    actor.shadow.material.opacity = state.dead ? 0.12 : 0.31;
  }

  function attachGateVisual(THREE, gate) {
    if (!THREE || !gate || !gate.root || !cache.gate || gate._goldVisual) return false;
    const legacyVisuals = gate.root.children.slice();
    legacyVisuals.forEach((child) => {
      if (!child.isLight) child.visible = false;
    });
    const visual = cache.gate.scene.clone(true);
    visual.name = "Meridian Lock - Gold Slice Shell";
    const materials = configureScene(THREE, visual, true);
    visual.scale.setScalar(0.54);
    visual.position.set(0, -0.12, 0);
    gate.root.add(visual);
    gate._goldVisual = visual;
    gate._goldMaterials = materials;
    const aperture = materials.filter((material) => /Aperture Cold Fire/i.test(material.name || ""));
    let mechanism = visual.getObjectByName("Meridian Lock Mechanism");
    if (!mechanism) {
      visual.traverse((object) => {
        if (!mechanism && object.userData && object.userData.mechanism_role === "aperture_rotor") {
          mechanism = object;
        }
      });
    }
    const gateMixer = new THREE.AnimationMixer(visual);
    const gateAnimation = buildActions(THREE, gateMixer, cache.gate.animations || []);
    const gateDescriptor = assetDescriptor("gate");
    const requiredGateClips = gateDescriptor && gateDescriptor.clips
      ? Object.keys(gateDescriptor.clips)
      : ["gate_closed_idle", "gate_unlock", "gate_open_idle"];
    const hasAuthoredGateMotion = requiredGateClips.every((name) => !!gateAnimation.actions[name]);
    const gateActor = {
      _gold: {
        mixer: gateMixer,
        actions: gateAnimation.actions,
        clips: gateAnimation.clips,
        currentName: "",
        currentAction: null,
        phaseDriven: false,
      },
    };
    function placeMechanism(openAmount) {
      if (!mechanism) return;
      mechanism.rotation.z = openAmount * Math.PI;
      mechanism.scale.setScalar(1 - openAmount * 0.92);
    }
    function updateGateMotion(openAmount, dt, reduceMotion) {
      if (!hasAuthoredGateMotion) {
        placeMechanism(openAmount);
        return;
      }
      let settings;
      if (openAmount <= 0.001) {
        settings = { name: "gate_closed_idle", loop: true, timeScale: reduceMotion ? 0 : 1, fade: 0.12 };
      } else if (openAmount >= 0.999) {
        settings = { name: "gate_open_idle", loop: true, timeScale: reduceMotion ? 0 : 1, fade: 0.12 };
      } else {
        settings = { name: "gate_unlock", loop: false, phase: openAmount, fade: 0.08 };
      }
      const action = transition(gateActor, settings.name, settings);
      gateMixer.update(Math.min(Math.max(Number(dt) || 0, 0), 0.08));
      if (action && typeof settings.phase === "number") {
        action.time = clamp01(settings.phase) * gateAnimation.clips[settings.name].duration;
        gateMixer.update(0);
      }
    }
    updateGateMotion(clamp01(gate._amount), 0, false);
    gate._goldAnimation = gateActor;
    const originalUpdate = gate._update;
    gate._update = function updateGoldGate(dt, elapsed, reduceMotion) {
      originalUpdate.call(gate, dt, elapsed, reduceMotion);
      const openAmount = clamp01(gate._amount);
      const shimmer = reduceMotion ? 0 : Math.sin((Number(elapsed) || 0) * 2.1) * 0.14;
      updateGateMotion(openAmount, dt, reduceMotion);
      aperture.forEach((material) => {
        material.emissiveIntensity = 1.85 + shimmer + openAmount * 1.35;
      });
    };
    return true;
  }

  global.DrownedGoldAssets = Object.freeze({
    preload: preload,
    createHeroActor: createHeroActor,
    createWardenActor: createWardenActor,
    updateHero: updateHero,
    updateWarden: updateWarden,
    attachGateVisual: attachGateVisual,
    status: function status() {
      return { hero: !!cache.hero, sentinel: !!cache.sentinel, gate: !!cache.gate, manifest: !!cache.manifest, version: MODEL_VERSION, failures: cache.failures.slice() };
    },
  });
})(typeof window !== "undefined" ? window : globalThis);
