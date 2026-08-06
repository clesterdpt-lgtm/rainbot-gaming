(function registerDrownedActors(global) {
  "use strict";

  const PI = Math.PI;
  const TAU = PI * 2;

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function smoothstep(value) {
    const x = clamp01(value);
    return x * x * (3 - 2 * x);
  }

  function damp(current, target, speed, dt) {
    return current + (target - current) * (1 - Math.exp(-speed * Math.min(dt || 0, 0.1)));
  }

  function dampAngle(current, target, speed, dt) {
    const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
    return current + delta * (1 - Math.exp(-speed * Math.min(dt || 0, 0.1)));
  }

  function numberFrom(state, names, fallback) {
    for (let i = 0; i < names.length; i += 1) {
      const value = state && state[names[i]];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return fallback;
  }

  function truthyFrom(state, names) {
    for (let i = 0; i < names.length; i += 1) {
      if (state && state[names[i]]) return true;
    }
    return false;
  }

  function createContext(THREE) {
    return {
      THREE: THREE,
      geometries: [],
      materials: [],
      meshes: [],
      hitParts: [],
    };
  }

  function keepGeometry(ctx, geometry) {
    ctx.geometries.push(geometry);
    return geometry;
  }

  function keepMaterial(ctx, material) {
    ctx.materials.push(material);
    return material;
  }

  function standard(ctx, color, roughness, metalness, emissive, emissiveIntensity) {
    const THREE = ctx.THREE;
    const material = new THREE.MeshStandardMaterial({
      color: color,
      roughness: roughness,
      metalness: metalness,
      emissive: emissive || 0x000000,
      emissiveIntensity: emissiveIntensity || 0,
    });
    material.userData.baseEmissiveIntensity = material.emissiveIntensity;
    return keepMaterial(ctx, material);
  }

  function physical(ctx, options) {
    const THREE = ctx.THREE;
    const material = new THREE.MeshPhysicalMaterial(options);
    material.userData.baseEmissiveIntensity = material.emissiveIntensity || 0;
    return keepMaterial(ctx, material);
  }

  function glowMaterial(ctx, color, opacity) {
    const THREE = ctx.THREE;
    return keepMaterial(ctx, new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: opacity === undefined ? 0.92 : opacity,
      toneMapped: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
  }

  function makeGroup(THREE, parent, name, position) {
    const node = new THREE.Group();
    node.name = name;
    if (position) node.position.set(position[0], position[1], position[2]);
    if (parent) parent.add(node);
    return node;
  }

  function markHit(ctx, mesh, zone, multiplier) {
    if (!zone) return;
    mesh.userData.hitPart = zone;
    mesh.userData.hitZone = { name: zone, multiplier: multiplier === undefined ? 1 : multiplier };
    ctx.hitParts.push(mesh);
  }

  function mesh(ctx, parent, geometry, material, options) {
    const THREE = ctx.THREE;
    const opts = options || {};
    const object = new THREE.Mesh(geometry, material);
    object.name = opts.name || "actor-part";
    if (opts.position) object.position.set(opts.position[0], opts.position[1], opts.position[2]);
    if (opts.rotation) object.rotation.set(opts.rotation[0], opts.rotation[1], opts.rotation[2]);
    if (opts.scale) object.scale.set(opts.scale[0], opts.scale[1], opts.scale[2]);
    object.castShadow = opts.castShadow !== false;
    object.receiveShadow = opts.receiveShadow !== false;
    if (opts.renderOrder !== undefined) object.renderOrder = opts.renderOrder;
    markHit(ctx, object, opts.hit, opts.multiplier);
    parent.add(object);
    ctx.meshes.push(object);
    return object;
  }

  function polygonPrism(ctx, points, depth, bevel) {
    const THREE = ctx.THREE;
    const shape = new THREE.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) shape.lineTo(points[i][0], points[i][1]);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: depth,
      steps: 1,
      bevelEnabled: Boolean(bevel),
      bevelSegments: 1,
      bevelSize: bevel || 0,
      bevelThickness: bevel || 0,
      curveSegments: 2,
    });
    geometry.translate(0, 0, -depth * 0.5);
    geometry.computeVertexNormals();
    return keepGeometry(ctx, geometry);
  }

  function drapedPanel(ctx, options) {
    const THREE = ctx.THREE;
    const opts = options || {};
    const widthTop = opts.widthTop || 0.5;
    const widthBottom = opts.widthBottom || widthTop * 0.7;
    const height = opts.height || 0.7;
    const drift = opts.drift || 0;
    const curve = opts.curve || 0;
    const fold = opts.fold || 0.025;
    const folds = opts.folds || 3;
    const xSegments = opts.xSegments || 7;
    const ySegments = opts.ySegments || 8;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let y = 0; y <= ySegments; y += 1) {
      const v = y / ySegments;
      const width = widthTop + (widthBottom - widthTop) * smoothstep(v);
      for (let x = 0; x <= xSegments; x += 1) {
        const u = x / xSegments;
        const centered = u - 0.5;
        const hem = y === ySegments ? (Math.sin(u * PI * 3.1) * 0.022 + Math.abs(centered) * 0.018) : 0;
        const foldEnvelope = 0.35 + v * 0.65;
        positions.push(
          centered * width + drift * v,
          -v * height - hem,
          Math.sin(u * PI * folds) * fold * foldEnvelope + curve * v * v + Math.cos(v * PI) * 0.008,
        );
        uvs.push(u, 1 - v);
      }
    }
    for (let y = 0; y < ySegments; y += 1) {
      for (let x = 0; x < xSegments; x += 1) {
        const a = y * (xSegments + 1) + x;
        const b = a + 1;
        const c = a + xSegments + 1;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return keepGeometry(ctx, geometry);
  }

  function lathe(ctx, profile, segments) {
    const THREE = ctx.THREE;
    const points = [];
    for (let i = 0; i < profile.length; i += 1) {
      points.push(new THREE.Vector2(profile[i][0], profile[i][1]));
    }
    return keepGeometry(ctx, new THREE.LatheGeometry(points, segments || 12));
  }

  function branch(ctx, parent, start, end, radiusStart, radiusEnd, material, name, hit) {
    const THREE = ctx.THREE;
    const a = new THREE.Vector3(start[0], start[1], start[2]);
    const b = new THREE.Vector3(end[0], end[1], end[2]);
    const direction = b.clone().sub(a);
    const length = Math.max(0.001, direction.length());
    const geometry = keepGeometry(ctx, new THREE.CylinderGeometry(
      radiusEnd,
      radiusStart,
      length,
      10,
      1,
      false,
    ));
    const object = mesh(ctx, parent, geometry, material, {
      name: name,
      position: [(a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5],
      hit: hit,
      multiplier: hit === "head" ? 1.25 : 0.8,
    });
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return object;
  }

  function limb(ctx, parent, name, length, topRadius, bottomRadius, material, hit) {
    const THREE = ctx.THREE;
    const pivot = makeGroup(THREE, parent, name + "-pivot", [0, 0, 0]);
    const middleRadius = (topRadius + bottomRadius) * 0.5;
    const geometry = lathe(ctx, [
      [topRadius * 0.72, 0],
      [topRadius, -length * 0.1],
      [topRadius * 0.94, -length * 0.32],
      [middleRadius * 0.95, -length * 0.58],
      [bottomRadius * 1.08, -length * 0.84],
      [bottomRadius * 0.82, -length],
    ], 16);
    mesh(ctx, pivot, geometry, material, {
      name: name,
      hit: hit || "limb",
      multiplier: 0.72,
    });
    return pivot;
  }

  function contactShadow(ctx, parent, width, depth, opacity) {
    const THREE = ctx.THREE;
    const material = keepMaterial(ctx, new THREE.MeshBasicMaterial({
      color: 0x05070a,
      transparent: true,
      opacity: opacity,
      depthWrite: false,
      fog: false,
    }));
    const geometry = keepGeometry(ctx, new THREE.CircleGeometry(1, 32));
    const shadow = mesh(ctx, parent, geometry, material, {
      name: "contact-shadow",
      position: [0, 0.018, 0],
      rotation: [-PI * 0.5, 0, 0],
      scale: [width, depth, 1],
      castShadow: false,
      receiveShadow: false,
      renderOrder: -2,
    });
    return shadow;
  }

  function finishActor(ctx, actor) {
    actor.root.traverse(function configureActorPart(object) {
      if (object.isMesh) {
        object.frustumCulled = true;
        if (object.material && object.material.transparent) object.renderOrder = object.renderOrder || 2;
      }
    });
    actor.root.userData.actor = actor;
    actor.root.userData.kind = actor.kind;
    actor.hitParts = ctx.hitParts;
    actor.materials = ctx.materials;
    actor.dispose = function disposeActor() {
      for (let i = 0; i < ctx.geometries.length; i += 1) ctx.geometries[i].dispose();
      for (let i = 0; i < ctx.materials.length; i += 1) ctx.materials[i].dispose();
    };
    return actor;
  }

  function polishImportedGoldActor(THREE, actor) {
    if (!actor || !actor._gold || !Array.isArray(actor.materials)) return actor;
    const neutralHighlight = new THREE.Color(0xfff4dc);
    for (let i = 0; i < actor.materials.length; i += 1) {
      const material = actor.materials[i];
      if (!material) continue;
      // Blender's authored values are preserved, but a small neutral lift keeps
      // the glTF albedo from collapsing into the valley's green ambient fill.
      if (material.color) {
        const metallic = typeof material.metalness === "number" && material.metalness > 0.22;
        material.color.lerp(neutralHighlight, metallic ? 0.075 : 0.045);
      }
      if (typeof material.roughness === "number") {
        material.roughness = Math.max(0.2, Math.min(0.94, material.roughness * 0.88));
      }
      if (typeof material.metalness === "number" && material.metalness > 0.16) {
        material.metalness = Math.min(1, material.metalness * 1.08);
      }
      material.dithering = true;
      material.needsUpdate = true;
    }
    return actor;
  }

  function createHero(THREE) {
    if (global.DrownedGoldAssets && typeof global.DrownedGoldAssets.createHeroActor === "function") {
      const importedHero = global.DrownedGoldAssets.createHeroActor(THREE);
      if (importedHero) return polishImportedGoldActor(THREE, importedHero);
    }
    const ctx = createContext(THREE);
    const root = new THREE.Group();
    root.name = "Ilyra Vale - sky cartographer";
    const shadow = contactShadow(ctx, root, 0.59, 0.4, 0.34);
    const innerShadow = contactShadow(ctx, root, 0.36, 0.245, 0.2);
    innerShadow.name = "inner-contact-shadow";
    innerShadow.position.y = 0.021;
    innerShadow.renderOrder = -1;
    const body = makeGroup(THREE, root, "hero-body", [0, 0, 0]);

    const navy = standard(ctx, 0x0b172b, 0.9, 0.025);
    const navyLight = standard(ctx, 0x31425c, 0.7, 0.1);
    const ivory = standard(ctx, 0xd8d0bb, 0.96, 0.005);
    ivory.side = THREE.DoubleSide;
    const ivoryShade = standard(ctx, 0xb8ad93, 0.9, 0.025);
    ivoryShade.side = THREE.DoubleSide;
    const ivoryEdge = standard(ctx, 0xa88f61, 0.54, 0.38);
    const coral = standard(ctx, 0xec725d, 0.7, 0.035);
    coral.side = THREE.DoubleSide;
    const coralShade = standard(ctx, 0xa84e49, 0.82, 0.03);
    coralShade.side = THREE.DoubleSide;
    const bronze = physical(ctx, {
      color: 0x8c6c3e,
      roughness: 0.34,
      metalness: 0.86,
      clearcoat: 0.12,
      clearcoatRoughness: 0.5,
    });
    const darkBronze = standard(ctx, 0x3e342a, 0.44, 0.76);
    const skin = standard(ctx, 0x8f5f46, 0.9, 0);
    const hair = standard(ctx, 0x17141a, 0.84, 0.02);
    const leather = standard(ctx, 0x382725, 0.88, 0.04);
    const cyan = standard(ctx, 0x89f0e6, 0.24, 0.22, 0x43d7d5, 1.8);
    const cyanGlow = glowMaterial(ctx, 0x6ffff4, 0.62);

    const heroKey = new THREE.PointLight(0xffdfad, 0.36, 3.15, 2);
    heroKey.name = "soft-cartographer-key";
    heroKey.position.set(-0.7, 2.35, 1.05);
    root.add(heroKey);

    const sphere = keepGeometry(ctx, new THREE.SphereGeometry(0.5, 24, 18));
    const lowSphere = keepGeometry(ctx, new THREE.SphereGeometry(0.5, 16, 12));
    const box = keepGeometry(ctx, new THREE.BoxGeometry(1, 1, 1));
    const torusSmall = keepGeometry(ctx, new THREE.TorusGeometry(0.15, 0.025, 6, 18));

    const pelvis = makeGroup(THREE, body, "pelvis-pivot", [0, 1.1, 0]);
    mesh(ctx, pelvis, lowSphere, navy, {
      name: "tailored-hip-wrap",
      scale: [0.325, 0.25, 0.275],
      hit: "body",
    });
    mesh(ctx, pelvis, keepGeometry(ctx, new THREE.CylinderGeometry(0.33, 0.315, 0.085, 16)), leather, {
      name: "survey-belt",
      position: [0, 0.12, 0],
      hit: "body",
    });
    mesh(ctx, pelvis, keepGeometry(ctx, new THREE.CylinderGeometry(0.07, 0.07, 0.18, 12)), cyan, {
      name: "belt-lens",
      position: [-0.29, 0.12, -0.17],
      rotation: [PI * 0.5, 0, 0],
    });

    const spine = makeGroup(THREE, body, "spine-pivot", [0, 1.24, 0]);
    const torsoGeometry = lathe(ctx, [
      [0.255, 0],
      [0.29, 0.1],
      [0.32, 0.3],
      [0.365, 0.57],
      [0.31, 0.78],
    ], 18);
    mesh(ctx, spine, torsoGeometry, navy, {
      name: "navy-travel-coat",
      hit: "body",
    });
    const chestPanel = polygonPrism(ctx, [
      [-0.23, -0.31],
      [0.22, -0.27],
      [0.27, 0.22],
      [0.08, 0.38],
      [-0.25, 0.27],
    ], 0.055, 0.012);
    mesh(ctx, spine, chestPanel, navyLight, {
      name: "cartographer-chest-panel",
      position: [0, 0.41, -0.31],
      hit: "body",
    });
    mesh(ctx, spine, keepGeometry(ctx, new THREE.CylinderGeometry(0.018, 0.018, 0.5, 6)), ivoryEdge, {
      name: "chest-map-seam",
      position: [0.02, 0.38, -0.348],
      rotation: [0, 0, -0.58],
      castShadow: false,
    });
    const backPanelGeometry = polygonPrism(ctx, [
      [-0.17, -0.28],
      [0.17, -0.28],
      [0.23, 0.24],
      [0.1, 0.39],
      [-0.16, 0.34],
      [-0.22, 0.08],
    ], 0.042, 0.012);
    mesh(ctx, spine, backPanelGeometry, navyLight, {
      name: "tapered-cartographer-back-panel",
      position: [0.03, 0.4, 0.305],
      hit: "body",
    });
    mesh(ctx, spine, keepGeometry(ctx, new THREE.CylinderGeometry(0.015, 0.015, 0.48, 8)), coralShade, {
      name: "back-panel-coral-binding",
      position: [0.12, 0.42, 0.34],
      rotation: [0, 0, -0.26],
      castShadow: false,
    });

    const mantle = makeGroup(THREE, spine, "asymmetric-ivory-mantle", [-0.13, 0.75, 0.305]);
    const mantleYoke = makeGroup(THREE, mantle, "mantle-draped-yoke", [0.02, 0, 0]);
    const yokeGeometry = drapedPanel(ctx, {
      widthTop: 0.49,
      widthBottom: 0.34,
      height: 0.235,
      drift: -0.09,
      curve: 0.026,
      fold: 0.017,
      folds: 3,
      xSegments: 12,
      ySegments: 7,
    });
    mesh(ctx, mantleYoke, yokeGeometry, ivoryShade, {
      name: "soft-mantle-yoke",
      position: [-0.04, 0, 0],
      rotation: [-0.04, 0, 0.025],
      hit: "body",
    });
    const mantleMain = makeGroup(THREE, mantle, "mantle-main-fold-pivot", [-0.105, -0.075, 0.034]);
    const mantleMainGeometry = drapedPanel(ctx, {
      widthTop: 0.37,
      widthBottom: 0.18,
      height: 0.61,
      drift: -0.17,
      curve: 0.07,
      fold: 0.022,
      folds: 3,
      xSegments: 12,
      ySegments: 12,
    });
    mesh(ctx, mantleMain, mantleMainGeometry, ivory, {
      name: "long-asymmetric-cloth-fold",
      rotation: [-0.02, 0.02, 0.075],
      hit: "body",
    });
    const mantleSide = makeGroup(THREE, mantle, "mantle-side-fold-pivot", [-0.405, -0.095, 0.06]);
    const mantleSideGeometry = drapedPanel(ctx, {
      widthTop: 0.14,
      widthBottom: 0.07,
      height: 0.48,
      drift: -0.095,
      curve: 0.078,
      fold: 0.012,
      folds: 2,
      xSegments: 6,
      ySegments: 10,
    });
    mesh(ctx, mantleSide, mantleSideGeometry, ivoryShade, {
      name: "shadowed-side-cloth-fold",
      rotation: [-0.035, -0.1, -0.085],
    });
    const mantleRibbon = makeGroup(THREE, mantle, "mantle-edge-ribbon-pivot", [-0.31, -0.125, 0.084]);
    const mantleRibbonGeometry = drapedPanel(ctx, {
      widthTop: 0.046,
      widthBottom: 0.026,
      height: 0.43,
      drift: -0.07,
      curve: 0.075,
      fold: 0.006,
      folds: 2,
      xSegments: 3,
      ySegments: 9,
    });
    mesh(ctx, mantleRibbon, mantleRibbonGeometry, coral, {
      name: "mantle-bound-edge",
      rotation: [-0.02, 0.03, 0.03],
    });
    mesh(ctx, mantle, lowSphere, ivory, {
      name: "draped-left-shoulder-cap",
      position: [-0.3, 0.012, -0.005],
      scale: [0.245, 0.105, 0.22],
      rotation: [0.08, 0.05, -0.08],
      hit: "body",
    });
    mesh(ctx, mantle, keepGeometry(ctx, new THREE.TorusGeometry(0.145, 0.016, 6, 22, PI * 1.55)), ivoryEdge, {
      name: "mantle-tailored-piping",
      position: [-0.3, -0.008, -0.212],
      rotation: [0, 0, -0.3],
    });
    mesh(ctx, mantle, keepGeometry(ctx, new THREE.CylinderGeometry(0.055, 0.055, 0.026, 14)), coral, {
      name: "mantle-star-clasp",
      position: [0.245, -0.02, -0.07],
      rotation: [PI * 0.5, 0, 0],
    });

    const neck = makeGroup(THREE, body, "neck-pivot", [0, 2.0, 0]);
    mesh(ctx, neck, keepGeometry(ctx, new THREE.CylinderGeometry(0.105, 0.13, 0.145, 16)), skin, {
      name: "neck",
      position: [0, 0.015, 0],
      hit: "head",
      multiplier: 1.15,
    });
    mesh(ctx, neck, keepGeometry(ctx, new THREE.TorusGeometry(0.142, 0.03, 7, 22)), navyLight, {
      name: "high-travel-collar",
      position: [0, -0.055, 0],
      rotation: [PI * 0.5, 0, 0],
    });
    const head = makeGroup(THREE, neck, "head-pivot", [0, 0.09, 0]);
    mesh(ctx, head, sphere, skin, {
      name: "hero-head",
      position: [0, 0.13, -0.012],
      scale: [0.25, 0.278, 0.235],
      hit: "head",
      multiplier: 1.35,
    });
    mesh(ctx, head, sphere, skin, {
      name: "soft-jawline",
      position: [0, 0.025, -0.018],
      scale: [0.205, 0.18, 0.195],
      hit: "head",
      multiplier: 1.3,
    });
    mesh(ctx, head, lowSphere, hair, {
      name: "windswept-hair-cap",
      position: [-0.008, 0.155, 0.075],
      scale: [0.258, 0.282, 0.205],
      rotation: [0.02, 0, -0.035],
      hit: "head",
      multiplier: 1.3,
    });
    mesh(ctx, head, keepGeometry(ctx, new THREE.ConeGeometry(0.09, 0.34, 12)), hair, {
      name: "left-swept-hair-lock",
      position: [-0.195, 0.105, 0.095],
      rotation: [0.16, 0.02, -0.24],
    });
    mesh(ctx, head, keepGeometry(ctx, new THREE.ConeGeometry(0.075, 0.29, 12)), hair, {
      name: "right-swept-hair-lock",
      position: [0.195, 0.135, 0.09],
      rotation: [0.12, -0.04, 0.3],
    });
    const hairTail = makeGroup(THREE, head, "bound-wind-braid-pivot", [0.19, 0.265, 0.165]);
    mesh(ctx, hairTail, lowSphere, hair, {
      name: "sculpted-hair-knot",
      position: [0, 0, 0],
      scale: [0.135, 0.12, 0.13],
    });
    mesh(ctx, hairTail, keepGeometry(ctx, new THREE.CylinderGeometry(0.05, 0.065, 0.055, 12)), coral, {
      name: "coral-hair-binding",
      position: [0.035, -0.095, 0.025],
      rotation: [0.12, 0, -0.28],
    });
    mesh(ctx, hairTail, keepGeometry(ctx, new THREE.ConeGeometry(0.072, 0.34, 12)), hair, {
      name: "tapered-wind-braid",
      position: [0.08, -0.22, 0.055],
      rotation: [0.2, 0.05, -0.32],
    });
    mesh(ctx, head, lowSphere, skin, {
      name: "nose",
      position: [0, 0.135, -0.222],
      scale: [0.036, 0.055, 0.052],
    });
    const eyeGeometry = keepGeometry(ctx, new THREE.SphereGeometry(0.018, 8, 6));
    mesh(ctx, head, eyeGeometry, cyan, {
      name: "left-eye-glint",
      position: [-0.077, 0.19, -0.216],
      castShadow: false,
    });
    mesh(ctx, head, eyeGeometry, cyan, {
      name: "right-eye-glint",
      position: [0.077, 0.19, -0.216],
      castShadow: false,
    });

    const leftUpperArm = limb(ctx, body, "left-upper-arm", 0.48, 0.135, 0.11, navy, "limb");
    leftUpperArm.position.set(-0.43, 1.93, 0);
    mesh(ctx, leftUpperArm, sphere, navyLight, {
      name: "left-rounded-shoulder",
      position: [0, -0.04, 0],
      scale: [0.15, 0.145, 0.17],
      hit: "limb",
      multiplier: 0.72,
    });
    const leftForearm = limb(ctx, leftUpperArm, "left-forearm", 0.45, 0.12, 0.085, navyLight, "limb");
    leftForearm.position.y = -0.46;
    const leftHand = mesh(ctx, leftForearm, sphere, skin, {
      name: "left-hand",
      position: [0, -0.45, 0],
      scale: [0.09, 0.115, 0.085],
      hit: "limb",
      multiplier: 0.65,
    });

    const rightUpperArm = limb(ctx, body, "right-upper-arm", 0.48, 0.135, 0.11, navy, "limb");
    rightUpperArm.position.set(0.455, 1.93, 0);
    mesh(ctx, rightUpperArm, sphere, navyLight, {
      name: "right-rounded-shoulder",
      position: [0, -0.04, 0],
      scale: [0.15, 0.145, 0.17],
      hit: "limb",
      multiplier: 0.72,
    });
    const rightForearm = limb(ctx, rightUpperArm, "right-forearm", 0.45, 0.12, 0.085, navyLight, "limb");
    rightForearm.position.y = -0.46;
    const rightHand = mesh(ctx, rightForearm, sphere, skin, {
      name: "right-hand",
      position: [0, -0.45, 0],
      scale: [0.09, 0.115, 0.085],
      hit: "limb",
      multiplier: 0.65,
    });

    const bracer = makeGroup(THREE, leftForearm, "luminous-prism-bracer", [0, -0.24, 0]);
    mesh(ctx, bracer, keepGeometry(ctx, new THREE.CylinderGeometry(0.145, 0.12, 0.3, 14)), bronze, {
      name: "bracer-bronze-cage",
      rotation: [0, 0, 0],
      hit: "limb",
      multiplier: 0.72,
    });
    mesh(ctx, bracer, keepGeometry(ctx, new THREE.TorusGeometry(0.13, 0.018, 7, 20)), darkBronze, {
      name: "bracer-upper-binding",
      position: [0, 0.115, 0],
      rotation: [PI * 0.5, 0, 0],
    });
    mesh(ctx, bracer, keepGeometry(ctx, new THREE.TorusGeometry(0.115, 0.016, 7, 20)), darkBronze, {
      name: "bracer-lower-binding",
      position: [0, -0.115, 0],
      rotation: [PI * 0.5, 0, 0],
    });
    const bracerLens = mesh(ctx, bracer, keepGeometry(ctx, new THREE.OctahedronGeometry(0.135, 1)), cyan, {
      name: "bracer-prism",
      position: [0, 0, 0.145],
      rotation: [0, 0, PI * 0.25],
    });
    const bracerAura = mesh(ctx, bracer, keepGeometry(ctx, new THREE.SphereGeometry(0.19, 16, 10)), cyanGlow, {
      name: "bracer-aura",
      position: [0, 0, 0.155],
      scale: [1, 0.74, 0.52],
      castShadow: false,
      receiveShadow: false,
    });
    const bracerLight = new THREE.PointLight(0x67fff2, 0.68, 2.25, 2);
    bracerLight.name = "prism-bracer-light";
    bracerLight.position.set(0, 0, 0.18);
    bracer.add(bracerLight);

    const leftThigh = limb(ctx, body, "left-thigh", 0.54, 0.165, 0.125, navy, "limb");
    leftThigh.position.set(-0.22, 1.02, 0);
    const leftShin = limb(ctx, leftThigh, "left-shin", 0.51, 0.13, 0.09, navyLight, "limb");
    leftShin.position.y = -0.52;
    mesh(ctx, leftShin, sphere, darkBronze, {
      name: "left-sculpted-knee",
      position: [0, 0.015, -0.035],
      scale: [0.14, 0.105, 0.145],
      hit: "limb",
      multiplier: 0.68,
    });
    const leftFoot = mesh(ctx, leftShin, sphere, leather, {
      name: "left-boot",
      position: [0, -0.5, -0.095],
      scale: [0.19, 0.13, 0.32],
      hit: "limb",
      multiplier: 0.65,
    });
    mesh(ctx, leftShin, keepGeometry(ctx, new THREE.CylinderGeometry(0.135, 0.12, 0.16, 14)), leather, {
      name: "left-boot-cuff",
      position: [0, -0.39, 0],
    });
    const rightThigh = limb(ctx, body, "right-thigh", 0.54, 0.165, 0.125, navy, "limb");
    rightThigh.position.set(0.22, 1.02, 0);
    const rightShin = limb(ctx, rightThigh, "right-shin", 0.51, 0.13, 0.09, navyLight, "limb");
    rightShin.position.y = -0.52;
    mesh(ctx, rightShin, sphere, darkBronze, {
      name: "right-sculpted-knee",
      position: [0, 0.015, -0.035],
      scale: [0.14, 0.105, 0.145],
      hit: "limb",
      multiplier: 0.68,
    });
    const rightFoot = mesh(ctx, rightShin, sphere, leather, {
      name: "right-boot",
      position: [0, -0.5, -0.095],
      scale: [0.19, 0.13, 0.32],
      hit: "limb",
      multiplier: 0.65,
    });
    mesh(ctx, rightShin, keepGeometry(ctx, new THREE.CylinderGeometry(0.135, 0.12, 0.16, 14)), leather, {
      name: "right-boot-cuff",
      position: [0, -0.39, 0],
    });

    const coatTailLeft = makeGroup(THREE, pelvis, "left-coat-tail-pivot", [-0.125, 0.08, 0.27]);
    mesh(ctx, coatTailLeft, drapedPanel(ctx, {
      widthTop: 0.24,
      widthBottom: 0.18,
      height: 0.42,
      drift: -0.035,
      curve: 0.055,
      fold: 0.012,
      folds: 2,
      xSegments: 5,
      ySegments: 8,
    }), navy, {
      name: "left-split-travel-coat-tail",
      rotation: [0.02, 0, -0.025],
    });
    const coatTailRight = makeGroup(THREE, pelvis, "right-coat-tail-pivot", [0.125, 0.08, 0.272]);
    mesh(ctx, coatTailRight, drapedPanel(ctx, {
      widthTop: 0.24,
      widthBottom: 0.18,
      height: 0.38,
      drift: 0.035,
      curve: 0.052,
      fold: 0.012,
      folds: 2,
      xSegments: 5,
      ySegments: 8,
    }), navyLight, {
      name: "right-split-travel-coat-tail",
      rotation: [0.025, 0, 0.025],
    });

    const sashBand = mesh(ctx, pelvis, keepGeometry(ctx, new THREE.CylinderGeometry(0.365, 0.345, 0.11, 18, 1, true)), coral, {
      name: "coral-sash-waist-wrap",
      position: [0, 0.135, 0],
      rotation: [0.02, 0, -0.035],
      hit: "body",
    });
    const sash = makeGroup(THREE, pelvis, "coral-navigation-sash", [0.265, 0.15, 0.255]);
    mesh(ctx, sash, sphere, coral, {
      name: "sculpted-sash-knot",
      position: [0.08, -0.02, 0],
      scale: [0.115, 0.09, 0.085],
    });
    const sashPanelGeometry = drapedPanel(ctx, {
      widthTop: 0.19,
      widthBottom: 0.125,
      height: 0.72,
      drift: 0.08,
      curve: 0.12,
      fold: 0.024,
      folds: 3,
      xSegments: 4,
      ySegments: 8,
    });
    const sashTailA = mesh(ctx, sash, sashPanelGeometry, coral, {
      name: "long-sash-tail",
      position: [0.075, -0.075, 0.01],
      rotation: [0.08, -0.05, -0.13],
    });
    const shortSashGeometry = drapedPanel(ctx, {
      widthTop: 0.145,
      widthBottom: 0.09,
      height: 0.52,
      drift: -0.07,
      curve: 0.1,
      fold: 0.02,
      folds: 2,
      xSegments: 4,
      ySegments: 7,
    });
    const sashTailB = mesh(ctx, sash, shortSashGeometry, coralShade, {
      name: "short-sash-tail",
      position: [-0.01, -0.055, 0.04],
      rotation: [-0.06, 0.12, 0.18],
    });

    const spear = makeGroup(THREE, rightForearm, "crescent-survey-spear", [0.135, -0.44, 0.105]);
    spear.rotation.set(-0.045, 0, -0.035);
    mesh(ctx, spear, keepGeometry(ctx, new THREE.CylinderGeometry(0.033, 0.041, 2.02, 12)), bronze, {
      name: "spear-shaft",
      position: [0, 0.045, 0],
    });
    mesh(ctx, spear, keepGeometry(ctx, new THREE.CylinderGeometry(0.047, 0.061, 0.15, 12)), darkBronze, {
      name: "spear-counterweight",
      position: [0, -0.98, 0],
    });
    mesh(ctx, spear, keepGeometry(ctx, new THREE.TorusGeometry(0.047, 0.011, 6, 15)), coral, {
      name: "spear-hand-wrap-upper",
      position: [0, 0.03, 0],
      rotation: [PI * 0.5, 0, 0],
    });
    mesh(ctx, spear, keepGeometry(ctx, new THREE.TorusGeometry(0.047, 0.011, 6, 15)), coralShade, {
      name: "spear-hand-wrap-lower",
      position: [0, -0.1, 0],
      rotation: [PI * 0.5, 0, 0],
    });
    const crescentGeometry = polygonPrism(ctx, [
      [-0.035, -0.16],
      [0.105, -0.09],
      [0.225, 0.025],
      [0.235, 0.14],
      [0.12, 0.255],
      [-0.055, 0.285],
      [0.018, 0.145],
      [0.11, 0.055],
      [0.015, -0.025],
    ], 0.05, 0.008);
    mesh(ctx, spear, crescentGeometry, bronze, {
      name: "crescent-survey-blade",
      position: [0, 1.16, 0],
      rotation: [0, 0, 0.11],
    });
    mesh(ctx, spear, crescentGeometry, ivoryEdge, {
      name: "crescent-cutting-inlay",
      position: [0.012, 1.17, 0.032],
      rotation: [0, 0, 0.11],
      scale: [0.72, 0.72, 0.52],
      castShadow: false,
    });
    mesh(ctx, spear, keepGeometry(ctx, new THREE.CylinderGeometry(0.075, 0.048, 0.15, 12)), darkBronze, {
      name: "blade-socket",
      position: [0, 1.05, 0],
    });
    mesh(ctx, spear, torusSmall, bronze, {
      name: "spear-lens-ring",
      position: [0, 0.94, 0],
      rotation: [0, 0, 0],
      scale: [0.68, 0.68, 0.68],
    });
    mesh(ctx, spear, keepGeometry(ctx, new THREE.OctahedronGeometry(0.062, 1)), cyan, {
      name: "spear-focus-prism",
      position: [0, 0.94, 0],
      rotation: [0, 0, PI * 0.25],
    });

    const rig = {
      pelvis: pelvis,
      spine: spine,
      mantle: mantle,
      mantleYoke: mantleYoke,
      mantleMain: mantleMain,
      mantleSide: mantleSide,
      mantleRibbon: mantleRibbon,
      head: head,
      neck: neck,
      hairTail: hairTail,
      leftUpperArm: leftUpperArm,
      leftForearm: leftForearm,
      rightUpperArm: rightUpperArm,
      rightForearm: rightForearm,
      leftThigh: leftThigh,
      leftShin: leftShin,
      rightThigh: rightThigh,
      rightShin: rightShin,
      leftFoot: leftFoot,
      rightFoot: rightFoot,
      coatTailLeft: coatTailLeft,
      coatTailRight: coatTailRight,
      spear: spear,
      bracer: bracer,
      bracerLens: bracerLens,
      bracerAura: bracerAura,
      bracerLight: bracerLight,
      heroKey: heroKey,
      sash: sash,
      sashBand: sashBand,
      sashTailA: sashTailA,
      sashTailB: sashTailB,
      innerShadow: innerShadow,
    };
    const actor = {
      root: root,
      body: body,
      shadow: shadow,
      hitParts: ctx.hitParts,
      kind: "hero",
      spear: spear,
      bracer: bracer,
      sash: sash,
      pelvis: pelvis,
      spine: spine,
      head: head,
      leftUpperArm: leftUpperArm,
      leftForearm: leftForearm,
      rightUpperArm: rightUpperArm,
      rightForearm: rightForearm,
      leftThigh: leftThigh,
      leftShin: leftShin,
      rightThigh: rightThigh,
      rightShin: rightShin,
      rig: rig,
      _rig: rig,
      _ctx: ctx,
    };
    return finishActor(ctx, actor);
  }

  function variantIndex(variant) {
    if (typeof variant === "number" && Number.isFinite(variant)) return Math.abs(Math.floor(variant)) % 4;
    if (typeof variant === "string") {
      let hash = 0;
      for (let i = 0; i < variant.length; i += 1) hash = ((hash << 5) - hash + variant.charCodeAt(i)) | 0;
      return Math.abs(hash) % 4;
    }
    if (variant && typeof variant.index === "number") return Math.abs(Math.floor(variant.index)) % 4;
    return 0;
  }

  function createRootbound(THREE, variant) {
    const ctx = createContext(THREE);
    const v = variantIndex(variant);
    const root = new THREE.Group();
    root.name = "Rootbound prowler " + (v + 1);
    const shadow = contactShadow(ctx, root, 0.82, 1.18, 0.32);
    const body = makeGroup(THREE, root, "rootbound-body", [0, 0, 0]);

    const rootwoodColors = [0x9b8e72, 0x817760, 0xa49a7e, 0x756c59];
    const mossColors = [0x4f6552, 0x606c49, 0x495e60, 0x68564c];
    const rootwood = standard(ctx, rootwoodColors[v], 0.95, 0.01);
    const barkDark = standard(ctx, 0x302d27, 0.98, 0.01);
    const basalt = standard(ctx, 0x171d20, 0.68, 0.22);
    const bronze = physical(ctx, {
      color: 0x695536,
      roughness: 0.48,
      metalness: 0.72,
      clearcoat: 0.08,
    });
    const moss = standard(ctx, mossColors[v], 0.98, 0);
    const sap = standard(ctx, 0x6ee0cf, 0.32, 0.15, 0x38cdbf, 1.45);
    const sapGlow = glowMaterial(ctx, 0x69ffed, 0.48);

    const bodyGeometry = keepGeometry(ctx, new THREE.DodecahedronGeometry(0.66, 1));
    const lowSphere = keepGeometry(ctx, new THREE.SphereGeometry(0.5, 12, 9));
    const box = keepGeometry(ctx, new THREE.BoxGeometry(1, 1, 1));
    const torso = mesh(ctx, body, bodyGeometry, barkDark, {
      name: "rootbound-torso",
      position: [0, 0.78, 0.02],
      scale: [0.72, 0.56, 1.2],
      hit: "body",
    });
    mesh(ctx, body, bodyGeometry, basalt, {
      name: "shoulder-stone-left",
      position: [-0.39, 0.98, -0.29],
      rotation: [0.12, 0.2, -0.12],
      scale: [0.35, 0.24, 0.48],
      hit: "body",
    });
    mesh(ctx, body, bodyGeometry, basalt, {
      name: "shoulder-stone-right",
      position: [0.39, 0.98, -0.29],
      rotation: [-0.08, -0.16, 0.1],
      scale: [0.35, 0.24, 0.48],
      hit: "body",
    });
    const spineCount = 4;
    for (let i = 0; i < spineCount; i += 1) {
      mesh(ctx, body, keepGeometry(ctx, new THREE.ConeGeometry(0.1 + i * 0.008, 0.34, 6)), rootwood, {
        name: "root-spine-" + i,
        position: [(i % 2 ? 0.035 : -0.04), 1.24 - Math.abs(i - 1.5) * 0.06, -0.45 + i * 0.32],
        rotation: [0.03 * (i - 1.5), 0, i % 2 ? 0.12 : -0.12],
      });
    }
    const mossPatch = mesh(ctx, body, lowSphere, moss, {
      name: "living-moss-saddle",
      position: [0, 1.19, 0.18],
      scale: [0.48, 0.09, 0.68],
      hit: "body",
    });
    const core = mesh(ctx, body, keepGeometry(ctx, new THREE.OctahedronGeometry(0.16, 1)), sap, {
      name: "exposed-sap-core",
      position: [0, 0.85, -0.59],
      rotation: [0, 0, PI * 0.25],
      hit: "core",
      multiplier: 1.5,
    });
    const coreAura = mesh(ctx, body, keepGeometry(ctx, new THREE.SphereGeometry(0.22, 12, 8)), sapGlow, {
      name: "sap-core-aura",
      position: [0, 0.85, -0.61],
      scale: [1, 1, 0.5],
      castShadow: false,
      receiveShadow: false,
    });

    const headPivot = makeGroup(THREE, body, "rootbound-head-pivot", [0, 0.82, -0.92]);
    mesh(ctx, headPivot, bodyGeometry, rootwood, {
      name: "wedge-root-skull",
      position: [0, 0, -0.05],
      scale: [0.48, 0.32, 0.61],
      rotation: [-0.12, 0, 0],
      hit: "head",
      multiplier: 1.3,
    });
    mesh(ctx, headPivot, box, basalt, {
      name: "basalt-brow",
      position: [0, 0.13, -0.36],
      scale: [0.58, 0.12, 0.17],
      rotation: [-0.08, 0, 0],
      hit: "head",
      multiplier: 1.25,
    });
    const eyeGeometry = keepGeometry(ctx, new THREE.SphereGeometry(0.05, 9, 7));
    mesh(ctx, headPivot, eyeGeometry, sap, {
      name: "left-sap-eye",
      position: [-0.19, 0.1, -0.43],
      castShadow: false,
    });
    mesh(ctx, headPivot, eyeGeometry, sap, {
      name: "right-sap-eye",
      position: [0.19, 0.1, -0.43],
      castShadow: false,
    });

    const antlers = makeGroup(THREE, headPivot, "split-root-antlers", [0, 0.16, -0.05]);
    const antlerSpread = 0.03 * v;
    branch(ctx, antlers, [-0.18, 0, 0], [-0.46 - antlerSpread, 0.38, -0.03], 0.075, 0.045, rootwood, "left-antler-root", "head");
    branch(ctx, antlers, [-0.45 - antlerSpread, 0.37, -0.03], [-0.77 - antlerSpread, 0.52, 0.02], 0.045, 0.016, rootwood, "left-antler-outer", "head");
    branch(ctx, antlers, [-0.43, 0.35, -0.02], [-0.37, 0.68 + v * 0.03, -0.03], 0.04, 0.014, rootwood, "left-antler-crown", "head");
    branch(ctx, antlers, [0.18, 0, 0], [0.46 + antlerSpread, 0.38, -0.03], 0.075, 0.045, rootwood, "right-antler-root", "head");
    branch(ctx, antlers, [0.45 + antlerSpread, 0.37, -0.03], [0.77 + antlerSpread, 0.52, 0.02], 0.045, 0.016, rootwood, "right-antler-outer", "head");
    branch(ctx, antlers, [0.43, 0.35, -0.02], [0.37, 0.66 + v * 0.025, -0.03], 0.04, 0.014, rootwood, "right-antler-crown", "head");

    const legData = [
      ["front-left", -0.4, -0.46, 0],
      ["front-right", 0.4, -0.46, PI],
      ["rear-left", -0.4, 0.51, PI],
      ["rear-right", 0.4, 0.51, 0],
    ];
    const legs = [];
    for (let i = 0; i < legData.length; i += 1) {
      const item = legData[i];
      const upper = limb(ctx, body, item[0] + "-upper", 0.5, 0.135, 0.095, rootwood, "limb");
      upper.position.set(item[1], 0.74, item[2]);
      upper.rotation.z = item[1] < 0 ? -0.17 : 0.17;
      const lower = limb(ctx, upper, item[0] + "-lower", 0.43, 0.1, 0.065, barkDark, "limb");
      lower.position.y = -0.46;
      lower.rotation.x = 0.22;
      const hoof = mesh(ctx, lower, bodyGeometry, basalt, {
        name: item[0] + "-root-claw",
        position: [0, -0.42, -0.06],
        scale: [0.16, 0.09, 0.24],
        hit: "limb",
        multiplier: 0.65,
      });
      legs.push({ upper: upper, lower: lower, hoof: hoof, offset: item[3] });
    }

    const tail = makeGroup(THREE, body, "rootbound-tail", [0, 0.82, 0.88]);
    const tailA = branch(ctx, tail, [0, 0, 0], [0.05, 0.02, 0.62], 0.12, 0.075, rootwood, "tail-main", null);
    const tailB = branch(ctx, tail, [0.04, 0.02, 0.57], [0.25, -0.02, 0.98], 0.07, 0.02, rootwood, "tail-fork-left", null);
    const tailC = branch(ctx, tail, [0.04, 0.02, 0.57], [-0.22, 0.04, 0.96], 0.07, 0.02, rootwood, "tail-fork-right", null);

    const rig = {
      torso: torso,
      moss: mossPatch,
      core: core,
      coreAura: coreAura,
      head: headPivot,
      antlers: antlers,
      legs: legs,
      tail: tail,
      tailBranches: [tailA, tailB, tailC],
    };
    const actor = {
      root: root,
      body: body,
      shadow: shadow,
      hitParts: ctx.hitParts,
      kind: "rootbound",
      variant: v,
      rig: rig,
      _rig: rig,
      _ctx: ctx,
    };
    return finishActor(ctx, actor);
  }

  function createWarden(THREE, variant) {
    if (global.DrownedGoldAssets && typeof global.DrownedGoldAssets.createWardenActor === "function") {
      const importedWarden = global.DrownedGoldAssets.createWardenActor(THREE, variant);
      if (importedWarden) return polishImportedGoldActor(THREE, importedWarden);
    }
    const ctx = createContext(THREE);
    const v = variantIndex(variant);
    const root = new THREE.Group();
    root.name = "Orrery Warden " + (v + 1);
    const shadow = contactShadow(ctx, root, 0.78, 0.58, 0.3);
    const body = makeGroup(THREE, root, "warden-body", [0, 0, 0]);

    const basalt = standard(ctx, 0x171d22, 0.59, 0.32);
    const basaltLight = standard(ctx, 0x30383a, 0.63, 0.22);
    const bronzeColors = [0x87704b, 0x735e42, 0x927853, 0x6d684c];
    const bronze = physical(ctx, {
      color: bronzeColors[v],
      roughness: 0.3,
      metalness: 0.88,
      clearcoat: 0.16,
      clearcoatRoughness: 0.38,
    });
    const rootwood = standard(ctx, 0x94896e, 0.93, 0.01);
    const cyan = standard(ctx, 0x76e4dc, 0.22, 0.3, 0x36ccc6, 1.7);
    const cyanGlow = glowMaterial(ctx, 0x6dfff4, 0.5);

    const stone = keepGeometry(ctx, new THREE.DodecahedronGeometry(0.5, 1));
    const sphere = keepGeometry(ctx, new THREE.SphereGeometry(0.5, 16, 12));
    const box = keepGeometry(ctx, new THREE.BoxGeometry(1, 1, 1));

    const pelvis = makeGroup(THREE, body, "warden-pelvis", [0, 1.23, 0]);
    mesh(ctx, pelvis, stone, basalt, {
      name: "floating-pelvis-stone",
      scale: [0.48, 0.35, 0.39],
      hit: "body",
    });
    const torsoPivot = makeGroup(THREE, body, "warden-torso-pivot", [0, 1.48, 0]);
    const torsoGeometry = lathe(ctx, [
      [0.28, 0],
      [0.36, 0.18],
      [0.31, 0.62],
      [0.5, 0.91],
      [0.4, 1.12],
    ], 16);
    mesh(ctx, torsoPivot, torsoGeometry, basalt, {
      name: "tall-basalt-torso",
      hit: "body",
    });
    for (let i = 0; i < 3; i += 1) {
      mesh(ctx, torsoPivot, keepGeometry(ctx, new THREE.TorusGeometry(0.27 + i * 0.03, 0.018, 5, 16)), bronze, {
        name: "torso-meridian-" + i,
        position: [0, 0.38 + i * 0.18, -0.28 - i * 0.02],
        rotation: [0, 0, v * 0.06 + i * 0.18],
      });
    }

    const ringHub = makeGroup(THREE, body, "ring-shoulder-assembly", [0, 2.55, 0]);
    const shoulderRing = mesh(ctx, ringHub, keepGeometry(ctx, new THREE.TorusGeometry(0.82, 0.095, 8, 36)), bronze, {
      name: "great-shoulder-ring",
      rotation: [0, 0, v * 0.05],
      hit: "body",
    });
    const innerRing = mesh(ctx, ringHub, keepGeometry(ctx, new THREE.TorusGeometry(0.58, 0.045, 7, 30)), basaltLight, {
      name: "inclined-inner-ring",
      rotation: [0.38, 0.16, -0.2],
      hit: "body",
    });
    const crossRing = mesh(ctx, ringHub, keepGeometry(ctx, new THREE.TorusGeometry(0.48, 0.025, 6, 26)), bronze, {
      name: "cross-axis-ring",
      rotation: [0.1, PI * 0.5, 0.08],
    });
    const core = mesh(ctx, ringHub, keepGeometry(ctx, new THREE.IcosahedronGeometry(0.25, 1)), cyan, {
      name: "warden-star-core",
      position: [0, 0.02, -0.02],
      hit: "core",
      multiplier: 1.55,
    });
    const coreAura = mesh(ctx, ringHub, sphere, cyanGlow, {
      name: "warden-core-aura",
      scale: [0.7, 0.7, 0.36],
      castShadow: false,
      receiveShadow: false,
    });
    const crown = makeGroup(THREE, ringHub, "three-prong-crown", [0, 0.31, 0.06]);
    branch(ctx, crown, [0, 0, 0], [0, 0.55, 0], 0.055, 0.016, rootwood, "central-crown-root", "head");
    branch(ctx, crown, [-0.08, 0.02, 0], [-0.32, 0.42, 0.02], 0.05, 0.014, rootwood, "left-crown-root", "head");
    branch(ctx, crown, [0.08, 0.02, 0], [0.32, 0.42, 0.02], 0.05, 0.014, rootwood, "right-crown-root", "head");

    const leftUpperArm = limb(ctx, body, "warden-left-upper-arm", 0.74, 0.13, 0.09, rootwood, "limb");
    leftUpperArm.position.set(-0.73, 2.46, 0);
    leftUpperArm.rotation.z = -0.15;
    const leftForearm = limb(ctx, leftUpperArm, "warden-left-forearm", 0.68, 0.105, 0.065, basaltLight, "limb");
    leftForearm.position.y = -0.7;
    const rightUpperArm = limb(ctx, body, "warden-right-upper-arm", 0.74, 0.13, 0.09, rootwood, "limb");
    rightUpperArm.position.set(0.73, 2.46, 0);
    rightUpperArm.rotation.z = 0.15;
    const rightForearm = limb(ctx, rightUpperArm, "warden-right-forearm", 0.68, 0.105, 0.065, basaltLight, "limb");
    rightForearm.position.y = -0.7;

    const bladeGeometry = polygonPrism(ctx, [
      [-0.08, 0.06],
      [0.08, 0.06],
      [0.15, -0.56],
      [0, -0.84],
      [-0.13, -0.55],
    ], 0.08, 0.01);
    mesh(ctx, leftForearm, bladeGeometry, bronze, {
      name: "left-vane-hand",
      position: [0, -0.65, 0],
      hit: "limb",
      multiplier: 0.7,
    });
    mesh(ctx, rightForearm, bladeGeometry, bronze, {
      name: "right-vane-hand",
      position: [0, -0.65, 0],
      rotation: [0, PI, 0],
      hit: "limb",
      multiplier: 0.7,
    });

    const leftThigh = limb(ctx, body, "warden-left-thigh", 0.78, 0.15, 0.105, rootwood, "limb");
    leftThigh.position.set(-0.25, 1.16, 0);
    const leftShin = limb(ctx, leftThigh, "warden-left-shin", 0.68, 0.12, 0.07, basaltLight, "limb");
    leftShin.position.y = -0.75;
    const rightThigh = limb(ctx, body, "warden-right-thigh", 0.78, 0.15, 0.105, rootwood, "limb");
    rightThigh.position.set(0.25, 1.16, 0);
    const rightShin = limb(ctx, rightThigh, "warden-right-shin", 0.68, 0.12, 0.07, basaltLight, "limb");
    rightShin.position.y = -0.75;
    mesh(ctx, leftShin, box, basalt, {
      name: "left-anchor-foot",
      position: [0, -0.67, -0.08],
      scale: [0.24, 0.1, 0.38],
      hit: "limb",
      multiplier: 0.65,
    });
    mesh(ctx, rightShin, box, basalt, {
      name: "right-anchor-foot",
      position: [0, -0.67, -0.08],
      scale: [0.24, 0.1, 0.38],
      hit: "limb",
      multiplier: 0.65,
    });

    const rig = {
      pelvis: pelvis,
      torso: torsoPivot,
      ringHub: ringHub,
      shoulderRing: shoulderRing,
      innerRing: innerRing,
      crossRing: crossRing,
      core: core,
      coreAura: coreAura,
      crown: crown,
      leftUpperArm: leftUpperArm,
      leftForearm: leftForearm,
      rightUpperArm: rightUpperArm,
      rightForearm: rightForearm,
      leftThigh: leftThigh,
      leftShin: leftShin,
      rightThigh: rightThigh,
      rightShin: rightShin,
    };
    const actor = {
      root: root,
      body: body,
      shadow: shadow,
      hitParts: ctx.hitParts,
      kind: "warden",
      variant: v,
      rig: rig,
      _rig: rig,
      _ctx: ctx,
    };
    return finishActor(ctx, actor);
  }

  function createBoss(THREE) {
    const ctx = createContext(THREE);
    const root = new THREE.Group();
    root.name = "The Hollow Astronomer";
    const shadow = contactShadow(ctx, root, 2.65, 1.75, 0.38);
    const body = makeGroup(THREE, root, "astronomer-body", [0, 0, 0]);

    const voidMaterial = standard(ctx, 0x05080c, 0.42, 0.28);
    const basalt = standard(ctx, 0x151c22, 0.61, 0.32);
    const basaltEdge = standard(ctx, 0x334047, 0.48, 0.44);
    const rootwood = standard(ctx, 0x7d7665, 0.91, 0.03);
    const bronze = physical(ctx, {
      color: 0x8e7446,
      roughness: 0.29,
      metalness: 0.9,
      clearcoat: 0.18,
      clearcoatRoughness: 0.34,
    });
    const paleBronze = physical(ctx, {
      color: 0xc09a57,
      roughness: 0.24,
      metalness: 0.87,
      clearcoat: 0.22,
      clearcoatRoughness: 0.3,
    });
    const cyan = standard(ctx, 0x87f0e6, 0.18, 0.28, 0x3ad5cf, 2.15);
    const gold = standard(ctx, 0xf2c86b, 0.21, 0.48, 0xe3a743, 1.45);
    const cyanGlow = glowMaterial(ctx, 0x6efff1, 0.52);
    const goldGlow = glowMaterial(ctx, 0xffd477, 0.38);

    const stone = keepGeometry(ctx, new THREE.DodecahedronGeometry(0.5, 1));
    const sphere = keepGeometry(ctx, new THREE.SphereGeometry(0.5, 18, 14));
    const box = keepGeometry(ctx, new THREE.BoxGeometry(1, 1, 1));

    const rootBase = makeGroup(THREE, body, "astronomer-root-base", [0, 0, 0]);
    const anchorEnds = [
      [-1.8, 0.04, -0.85],
      [1.8, 0.04, -0.85],
      [-1.35, 0.04, 1.18],
      [1.35, 0.04, 1.18],
    ];
    const rootAnchors = [];
    for (let i = 0; i < anchorEnds.length; i += 1) {
      const elbow = [anchorEnds[i][0] * 0.48, 0.48, anchorEnds[i][2] * 0.4];
      rootAnchors.push(branch(ctx, rootBase, [-0.12 + i * 0.08, 1.35, 0], elbow, 0.22, 0.16, rootwood, "root-anchor-upper-" + i, "limb"));
      rootAnchors.push(branch(ctx, rootBase, elbow, anchorEnds[i], 0.16, 0.045, rootwood, "root-anchor-lower-" + i, "limb"));
      mesh(ctx, rootBase, keepGeometry(ctx, new THREE.SphereGeometry(0.21, 12, 9)), bronze, {
        name: "root-anchor-joint-" + i,
        position: elbow,
        scale: [1, 0.78, 1],
        hit: "limb",
        multiplier: 0.7,
      });
      mesh(ctx, rootBase, stone, basalt, {
        name: "anchor-stone-" + i,
        position: anchorEnds[i],
        scale: [0.42, 0.18, 0.58],
        rotation: [0, i * 0.7, 0],
        hit: "limb",
        multiplier: 0.7,
      });
    }

    const trunk = makeGroup(THREE, body, "hollow-trunk", [0, 0.95, 0]);
    const trunkGeometry = lathe(ctx, [
      [0.7, 0],
      [0.88, 0.28],
      [0.66, 0.82],
      [0.8, 1.45],
      [1.05, 2.0],
      [0.83, 2.45],
    ], 16);
    mesh(ctx, trunk, trunkGeometry, basalt, {
      name: "astronomer-basalt-trunk",
      hit: "body",
    });
    for (let i = 0; i < 5; i += 1) {
      const angle = i * TAU / 5 + 0.3;
      branch(
        ctx,
        trunk,
        [Math.sin(angle) * 0.56, 0.2, Math.cos(angle) * 0.52],
        [Math.sin(angle + 0.18) * 0.76, 2.24, Math.cos(angle + 0.18) * 0.7],
        0.105,
        0.045,
        i % 2 ? rootwood : bronze,
        "trunk-meridian-" + i,
        "body",
      );
    }

    const hub = makeGroup(THREE, body, "radial-plate-hub", [0, 3.62, 0]);
    const rearDisc = mesh(ctx, hub, keepGeometry(ctx, new THREE.CylinderGeometry(1.38, 1.38, 0.36, 24)), basalt, {
      name: "rear-celestial-disc",
      rotation: [PI * 0.5, 0, 0],
      hit: "body",
    });
    const plateGeometry = polygonPrism(ctx, [
      [-0.3, 0.68],
      [0.3, 0.68],
      [0.56, 1.47],
      [0.4, 1.98],
      [0.12, 2.28],
      [-0.18, 2.25],
      [-0.47, 1.92],
      [-0.58, 1.43],
    ], 0.24, 0.018);
    const insetGeometry = polygonPrism(ctx, [
      [-0.12, 0.86],
      [0.13, 0.86],
      [0.25, 1.55],
      [0.08, 1.9],
      [-0.12, 1.82],
      [-0.25, 1.48],
    ], 0.03, 0.006);
    const plates = [];
    for (let i = 0; i < 10; i += 1) {
      const pivot = makeGroup(THREE, hub, "radial-plate-pivot-" + i, [0, 0, 0]);
      pivot.rotation.z = i * TAU / 10;
      const plate = mesh(ctx, pivot, plateGeometry, i % 2 ? bronze : basaltEdge, {
        name: "radial-celestial-plate-" + i,
        position: [0, 0, 0.02 + (i % 2) * 0.04],
        hit: "plate",
        multiplier: 0.72,
      });
      mesh(ctx, pivot, insetGeometry, i % 2 ? basalt : paleBronze, {
        name: "radial-plate-inlay-" + i,
        position: [0, 0, -0.14],
      });
      mesh(ctx, pivot, keepGeometry(ctx, new THREE.SphereGeometry(0.075, 8, 6)), i % 2 ? cyan : gold, {
        name: "plate-star-node-" + i,
        position: [0, 1.42, -0.17],
        castShadow: false,
      });
      plates.push({ pivot: pivot, plate: plate, angle: i * TAU / 10 });
    }

    const outerRingA = mesh(ctx, hub, keepGeometry(ctx, new THREE.TorusGeometry(2.48, 0.075, 8, 54)), bronze, {
      name: "outer-orbit-ring-a",
      rotation: [0.22, 0.07, 0.04],
      hit: "body",
      multiplier: 0.82,
    });
    const outerRingB = mesh(ctx, hub, keepGeometry(ctx, new THREE.TorusGeometry(2.05, 0.045, 7, 48)), paleBronze, {
      name: "outer-orbit-ring-b",
      rotation: [0.18, PI * 0.5, 0.2],
      hit: "body",
      multiplier: 0.82,
    });
    const outerRingC = mesh(ctx, hub, keepGeometry(ctx, new THREE.TorusGeometry(1.72, 0.032, 6, 42)), basaltEdge, {
      name: "outer-orbit-ring-c",
      rotation: [PI * 0.5, 0.25, 0],
    });

    const coreRing = mesh(ctx, hub, keepGeometry(ctx, new THREE.TorusGeometry(0.91, 0.22, 10, 40)), paleBronze, {
      name: "hollow-core-rim",
      position: [0, 0, -0.28],
      hit: "core",
      multiplier: 1.5,
    });
    const coreVoid = mesh(ctx, hub, sphere, voidMaterial, {
      name: "hollow-star-void",
      position: [0, 0, -0.06],
      scale: [1.3, 1.3, 0.7],
      hit: "core",
      multiplier: 1.65,
    });
    const coreIris = mesh(ctx, hub, keepGeometry(ctx, new THREE.TorusGeometry(0.63, 0.045, 7, 34)), cyan, {
      name: "luminous-core-iris",
      position: [0, 0, -0.45],
      hit: "core",
      multiplier: 1.75,
    });
    const coreAura = mesh(ctx, hub, keepGeometry(ctx, new THREE.CircleGeometry(0.72, 40)), cyanGlow, {
      name: "hollow-core-radiance",
      position: [0, 0, -0.49],
      castShadow: false,
      receiveShadow: false,
    });

    const moons = makeGroup(THREE, hub, "orbiting-star-fragments", [0, 0, 0]);
    const moonData = [];
    for (let i = 0; i < 4; i += 1) {
      const moonPivot = makeGroup(THREE, moons, "moon-orbit-" + i, [0, 0, 0]);
      const moon = mesh(ctx, moonPivot, stone, i % 2 ? gold : cyan, {
        name: "star-fragment-" + i,
        position: [1.55 + i * 0.31, 0, -0.44 - i * 0.05],
        scale: [0.18 + i * 0.025, 0.18 + i * 0.025, 0.12],
        castShadow: false,
      });
      moonData.push({ pivot: moonPivot, moon: moon, speed: 0.18 + i * 0.07, tilt: (i - 1.5) * 0.18 });
    }

    const leftArm = makeGroup(THREE, body, "astronomer-left-arm", [-1.0, 3.14, 0.08]);
    const leftUpper = limb(ctx, leftArm, "astronomer-left-upper", 1.28, 0.28, 0.17, rootwood, "limb");
    leftUpper.rotation.z = -0.45;
    const leftFore = limb(ctx, leftUpper, "astronomer-left-forearm", 1.12, 0.2, 0.095, basaltEdge, "limb");
    leftFore.position.y = -1.2;
    leftFore.rotation.x = -0.12;
    const rightArm = makeGroup(THREE, body, "astronomer-right-arm", [1.0, 3.14, 0.08]);
    const rightUpper = limb(ctx, rightArm, "astronomer-right-upper", 1.28, 0.28, 0.17, rootwood, "limb");
    rightUpper.rotation.z = 0.45;
    const rightFore = limb(ctx, rightUpper, "astronomer-right-forearm", 1.12, 0.2, 0.095, basaltEdge, "limb");
    rightFore.position.y = -1.2;
    rightFore.rotation.x = -0.12;
    const handGeometry = polygonPrism(ctx, [
      [-0.16, 0.1],
      [0.16, 0.1],
      [0.22, -0.3],
      [0.43, -0.62],
      [0.29, -0.78],
      [0.07, -0.5],
      [0, -0.9],
      [-0.07, -0.5],
      [-0.29, -0.78],
      [-0.43, -0.62],
      [-0.22, -0.3],
    ], 0.16, 0.022);
    mesh(ctx, leftFore, handGeometry, bronze, {
      name: "left-radial-hand",
      position: [0, -1.05, 0],
      hit: "limb",
      multiplier: 0.72,
    });
    mesh(ctx, rightFore, handGeometry, bronze, {
      name: "right-radial-hand",
      position: [0, -1.05, 0],
      hit: "limb",
      multiplier: 0.72,
    });
    mesh(ctx, leftFore, keepGeometry(ctx, new THREE.IcosahedronGeometry(0.17, 1)), cyan, {
      name: "left-palm-star",
      position: [0, -1.18, -0.11],
      castShadow: false,
    });
    mesh(ctx, rightFore, keepGeometry(ctx, new THREE.IcosahedronGeometry(0.17, 1)), gold, {
      name: "right-palm-star",
      position: [0, -1.18, -0.11],
      castShadow: false,
    });

    const rig = {
      rootBase: rootBase,
      rootAnchors: rootAnchors,
      trunk: trunk,
      hub: hub,
      rearDisc: rearDisc,
      plates: plates,
      outerRingA: outerRingA,
      outerRingB: outerRingB,
      outerRingC: outerRingC,
      coreRing: coreRing,
      coreVoid: coreVoid,
      coreIris: coreIris,
      coreAura: coreAura,
      moons: moonData,
      leftArm: leftArm,
      leftUpper: leftUpper,
      leftFore: leftFore,
      rightArm: rightArm,
      rightUpper: rightUpper,
      rightFore: rightFore,
    };
    const actor = {
      root: root,
      body: body,
      shadow: shadow,
      hitParts: ctx.hitParts,
      kind: "boss",
      plates: plates,
      core: coreIris,
      orbitRings: [outerRingA, outerRingB, outerRingC],
      rig: rig,
      _rig: rig,
      _ctx: ctx,
    };
    return finishActor(ctx, actor);
  }

  function applyFacing(actor, state, dt) {
    const facing = numberFrom(state, ["facing", "heading", "rotation"], NaN);
    if (Number.isFinite(facing)) actor.root.rotation.y = dampAngle(actor.root.rotation.y, facing, 16, dt);
  }

  function poseRotation(object, x, y, z, dt, speed) {
    if (!object) return;
    const rate = speed || 14;
    object.rotation.x = dampAngle(object.rotation.x, x, rate, dt);
    object.rotation.y = dampAngle(object.rotation.y, y, rate, dt);
    object.rotation.z = dampAngle(object.rotation.z, z, rate, dt);
  }

  function updateHero(actor, visualState, dt, elapsed) {
    if (!actor || actor.kind !== "hero" || !actor._rig) return;
    const state = visualState || {};
    if (actor._gold && global.DrownedGoldAssets && typeof global.DrownedGoldAssets.updateHero === "function") {
      applyFacing(actor, state, dt);
      global.DrownedGoldAssets.updateHero(actor, state, dt, elapsed);
      return;
    }
    const rig = actor._rig;
    const t = typeof elapsed === "number" ? elapsed : ((actor._elapsed || 0) + (dt || 0));
    actor._elapsed = t;
    applyFacing(actor, state, dt);

    const speed = clamp01(numberFrom(state, ["speed", "moveSpeed", "movementSpeed", "moving"], 0));
    const grounded = state.grounded !== false;
    const dead = truthyFrom(state, ["dead", "defeated"]);
    const guarding = truthyFrom(state, ["guarding", "guard", "blocking"]);
    const dodging = truthyFrom(state, ["dodging", "dodge", "rolling"]);
    const hurt = clamp01(numberFrom(state, ["hurt", "hurtAmount", "hitFlash"], truthyFrom(state, ["staggered"]) ? 1 : 0));
    const attackPhase = clamp01(numberFrom(state, ["attackPhase", "attack", "swingPhase"], 0));
    const combo = Math.max(0, Math.floor(numberFrom(state, ["combo", "comboIndex", "attackIndex"], 0))) % 3;
    const charge = clamp01(numberFrom(state, ["charge", "chargeAmount", "pulseCharge"], truthyFrom(state, ["charging"]) ? 0.75 : 0));
    const cycle = t * (4.8 + speed * 5.8);
    const stride = Math.sin(cycle) * speed;
    const otherStride = Math.sin(cycle + PI) * speed;
    const bob = grounded ? Math.abs(Math.sin(cycle)) * 0.055 * speed : 0.07;
    const idleWeight = grounded && !dead && !dodging ? (1 - speed) * (1 - attackPhase) : 0;

    actor.body.position.x = damp(actor.body.position.x, idleWeight * 0.022, 10, dt);
    actor.body.position.y = damp(actor.body.position.y, dead ? 0.26 : bob, 13, dt);
    actor.body.position.z = damp(actor.body.position.z, dodging ? -0.16 : 0, 15, dt);
    poseRotation(actor.body, dead ? 0.05 : (dodging ? -0.5 : -speed * 0.08), 0, dead ? -1.22 : idleWeight * 0.018, dt, dead ? 5 : 15);
    poseRotation(rig.pelvis, speed * 0.035 + idleWeight * 0.025, stride * 0.075 - idleWeight * 0.065, -stride * 0.025 + idleWeight * 0.045, dt, 13);
    poseRotation(rig.spine, -speed * 0.03 - hurt * 0.2, -stride * 0.045 + hurt * 0.22 + idleWeight * 0.07, dead ? 0 : -stride * 0.02 - idleWeight * 0.035, dt, 14);
    poseRotation(rig.head, speed * 0.025 + hurt * 0.16, -stride * 0.035 - hurt * 0.18 - idleWeight * 0.035, idleWeight * 0.018, dt, 12);

    let leftArmX = otherStride * 0.52 * grounded - idleWeight * 0.1;
    let rightArmX = stride * 0.48 * grounded + idleWeight * 0.055;
    let leftArmZ = -0.11 - idleWeight * 0.045;
    let rightArmZ = 0.085 + idleWeight * 0.045;
    let leftForeX = -0.13 - idleWeight * 0.12 - Math.max(0, stride) * 0.3;
    let rightForeX = -0.16 - idleWeight * 0.035 - Math.max(0, otherStride) * 0.26;
    let spineY = rig.spine.rotation.y;
    let spearX = -0.045;
    let spearY = 0;
    let spearZ = -0.055;

    if (!grounded && !dead) {
      leftArmX = -0.38;
      rightArmX = -0.38;
      leftArmZ = -0.28;
      rightArmZ = 0.28;
      leftForeX = -0.45;
      rightForeX = -0.45;
    }
    if (guarding && !dead) {
      leftArmX = -1.05;
      leftArmZ = -0.35;
      leftForeX = -1.15;
      rightArmX = -0.82;
      rightArmZ = 0.22;
      rightForeX = -0.88;
      spearX = -0.46;
      spearZ = 0.28;
      spineY = -0.14;
    }
    if (attackPhase > 0 && !dead) {
      const wave = Math.sin(attackPhase * PI);
      const snap = smoothstep(Math.min(1, attackPhase * 1.55));
      if (combo === 0) {
        rightArmX = -1.45 + snap * 1.05;
        rightArmZ = 0.22;
        rightForeX = -0.56;
        leftArmX = -0.6;
        leftForeX = -0.75;
        spearX = -0.92 + snap * 0.55;
        spearZ = -0.18;
        spineY = -0.4 + snap * 0.66;
        actor.body.position.z = damp(actor.body.position.z, (dodging ? -0.16 : 0) - wave * 0.18, 22, dt);
      } else if (combo === 1) {
        rightArmX = -0.95;
        rightArmZ = -0.62 + snap * 1.28;
        rightForeX = -0.72;
        leftArmX = -0.62;
        leftArmZ = -0.18;
        spearY = -0.75 + snap * 1.5;
        spearZ = -0.48 + snap * 0.9;
        spineY = -0.75 + snap * 1.5;
      } else {
        rightArmX = -2.3 + snap * 2.1;
        rightArmZ = 0.12;
        rightForeX = -0.45;
        leftArmX = -1.65 + snap * 0.7;
        leftForeX = -0.9;
        spearX = -1.28 + snap * 1.78;
        spearZ = 0.1;
        spineY = -0.22 + snap * 0.42;
        actor.body.position.y = damp(actor.body.position.y, (dead ? 0.26 : bob) + wave * 0.11, 20, dt);
      }
    }

    poseRotation(rig.leftUpperArm, leftArmX, 0, leftArmZ, dt, 19);
    poseRotation(rig.rightUpperArm, rightArmX, 0, rightArmZ, dt, 19);
    poseRotation(rig.leftForearm, leftForeX, 0, guarding ? -0.22 : -idleWeight * 0.055, dt, 20);
    poseRotation(rig.rightForearm, rightForeX, 0, guarding ? 0.18 : idleWeight * 0.035, dt, 20);
    rig.spine.rotation.y = dampAngle(rig.spine.rotation.y, spineY, 18, dt);
    poseRotation(rig.spear, spearX, spearY, spearZ, dt, 22);

    const legStrength = grounded && !dead ? 0.72 : 0.2;
    let leftLegX = stride * legStrength - idleWeight * 0.055;
    let rightLegX = otherStride * legStrength + idleWeight * 0.13;
    let leftKneeX = Math.max(0, -stride) * 0.82 + idleWeight * 0.025;
    let rightKneeX = Math.max(0, -otherStride) * 0.82 + idleWeight * 0.22;
    if (!grounded) {
      leftLegX = -0.35;
      rightLegX = 0.22;
      leftKneeX = 0.65;
      rightKneeX = 0.32;
    }
    if (dodging && !dead) {
      leftLegX = -0.52;
      rightLegX = 0.58;
      leftKneeX = 0.86;
      rightKneeX = 0.35;
    }
    poseRotation(rig.leftThigh, leftLegX, 0, 0.015 - idleWeight * 0.025, dt, 18);
    poseRotation(rig.rightThigh, rightLegX, 0, -0.015 + idleWeight * 0.02, dt, 18);
    poseRotation(rig.leftShin, leftKneeX, 0, 0, dt, 18);
    poseRotation(rig.rightShin, rightKneeX, 0, 0, dt, 18);

    const mantleSway = Math.sin(t * 2.3) * 0.026 + stride * 0.035;
    const clothLift = speed * 0.15 + (dodging ? 0.24 : 0) + attackPhase * 0.045;
    poseRotation(rig.mantle, -speed * 0.025, 0, mantleSway, dt, 7);
    poseRotation(rig.mantleYoke, -0.015 + speed * 0.035, -stride * 0.012, -mantleSway * 0.35, dt, 7);
    poseRotation(
      rig.mantleMain,
      0.035 + clothLift + Math.sin(t * 3.25 + 0.4) * (0.022 + speed * 0.035),
      -0.025 + Math.sin(t * 1.8) * 0.018,
      -0.018 - stride * 0.048,
      dt,
      6,
    );
    poseRotation(
      rig.mantleSide,
      0.055 + clothLift * 1.12 + Math.sin(t * 3.7 + 1.3) * (0.03 + speed * 0.04),
      -0.08 + Math.sin(t * 2.1 + 0.5) * 0.025,
      -0.045 - stride * 0.065,
      dt,
      5.5,
    );
    poseRotation(
      rig.mantleRibbon,
      0.04 + clothLift * 1.25 + Math.sin(t * 4 + 2.1) * (0.028 + speed * 0.045),
      0.04 + Math.sin(t * 2.4) * 0.03,
      0.03 - stride * 0.055,
      dt,
      5,
    );
    poseRotation(
      rig.coatTailLeft,
      0.02 + speed * 0.18 + (dodging ? 0.18 : 0) + Math.sin(t * 3.45 + 0.2) * (0.018 + speed * 0.025),
      -stride * 0.025,
      -0.025 - stride * 0.035,
      dt,
      6.5,
    );
    poseRotation(
      rig.coatTailRight,
      0.025 + speed * 0.2 + (dodging ? 0.2 : 0) + Math.sin(t * 3.7 + 1.4) * (0.02 + speed * 0.028),
      stride * 0.028,
      0.025 - stride * 0.04,
      dt,
      6,
    );
    poseRotation(
      rig.sashTailA,
      0.08 + speed * 0.32 + (dodging ? 0.26 : 0) + Math.sin(t * 4.1) * (0.07 + speed * 0.045),
      -0.05 + Math.sin(t * 2.15) * 0.05,
      -0.13 - stride * 0.14,
      dt,
      6,
    );
    poseRotation(
      rig.sashTailB,
      -0.06 + speed * 0.27 + (dodging ? 0.2 : 0) + Math.sin(t * 3.7 + 1) * (0.065 + speed * 0.04),
      0.12 + Math.sin(t * 1.85 + 0.7) * 0.045,
      0.18 - stride * 0.105,
      dt,
      6.5,
    );
    poseRotation(
      rig.hairTail,
      0.02 + speed * 0.12 + Math.sin(t * 3.05 + 0.9) * 0.035,
      -stride * 0.035,
      -0.03 - stride * 0.045,
      dt,
      6,
    );

    const pulse = 0.76 + Math.sin(t * 5.2) * 0.12 + charge * 0.55;
    rig.bracerLens.material.emissiveIntensity = 1.5 + pulse + charge * 2.1;
    rig.bracerAura.material.opacity = 0.42 + pulse * 0.16 + charge * 0.26;
    const auraScale = 0.9 + pulse * 0.12 + charge * 0.22;
    rig.bracerAura.scale.set(auraScale, auraScale * 0.74, auraScale * 0.52);
    rig.bracerLight.intensity = dead ? 0.12 : 0.72 + pulse * 0.16 + charge * 0.72;
    rig.heroKey.intensity = dead ? 0.12 : 0.34 + charge * 0.05;
    actor.shadow.material.opacity = dead ? 0.2 : (grounded ? 0.34 : 0.16);
    actor.shadow.scale.set(0.59 + speed * 0.04, 0.4 + speed * 0.075, 1);
    rig.innerShadow.material.opacity = dead ? 0.12 : (grounded ? 0.2 : 0.07);
    rig.innerShadow.scale.set(0.36 + speed * 0.025, 0.245 + speed * 0.04, 1);
  }

  function updateRootbound(actor, state, dt, t) {
    const rig = actor._rig;
    const speed = clamp01(numberFrom(state, ["speed", "moveSpeed", "movementSpeed", "moving"], 0));
    const attack = clamp01(numberFrom(state, ["attackPhase", "attack", "lunge"], 0));
    const hurt = clamp01(numberFrom(state, ["hurt", "hurtAmount", "stagger"], truthyFrom(state, ["staggered"]) ? 1 : 0));
    const dead = truthyFrom(state, ["dead", "defeated"]);
    const alert = clamp01(numberFrom(state, ["alert", "awareness"], truthyFrom(state, ["alerted"]) ? 1 : 0));
    const cycle = t * (4.2 + speed * 7.2) + actor.variant * 0.7;
    const lunge = Math.sin(attack * PI);

    actor.body.position.y = damp(actor.body.position.y, dead ? 0.18 : Math.abs(Math.sin(cycle * 2)) * 0.045 * speed, 12, dt);
    actor.body.position.z = damp(actor.body.position.z, dead ? 0.12 : -lunge * 0.5, 18, dt);
    poseRotation(actor.body, dead ? 0.1 : (-0.04 - lunge * 0.16), 0, dead ? (actor.variant % 2 ? 1.08 : -1.08) : hurt * 0.18, dt, dead ? 5 : 16);
    poseRotation(rig.head, -0.08 + Math.sin(t * 2.2 + actor.variant) * 0.04 + alert * 0.11 - lunge * 0.2, hurt * -0.18, Math.sin(t * 1.5) * 0.025, dt, 12);
    poseRotation(rig.antlers, 0, Math.sin(t * 1.8 + actor.variant) * 0.035, -hurt * 0.08, dt, 9);
    poseRotation(rig.tail, 0.1 + speed * 0.08, Math.sin(t * 3.1 + actor.variant) * (0.2 + speed * 0.14), 0, dt, 7);

    for (let i = 0; i < rig.legs.length; i += 1) {
      const leg = rig.legs[i];
      const phase = cycle + leg.offset;
      const step = Math.sin(phase) * speed;
      const frontBias = i < 2 ? 1 : -1;
      poseRotation(leg.upper, step * 0.58 + lunge * 0.24 * frontBias, 0, leg.upper.position.x < 0 ? -0.17 : 0.17, dt, 18);
      poseRotation(leg.lower, 0.22 + Math.max(0, -step) * 0.72 + lunge * 0.18, 0, 0, dt, 18);
    }
    const pulse = 0.85 + Math.sin(t * 6 + actor.variant) * 0.16 + alert * 0.35;
    rig.core.material.emissiveIntensity = 1.25 + pulse + hurt * 1.2;
    rig.coreAura.material.opacity = 0.22 + pulse * 0.16 + hurt * 0.18;
    rig.coreAura.scale.setScalar(0.88 + pulse * 0.11);
    actor.shadow.material.opacity = dead ? 0.16 : 0.32;
  }

  function updateWarden(actor, state, dt, t) {
    const rig = actor._rig;
    const speed = clamp01(numberFrom(state, ["speed", "moveSpeed", "movementSpeed", "moving"], 0));
    const attack = clamp01(numberFrom(state, ["attackPhase", "attack", "swingPhase"], 0));
    const charge = clamp01(numberFrom(state, ["charge", "chargeAmount"], truthyFrom(state, ["charging"]) ? 0.8 : 0));
    const hurt = clamp01(numberFrom(state, ["hurt", "hurtAmount", "stagger"], truthyFrom(state, ["staggered"]) ? 1 : 0));
    const dead = truthyFrom(state, ["dead", "defeated"]);
    const cycle = t * (3.8 + speed * 5.8) + actor.variant * 0.8;
    const step = Math.sin(cycle) * speed;
    const swing = Math.sin(attack * PI);
    const snap = smoothstep(Math.min(1, attack * 1.45));

    actor.body.position.y = damp(actor.body.position.y, dead ? -0.62 : 0.06 + Math.sin(t * 1.7 + actor.variant) * 0.035, 9, dt);
    actor.body.position.z = damp(actor.body.position.z, dead ? 0 : -swing * 0.16, 18, dt);
    poseRotation(actor.body, dead ? 0.22 : -speed * 0.04, 0, dead ? (actor.variant % 2 ? 0.88 : -0.88) : hurt * 0.15, dt, dead ? 4 : 13);
    poseRotation(rig.torso, -speed * 0.025 - hurt * 0.12, step * -0.06, hurt * 0.12, dt, 13);
    poseRotation(rig.pelvis, 0, step * 0.08, -step * 0.025, dt, 13);
    poseRotation(rig.ringHub, Math.sin(t * 1.3) * 0.025, hurt * -0.15, 0, dt, 10);
    rig.shoulderRing.rotation.z = t * (0.12 + charge * 0.32) + actor.variant * 0.22;
    rig.innerRing.rotation.x = 0.38 + Math.sin(t * 0.9) * 0.08;
    rig.innerRing.rotation.z = -t * (0.2 + charge * 0.4);
    rig.crossRing.rotation.y = PI * 0.5 + t * (0.16 + charge * 0.34);

    let leftArmX = step * 0.42;
    let rightArmX = -step * 0.42;
    let leftArmZ = -0.15;
    let rightArmZ = 0.15;
    let leftForeX = -0.1;
    let rightForeX = -0.1;
    if (attack > 0 && !dead) {
      leftArmX = -1.2 + snap * 1.45;
      rightArmX = -1.0 + snap * 1.1;
      leftArmZ = -0.85 + snap * 1.6;
      rightArmZ = 0.72 - snap * 1.35;
      leftForeX = -0.66;
      rightForeX = -0.58;
    }
    if (charge > 0 && !dead) {
      leftArmX = -1.25;
      rightArmX = -1.25;
      leftArmZ = -0.52;
      rightArmZ = 0.52;
      leftForeX = -0.9;
      rightForeX = -0.9;
    }
    poseRotation(rig.leftUpperArm, leftArmX, 0, leftArmZ, dt, 16);
    poseRotation(rig.rightUpperArm, rightArmX, 0, rightArmZ, dt, 16);
    poseRotation(rig.leftForearm, leftForeX, 0, 0, dt, 17);
    poseRotation(rig.rightForearm, rightForeX, 0, 0, dt, 17);
    poseRotation(rig.leftThigh, step * 0.52, 0, -0.02, dt, 16);
    poseRotation(rig.rightThigh, -step * 0.52, 0, 0.02, dt, 16);
    poseRotation(rig.leftShin, Math.max(0, -step) * 0.62, 0, 0, dt, 16);
    poseRotation(rig.rightShin, Math.max(0, step) * 0.62, 0, 0, dt, 16);

    const pulse = 0.8 + Math.sin(t * 5.4 + actor.variant) * 0.15 + charge * 0.75;
    rig.core.material.emissiveIntensity = 1.45 + pulse + charge * 2.4 + hurt;
    rig.coreAura.material.opacity = 0.2 + pulse * 0.14 + charge * 0.35;
    rig.coreAura.scale.setScalar(0.62 + pulse * 0.12 + charge * 0.2);
    actor.shadow.material.opacity = dead ? 0.15 : 0.3;
  }

  function updateEnemy(actor, visualState, dt, elapsed) {
    if (!actor || !actor._rig) return;
    const state = visualState || {};
    if (actor._gold && actor.kind === "warden" && global.DrownedGoldAssets && typeof global.DrownedGoldAssets.updateWarden === "function") {
      applyFacing(actor, state, dt);
      global.DrownedGoldAssets.updateWarden(actor, state, dt, elapsed);
      return;
    }
    const t = typeof elapsed === "number" ? elapsed : ((actor._elapsed || 0) + (dt || 0));
    actor._elapsed = t;
    applyFacing(actor, state, dt);
    if (actor.kind === "rootbound") updateRootbound(actor, state, dt, t);
    else if (actor.kind === "warden") updateWarden(actor, state, dt, t);
  }

  function updateBoss(actor, visualState, dt, elapsed) {
    if (!actor || actor.kind !== "boss" || !actor._rig) return;
    const state = visualState || {};
    const rig = actor._rig;
    const t = typeof elapsed === "number" ? elapsed : ((actor._elapsed || 0) + (dt || 0));
    actor._elapsed = t;
    applyFacing(actor, state, dt);

    const phase = Math.max(1, Math.floor(numberFrom(state, ["phase", "bossPhase"], 1)));
    const charge = clamp01(numberFrom(state, ["charge", "chargeAmount", "attackCharge"], truthyFrom(state, ["charging"]) ? 0.8 : 0));
    const attack = clamp01(numberFrom(state, ["attackPhase", "attack", "swingPhase"], 0));
    const stagger = clamp01(numberFrom(state, ["stagger", "staggerAmount"], truthyFrom(state, ["staggered"]) ? 1 : 0));
    const hurt = clamp01(numberFrom(state, ["hurt", "hurtAmount", "hitFlash"], 0));
    const dead = truthyFrom(state, ["dead", "defeated"]);
    const phaseBloom = Math.min(0.3, (phase - 1) * 0.12);
    const breathing = Math.sin(t * 1.25) * 0.055;
    const swing = Math.sin(attack * PI);
    const snap = smoothstep(Math.min(1, attack * 1.5));

    actor.body.position.y = damp(actor.body.position.y, dead ? -2.1 : breathing - stagger * 0.5, dead ? 3 : 7, dt);
    actor.body.position.z = damp(actor.body.position.z, -swing * 0.18, 12, dt);
    poseRotation(actor.body, stagger * 0.16 + (dead ? 0.3 : 0), hurt * 0.08, dead ? -0.28 : Math.sin(t * 0.55) * 0.018, dt, dead ? 3 : 9);
    poseRotation(rig.trunk, -stagger * 0.13, Math.sin(t * 0.42) * 0.035, hurt * 0.08, dt, 7);
    poseRotation(rig.hub, -stagger * 0.18, Math.sin(t * 0.36) * 0.045, Math.sin(t * 0.48) * 0.025, dt, 7);

    for (let i = 0; i < rig.plates.length; i += 1) {
      const item = rig.plates[i];
      const ripple = Math.sin(t * 1.45 + i * 0.72) * 0.045;
      const bloom = phaseBloom + charge * 0.28 + ripple - stagger * 0.12;
      const radialX = -Math.sin(item.angle) * bloom;
      const radialY = Math.cos(item.angle) * bloom;
      item.pivot.position.x = damp(item.pivot.position.x, radialX, 7, dt);
      item.pivot.position.y = damp(item.pivot.position.y, radialY, 7, dt);
      item.pivot.position.z = damp(item.pivot.position.z, charge * 0.14 + (i % 2) * 0.035, 7, dt);
      const targetZ = item.angle + ripple * 0.35 + (dead ? (i % 2 ? 0.22 : -0.22) : 0);
      item.pivot.rotation.z = dampAngle(item.pivot.rotation.z, targetZ, 8, dt);
      item.pivot.rotation.y = dampAngle(item.pivot.rotation.y, charge * (i % 2 ? 0.12 : -0.12) + stagger * 0.16, 7, dt);
    }

    rig.outerRingA.rotation.z = t * (0.08 + phase * 0.018 + charge * 0.22);
    rig.outerRingA.rotation.x = 0.22 + Math.sin(t * 0.33) * 0.06 + stagger * 0.18;
    rig.outerRingB.rotation.y = PI * 0.5 + t * (0.105 + phase * 0.014 + charge * 0.26);
    rig.outerRingB.rotation.z = 0.2 + Math.sin(t * 0.4) * 0.1;
    rig.outerRingC.rotation.x = PI * 0.5 + t * (0.065 + charge * 0.16);
    rig.outerRingC.rotation.y = 0.25 + Math.sin(t * 0.48) * 0.09;

    for (let i = 0; i < rig.moons.length; i += 1) {
      const moon = rig.moons[i];
      moon.pivot.rotation.z = t * moon.speed * (1 + phase * 0.12 + charge * 1.5) + i * TAU / rig.moons.length;
      moon.pivot.rotation.x = moon.tilt + Math.sin(t * 0.32 + i) * 0.08;
      moon.moon.rotation.x = t * (0.7 + i * 0.13);
      moon.moon.rotation.y = t * (0.45 + i * 0.1);
    }

    let leftArmX = -0.08 + Math.sin(t * 1.05) * 0.07;
    let rightArmX = -0.08 + Math.sin(t * 1.05 + PI) * 0.07;
    let leftArmZ = -0.45;
    let rightArmZ = 0.45;
    let leftForeX = -0.12;
    let rightForeX = -0.12;
    if (charge > 0 && !dead) {
      leftArmX = -1.42 + charge * 0.18;
      rightArmX = -1.42 + charge * 0.18;
      leftArmZ = -0.62;
      rightArmZ = 0.62;
      leftForeX = -0.82;
      rightForeX = -0.82;
    }
    if (attack > 0 && !dead) {
      leftArmX = -1.2 + snap * 1.45;
      rightArmX = -1.05 + snap * 1.32;
      leftArmZ = -1.0 + snap * 1.8;
      rightArmZ = 0.86 - snap * 1.65;
      leftForeX = -0.62;
      rightForeX = -0.62;
    }
    if (stagger > 0 || dead) {
      leftArmX = 0.28;
      rightArmX = 0.28;
      leftArmZ = -0.16;
      rightArmZ = 0.16;
      leftForeX = 0.4;
      rightForeX = 0.4;
    }
    poseRotation(rig.leftUpper, leftArmX, 0, leftArmZ, dt, 11);
    poseRotation(rig.rightUpper, rightArmX, 0, rightArmZ, dt, 11);
    poseRotation(rig.leftFore, leftForeX, 0, 0, dt, 12);
    poseRotation(rig.rightFore, rightForeX, 0, 0, dt, 12);

    const pulse = 0.85 + Math.sin(t * (4.2 + phase * 0.4)) * 0.15 + charge * 0.85;
    rig.coreIris.material.emissiveIntensity = 1.8 + pulse + charge * 3 + hurt * 1.6;
    rig.coreAura.material.opacity = 0.24 + pulse * 0.14 + charge * 0.38 + hurt * 0.15;
    rig.coreAura.scale.setScalar(0.92 + pulse * 0.1 + charge * 0.28);
    rig.coreRing.scale.setScalar(1 + charge * 0.08 + Math.sin(t * 2.1) * 0.012);
    actor.shadow.material.opacity = dead ? 0.2 : 0.38;
    actor.shadow.scale.set(2.65 + phaseBloom * 0.5, 1.75 + phaseBloom * 0.35, 1);
  }

  global.DrownedActors = Object.freeze({
    createHero: createHero,
    createRootbound: createRootbound,
    createWarden: createWarden,
    createBoss: createBoss,
    updateHero: updateHero,
    updateEnemy: updateEnemy,
    updateBoss: updateBoss,
  });
})(typeof window !== "undefined" ? window : globalThis);
