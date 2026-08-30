(function () {
  'use strict';

  // Asterwake's world is deliberately asset-free: every surface and silhouette is
  // authored from deterministic geometry so a reload always produces the same valley.
  window.DrownedWorld = {
    create: function (THREE, scene, renderer, options) {
      options = options || {};
      var qualityName = String(options.quality || 'high').toLowerCase();
      var quality = qualityName === 'low' ? 0 : qualityName === 'medium' ? 1 : 2;
      var reduceMotion = !!options.reduceMotion;
      var rng = mulberry32(0x0a57e4a1);
      var root = new THREE.Group();
      root.name = 'Drowned Orrery World';
      scene.add(root);

      configureRenderer(THREE, renderer, quality);

      var palette = {
        abyss: new THREE.Color(0x081821),
        storm: new THREE.Color(0x173849),
        moss: new THREE.Color(0x203a37),
        mossLight: new THREE.Color(0x526865),
        ivory: new THREE.Color(0xc8b991),
        bronze: new THREE.Color(0x6f806b),
        cyan: new THREE.Color(0x72e0db),
        gold: new THREE.Color(0xffd17c),
        coral: new THREE.Color(0xf0644d),
        violet: new THREE.Color(0x7e3f75)
      };

      scene.background = palette.abyss.clone();
      // The Orrery is 155 units from the opening shot; keep enough aerial perspective
      // for depth without ever erasing the landmark that anchors navigation.
      scene.fog = new THREE.Fog(0x3b5963, 48, quality === 0 ? 178 : 212);

      var textureSize = quality === 2 ? 256 : quality === 1 ? 128 : 64;
      var maxAnisotropy = renderer && renderer.capabilities && renderer.capabilities.getMaxAnisotropy
        ? Math.min(quality === 2 ? 8 : 4, renderer.capabilities.getMaxAnisotropy())
        : 1;
      var terrainMap = makeSurfaceTexture(THREE, textureSize, 0x71847f, 0xbcc0aa, 401, 'mottle', maxAnisotropy);
      // Non-harmonic tiling plus a slight diagonal bias keeps the procedural
      // swatches from resolving into a visible checker across long hill faces.
      terrainMap.repeat.set(10.75, 17.25);
      terrainMap.center.set(0.5, 0.5);
      terrainMap.rotation = 0.065;
      var terrainDetailMap = makeSurfaceTexture(THREE, textureSize, 0xb8b8b8, 0xf5f5f5, 409, 'stone', maxAnisotropy);
      terrainDetailMap.repeat.set(28.5, 43.25);
      terrainDetailMap.center.set(0.5, 0.5);
      terrainDetailMap.rotation = -0.09;
      if (THREE.LinearEncoding !== undefined) terrainDetailMap.encoding = THREE.LinearEncoding;
      var routeDetailMap = terrainDetailMap.clone();
      routeDetailMap.name = 'Worn route microdetail';
      routeDetailMap.repeat.set(3, 7);
      routeDetailMap.needsUpdate = true;
      var stoneMap = makeSurfaceTexture(THREE, textureSize, 0x707978, 0xa9b0aa, 733, 'stone', maxAnisotropy);
      stoneMap.repeat.set(3, 4);
      var rootMap = makeSurfaceTexture(THREE, textureSize, 0xa69f82, 0xe2d7b5, 991, 'grain', maxAnisotropy);
      rootMap.repeat.set(2, 6);
      var bronzeMap = makeSurfaceTexture(THREE, textureSize, 0x718078, 0xaeb29a, 1201, 'metal', maxAnisotropy);
      bronzeMap.repeat.set(3, 3);

      var terrainMaterial = new THREE.MeshStandardMaterial({
        name: 'Wind-cut valley earth',
        // The procedural map supplies micro-variation while vertex color carries
        // the authored path/wetland palette; neutral albedo avoids double tinting.
        color: 0xffffff,
        map: terrainMap,
        bumpMap: terrainDetailMap,
        bumpScale: 0.085,
        roughnessMap: terrainDetailMap,
        vertexColors: true,
        roughness: 0.96,
        metalness: 0.0
      });
      var basaltMaterial = new THREE.MeshStandardMaterial({
        name: 'Porous midnight basalt',
        color: 0x2b393b,
        map: stoneMap,
        bumpMap: stoneMap,
        bumpScale: 0.15,
        roughness: 0.94,
        metalness: 0.04
      });
      var cutBasaltMaterial = new THREE.MeshStandardMaterial({
        name: 'Rain-polished cut basalt',
        color: 0x445255,
        map: stoneMap,
        bumpMap: stoneMap,
        bumpScale: 0.045,
        roughness: 0.76,
        metalness: 0.08
      });
      var rootMaterial = new THREE.MeshStandardMaterial({
        name: 'Pale rootwood',
        color: new THREE.Color(0xd4c7a2),
        map: rootMap,
        bumpMap: rootMap,
        bumpScale: 0.055,
        roughness: 0.76,
        metalness: 0.0,
        emissive: new THREE.Color(0x11130e),
        emissiveIntensity: 0.22
      });
      var darkRootMaterial = new THREE.MeshStandardMaterial({
        name: 'Ancient root bark',
        color: 0x5a5d50,
        map: rootMap,
        bumpMap: rootMap,
        bumpScale: 0.075,
        roughness: 0.9,
        metalness: 0.0
      });
      var bronzeMaterial = new THREE.MeshStandardMaterial({
        name: 'Oxidized observatory bronze',
        color: new THREE.Color(0xa79b70),
        map: bronzeMap,
        bumpMap: bronzeMap,
        bumpScale: 0.022,
        roughness: 0.4,
        metalness: 0.38,
        emissive: new THREE.Color(0x1b1508),
        emissiveIntensity: 0.2
      });
      var bronzeEdgeMaterial = new THREE.MeshStandardMaterial({
        name: 'Polished bronze edges',
        color: 0xd1b878,
        map: bronzeMap,
        bumpMap: bronzeMap,
        bumpScale: 0.012,
        roughness: 0.28,
        metalness: 0.45,
        emissive: new THREE.Color(0x2d2109),
        emissiveIntensity: 0.24
      });
      var inactiveGlassMaterial = new THREE.MeshPhysicalMaterial({
        name: 'Dormant star glass',
        color: 0x325660,
        emissive: new THREE.Color(0x0b242b),
        emissiveIntensity: 0.6,
        roughness: 0.16,
        metalness: 0.05,
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      var orreryEnergyMaterial = new THREE.MeshBasicMaterial({
        name: 'Orrery refracted light',
        color: palette.cyan.clone(),
        transparent: true,
        opacity: 0.58,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        fog: false
      });

      var sky = createSky(THREE, palette, scene.fog);
      root.add(sky.mesh);

      var hemi = new THREE.HemisphereLight(0x7aa5ad, 0x1b2927, quality === 0 ? 0.84 : 0.76);
      hemi.name = 'Cool storm skylight';
      root.add(hemi);

      var sun = new THREE.DirectionalLight(0xffbd70, quality === 0 ? 1.78 : 2.22);
      sun.name = 'Low returning sun';
      sun.position.set(-72, 31, 58);
      sun.target.position.set(4, 1, -32);
      sun.castShadow = quality > 0;
      if (sun.shadow) {
        sun.shadow.mapSize.set(quality === 2 ? 2048 : 1024, quality === 2 ? 2048 : 1024);
        sun.shadow.camera.left = -74;
        sun.shadow.camera.right = 74;
        sun.shadow.camera.top = 94;
        sun.shadow.camera.bottom = -94;
        sun.shadow.camera.near = 8;
        sun.shadow.camera.far = 190;
        sun.shadow.bias = -0.00035;
        sun.shadow.normalBias = 0.035;
      }
      root.add(sun);
      root.add(sun.target);

      var horizonFill = new THREE.DirectionalLight(0x66a5b1, 0.82);
      horizonFill.name = 'Orrery horizon fill';
      horizonFill.position.set(35, 18, -78);
      horizonFill.target.position.set(0, 7, -25);
      root.add(horizonFill);
      root.add(horizonFill.target);

      // A restrained cross-key gives textured glTF metals and cloth a neutral
      // read without washing the authored storm lighting across the terrain.
      var materialKey = new THREE.DirectionalLight(0xffdfb0, quality === 0 ? 0.26 : 0.42);
      materialKey.name = 'Surveyor warm material key';
      materialKey.position.set(-18, 14, 18);
      materialKey.target.position.set(0, 3, -36);
      root.add(materialKey);
      root.add(materialKey.target);

      var materialRim = new THREE.DirectionalLight(0x91d8dc, quality === 0 ? 0.2 : 0.31);
      materialRim.name = 'Surveyor cool silhouette rim';
      materialRim.position.set(21, 11, -68);
      materialRim.target.position.set(0, 4, -34);
      root.add(materialRim);
      root.add(materialRim.target);

      // Local no-shadow pools shape the two destination spaces without raising
      // the exposure of the whole valley. The gate's own cyan seal supplies its
      // cool half; the arena receives a deliberate warm/cool cross-light.
      var gateWarmFocus = new THREE.SpotLight(
        0xffbd78,
        quality === 0 ? 0.72 : 1.16,
        31,
        0.5,
        0.78,
        1.8
      );
      gateWarmFocus.name = 'Gate amber threshold focus';
      gateWarmFocus.position.set(-10.5, 10.5, -30.5);
      gateWarmFocus.target.position.set(0, 2.9, -44);
      root.add(gateWarmFocus);
      root.add(gateWarmFocus.target);

      var arenaWarmFocus = new THREE.SpotLight(
        0xffc886,
        quality === 0 ? 0.62 : 0.98,
        36,
        0.54,
        0.82,
        1.9
      );
      arenaWarmFocus.name = 'Arena low amber key';
      arenaWarmFocus.position.set(-15, 13.5, -49);
      arenaWarmFocus.target.position.set(-1.8, 1.9, -66);
      root.add(arenaWarmFocus);
      root.add(arenaWarmFocus.target);

      var arenaCoolFocus = new THREE.SpotLight(
        0x70cbd2,
        quality === 0 ? 0.52 : 0.82,
        31,
        0.5,
        0.84,
        2.0
      );
      arenaCoolFocus.name = 'Arena drowned-blue rim pool';
      arenaCoolFocus.position.set(13, 9, -79);
      arenaCoolFocus.target.position.set(2.4, 2.7, -66);
      root.add(arenaCoolFocus);
      root.add(arenaCoolFocus.target);

      function heightAt(x, z) {
        x = Number(x) || 0;
        z = Number(z) || 0;
        var broad = fbm(x * 0.041, z * 0.041) * 1.22;
        var detail = valueNoise(x * 0.118 + 13.2, z * 0.118 - 4.7) * 0.38;
        var y = -0.72 + broad + detail + Math.sin(z * 0.055 + x * 0.018) * 0.22;

        // Three authored, overlapping landforms interrupt the noise field's
        // uniform frequency. They sit outside the traversal ribbon, so their
        // asymmetry reads in the long camera while the route remains predictable.
        var westShoulderDistance = Math.sqrt(
          Math.pow((x + 42) / 15.5, 2) + Math.pow((z - 9) / 47, 2)
        );
        var eastShoulderDistance = Math.sqrt(
          Math.pow((x - 43) / 17, 2) + Math.pow((z + 8) / 40, 2)
        );
        var northShelfDistance = Math.sqrt(
          Math.pow((x - 21) / 24, 2) + Math.pow((z - 58) / 19, 2)
        );
        var westShoulder = 1 - smoothstep(0.22, 1.05, westShoulderDistance);
        var eastShoulder = 1 - smoothstep(0.2, 1.0, eastShoulderDistance);
        var northShelf = 1 - smoothstep(0.18, 1.0, northShelfDistance);
        y += westShoulder * (1.62 + valueNoise(x * 0.075 - 3.2, z * 0.052 + 8.4) * 0.28);
        y += eastShoulder * (1.28 + valueNoise(x * 0.061 + 9.7, z * 0.068 - 2.1) * 0.24);
        y += northShelf * (0.74 + valueNoise(x * 0.09 - 12.0, z * 0.07 + 5.0) * 0.16);

        var edge = Math.max(0, Math.abs(x) - 34) / 18;
        y += edge * edge * (10.8 + 2.2 * valueNoise(x * 0.07, z * 0.04));
        if (z < -86) {
          var rearShoulders = smoothstep(16, 36, Math.abs(x));
          y += (1 - smoothstep(-98, -86, z)) * 4.0 * rearShoulders;
        }

        var sx = streamX(z);
        var streamDistance = Math.abs(x - sx);
        y -= (1 - smoothstep(1.2, 5.1, streamDistance)) * 0.72;

        if (z < 80 && z > -46) {
          var routeDistance = Math.abs(x - pathX(z));
          var wornCenter = 1 - smoothstep(0.5, 2.55, routeDistance);
          var raisedBank = smoothstep(2.25, 3.55, routeDistance) * (1 - smoothstep(3.55, 5.15, routeDistance));
          y -= wornCenter * 0.075;
          y += raisedBank * 0.17;
        }

        y = flattenHeight(y, x, z, 0, 68, 7.5, 0.05);
        y = flattenHeight(y, x, z, -24, 20, 5.7, 1.05);
        y = flattenHeight(y, x, z, 25, 2, 5.7, 0.58);
        y = flattenHeight(y, x, z, 0, -27, 6.1, 0.08);
        y = flattenHeight(y, x, z, 0, -44, 8.2, -0.12);
        // The boss dais must sit cleanly above the land across its entire rim.
        // Keep the full platform footprint planar, then feather into the valley.
        y = flattenHeightRange(y, x, z, 0, -66, 21.2, 26.0, -0.34);
        return y;
      }

      var terrain = createTerrain(THREE, heightAt, terrainMaterial, quality);
      terrain.name = 'Authored valley terrain';
      terrain.receiveShadow = true;
      root.add(terrain);

      var routeRibbon = createRouteRibbon(THREE, heightAt, routeDetailMap, quality);
      root.add(routeRibbon);

      var water = createStream(THREE, heightAt, palette, quality, reduceMotion);
      root.add(water.mesh);

      var colliders = [];
      var cylinderUnit = new THREE.CylinderGeometry(1, 1, 1, quality === 0 ? 6 : 8, 1, false);
      var rockGeometry = makeFacetedRockGeometry(THREE, quality === 0 ? 0 : 1);

      var cliffGroup = createCliffs(
        THREE,
        heightAt,
        basaltMaterial,
        darkRootMaterial,
        cylinderUnit,
        rng,
        quality,
        colliders
      );
      root.add(cliffGroup);

      var stoneField = createStoneField(
        THREE,
        heightAt,
        cutBasaltMaterial,
        rockGeometry,
        rng,
        quality,
        colliders
      );
      root.add(stoneField);

      var authoredProps = createAuthoredPropClusters(
        THREE,
        heightAt,
        basaltMaterial,
        cutBasaltMaterial,
        rootMaterial,
        bronzeMaterial,
        bronzeEdgeMaterial,
        cylinderUnit,
        rockGeometry,
        quality,
        colliders
      );
      root.add(authoredProps);

      var pathMarkers = createPathMarkers(THREE, heightAt, bronzeMaterial, bronzeEdgeMaterial, cylinderUnit);
      root.add(pathMarkers);

      var surfaceRoots = createSurfaceRoots(THREE, heightAt, darkRootMaterial, rootMaterial, quality);
      root.add(surfaceRoots);

      var grass = createGrass(THREE, heightAt, palette, rng, quality, reduceMotion);
      root.add(grass.mesh);

      var flowers = createStarFlowers(THREE, heightAt, palette, rng, quality);
      root.add(flowers);

      var arena = createArena(
        THREE,
        heightAt,
        basaltMaterial,
        cutBasaltMaterial,
        bronzeMaterial,
        bronzeEdgeMaterial,
        cylinderUnit,
        colliders
      );
      root.add(arena.root);

      var mechanisms = [];
      var mechanismCoordinates = [
        { id: 'vesper', x: -24, z: 20, color: 0x72e0db, phase: 0.4 },
        { id: 'meridian', x: 25, z: 2, color: 0xffd17c, phase: 2.7 },
        { id: 'nadir', x: 0, z: -27, color: 0x8ae0c1, phase: 4.9 }
      ];
      for (var mi = 0; mi < mechanismCoordinates.length; mi++) {
        var mc = mechanismCoordinates[mi];
        var mechanism = createMechanism(
          THREE,
          mc,
          heightAt(mc.x, mc.z),
          basaltMaterial,
          bronzeMaterial,
          bronzeEdgeMaterial,
          inactiveGlassMaterial,
          cylinderUnit,
          quality
        );
        mechanisms.push(mechanism);
        root.add(mechanism.root);
        colliders.push({ x: mc.x, z: mc.z, radius: 2.05, kind: 'mechanism' });
      }

      var gate = createGate(
        THREE,
        heightAt(0, -44),
        rootMaterial,
        basaltMaterial,
        bronzeMaterial,
        bronzeEdgeMaterial,
        palette,
        cylinderUnit
      );
      root.add(gate.root);
      colliders.push({ x: -6.15, z: -44, radius: 1.55, kind: 'gate-pillar' });
      colliders.push({ x: 6.15, z: -44, radius: 1.55, kind: 'gate-pillar' });

      var orrery = createOrrery(
        THREE,
        heightAt,
        rootMaterial,
        darkRootMaterial,
        bronzeMaterial,
        bronzeEdgeMaterial,
        orreryEnergyMaterial,
        palette,
        cylinderUnit,
        rng,
        quality
      );
      root.add(orrery);
      colliders.push({ x: 0, z: -86.5, radius: 5.5, kind: 'orrery-root' });

      var motes = createMotes(THREE, palette, rng, quality, reduceMotion);
      root.add(motes.points);

      var restoredTarget = 0;
      var restoredAmount = 0;
      var worldClock = 0;
      var fogDormant = new THREE.Color(0x3b5963);
      var fogRestored = new THREE.Color(0x54736f);
      var hemiSkyDormant = new THREE.Color(0x7aa5ad);
      var hemiSkyRestored = new THREE.Color(0x91c8c4);
      var hemiGroundDormant = new THREE.Color(0x242a31);
      var hemiGroundRestored = new THREE.Color(0x3a3b34);
      var sunDormant = new THREE.Color(0xffbd70);
      var sunRestored = new THREE.Color(0xffe1a6);

      function setRestored(value) {
        restoredTarget = value ? 1 : 0;
      }

      function update(dt, elapsed, runtimeState) {
        dt = Math.min(Math.max(Number(dt) || 0, 0), 0.08);
        worldClock = Number.isFinite(elapsed) ? elapsed : worldClock + dt;
        runtimeState = runtimeState || {};
        if (typeof runtimeState.restored === 'boolean') setRestored(runtimeState.restored);
        if (typeof runtimeState.gateOpen === 'boolean') gate.setOpen(runtimeState.gateOpen);

        var restorationEase = 1 - Math.exp(-dt * 1.35);
        restoredAmount += (restoredTarget - restoredAmount) * restorationEase;
        sky.uniforms.uTime.value = worldClock;
        sky.uniforms.uRestored.value = restoredAmount;
        water.uniforms.uTime.value = reduceMotion ? worldClock * 0.16 : worldClock;
        water.uniforms.uRestored.value = restoredAmount;
        water.uniforms.uOpacity.value = 0.9 + restoredAmount * 0.1;
        grass.uniforms.uTime.value = reduceMotion ? worldClock * 0.12 : worldClock;
        motes.uniforms.uTime.value = reduceMotion ? worldClock * 0.1 : worldClock;
        motes.uniforms.uRestored.value = restoredAmount;

        scene.fog.color.copy(fogDormant).lerp(fogRestored, restoredAmount);
        scene.background.copy(palette.abyss).lerp(new THREE.Color(0x153b43), restoredAmount);
        hemi.color.copy(hemiSkyDormant).lerp(hemiSkyRestored, restoredAmount);
        hemi.groundColor.copy(hemiGroundDormant).lerp(hemiGroundRestored, restoredAmount);
        hemi.intensity = (quality === 0 ? 0.84 : 0.76) + restoredAmount * 0.28;
        sun.color.copy(sunDormant).lerp(sunRestored, restoredAmount);
        sun.intensity = (quality === 0 ? 1.78 : 2.22) + restoredAmount * 0.34;
        horizonFill.intensity = 0.82 + restoredAmount * 0.16;
        var bossPresentation = runtimeState.bossActive ? 1 : 0;
        if (arena.presentationObstructions) {
          for (var obstructionIndex = 0; obstructionIndex < arena.presentationObstructions.length; obstructionIndex++) {
            arena.presentationObstructions[obstructionIndex].visible = !bossPresentation;
          }
        }
        materialKey.intensity = (quality === 0 ? 0.26 : 0.42) + bossPresentation * 0.2 + restoredAmount * 0.06;
        materialRim.intensity = (quality === 0 ? 0.2 : 0.31) + bossPresentation * 0.24 + restoredAmount * 0.05;
        gateWarmFocus.intensity = (quality === 0 ? 0.72 : 1.16) + (1 - gate._amount) * 0.12 + restoredAmount * 0.08;
        arenaWarmFocus.intensity = (quality === 0 ? 0.62 : 0.98) + bossPresentation * 0.34 + restoredAmount * 0.1;
        arenaCoolFocus.intensity = (quality === 0 ? 0.52 : 0.82) + bossPresentation * 0.42 + restoredAmount * 0.08;
        var lightFocus = runtimeState.bossActive ? arena.center : runtimeState.playerPosition;
        if (lightFocus) {
          materialKey.target.position.set(lightFocus.x, lightFocus.y + 2.4, lightFocus.z);
          materialRim.target.position.set(lightFocus.x, lightFocus.y + 3.2, lightFocus.z);
        }
        rootMaterial.emissive.setRGB(
          0.065 + restoredAmount * 0.09,
          0.074 + restoredAmount * 0.11,
          0.055 + restoredAmount * 0.08
        );
        orreryEnergyMaterial.opacity = 0.58 + restoredAmount * 0.34;
        orreryEnergyMaterial.color.copy(palette.cyan).lerp(palette.gold, restoredAmount * 0.62);

        var activeCount = 0;
        for (var i = 0; i < mechanisms.length; i++) {
          var m = mechanisms[i];
          if (m.active) activeCount++;
          updateMechanism(m, dt, worldClock, reduceMotion);
        }
        if (activeCount === mechanisms.length && !gate.open && runtimeState.autoOpenGate !== false) {
          gate.setOpen(true);
        }

        gate._update(dt, worldClock, reduceMotion);
        updateOrrery(orrery, dt, worldClock, activeCount / mechanisms.length, restoredAmount, reduceMotion, !!runtimeState.bossActive);
      }

      function resolvePosition(previous, desired, radius) {
        radius = Math.max(0.05, Number(radius) || 0.55);
        previous = previous || desired || new THREE.Vector3();
        desired = desired || previous;
        var result = new THREE.Vector3(
          clamp(Number(desired.x) || 0, -52 + radius, 52 - radius),
          Number(desired.y) || 0,
          clamp(Number(desired.z) || 0, -91 + radius, 83 - radius)
        );

        for (var pass = 0; pass < 2; pass++) {
          for (var i = 0; i < colliders.length; i++) {
            var c = colliders[i];
            if (c.disabled) continue;
            var dx = result.x - c.x;
            var dz = result.z - c.z;
            var minDistance = radius + c.radius;
            var distanceSq = dx * dx + dz * dz;
            if (distanceSq < minDistance * minDistance) {
              var distance = Math.sqrt(distanceSq);
              if (distance < 0.0001) {
                dx = (Number(previous.x) || 0) - c.x;
                dz = (Number(previous.z) || 0) - c.z;
                distance = Math.sqrt(dx * dx + dz * dz) || 1;
              }
              result.x = c.x + dx / distance * minDistance;
              result.z = c.z + dz / distance * minDistance;
            }
          }
        }

        // `open` is the requested state; the slab remains solid until the heavy
        // leaves have visibly cleared the player silhouette.
        if (gate._amount < 0.84 && Math.abs(result.x) < 5.45 + radius) {
          var gateZ = -44;
          var crossedGate = (previous.z - gateZ) * (result.z - gateZ) <= 0;
          var withinGateSlab = Math.abs(result.z - gateZ) < 0.7 + radius;
          if (crossedGate || withinGateSlab) {
            result.z = previous.z >= gateZ ? gateZ + 0.72 + radius : gateZ - 0.72 - radius;
          }
        }

        result.x = clamp(result.x, -52 + radius, 52 - radius);
        result.z = clamp(result.z, -91 + radius, 83 - radius);
        result.y = heightAt(result.x, result.z);
        return result;
      }

      update(0, 0, {});

      return {
        root: root,
        mechanisms: mechanisms,
        gate: gate,
        arena: { center: arena.center.clone(), radius: arena.radius, root: arena.root },
        orrery: orrery,
        colliders: colliders,
        heightAt: heightAt,
        resolvePosition: resolvePosition,
        setRestored: setRestored,
        update: update
      };
    }
  };

  function configureRenderer(THREE, renderer, quality) {
    if (!renderer) return;
    if (THREE.ACESFilmicToneMapping !== undefined) renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    if (THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
    if (renderer.shadowMap) {
      renderer.shadowMap.enabled = quality > 0;
      if (THREE.PCFSoftShadowMap !== undefined) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
  }

  function createSky(THREE, palette, fog) {
    var uniforms = {
      uTime: { value: 0 },
      uRestored: { value: 0 },
      uTop: { value: palette.abyss.clone() },
      uHorizon: { value: new THREE.Color(0x45656e) },
      uSun: { value: palette.gold.clone() }
    };
    var material = new THREE.ShaderMaterial({
      name: 'Layered storm-cleared sky',
      uniforms: uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: [
        'varying vec3 vDirection;',
        'void main(){',
        '  vec4 world = modelMatrix * vec4(position, 1.0);',
        '  vDirection = normalize(world.xyz);',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'precision highp float;',
        'uniform float uTime;',
        'uniform float uRestored;',
        'uniform vec3 uTop;',
        'uniform vec3 uHorizon;',
        'uniform vec3 uSun;',
        'varying vec3 vDirection;',
        'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }',
        'void main(){',
        '  vec3 d = normalize(vDirection);',
        '  float h = clamp(d.y * 0.62 + 0.38, 0.0, 1.0);',
        '  vec3 top = mix(uTop, vec3(0.045,0.19,0.23), uRestored);',
        '  vec3 horizon = mix(uHorizon, vec3(0.44,0.65,0.64), uRestored);',
        '  vec3 col = mix(horizon, top, smoothstep(0.08,0.9,h));',
        '  vec3 sunDir = normalize(vec3(-0.58,0.38,0.72));',
        '  float sun = pow(max(dot(d,sunDir),0.0), 190.0);',
        '  float haze = pow(max(dot(d,sunDir),0.0), 9.0) * (1.0-h) * 0.42;',
        '  col += uSun * (sun * 1.8 + haze * (0.48 + uRestored * 0.35));',
        '  float cloud = sin(d.x*13.0 + d.z*8.0 + sin(d.z*17.0))*0.5+0.5;',
        '  cloud *= smoothstep(0.15,0.65,h)*(1.0-smoothstep(0.72,0.96,h));',
        '  col = mix(col, col*0.78 + vec3(0.035,0.07,0.075), cloud*0.2*(1.0-uRestored*0.65));',
        '  float star = step(0.9985, hash(floor((d.xz+1.0)*410.0))) * smoothstep(0.5,0.9,h);',
        '  col += vec3(star * (1.0-uRestored) * 0.45);',
        '  gl_FragColor = vec4(col,1.0);',
        '}'
      ].join('\n')
    });
    var mesh = new THREE.Mesh(new THREE.SphereGeometry(230, 32, 18), material);
    mesh.name = 'Sky vault';
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000;
    return { mesh: mesh, uniforms: uniforms };
  }

  function createTerrain(THREE, heightAt, material, quality) {
    var xSegments = quality === 2 ? 76 : quality === 1 ? 58 : 38;
    var zSegments = quality === 2 ? 116 : quality === 1 ? 88 : 56;
    var minX = -58;
    var maxX = 58;
    var minZ = -99;
    var maxZ = 91;
    var positions = [];
    var colors = [];
    var uvs = [];
    var indices = [];
    var moss = new THREE.Color(0x223a37);
    var dry = new THREE.Color(0x435151);
    var path = new THREE.Color(0xc4ad70);
    var wet = new THREE.Color(0x102b33);
    var stone = new THREE.Color(0x354b50);
    var lichen = new THREE.Color(0x5d6f61);
    var peat = new THREE.Color(0x263437);
    var ochre = new THREE.Color(0x756747);
    var foreground = new THREE.Color(0x172e31);
    var middleDistance = new THREE.Color(0x58635a);
    var atmosphere = new THREE.Color(0x425d64);
    var tmp = new THREE.Color();

    for (var iz = 0; iz <= zSegments; iz++) {
      var vz = iz / zSegments;
      var z = minZ + (maxZ - minZ) * vz;
      for (var ix = 0; ix <= xSegments; ix++) {
        var vx = ix / xSegments;
        var x = minX + (maxX - minX) * vx;
        var y = heightAt(x, z);
        positions.push(x, y, z);
        // Continuous domain warping interrupts identical texels at the scale of
        // whole hills while preserving a stable, seam-free micro surface.
        var uvWarpX = fbm(x * 0.026 + 6.7, z * 0.024 - 11.3) * 0.012 + Math.sin(z * 0.041) * 0.006;
        var uvWarpZ = fbm(x * 0.021 - 9.2, z * 0.029 + 4.6) * 0.011 + Math.sin(x * 0.038) * 0.005;
        uvs.push(vx + uvWarpX, vz + uvWarpZ);

        var n = valueNoise(x * 0.19 + 4.2, z * 0.19 - 8.1) * 0.5 + 0.5;
        tmp.copy(moss).lerp(dry, clamp((y + 0.7) * 0.065 + n * 0.16, 0, 0.38));
        if (Math.abs(x) > 27) tmp.lerp(stone, smoothstep(27, 49, Math.abs(x)) * 0.9);
        var foregroundBand = smoothstep(27, 73, z);
        var midBand = 1 - smoothstep(24, 68, Math.abs(z - 4));
        var distanceBand = 1 - smoothstep(-65, -12, z);
        tmp.lerp(foreground, foregroundBand * 0.72);
        tmp.lerp(middleDistance, midBand * 0.2);
        tmp.lerp(atmosphere, distanceBand * 0.48);
        var macroPatch = clamp(fbm(x * 0.032 - 8.4, z * 0.028 + 13.1) * 0.5 + 0.5, 0, 1);
        var broadSwale = clamp(fbm(x * 0.057 + 19.0, z * 0.044 - 5.7) * 0.5 + 0.5, 0, 1);
        var mineralBand = Math.sin(x * 0.115 + z * 0.041 + macroPatch * 3.8) * 0.5 + 0.5;
        var shoulderWeight = smoothstep(20, 48, Math.abs(x));
        tmp.lerp(lichen, smoothstep(0.57, 0.88, macroPatch) * (0.08 + shoulderWeight * 0.09));
        tmp.lerp(peat, smoothstep(0.68, 0.94, 1 - broadSwale) * 0.13);
        tmp.lerp(ochre, smoothstep(0.84, 0.98, mineralBand) * shoulderWeight * 0.14);
        var groundBreakup = fbm(x * 0.105 + 17.3, z * 0.105 - 9.7) * 0.1;
        groundBreakup += valueNoise(x * 0.48 - 3.2, z * 0.48 + 6.1) * 0.035;
        var breakupWeight = 0.38 + smoothstep(-28, 72, z) * 0.62;
        tmp.offsetHSL(groundBreakup * 0.035, -0.018, groundBreakup * breakupWeight);
        var streamDist = Math.abs(x - streamX(z));
        if (streamDist < 5.0 && z > -38 && z < 82) {
          tmp.lerp(wet, (1 - smoothstep(1.7, 5.0, streamDist)) * 0.74);
        }
        var mainPath = Math.abs(x - pathX(z));
        var pathBlend = (1 - smoothstep(2.4, 6.4, mainPath)) * 0.88;
        tmp.lerp(path, pathBlend);
        colors.push(tmp.r, tmp.g, tmp.b);
      }
    }
    for (var zc = 0; zc < zSegments; zc++) {
      for (var xc = 0; xc < xSegments; xc++) {
        var a = zc * (xSegments + 1) + xc;
        var b = a + 1;
        var c = a + xSegments + 1;
        var d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    var geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return new THREE.Mesh(geometry, material);
  }

  function createRouteRibbon(THREE, heightAt, terrainMap, quality) {
    var positions = [];
    var colors = [];
    var uvs = [];
    var indices = [];
    var bankPositions = [];
    var bankColors = [];
    var bankIndices = [];
    var edgeColor = new THREE.Color(0x182d2e);
    var shoulderColor = new THREE.Color(0x967c48);
    var centerColor = new THREE.Color(0xd9bd70);
    var wornColor = new THREE.Color(0x8b7041);
    var bankOuterColor = new THREE.Color(0x192f30);
    var bankCrestColor = new THREE.Color(0x75623d);
    var tempColor = new THREE.Color();

    function appendStrip(samplePoint, segments, baseWidth, uvScale) {
      var stripBase = positions.length / 3;
      var bankStripBase = bankPositions.length / 3;
      var laneCount = 7;
      for (var i = 0; i <= segments; i++) {
        var t = i / segments;
        var before = samplePoint(Math.max(0, t - 0.006));
        var after = samplePoint(Math.min(1, t + 0.006));
        var point = samplePoint(t);
        var tangentX = after.x - before.x;
        var tangentZ = after.z - before.z;
        var tangentLength = Math.sqrt(tangentX * tangentX + tangentZ * tangentZ) || 1;
        var normalX = -tangentZ / tangentLength;
        var normalZ = tangentX / tangentLength;
        var wornNoise = valueNoise(point.x * 0.18 + 5.7, point.z * 0.18 - 8.2);
        var width = baseWidth * (0.91 + Math.sin(t * 17.0 + point.z * 0.07) * 0.055 + wornNoise * 0.055);
        for (var lane = 0; lane < laneCount; lane++) {
          var lateral = lane / (laneCount - 1) * 2 - 1;
          var edgeBreak = Math.abs(lateral) > 0.85 ? wornNoise * 0.16 : 0;
          var px = point.x + normalX * width * (lateral + edgeBreak * Math.sign(lateral));
          var pz = point.z + normalZ * width * (lateral + edgeBreak * Math.sign(lateral));
          var centerWeight = 1 - Math.abs(lateral);
          positions.push(px, heightAt(px, pz) + 0.054 - centerWeight * 0.024, pz);
          uvs.push(lane / (laneCount - 1), t * uvScale);
          tempColor.copy(edgeColor).lerp(shoulderColor, smoothstep(0, 0.55, centerWeight));
          tempColor.lerp(centerColor, smoothstep(0.48, 1, centerWeight));
          var mottling = valueNoise(px * 0.38 + 7.1, pz * 0.38 - 2.7) * 0.065;
          tempColor.offsetHSL(0, 0, mottling);
          var wornStripe = smoothstep(0.42, 1, centerWeight) * (valueNoise(px * 0.72 - 4.8, pz * 0.24 + 3.9) * 0.5 + 0.5);
          tempColor.lerp(wornColor, wornStripe * 0.16);
          colors.push(tempColor.r, tempColor.g, tempColor.b);
        }

        for (var bankSide = -1; bankSide <= 1; bankSide += 2) {
          var crestLateral = bankSide * width * 1.01;
          var outerLateral = bankSide * width * 1.34;
          var crestX = point.x + normalX * crestLateral;
          var crestZ = point.z + normalZ * crestLateral;
          var outerX = point.x + normalX * outerLateral;
          var outerZ = point.z + normalZ * outerLateral;
          bankPositions.push(crestX, heightAt(crestX, crestZ) + 0.14 + wornNoise * 0.025, crestZ);
          bankPositions.push(outerX, heightAt(outerX, outerZ) + 0.028, outerZ);
          bankColors.push(bankCrestColor.r, bankCrestColor.g, bankCrestColor.b);
          bankColors.push(bankOuterColor.r, bankOuterColor.g, bankOuterColor.b);
        }
      }
      for (var row = 0; row < segments; row++) {
        for (var col = 0; col < laneCount - 1; col++) {
          var a = stripBase + row * laneCount + col;
          var b = a + 1;
          var c = a + laneCount;
          var d = c + 1;
          indices.push(a, c, b, b, c, d);
        }
        for (var bankSideIndex = 0; bankSideIndex < 2; bankSideIndex++) {
          var bankA = bankStripBase + row * 4 + bankSideIndex * 2;
          var bankB = bankA + 1;
          var bankC = bankA + 4;
          var bankD = bankC + 1;
          bankIndices.push(bankA, bankC, bankB, bankB, bankC, bankD);
        }
      }
    }

    appendStrip(function (t) {
      var z = 76 + (-120 * t);
      return new THREE.Vector3(pathX(z), 0, z);
    }, quality === 0 ? 64 : 108, 3.9, 7.0);

    function appendBranch(points, segments) {
      var curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
      appendStrip(function (t) { return curve.getPoint(t); }, segments, 2.15, 2.5);
    }
    appendBranch([
      new THREE.Vector3(pathX(31), 0, 31),
      new THREE.Vector3(-10, 0, 27),
      new THREE.Vector3(-24, 0, 20)
    ], quality === 0 ? 14 : 22);
    appendBranch([
      new THREE.Vector3(pathX(10), 0, 10),
      new THREE.Vector3(12, 0, 7),
      new THREE.Vector3(25, 0, 2)
    ], quality === 0 ? 14 : 22);
    appendBranch([
      new THREE.Vector3(pathX(-20), 0, -20),
      new THREE.Vector3(-3, 0, -24),
      new THREE.Vector3(0, 0, -27)
    ], quality === 0 ? 10 : 16);

    var geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    var bankGeometry = new THREE.BufferGeometry();
    bankGeometry.setIndex(bankIndices);
    bankGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bankPositions, 3));
    bankGeometry.setAttribute('color', new THREE.Float32BufferAttribute(bankColors, 3));
    bankGeometry.computeVertexNormals();
    var material = new THREE.MeshStandardMaterial({
      name: 'Dry rootwood-earth route',
      color: 0xffffff,
      bumpMap: terrainMap,
      bumpScale: 0.04,
      roughnessMap: terrainMap,
      vertexColors: true,
      roughness: 1.0,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1.5,
      polygonOffsetUnits: -1.5
    });
    var bankMaterial = new THREE.MeshStandardMaterial({
      name: 'Sculpted worn route banks',
      color: 0xffffff,
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1.2,
      polygonOffsetUnits: -1.2
    });
    var group = new THREE.Group();
    group.name = 'Canonical S-curve and lens branches';
    var mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Warm worn traversal ribbon';
    mesh.receiveShadow = true;
    group.add(mesh);
    var banks = new THREE.Mesh(bankGeometry, bankMaterial);
    banks.name = 'Raised broken route banks';
    banks.castShadow = quality > 0;
    banks.receiveShadow = true;
    group.add(banks);
    return group;
  }

  function createStream(THREE, heightAt, palette, quality, reduceMotion) {
    var segments = quality === 2 ? 120 : quality === 1 ? 84 : 56;
    var positions = [];
    var uvs = [];
    var indices = [];
    var bedPositions = [];
    var bedColors = [];
    var bedUvs = [];
    var bedIndices = [];
    var laneCount = 5;
    var bedLaneCount = 7;
    var bedCenter = new THREE.Color(0x152e32);
    var bedEdge = new THREE.Color(0x334940);
    var bedColor = new THREE.Color();
    var minZ = -37;
    var maxZ = 82;
    for (var i = 0; i <= segments; i++) {
      var t = i / segments;
      var z = maxZ + (minZ - maxZ) * t;
      var x = streamX(z);
      var tangentX = (streamX(z - 0.15) - streamX(z + 0.15)) / 0.3;
      var inv = 1 / Math.sqrt(1 + tangentX * tangentX);
      var nx = inv;
      var nz = tangentX * inv;
      var width = 2.15 + Math.sin(z * 0.083) * 0.42;
      var leftX = x - nx * width;
      var leftZ = z - nz * width;
      var rightX = x + nx * width;
      var rightZ = z + nz * width;
      var leftY = heightAt(leftX, leftZ) + 0.2;
      var rightY = heightAt(rightX, rightZ) + 0.2;
      for (var lane = 0; lane < laneCount; lane++) {
        var laneU = lane / (laneCount - 1);
        var lateral = laneU * 2 - 1;
        var px = x + nx * width * lateral;
        var pz = z + nz * width * lateral;
        var py = lerp(leftY, rightY, laneU) - (1 - Math.abs(lateral)) * 0.035;
        positions.push(px, py, pz);
        uvs.push(laneU, t * 12);
      }
      if (i < segments) {
        var base = i * laneCount;
        for (var waterLane = 0; waterLane < laneCount - 1; waterLane++) {
          var wa = base + waterLane;
          var wb = wa + 1;
          var wc = wa + laneCount;
          var wd = wc + 1;
          indices.push(wa, wc, wb, wb, wc, wd);
        }
      }

      for (var bedLane = 0; bedLane < bedLaneCount; bedLane++) {
        var bedU = bedLane / (bedLaneCount - 1);
        var bedLateral = (bedU * 2 - 1) * 1.34;
        var bx = x + nx * width * bedLateral;
        var bz = z + nz * width * bedLateral;
        bedPositions.push(bx, heightAt(bx, bz) + 0.018, bz);
        bedUvs.push(bedU, t * 9);
        bedColor.copy(bedCenter).lerp(bedEdge, smoothstep(0.45, 1.34, Math.abs(bedLateral)));
        bedColors.push(bedColor.r, bedColor.g, bedColor.b);
      }
      if (i < segments) {
        var bedBase = i * bedLaneCount;
        for (var bedLaneIndex = 0; bedLaneIndex < bedLaneCount - 1; bedLaneIndex++) {
          var ba = bedBase + bedLaneIndex;
          var bb = ba + 1;
          var bc = ba + bedLaneCount;
          var bd = bc + 1;
          bedIndices.push(ba, bc, bb, bb, bc, bd);
        }
      }
    }
    var geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    var bedGeometry = new THREE.BufferGeometry();
    bedGeometry.setIndex(bedIndices);
    bedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bedPositions, 3));
    bedGeometry.setAttribute('color', new THREE.Float32BufferAttribute(bedColors, 3));
    bedGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(bedUvs, 2));
    bedGeometry.computeVertexNormals();
    var uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uRestored: { value: 0 },
        uOpacity: { value: 0.9 },
        uDeep: { value: new THREE.Color(0x0b2833) },
        uShallow: { value: new THREE.Color(0x4b8f91) },
        uSun: { value: palette.gold.clone() }
      }
    ]);
    var material = new THREE.ShaderMaterial({
      name: 'Suspended refractive stream',
      uniforms: uniforms,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      vertexShader: [
        '#include <fog_pars_vertex>',
        'uniform float uTime;',
        'varying vec2 vUv;',
        'varying vec3 vWorld;',
        'varying float vWave;',
        'void main(){',
        '  vUv=uv;',
        '  vec3 p=position;',
        '  float w=sin(uv.y*2.8+uTime*0.72+uv.x*2.7)*0.032+sin(uv.y*7.1-uTime*0.48+uv.x*8.0)*0.018;',
        '  p.y += w;',
        '  vWave=w;',
        '  vec4 wp=modelMatrix*vec4(p,1.0);',
        '  vWorld=wp.xyz;',
        '  vec4 mvPosition=viewMatrix*wp;',
        '  gl_Position=projectionMatrix*mvPosition;',
        '  #include <fog_vertex>',
        '}'
      ].join('\n'),
      fragmentShader: [
        '#include <fog_pars_fragment>',
        'precision highp float;',
        'uniform float uTime;',
        'uniform float uRestored;',
        'uniform float uOpacity;',
        'uniform vec3 uDeep;',
        'uniform vec3 uShallow;',
        'uniform vec3 uSun;',
        'varying vec2 vUv;',
        'varying vec3 vWorld;',
        'varying float vWave;',
        'void main(){',
        '  float waveA=sin(vUv.y*7.4-uTime*0.74+sin(vUv.x*8.0)*0.9);',
        '  float waveB=sin(vUv.y*16.0+uTime*0.51+vUv.x*13.0);',
        '  float ripple=waveA*0.58+waveB*0.28+sin(vUv.y*3.1-vUv.x*5.0)*0.14;',
        '  float edge=smoothstep(0.0,0.18,vUv.x)*(1.0-smoothstep(0.82,1.0,vUv.x));',
        '  vec3 n=normalize(vec3(cos(vUv.y*7.4-uTime*0.74+vUv.x*2.0)*0.11,1.0,cos(vUv.y*16.0+uTime*0.51+vUv.x*13.0)*0.075));',
        '  vec3 viewDir=normalize(cameraPosition-vWorld);',
        '  float ndv=max(dot(viewDir,n),0.0);',
        '  float fresnel=0.02+0.98*pow(1.0-ndv,5.0);',
        '  float broken=ripple*0.5+0.5;',
        '  vec3 col=mix(uDeep,uShallow,0.13+broken*0.1);',
        '  vec3 skyReflection=mix(vec3(0.055,0.14,0.18),vec3(0.26,0.38,0.4),clamp(viewDir.y,0.0,1.0));',
        '  col=mix(col,skyReflection,clamp(fresnel*0.72,0.0,0.68));',
        '  vec3 sunDir=normalize(vec3(-0.62,0.34,0.68));',
        '  float glint=pow(max(dot(reflect(-sunDir,n),viewDir),0.0),52.0);',
        '  float bank=1.0-smoothstep(0.0,0.22,min(vUv.x,1.0-vUv.x));',
        '  float foam=bank*smoothstep(0.62,0.98,broken)*0.14;',
        '  col+=uSun*glint*0.58+mix(uShallow,uSun,0.2)*foam;',
        '  col=mix(col,vec3(0.28,0.34,0.29),bank*(0.08+broken*0.08));',
        '  col=mix(col,mix(uShallow,uSun,0.18),uRestored*0.18);',
        '  gl_FragColor=vec4(col,(0.39+fresnel*0.24+foam)*edge*uOpacity);',
        '  #include <fog_fragment>',
        '}'
      ].join('\n')
    });
    var streamGroup = new THREE.Group();
    streamGroup.name = 'Layered valley stream';
    var bedMaterial = new THREE.MeshStandardMaterial({
      name: 'Visible dark streambed and wet banks',
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.78,
      metalness: 0.02
    });
    var bed = new THREE.Mesh(bedGeometry, bedMaterial);
    bed.name = 'Broken streambed';
    bed.receiveShadow = true;
    streamGroup.add(bed);
    var surface = new THREE.Mesh(geometry, material);
    surface.name = 'Broken reflective water surface';
    surface.receiveShadow = true;
    surface.renderOrder = 2;
    streamGroup.add(surface);
    return { mesh: streamGroup, surface: surface, bed: bed, uniforms: uniforms };
  }

  function createCliffs(THREE, heightAt, material, rootMaterial, unitGeometry, rng, quality, colliders) {
    var group = new THREE.Group();
    group.name = 'Authored basalt escarpments';
    var clusters = [
      { x: -53, z: 67, w: 7.5, d: 6.0, h: 8.0, n: 2 },
      { x: 52, z: 58, w: 7.0, d: 5.5, h: 9.5, n: 2 },
      { x: -50, z: 35, w: 8.0, d: 6.5, h: 11.0, n: 3 },
      { x: 52, z: 19, w: 7.5, d: 6.0, h: 8.5, n: 2 },
      { x: -51, z: -1, w: 8.5, d: 7.0, h: 10.0, n: 3 },
      { x: 50, z: -22, w: 8.0, d: 6.0, h: 7.5, n: 2 },
      { x: -52, z: -39, w: 9.0, d: 7.5, h: 7.0, n: 2 },
      { x: 51, z: -54, w: 8.0, d: 6.0, h: 5.6, n: 2 },
      // Low, widely separated rear shoulders create a deliberate skyline notch.
      { x: -43, z: -92, w: 10.0, d: 6.0, h: 4.6, n: 2 },
      { x: 43, z: -93, w: 10.0, d: 6.5, h: 4.2, n: 2 }
    ];
    var majors = [];
    var ledges = [];
    var talus = [];
    for (var clusterIndex = 0; clusterIndex < clusters.length; clusterIndex++) {
      var cluster = clusters[clusterIndex];
      var moduleCount = quality === 0 ? Math.min(1, cluster.n) : cluster.n;
      for (var moduleIndex = 0; moduleIndex < moduleCount; moduleIndex++) {
        var moduleHeight = cluster.h * (0.72 + rng() * 0.45);
        var moduleWidth = cluster.w * (0.58 + rng() * 0.42);
        var moduleDepth = cluster.d * (0.62 + rng() * 0.42);
        majors.push({
          x: cluster.x + (rng() - 0.5) * cluster.w * 0.85,
          z: cluster.z + (rng() - 0.5) * cluster.d * 0.9,
          h: moduleHeight,
          w: moduleWidth,
          d: moduleDepth,
          rot: rng() * Math.PI,
          tilt: (rng() - 0.5) * 0.24
        });
      }
      if (quality > 0 || clusterIndex % 2 === 0) {
        var side = cluster.x < 0 ? -1 : 1;
        ledges.push({
          x: side * (39 + rng() * 5),
          z: cluster.z + (rng() - 0.5) * 9,
          w: 4.8 + rng() * 4.8,
          h: 1.2 + rng() * 1.5,
          d: 2.3 + rng() * 2.4,
          rot: (rng() - 0.5) * 0.38
        });
      }
      var talusCount = quality === 2 ? 6 : quality === 1 ? 4 : 2;
      for (var talusIndex = 0; talusIndex < talusCount; talusIndex++) {
        var angle = rng() * Math.PI * 2;
        var spread = 2.2 + rng() * cluster.w * 0.78;
        talus.push({
          x: cluster.x + Math.cos(angle) * spread,
          z: cluster.z + Math.sin(angle) * spread * 0.72,
          s: 0.32 + Math.pow(rng(), 1.5) * 1.65,
          rot: rng() * Math.PI
        });
      }
    }

    var majorGeometry = makeCliffModuleGeometry(THREE, 0);
    var majorMesh = new THREE.InstancedMesh(majorGeometry, material, majors.length);
    majorMesh.name = 'Varied basalt buttresses';
    majorMesh.castShadow = quality > 0;
    majorMesh.receiveShadow = true;
    var dummy = new THREE.Object3D();
    for (var i = 0; i < majors.length; i++) {
      var p = majors[i];
      var gy = heightAt(p.x, p.z);
      dummy.position.set(p.x, gy + p.h * 0.42, p.z);
      dummy.rotation.set(p.tilt * 0.3, p.rot, p.tilt);
      dummy.scale.set(p.w * 0.5, p.h * 0.5, p.d * 0.5);
      dummy.updateMatrix();
      majorMesh.setMatrixAt(i, dummy.matrix);
      if (Math.abs(p.x) < 51) colliders.push({ x: p.x, z: p.z, radius: Math.min(p.w, p.d) * 0.33, kind: 'cliff' });
    }
    majorMesh.instanceMatrix.needsUpdate = true;
    group.add(majorMesh);

    var ledgeMaterial = material.clone();
    ledgeMaterial.name = 'Weathered basalt ledges';
    ledgeMaterial.color.multiplyScalar(1.16);
    ledgeMaterial.roughness = 0.72;
    var ledgeMesh = new THREE.InstancedMesh(makeCliffModuleGeometry(THREE, 1), ledgeMaterial, ledges.length);
    ledgeMesh.name = 'Broken lateral ledges';
    ledgeMesh.castShadow = quality > 0;
    ledgeMesh.receiveShadow = true;
    for (var ledgeIndex = 0; ledgeIndex < ledges.length; ledgeIndex++) {
      var ledge = ledges[ledgeIndex];
      dummy.position.set(ledge.x, heightAt(ledge.x, ledge.z) + ledge.h * 0.28, ledge.z);
      dummy.rotation.set((rng() - 0.5) * 0.12, ledge.rot, (rng() - 0.5) * 0.12);
      dummy.scale.set(ledge.w * 0.5, ledge.h * 0.5, ledge.d * 0.5);
      dummy.updateMatrix();
      ledgeMesh.setMatrixAt(ledgeIndex, dummy.matrix);
    }
    ledgeMesh.instanceMatrix.needsUpdate = true;
    group.add(ledgeMesh);

    var talusMesh = new THREE.InstancedMesh(makeFacetedRockGeometry(THREE, 0), material, talus.length);
    talusMesh.name = 'Clustered cliff talus';
    talusMesh.castShadow = quality > 0;
    talusMesh.receiveShadow = true;
    for (var talusMeshIndex = 0; talusMeshIndex < talus.length; talusMeshIndex++) {
      var t = talus[talusMeshIndex];
      dummy.position.set(t.x, heightAt(t.x, t.z) + t.s * 0.28, t.z);
      dummy.rotation.set(rng() * 0.45, t.rot, rng() * 0.32);
      dummy.scale.set(t.s * (0.8 + rng() * 0.65), t.s * (0.55 + rng() * 0.38), t.s);
      dummy.updateMatrix();
      talusMesh.setMatrixAt(talusMeshIndex, dummy.matrix);
    }
    talusMesh.instanceMatrix.needsUpdate = true;
    group.add(talusMesh);

    var rootRuns = [
      [[-51, 39], [-46, 35], [-40, 29]],
      [[51, 21], [46, 17], [40, 10]],
      [[-52, -5], [-47, -10], [-40, -16]],
      [[50, -49], [45, -52], [39, -57]]
    ];
    for (var rootIndex = 0; rootIndex < rootRuns.length; rootIndex++) {
      var rootGuidePoints = [];
      for (var rootPoint = 0; rootPoint < rootRuns[rootIndex].length; rootPoint++) {
        var rp = rootRuns[rootIndex][rootPoint];
        rootGuidePoints.push(new THREE.Vector3(rp[0], 0, rp[1]));
      }
      var rootRadius = 0.22 + rootIndex * 0.035;
      var rootGuide = new THREE.CatmullRomCurve3(rootGuidePoints, false, 'centripetal');
      var projectedRootPoints = [];
      var rootSamples = quality === 0 ? 10 : 18;
      for (var rootSample = 0; rootSample <= rootSamples; rootSample++) {
        var rootPosition = rootGuide.getPoint(rootSample / rootSamples);
        rootPosition.y = heightAt(rootPosition.x, rootPosition.z) + rootRadius * 0.44;
        projectedRootPoints.push(rootPosition);
      }
      var rootCurve = new THREE.CatmullRomCurve3(projectedRootPoints, false, 'centripetal');
      var cliffRoot = new THREE.Mesh(new THREE.TubeGeometry(rootCurve, quality === 0 ? 10 : 18, rootRadius, 6, false), rootMaterial);
      cliffRoot.name = 'Escarpment binding root';
      cliffRoot.castShadow = quality > 0;
      group.add(cliffRoot);
    }
    return group;
  }

  function createStoneField(THREE, heightAt, material, geometry, rng, quality, colliders) {
    var count = quality === 2 ? 38 : quality === 1 ? 28 : 18;
    var mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = 'Rain-dark valley stones';
    mesh.castShadow = quality > 0;
    mesh.receiveShadow = true;
    var dummy = new THREE.Object3D();
    var placed = 0;
    var attempts = 0;
    var clusters = [
      { x: -17, z: 47, r: 6 }, { x: 18, z: 38, r: 7 },
      { x: -34, z: 26, r: 6 }, { x: 32, z: 14, r: 5 },
      { x: -19, z: -2, r: 7 }, { x: 28, z: -19, r: 6 },
      { x: -28, z: -34, r: 6 }
    ];
    while (placed < count && attempts++ < count * 30) {
      var cluster = clusters[Math.floor(rng() * clusters.length)];
      var angle = rng() * Math.PI * 2;
      var spread = Math.sqrt(rng()) * cluster.r;
      var x = cluster.x + Math.cos(angle) * spread;
      var z = cluster.z + Math.sin(angle) * spread;
      if (Math.abs(x - pathX(z)) < 5.6) continue;
      if (lensBranchDistance(x, z) < 3.6) continue;
      if (Math.abs(x - streamX(z)) < 4.2 && z > -38) continue;
      if (distance2D(x, z, 0, -66) < 23) continue;
      if (distance2D(x, z, -24, 20) < 6 || distance2D(x, z, 25, 2) < 6 || distance2D(x, z, 0, -27) < 6) continue;
      var scale = 0.32 + Math.pow(rng(), 2) * 1.08;
      dummy.position.set(x, heightAt(x, z) + scale * 0.34, z);
      dummy.rotation.set(rng() * 0.6, rng() * Math.PI * 2, rng() * 0.4);
      dummy.scale.set(scale * (0.7 + rng() * 0.6), scale * (0.65 + rng() * 0.65), scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      if (scale > 1.2) colliders.push({ x: x, z: z, radius: scale * 0.62, kind: 'stone' });
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  function createAuthoredPropClusters(THREE, heightAt, basalt, cutBasalt, rootMaterial, bronze, edge, unitCylinder, rockGeometry, quality, colliders) {
    var group = new THREE.Group();
    group.name = 'Authored cartographer relic clusters';
    var rockTransforms = [];

    function queueRock(x, z, sx, sy, sz, rotation, lift) {
      rockTransforms.push({ x: x, z: z, sx: sx, sy: sy, sz: sz, rotation: rotation || 0, lift: lift || 0 });
    }

    // Opening foreground: a deliberately collapsed survey station frames the
    // first bend without competing with the hero silhouette.
    var fallen = new THREE.Group();
    fallen.name = 'Collapsed star survey station';
    fallen.position.set(-15.5, heightAt(-15.5, 51), 51);
    fallen.rotation.y = -0.28;
    var fallenMast = new THREE.Mesh(unitCylinder, bronze);
    fallenMast.scale.set(0.13, 3.4, 0.13);
    fallenMast.rotation.z = Math.PI * 0.5 - 0.12;
    fallenMast.position.set(0.2, 0.38, 0);
    fallenMast.castShadow = quality > 0;
    fallen.add(fallenMast);
    var fallenArc = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.09, 6, 28, Math.PI * 1.38), edge);
    fallenArc.rotation.set(Math.PI * 0.52, 0.15, -0.45);
    fallenArc.position.set(-1.45, 0.48, 0.22);
    fallenArc.castShadow = quality > 0;
    fallen.add(fallenArc);
    var lensShard = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), rootMaterial);
    lensShard.scale.set(1.5, 0.28, 0.78);
    lensShard.position.set(1.9, 0.22, -0.3);
    lensShard.rotation.set(0.3, 0.8, 0.2);
    fallen.add(lensShard);
    group.add(fallen);
    queueRock(-18.1, 52.2, 1.35, 0.72, 1.0, 0.4, 0.1);
    queueRock(-13.2, 49.6, 0.72, 0.48, 0.9, 1.1, 0.05);
    queueRock(-16.4, 47.8, 0.5, 0.42, 0.58, 2.3, 0.03);
    queueRock(-11.8, 60.5, 0.72, 0.38, 0.62, 0.65, 0.03);
    queueRock(-13.3, 59.1, 0.46, 0.32, 0.52, 1.35, 0.02);
    queueRock(9.4, 59.4, 0.68, 0.4, 0.76, 2.1, 0.03);
    queueRock(11.1, 57.8, 0.44, 0.3, 0.5, 0.28, 0.02);

    var foregroundRootGuides = [
      [[-12.5, 62], [-15.8, 57], [-14.8, 52]],
      [[9.0, 61], [12.8, 57], [13.7, 52.5]]
    ];
    for (var foregroundRootIndex = 0; foregroundRootIndex < foregroundRootGuides.length; foregroundRootIndex++) {
      var foregroundRootPoints = [];
      for (var foregroundPointIndex = 0; foregroundPointIndex < foregroundRootGuides[foregroundRootIndex].length; foregroundPointIndex++) {
        var foregroundGuide = foregroundRootGuides[foregroundRootIndex][foregroundPointIndex];
        foregroundRootPoints.push(new THREE.Vector3(foregroundGuide[0], 0, foregroundGuide[1]));
      }
      var foregroundGuideCurve = new THREE.CatmullRomCurve3(foregroundRootPoints, false, 'centripetal');
      var foregroundProjectedPoints = [];
      for (var foregroundSample = 0; foregroundSample <= 16; foregroundSample++) {
        var foregroundPosition = foregroundGuideCurve.getPoint(foregroundSample / 16);
        foregroundPosition.y = heightAt(foregroundPosition.x, foregroundPosition.z) + 0.08;
        foregroundProjectedPoints.push(foregroundPosition);
      }
      var foregroundRootCurve = new THREE.CatmullRomCurve3(foregroundProjectedPoints, false, 'centripetal');
      var foregroundRoot = new THREE.Mesh(new THREE.TubeGeometry(foregroundRootCurve, 14, 0.18, 6, false), rootMaterial);
      foregroundRoot.name = 'Foreground framing root';
      foregroundRoot.castShadow = quality > 0;
      group.add(foregroundRoot);
    }

    // A broken stepping alignment interrupts the stream's surface and turns the
    // water into a traversable story beat rather than a glowing ribbon.
    var crossingZ = 33;
    var crossingX = streamX(crossingZ);
    for (var crossingIndex = 0; crossingIndex < 7; crossingIndex++) {
      var across = (crossingIndex - 3) * 0.92;
      queueRock(
        crossingX + across,
        crossingZ + Math.sin(crossingIndex * 1.7) * 0.42,
        0.72 + (crossingIndex % 2) * 0.18,
        0.28 + (crossingIndex % 3) * 0.06,
        0.62 + ((crossingIndex + 1) % 2) * 0.18,
        crossingIndex * 0.61,
        0.52
      );
    }

    // East meadow: a tilted parallax instrument with pale binding roots.
    var parallax = new THREE.Group();
    parallax.name = 'Tilted parallax instrument';
    parallax.position.set(25.5, heightAt(25.5, 27), 27);
    parallax.rotation.y = 0.48;
    for (var legIndex = -1; legIndex <= 1; legIndex++) {
      var leg = new THREE.Mesh(unitCylinder, legIndex === 0 ? edge : bronze);
      leg.scale.set(0.09, 2.45, 0.09);
      leg.position.set(legIndex * 0.62, 1.08, Math.abs(legIndex) * 0.18);
      leg.rotation.z = legIndex * -0.22;
      leg.castShadow = quality > 0;
      parallax.add(leg);
    }
    for (var forkIndex = -1; forkIndex <= 1; forkIndex += 2) {
      var forkArm = new THREE.Mesh(unitCylinder, edge);
      forkArm.scale.set(0.085, 1.28, 0.085);
      forkArm.position.set(forkIndex * 0.62, 2.72, 0);
      forkArm.rotation.z = forkIndex * -0.58;
      parallax.add(forkArm);
    }
    var parallaxCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), rootMaterial);
    parallaxCore.position.y = 2.55;
    parallax.add(parallaxCore);
    group.add(parallax);
    queueRock(22.7, 26.1, 0.86, 0.55, 0.72, 0.7, 0.04);
    queueRock(28.2, 25.8, 1.15, 0.64, 0.86, 1.8, 0.06);

    // Pre-gate ruin: nested, incomplete arcs create a one-off silhouette and a
    // clear intermediate destination on the final turn of the route.
    var ruin = new THREE.Group();
    ruin.name = 'Shattered meridian archive';
    ruin.position.set(-10.5, heightAt(-10.5, -31), -31);
    ruin.rotation.y = -0.32;
    for (var archiveRing = 0; archiveRing < 1; archiveRing++) {
      var archiveArc = new THREE.Mesh(
        new THREE.TorusGeometry(1.2 + archiveRing * 0.62, 0.08 + archiveRing * 0.025, 6, 30, Math.PI * (1.12 + archiveRing * 0.13)),
        archiveRing === 1 ? rootMaterial : bronze
      );
      archiveArc.position.y = 1.85;
      archiveArc.rotation.set(archiveRing * 0.24, archiveRing * 0.31, -0.5 + archiveRing * 0.36);
      archiveArc.castShadow = quality > 0;
      ruin.add(archiveArc);
    }
    var archiveBase = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.34, 1.2), cutBasalt);
    archiveBase.position.y = 0.1;
    archiveBase.rotation.y = 0.16;
    archiveBase.castShadow = true;
    archiveBase.receiveShadow = true;
    ruin.add(archiveBase);
    group.add(ruin);
    queueRock(-14.2, -32.4, 1.25, 0.66, 1.0, 2.1, 0.05);
    queueRock(-8.0, -34.0, 0.78, 0.45, 0.92, 0.5, 0.03);
    colliders.push({ x: -10.5, z: -31, radius: 1.75, kind: 'archive-ruin' });

    // Small cairns punctuate, rather than line, the S-curve.
    var cairnStops = [44, 6, -18];
    for (var cairnIndex = 0; cairnIndex < cairnStops.length; cairnIndex++) {
      var cz = cairnStops[cairnIndex];
      var cx = pathX(cz) + (cairnIndex % 2 ? 1 : -1) * 5.0;
      queueRock(cx, cz, 0.9, 0.48, 0.72, cairnIndex * 0.8, 0.04);
      queueRock(cx + 0.08, cz, 0.58, 0.4, 0.52, cairnIndex * 0.8 + 0.4, 0.68);
      queueRock(cx - 0.04, cz, 0.32, 0.3, 0.3, cairnIndex * 0.8 + 0.9, 1.13);
    }

    var rocks = new THREE.InstancedMesh(rockGeometry, basalt, rockTransforms.length);
    rocks.name = 'Clustered relic stones and stepping alignment';
    rocks.castShadow = quality > 0;
    rocks.receiveShadow = true;
    var dummy = new THREE.Object3D();
    for (var rockIndex = 0; rockIndex < rockTransforms.length; rockIndex++) {
      var r = rockTransforms[rockIndex];
      dummy.position.set(r.x, heightAt(r.x, r.z) + r.lift + r.sy * 0.35, r.z);
      dummy.rotation.set(0.12 + (rockIndex % 3) * 0.09, r.rotation, (rockIndex % 2) * 0.12);
      dummy.scale.set(r.sx, r.sy, r.sz);
      dummy.updateMatrix();
      rocks.setMatrixAt(rockIndex, dummy.matrix);
    }
    rocks.instanceMatrix.needsUpdate = true;
    group.add(rocks);

    var contactSites = [
      [-15.5, 51, 3.1, 1.8],
      [25.5, 27, 3.0, 2.0],
      [-10.5, -31, 3.7, 2.1],
      [pathX(44) - 5, 44, 1.35, 0.9],
      [pathX(6) + 5, 6, 1.35, 0.9],
      [pathX(-18) - 5, -18, 1.35, 0.9]
    ];
    var contactMaterial = new THREE.MeshBasicMaterial({
      name: 'Grounded ambient contact patches',
      color: 0x071714,
      transparent: true,
      opacity: 0.17,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    var contacts = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 18), contactMaterial, contactSites.length);
    contacts.name = 'Authored prop contact shadows';
    for (var contactIndex = 0; contactIndex < contactSites.length; contactIndex++) {
      var contact = contactSites[contactIndex];
      dummy.position.set(contact[0], heightAt(contact[0], contact[1]) + 0.026, contact[1]);
      dummy.rotation.set(-Math.PI * 0.5, 0, 0);
      dummy.scale.set(contact[2], contact[3], 1);
      dummy.updateMatrix();
      contacts.setMatrixAt(contactIndex, dummy.matrix);
    }
    contacts.instanceMatrix.needsUpdate = true;
    contacts.renderOrder = 1;
    group.add(contacts);
    return group;
  }

  function createPathMarkers(THREE, heightAt, bronzeMaterial, edgeMaterial, unitCylinder) {
    var group = new THREE.Group();
    group.name = 'Cartographers path markers';
    var stationZ = [43, 4, -28];
    var stations = [];
    for (var stationIndex = 0; stationIndex < stationZ.length; stationIndex++) {
      var z = stationZ[stationIndex];
      var side = stationIndex % 2 ? 1 : -1;
      var tangent = pathX(z - 0.5) - pathX(z + 0.5);
      stations.push([pathX(z) + side * 4.4, z, Math.atan2(tangent, 1) * 0.35]);
    }
    for (var i = 0; i < stations.length; i++) {
      var s = stations[i];
      var marker = new THREE.Group();
      marker.position.set(s[0], heightAt(s[0], s[1]), s[1]);
      marker.rotation.y = s[2];
      var mast = new THREE.Mesh(unitCylinder, bronzeMaterial);
      mast.scale.set(0.12, 2.5, 0.12);
      mast.position.y = 1.25;
      mast.castShadow = true;
      marker.add(mast);
      var pointerArm = new THREE.Mesh(unitCylinder, edgeMaterial);
      pointerArm.scale.set(0.075, 0.86, 0.075);
      pointerArm.position.set(0.28 * (i % 2 ? -1 : 1), 2.22, 0);
      pointerArm.rotation.z = (i % 2 ? 1 : -1) * 0.72;
      pointerArm.castShadow = true;
      marker.add(pointerArm);
      var vane = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 0), edgeMaterial);
      vane.position.set((i % 2 ? -1 : 1) * 0.62, 2.55, 0);
      marker.add(vane);
      group.add(marker);
    }
    return group;
  }

  function createSurfaceRoots(THREE, heightAt, darkMaterial, paleMaterial, quality) {
    var group = new THREE.Group();
    group.name = 'Ancient surface roots';
    var roots = [
      [[-42, 51], [-34, 43], [-28, 31], [-25, 18]],
      [[43, 30], [35, 24], [30, 14], [25, 2]],
      [[-37, -3], [-27, -10], [-15, -20], [0, -27]],
      [[34, -33], [26, -39], [17, -47], [13, -55]],
      [[-33, -44], [-24, -51], [-18, -61], [-16, -73]]
    ];
    for (var i = 0; i < roots.length; i++) {
      var guidePoints = [];
      for (var j = 0; j < roots[i].length; j++) {
        var p = roots[i][j];
        guidePoints.push(new THREE.Vector3(p[0], 0, p[1]));
      }
      var radius = i < 2 ? 0.36 : 0.27;
      var guide = new THREE.CatmullRomCurve3(guidePoints, false, 'centripetal');
      var projectedPoints = [];
      var projectionSteps = quality === 0 ? 18 : 32;
      for (var sample = 0; sample <= projectionSteps; sample++) {
        var projected = guide.getPoint(sample / projectionSteps);
        projected.y = heightAt(projected.x, projected.z) + radius * 0.42;
        projectedPoints.push(projected);
      }
      // Dense terrain projection prevents Catmull-Rom spans from hovering over
      // hollows or disappearing into ridges between sparse art-direction points.
      var curve = new THREE.CatmullRomCurve3(projectedPoints, false, 'centripetal');
      var tube = new THREE.Mesh(new THREE.TubeGeometry(curve, quality === 0 ? 16 : 28, radius, 6, false), i % 2 ? paleMaterial : darkMaterial);
      tube.castShadow = quality > 0;
      tube.receiveShadow = true;
      group.add(tube);
    }
    return group;
  }

  function createGrass(THREE, heightAt, palette, rng, quality, reduceMotion) {
    // Each instance is a genuinely multi-blade tuft. Fewer, denser patches read
    // as an ecosystem instead of an evenly scattered field of identical spikes.
    var count = quality === 2 ? 640 : quality === 1 ? 390 : 180;
    var geometry = makeGrassTuftGeometry(THREE);
    var material = new THREE.MeshStandardMaterial({
      name: 'Wind-cut valley grass',
      color: 0xc0cbb8,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
      vertexColors: true,
      alphaTest: 0.12
    });
    var uniforms = { uTime: { value: 0 }, uStrength: { value: reduceMotion ? 0.025 : 0.11 } };
    material.onBeforeCompile = function (shader) {
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uStrength = uniforms.uStrength;
      shader.vertexShader = 'uniform float uTime; uniform float uStrength;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        [
          'vec3 transformed = vec3(position);',
          '#ifdef USE_INSTANCING',
          'float grassPhase = instanceMatrix[3].x * 0.19 + instanceMatrix[3].z * 0.13;',
          '#else',
          'float grassPhase = 0.0;',
          '#endif',
          'float grassTip = smoothstep(0.0, 1.0, uv.y);',
          'float windGust = sin(uTime * 1.06 + grassPhase) + sin(uTime * 0.43 + grassPhase * 0.71) * 0.34;',
          'transformed.x += windGust * uStrength * 0.88 * grassTip * grassTip;',
          'transformed.z += windGust * uStrength * 0.38 * grassTip * grassTip;'
        ].join('\n')
      );
    };
    material.customProgramCacheKey = function () { return 'asterwake-grass-v3'; };
    var mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = 'Instanced wind-cut grass';
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    var dummy = new THREE.Object3D();
    var placed = 0;
    var attempts = 0;
    var patches = [
      { x: -12.5, z: 61, radius: 3.2 },
      { x: 9.5, z: 59, radius: 3.0 },
      { x: -14, z: 45, radius: 3.8 },
      { x: 13, z: 35, radius: 3.5 }
    ];
    var patchTarget = quality === 2 ? 54 : quality === 1 ? 36 : 20;
    var patchAttempts = 0;
    while (patches.length < patchTarget && patchAttempts++ < patchTarget * 30) {
      var patchX = (rng() * 2 - 1) * 44;
      var patchZ = 80 - rng() * 166;
      if (Math.abs(patchX - pathX(patchZ)) < 8.0) continue;
      if (lensBranchDistance(patchX, patchZ) < 5.8) continue;
      if (Math.abs(patchX - streamX(patchZ)) < 5.2 && patchZ > -38) continue;
      if (distance2D(patchX, patchZ, 0, -66) < 23) continue;
      patches.push({ x: patchX, z: patchZ, radius: 2.4 + rng() * 5.2 });
    }
    while (placed < count && attempts++ < count * 42 && patches.length) {
      var patch = patches[Math.floor(rng() * patches.length)];
      var patchAngle = rng() * Math.PI * 2;
      var patchRadius = Math.sqrt(rng()) * patch.radius;
      var x = patch.x + Math.cos(patchAngle) * patchRadius;
      var z = patch.z + Math.sin(patchAngle) * patchRadius;
      if (Math.abs(x - pathX(z)) < 5.7) continue;
      if (lensBranchDistance(x, z) < 3.4) continue;
      if (Math.abs(x - streamX(z)) < 3.7 && z > -38) continue;
      if (distance2D(x, z, 0, -66) < 21.5) continue;
      var y = heightAt(x, z);
      if (y > 5.2) continue;
      var ecology = valueNoise(x * 0.115 + 8.3, z * 0.115 - 3.1) * 0.5 + 0.5;
      if (rng() > 0.48 + ecology * 0.5) continue;
      var scale = 0.62 + rng() * 0.56;
      dummy.position.set(x, y + 0.015, z);
      dummy.rotation.set(0, rng() * Math.PI, 0);
      dummy.scale.set(scale * (0.82 + rng() * 0.24), scale * (0.74 + rng() * 0.25), scale * (0.82 + rng() * 0.24));
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    return { mesh: mesh, uniforms: uniforms };
  }

  function createStarFlowers(THREE, heightAt, palette, rng, quality) {
    var count = quality === 2 ? 60 : quality === 1 ? 38 : 22;
    var group = new THREE.Group();
    group.name = 'Naturalized star-flower colonies';
    var geometry = new THREE.OctahedronGeometry(0.12, 0);
    geometry.scale(1, 1.42, 1);
    var material = new THREE.MeshStandardMaterial({
      name: 'Variegated coral star-flower petals',
      color: new THREE.Color(0xffffff),
      emissive: new THREE.Color(0x421008),
      emissiveIntensity: 0.27,
      roughness: 0.52,
      metalness: 0.02
    });
    var mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = 'Open star-flower blossoms';

    var budGeometry = new THREE.DodecahedronGeometry(0.075, 0);
    budGeometry.scale(0.8, 1.55, 0.8);
    var budMaterial = material.clone();
    budMaterial.name = 'Closed star-flower buds';
    budMaterial.roughness = 0.62;
    var buds = new THREE.InstancedMesh(budGeometry, budMaterial, count);
    buds.name = 'Closed star-flower buds';

    var stemGeometry = new THREE.CylinderGeometry(0.018, 0.032, 1, 6);
    var stemMaterial = new THREE.MeshStandardMaterial({
      name: 'Variegated star-flower stems',
      color: new THREE.Color(0xffffff),
      roughness: 0.88,
      metalness: 0.0
    });
    var stems = new THREE.InstancedMesh(stemGeometry, stemMaterial, count);
    stems.name = 'Star-flower stems';

    var leafGeometry = new THREE.OctahedronGeometry(0.1, 0);
    leafGeometry.scale(0.5, 0.18, 1.28);
    var leafMaterial = new THREE.MeshStandardMaterial({
      name: 'Sage star-flower leaves',
      color: new THREE.Color(0xffffff),
      roughness: 0.92,
      metalness: 0.0
    });
    var leaves = new THREE.InstancedMesh(leafGeometry, leafMaterial, count * 2);
    leaves.name = 'Paired star-flower leaves';

    // Hand-placed colony anchors create readable pockets of ecology. The seeded
    // scatter within each anchor keeps their edges irregular without becoming
    // evenly distributed confetti along the path.
    var colonySites = [
      { z: 42.5, side: -1, spreadX: 1.7, spreadZ: 2.7 },
      { z: 35.0, side: 1, spreadX: 1.25, spreadZ: 1.8 },
      { z: 10.5, side: -1, spreadX: 1.45, spreadZ: 2.4 },
      { z: 3.5, side: 1, spreadX: 1.8, spreadZ: 2.6 },
      { z: -16.5, side: -1, spreadX: 1.35, spreadZ: 2.1 },
      { z: -23.5, side: 1, spreadX: 1.6, spreadZ: 2.3 }
    ];
    var petalColors = [
      palette.coral.clone().lerp(new THREE.Color(0xffc09a), 0.48),
      new THREE.Color(0xf07b68),
      new THREE.Color(0xe9b879),
      new THREE.Color(0xd6c29b)
    ];
    var stemColors = [new THREE.Color(0x2d514d), new THREE.Color(0x526d5b), new THREE.Color(0x6f7457)];
    var leafColors = [new THREE.Color(0x365e57), new THREE.Color(0x6b8068), new THREE.Color(0x8b8963)];
    var dummy = new THREE.Object3D();
    var placed = 0;
    var budCount = 0;
    var leafCount = 0;
    var attempts = 0;
    while (placed < count && attempts++ < count * 32) {
      var colony = colonySites[Math.floor(rng() * colonySites.length)];
      var clusterAngle = rng() * Math.PI * 2;
      var clusterRadius = Math.pow(rng(), 0.72);
      var z = colony.z + Math.sin(clusterAngle) * colony.spreadZ * clusterRadius;
      var x = pathX(colony.z) + colony.side * (5.05 + Math.cos(clusterAngle) * colony.spreadX * clusterRadius);
      if (Math.abs(x - streamX(z)) < 3.0 && z > -38) continue;
      if (Math.abs(x - pathX(z)) < 4.05) continue;
      var ground = heightAt(x, z);
      var s = 0.58 + rng() * 0.72;
      var stemHeight = 0.25 + s * (0.17 + rng() * 0.08);
      var leanX = (rng() - 0.5) * 0.22;
      var leanZ = (rng() - 0.5) * 0.22;
      var flowerX = x + leanX * stemHeight * 0.48;
      var flowerZ = z + leanZ * stemHeight * 0.48;
      var flowerY = ground + stemHeight;

      dummy.position.set(x, ground + stemHeight * 0.5, z);
      dummy.rotation.set(leanZ, rng() * Math.PI, -leanX);
      dummy.scale.set(s, stemHeight, s);
      dummy.updateMatrix();
      stems.setMatrixAt(placed, dummy.matrix);
      if (stems.setColorAt) stems.setColorAt(placed, stemColors[placed % stemColors.length]);

      var isBud = rng() < 0.22;
      dummy.position.set(flowerX, flowerY, flowerZ);
      dummy.rotation.set(leanZ * 0.7, rng() * Math.PI, -leanX * 0.7);
      dummy.scale.setScalar(isBud ? s * 0.82 : s);
      dummy.updateMatrix();
      var petalColor = petalColors[(placed + Math.floor(rng() * petalColors.length)) % petalColors.length];
      if (isBud) {
        buds.setMatrixAt(budCount, dummy.matrix);
        if (buds.setColorAt) buds.setColorAt(budCount, petalColor.clone().multiplyScalar(0.82));
        budCount++;
      } else {
        mesh.setMatrixAt(placed - budCount, dummy.matrix);
        if (mesh.setColorAt) mesh.setColorAt(placed - budCount, petalColor);
      }

      var leavesOnStem = rng() < 0.64 ? 2 : 1;
      for (var leafIndex = 0; leafIndex < leavesOnStem; leafIndex++) {
        var leafYaw = clusterAngle + leafIndex * 2.25 + (rng() - 0.5) * 0.65;
        var leafLift = stemHeight * (0.31 + leafIndex * 0.22);
        var leafLength = s * (0.58 + rng() * 0.36);
        dummy.position.set(x + Math.sin(leafYaw) * 0.065 * s, ground + leafLift, z + Math.cos(leafYaw) * 0.065 * s);
        dummy.rotation.set(0.18 + rng() * 0.24, leafYaw, (rng() - 0.5) * 0.28);
        dummy.scale.set(leafLength, leafLength, leafLength);
        dummy.updateMatrix();
        leaves.setMatrixAt(leafCount, dummy.matrix);
        if (leaves.setColorAt) leaves.setColorAt(leafCount, leafColors[(placed + leafIndex) % leafColors.length]);
        leafCount++;
      }
      placed++;
    }
    mesh.count = placed - budCount;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    buds.count = budCount;
    buds.instanceMatrix.needsUpdate = true;
    if (buds.instanceColor) buds.instanceColor.needsUpdate = true;
    stems.count = placed;
    stems.instanceMatrix.needsUpdate = true;
    if (stems.instanceColor) stems.instanceColor.needsUpdate = true;
    leaves.count = leafCount;
    leaves.instanceMatrix.needsUpdate = true;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    mesh.castShadow = quality > 0;
    buds.castShadow = quality > 0;
    group.add(stems, leaves, buds, mesh);
    return group;
  }

  function createArena(THREE, heightAt, basalt, cutBasalt, bronze, edge, unitCylinder, colliders) {
    var group = new THREE.Group();
    group.name = 'Hollow Astronomer arena';
    var center = new THREE.Vector3(0, heightAt(0, -66), -66);
    var radius = 20;
    group.position.copy(center);

    var floorMaterial = cutBasalt.clone();
    floorMaterial.name = 'Blue slate ritual floor';
    floorMaterial.color.setHex(0x58686c);
    floorMaterial.roughness = 0.68;
    floorMaterial.metalness = 0.11;
    var rimMaterial = bronze.clone();
    rimMaterial.name = 'Rain-dulled arena rim';
    rimMaterial.color.setHex(0x8f8360);
    rimMaterial.roughness = 0.53;
    var pillarMaterial = basalt.clone();
    pillarMaterial.name = 'Deep blue arena monoliths';
    pillarMaterial.color.setHex(0x27383f);
    var brokenPillarMaterial = basalt.clone();
    brokenPillarMaterial.name = 'Warm weathered broken monoliths';
    brokenPillarMaterial.color.setHex(0x4b4640);
    brokenPillarMaterial.roughness = 0.98;
    var ritualMaterial = edge.clone();
    ritualMaterial.name = 'Burnished ritual inscriptions';
    ritualMaterial.color.setHex(0xd6aa62);
    ritualMaterial.roughness = 0.34;

    var floor = new THREE.Mesh(new THREE.CylinderGeometry(18.7, 19.35, 0.36, 64, 1), floorMaterial);
    floor.position.y = -0.12;
    floor.receiveShadow = true;
    group.add(floor);
    var rim = new THREE.Mesh(new THREE.TorusGeometry(19.1, 0.36, 8, 72), rimMaterial);
    rim.rotation.x = Math.PI * 0.5;
    rim.position.y = 0.12;
    rim.receiveShadow = true;
    group.add(rim);

    // These calibration paths were repaired in different eras: one complete,
    // one interrupted, one deliberately left open toward the drowned gate.
    var inlaySpecs = [
      { radius: 5.2, tube: 0.065, arc: Math.PI * 2, rotation: 0, material: ritualMaterial },
      { radius: 9.35, tube: 0.052, arc: Math.PI * 1.72, rotation: 0.38, material: edge },
      { radius: 13.5, tube: 0.085, arc: Math.PI * 1.38, rotation: -0.84, material: rimMaterial }
    ];
    for (var ringIndex = 0; ringIndex < inlaySpecs.length; ringIndex++) {
      var inlaySpec = inlaySpecs[ringIndex];
      var inlay = new THREE.Mesh(new THREE.TorusGeometry(inlaySpec.radius, inlaySpec.tube, 5, 56, inlaySpec.arc), inlaySpec.material);
      inlay.rotation.x = Math.PI * 0.5;
      inlay.rotation.z = inlaySpec.rotation;
      inlay.position.y = 0.105;
      group.add(inlay);
    }

    var spokeLengths = [17.4, 14.8, 16.6, 12.9, 17.1, 15.6, 13.7, 16.9];
    var spokes = new THREE.InstancedMesh(unitCylinder, rimMaterial, spokeLengths.length);
    spokes.name = 'Uneven repaired arena spokes';
    var dummy = new THREE.Object3D();
    for (var spoke = 0; spoke < 8; spoke++) {
      var a = spoke / 8 * Math.PI * 2;
      var spokeStart = spoke === 3 || spoke === 6 ? 1.15 : 0.22;
      var spokeLength = spokeLengths[spoke];
      var spokeCenter = spokeStart + spokeLength * 0.5;
      dummy.position.set(Math.sin(a) * spokeCenter, 0.1, Math.cos(a) * spokeCenter);
      dummy.rotation.set(0, a, Math.PI * 0.5);
      dummy.scale.set(0.065 + (spoke % 3) * 0.012, spokeLength, 0.065 + (spoke % 2) * 0.014);
      dummy.updateMatrix();
      spokes.setMatrixAt(spoke, dummy.matrix);
    }
    spokes.instanceMatrix.needsUpdate = true;
    spokes.receiveShadow = true;
    group.add(spokes);

    var pillarData = [
      { height: 5.15, broken: false, leanX: 0.01, leanZ: -0.018, crown: true },
      { height: 4.35, broken: false, leanX: -0.026, leanZ: 0.01, cap: true },
      { height: 3.55, broken: true, leanX: 0.055, leanZ: -0.022 },
      { height: 4.72, broken: false, leanX: -0.014, leanZ: -0.012 },
      { height: 3.18, broken: true, leanX: -0.064, leanZ: 0.025 },
      { height: 5.34, broken: false, leanX: 0.016, leanZ: 0.018, cap: true },
      { height: 3.82, broken: true, leanX: 0.048, leanZ: 0.038 },
      { height: 4.58, broken: false, leanX: -0.018, leanZ: 0.026, crown: true }
    ];
    var intactCount = 0;
    var brokenCount = 0;
    for (var pillarCountIndex = 0; pillarCountIndex < pillarData.length; pillarCountIndex++) {
      if (pillarData[pillarCountIndex].broken) brokenCount++;
      else intactCount++;
    }
    var intactPillars = new THREE.InstancedMesh(makeWeatheredPillarGeometry(THREE, false), pillarMaterial, intactCount);
    intactPillars.name = 'Standing arena monolith variants';
    var brokenPillars = new THREE.InstancedMesh(makeWeatheredPillarGeometry(THREE, true), brokenPillarMaterial, brokenCount);
    brokenPillars.name = 'Broken arena monolith variants';
    var capGeometry = new THREE.CylinderGeometry(0.92, 0.84, 0.24, 7);
    var caps = new THREE.InstancedMesh(capGeometry, cutBasalt, 2);
    caps.name = 'Repaired monolith capstones';
    var crownGeometry = new THREE.OctahedronGeometry(0.38, 0);
    var crowns = new THREE.InstancedMesh(crownGeometry, ritualMaterial, 2);
    crowns.name = 'Surviving astronomer crowns';
    var plaqueGeometry = new THREE.OctahedronGeometry(0.24, 0);
    plaqueGeometry.scale(0.72, 1.45, 0.16);
    var plaques = new THREE.InstancedMesh(plaqueGeometry, ritualMaterial, 6);
    plaques.name = 'Ritual monolith inscriptions';
    var intactIndex = 0;
    var brokenIndex = 0;
    var capIndex = 0;
    var crownIndex = 0;
    var plaqueIndex = 0;
    for (var p = 0; p < 8; p++) {
      var angle = p / 8 * Math.PI * 2 + Math.PI / 8;
      var px = Math.sin(angle) * 20.7;
      var pz = Math.cos(angle) * 20.7;
      var pillarSpec = pillarData[p];
      dummy.position.set(px, pillarSpec.height * 0.5 - 0.3, pz);
      dummy.rotation.set(pillarSpec.leanX, angle, pillarSpec.leanZ);
      dummy.scale.set(0.92 + (p % 3) * 0.045, pillarSpec.height, 0.94 + ((p + 1) % 3) * 0.04);
      dummy.updateMatrix();
      if (pillarSpec.broken) brokenPillars.setMatrixAt(brokenIndex++, dummy.matrix);
      else intactPillars.setMatrixAt(intactIndex++, dummy.matrix);

      if (pillarSpec.cap) {
        dummy.position.set(px, pillarSpec.height - 0.18, pz);
        dummy.rotation.set(pillarSpec.leanX, angle, pillarSpec.leanZ);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        caps.setMatrixAt(capIndex++, dummy.matrix);
      }
      if (pillarSpec.crown) {
        dummy.position.set(px, pillarSpec.height + 0.08, pz);
        dummy.rotation.set(0.08 * (p ? -1 : 1), angle, 0.12);
        dummy.scale.set(0.72, 1.65, 0.72);
        dummy.updateMatrix();
        crowns.setMatrixAt(crownIndex++, dummy.matrix);
      }
      if (!pillarSpec.broken || p === 2) {
        // The plaques face the dais, so they read as a deliberate observatory
        // language instead of generic trim on every repeated column.
        dummy.position.set(Math.sin(angle) * 19.82, 1.35 + (p % 3) * 0.34, Math.cos(angle) * 19.82);
        dummy.rotation.set(0, angle, p % 2 ? 0.08 : -0.08);
        dummy.scale.setScalar(0.86 + (p % 3) * 0.1);
        dummy.updateMatrix();
        plaques.setMatrixAt(plaqueIndex++, dummy.matrix);
      }
      colliders.push({ x: center.x + px, z: center.z + pz, radius: 1.05, kind: 'arena-pillar' });
    }

    intactPillars.instanceMatrix.needsUpdate = true;
    brokenPillars.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    plaques.count = plaqueIndex;
    plaques.instanceMatrix.needsUpdate = true;
    intactPillars.castShadow = intactPillars.receiveShadow = true;
    brokenPillars.castShadow = brokenPillars.receiveShadow = true;
    caps.castShadow = caps.receiveShadow = true;
    crowns.castShadow = true;
    group.add(intactPillars, brokenPillars, caps, crowns, plaques);

    // A small, readable survey accident tells why one monolith is broken. The
    // tablets and spilled lens fragments stay at the perimeter, out of combat.
    var tabletGeometry = new THREE.BoxGeometry(1.15, 0.12, 0.68);
    var tabletMaterial = cutBasalt.clone();
    tabletMaterial.name = 'Ochre survey tablets';
    tabletMaterial.color.setHex(0x665b4a);
    tabletMaterial.roughness = 0.88;
    var tablets = new THREE.InstancedMesh(tabletGeometry, tabletMaterial, 3);
    tablets.name = 'Abandoned perimeter survey tablets';
    var tabletSites = [
      [-13.8, 0.18, -11.2, -0.42],
      [-14.9, 0.23, -10.5, 0.36],
      [14.1, 0.16, 10.9, 0.58]
    ];
    for (var tabletIndex = 0; tabletIndex < tabletSites.length; tabletIndex++) {
      var tabletSite = tabletSites[tabletIndex];
      dummy.position.set(tabletSite[0], tabletSite[1], tabletSite[2]);
      dummy.rotation.set(0.04 + tabletIndex * 0.035, tabletSite[3], tabletIndex === 1 ? 0.16 : -0.05);
      dummy.scale.set(1 + tabletIndex * 0.12, 1, 0.88 + (tabletIndex % 2) * 0.2);
      dummy.updateMatrix();
      tablets.setMatrixAt(tabletIndex, dummy.matrix);
    }
    tablets.instanceMatrix.needsUpdate = true;
    tablets.castShadow = tablets.receiveShadow = true;
    group.add(tablets);

    var shardGeometry = new THREE.OctahedronGeometry(0.17, 0);
    shardGeometry.scale(1.6, 0.24, 0.66);
    var shards = new THREE.InstancedMesh(shardGeometry, ritualMaterial, 5);
    shards.name = 'Spilled calibration lens fragments';
    for (var shardIndex = 0; shardIndex < 5; shardIndex++) {
      var shardAngle = 3.53 + shardIndex * 0.74;
      var shardRadius = 14.5 + (shardIndex % 3) * 0.72;
      dummy.position.set(Math.sin(shardAngle) * shardRadius, 0.19, Math.cos(shardAngle) * shardRadius);
      dummy.rotation.set(0.18, shardAngle * 1.7, (shardIndex - 2) * 0.12);
      dummy.scale.setScalar(0.72 + shardIndex * 0.09);
      dummy.updateMatrix();
      shards.setMatrixAt(shardIndex, dummy.matrix);
    }
    shards.instanceMatrix.needsUpdate = true;
    group.add(shards);
    return {
      root: group,
      center: center,
      radius: radius,
      // Broken monoliths add story and silhouette during exploration, but the
      // near-camera instances become oversized occluders in the boss framing.
      presentationObstructions: [brokenPillars]
    };
  }

  function makeWeatheredPillarGeometry(THREE, broken) {
    var geometry = new THREE.CylinderGeometry(0.8, 1.25, 1, 7, 2, false);
    var positions = geometry.attributes.position;
    var cuts = broken
      ? [0.02, 0.23, 0.09, 0.32, 0.13, 0.27, 0.05]
      : [0.0, 0.025, 0.008, 0.018, 0.0, 0.03, 0.012];
    for (var vertexIndex = 0; vertexIndex < positions.count; vertexIndex++) {
      var x = positions.getX(vertexIndex);
      var y = positions.getY(vertexIndex);
      var z = positions.getZ(vertexIndex);
      if (y > 0.24) {
        var normalizedAngle = (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2);
        var facet = Math.round(normalizedAngle / (Math.PI * 2) * 7) % 7;
        var topBlend = smoothstep(0.24, 0.5, y);
        y -= cuts[facet] * topBlend;
      }
      var weather = 1 + Math.sin((y + 0.5) * 13.0 + Math.atan2(z, x) * 3.0) * (broken ? 0.025 : 0.01);
      positions.setXYZ(vertexIndex, x * weather, y, z * weather);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  }

  function createMechanism(THREE, config, groundY, basalt, bronze, bronzeEdge, glassBase, unitCylinder, quality) {
    var group = new THREE.Group();
    group.name = 'Star mechanism ' + config.id;
    group.position.set(config.x, groundY, config.z);
    var base = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.05, 0.55, 12, 1), basalt);
    base.position.y = 0.08;
    base.castShadow = quality > 0;
    base.receiveShadow = true;
    group.add(base);
    var baseRing = new THREE.Mesh(new THREE.TorusGeometry(2.35, 0.16, 7, 36), bronze);
    baseRing.rotation.x = Math.PI * 0.5;
    baseRing.position.y = 0.39;
    group.add(baseRing);
    for (var i = 0; i < 6; i++) {
      var a = i / 6 * Math.PI * 2;
      var fin = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 1.08), bronzeEdge);
      fin.position.set(Math.sin(a) * 1.74, 0.48, Math.cos(a) * 1.74);
      fin.rotation.y = a;
      group.add(fin);
    }
    var stem = new THREE.Mesh(unitCylinder, bronze);
    stem.scale.set(0.18, 2.6, 0.18);
    stem.position.y = 1.65;
    stem.castShadow = true;
    group.add(stem);
    var ringPivot = new THREE.Group();
    ringPivot.name = 'Orbit ring pivot';
    ringPivot.position.y = 2.7;
    group.add(ringPivot);
    var ringMaterial = bronze.clone();
    ringMaterial.emissive = new THREE.Color(0x071417);
    ringMaterial.emissiveIntensity = 0.25;
    var ring = new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.12, 7, 42), ringMaterial);
    ring.castShadow = quality > 0;
    ringPivot.add(ring);
    var crossingRing = new THREE.Group();
    crossingRing.name = 'Asymmetric survey pointer';
    var pointerBeam = new THREE.Mesh(unitCylinder, bronzeEdge);
    pointerBeam.scale.set(0.055, 1.16, 0.055);
    pointerBeam.rotation.z = Math.PI * 0.5;
    crossingRing.add(pointerBeam);
    var pointerTip = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), bronzeEdge);
    pointerTip.position.x = 1.14;
    pointerTip.scale.set(1.5, 0.72, 0.72);
    crossingRing.add(pointerTip);
    crossingRing.rotation.y = Math.PI * 0.5;
    ringPivot.add(crossingRing);
    var glassMaterial = glassBase.clone();
    glassMaterial.color = new THREE.Color(config.color).multiplyScalar(0.42);
    glassMaterial.emissive = new THREE.Color(config.color).multiplyScalar(0.24);
    var prism = new THREE.Mesh(new THREE.OctahedronGeometry(0.48, 0), glassMaterial);
    prism.name = 'Dormant star prism';
    prism.scale.y = 1.45;
    ringPivot.add(prism);
    var haloMaterial = new THREE.MeshBasicMaterial({
      color: config.color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    var halo = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.035, 5, 52), haloMaterial);
    halo.rotation.x = Math.PI * 0.5;
    halo.position.y = 0.43;
    group.add(halo);
    var light = new THREE.PointLight(config.color, 0.0, 13, 2);
    light.position.y = 3.0;
    group.add(light);

    var mechanism = {
      id: config.id,
      root: group,
      position: new THREE.Vector3(config.x, groundY, config.z),
      active: false,
      ring: ring,
      light: light,
      activate: function () {
        if (mechanism.active) return false;
        mechanism.active = true;
        mechanism._target = 1;
        return true;
      },
      _amount: 0,
      _target: 0,
      _phase: config.phase,
      _ringPivot: ringPivot,
      _crossingRing: crossingRing,
      _prism: prism,
      _halo: halo,
      _color: new THREE.Color(config.color)
    };
    return mechanism;
  }

  function updateMechanism(m, dt, elapsed, reduceMotion) {
    m._target = m.active ? 1 : 0;
    m._amount += (m._target - m._amount) * (1 - Math.exp(-dt * 3.1));
    var motion = reduceMotion ? 0.2 : 1;
    m._ringPivot.rotation.y = elapsed * 0.33 * motion + m._phase;
    m._ringPivot.rotation.x = 0.16 + Math.sin(elapsed * 0.46 + m._phase) * 0.12 * motion;
    m._crossingRing.rotation.z = elapsed * -0.44 * motion;
    m._prism.rotation.y = elapsed * 0.68 * motion + m._phase;
    m._prism.position.y = Math.sin(elapsed * 1.35 + m._phase) * 0.1 * motion;
    m._ringPivot.position.y = 2.7 + Math.sin(elapsed * 1.05 + m._phase) * 0.06 * motion;
    m.ring.material.emissive.copy(m._color).multiplyScalar(0.12 + m._amount * 0.72);
    m.ring.material.emissiveIntensity = 0.3 + m._amount * 1.8;
    m._prism.material.color.copy(m._color).multiplyScalar(0.4 + m._amount * 0.42);
    m._prism.material.emissive.copy(m._color).multiplyScalar(0.22 + m._amount * 0.62);
    m._prism.material.emissiveIntensity = 0.7 + m._amount * 1.3;
    m._halo.material.opacity = m._amount * (0.42 + Math.sin(elapsed * 1.8 + m._phase) * 0.08);
    m._halo.scale.setScalar(0.8 + m._amount * 0.2);
    m.light.intensity = m._amount * (1.35 + Math.sin(elapsed * 2.1 + m._phase) * 0.12);
  }

  function createGate(THREE, groundY, rootMaterial, basalt, bronze, edge, palette, unitCylinder) {
    var group = new THREE.Group();
    group.name = 'Celestial root gate';
    group.position.set(0, groundY, -44);
    var leftPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.35, 7.2, 7), basalt);
    leftPillar.position.set(-6.15, 3.15, 0);
    leftPillar.rotation.z = -0.08;
    leftPillar.castShadow = true;
    leftPillar.receiveShadow = true;
    group.add(leftPillar);
    var rightPillar = leftPillar.clone();
    rightPillar.position.x = 6.15;
    rightPillar.rotation.z = 0.08;
    group.add(rightPillar);
    var gateArchMaterial = rootMaterial.clone();
    gateArchMaterial.name = 'Warm dominant gate rootwood';
    gateArchMaterial.color.setHex(0xe0c487);
    gateArchMaterial.emissive = new THREE.Color(0x4b3210);
    gateArchMaterial.emissiveIntensity = 0.62;
    var arch = new THREE.Mesh(new THREE.TorusGeometry(6.2, 0.74, 9, 48, Math.PI), gateArchMaterial);
    arch.position.y = 3.45;
    arch.castShadow = true;
    group.add(arch);
    var keystone = new THREE.Mesh(new THREE.OctahedronGeometry(0.52, 0), edge);
    keystone.position.set(0, 9.62, 0);
    keystone.scale.set(1.05, 1.45, 0.72);
    keystone.rotation.z = Math.PI * 0.25;
    group.add(keystone);
    var leftLeaf = new THREE.Group();
    var rightLeaf = new THREE.Group();
    leftLeaf.position.set(-0.25, 0.3, 0);
    rightLeaf.position.set(0.25, 0.3, 0);
    group.add(leftLeaf);
    group.add(rightLeaf);
    for (var i = 0; i < 4; i++) {
      var beamL = new THREE.Mesh(unitCylinder, i % 2 ? rootMaterial : bronze);
      beamL.scale.set(0.19 + i * 0.035, 6.3 - i * 0.45, 0.19 + i * 0.035);
      beamL.position.set(-1.05 - i * 0.95, 3.0 - i * 0.1, 0);
      beamL.rotation.z = -0.18 + i * 0.045;
      beamL.castShadow = true;
      leftLeaf.add(beamL);
      var beamR = beamL.clone();
      beamR.position.x = -beamL.position.x;
      beamR.rotation.z = -beamL.rotation.z;
      rightLeaf.add(beamR);
    }
    var barrierMaterial = new THREE.MeshBasicMaterial({
      color: palette.cyan.clone(),
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    var barrier = new THREE.Mesh(new THREE.PlaneGeometry(10.6, 6.0, 1, 1), barrierMaterial);
    barrier.name = 'Gate light membrane';
    barrier.position.y = 3.15;
    group.add(barrier);
    var sealMaterial = edge.clone();
    sealMaterial.transparent = true;
    sealMaterial.opacity = 1;
    var seal = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.1, 6, 32), sealMaterial);
    seal.position.set(0, 3.2, 0.08);
    group.add(seal);
    var sealCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), barrierMaterial);
    sealCore.position.set(0, 3.2, 0.1);
    group.add(sealCore);
    var light = new THREE.PointLight(0x72e0db, 0.7, 14, 2);
    light.position.set(0, 4.1, 1);
    group.add(light);

    var gate = {
      root: group,
      open: false,
      setOpen: function (value) { gate.open = !!value; },
      _amount: 0,
      _left: leftLeaf,
      _right: rightLeaf,
      _barrier: barrier,
      _seal: seal,
      _sealCore: sealCore,
      _light: light,
      _update: function (dt, elapsed, reduceMotion) {
        var target = gate.open ? 1 : 0;
        gate._amount += (target - gate._amount) * (1 - Math.exp(-dt * 3.2));
        var eased = gate._amount * gate._amount * (3 - 2 * gate._amount);
        gate._left.position.x = -0.25 - eased * 4.5;
        gate._right.position.x = 0.25 + eased * 4.5;
        gate._left.rotation.y = eased * 0.78;
        gate._right.rotation.y = -eased * 0.78;
        gate._barrier.material.opacity = (1 - eased) * (0.13 + Math.sin(elapsed * 2.2) * 0.025);
        gate._barrier.scale.x = 1 - eased * 0.92;
        gate._seal.rotation.z = elapsed * (reduceMotion ? 0.08 : 0.34);
        gate._seal.scale.setScalar(1 - eased * 0.4);
        gate._seal.material.opacity = 1 - eased;
        gate._sealCore.visible = eased < 0.96;
        gate._light.intensity = (1 - eased) * 0.72 + eased * 0.18;
      }
    };
    return gate;
  }

  function createOrrery(THREE, heightAt, rootMaterial, darkRootMaterial, bronze, edge, energy, palette, unitCylinder, rng, quality) {
    var group = new THREE.Group();
    group.name = 'The Drowned Orrery landmark';
    group.position.set(0, heightAt(0, -87) + 17.5, -87);

    var landmarkBronze = bronze.clone();
    landmarkBronze.name = 'Sky-lit Orrery bronze';
    landmarkBronze.color.setHex(0xa1a98d);
    landmarkBronze.emissive = new THREE.Color(0x132c2c);
    landmarkBronze.emissiveIntensity = 0.62;
    landmarkBronze.metalness = 0.42;
    var landmarkEdge = edge.clone();
    landmarkEdge.name = 'Orrery polished celestial edges';
    landmarkEdge.color.setHex(0xd0bd88);
    landmarkEdge.emissive = new THREE.Color(0x382b12);
    landmarkEdge.emissiveIntensity = 0.48;
    landmarkEdge.metalness = 0.48;
    var treeRootMaterial = rootMaterial.clone();
    treeRootMaterial.name = 'Luminous Orrery rootwood';
    treeRootMaterial.color.setHex(0xe0d3aa);
    treeRootMaterial.emissive = new THREE.Color(0x40351b);
    treeRootMaterial.emissiveIntensity = 0.72;
    treeRootMaterial.roughness = 0.67;

    var haloMaterial = new THREE.ShaderMaterial({
      name: 'Orrery atmospheric halo',
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(0x68bfc0) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uColor; varying vec2 vUv; void main(){ float d=length(vUv-0.5)*2.0; float a=(1.0-smoothstep(0.08,1.0,d))*0.16; gl_FragColor=vec4(uColor,a); }'
    });
    var aura = new THREE.Mesh(new THREE.CircleGeometry(18.7, 56), haloMaterial);
    aura.name = 'Skyroot halo aperture';
    aura.position.z = -0.72;
    group.add(aura);

    var plinth = new THREE.Mesh(new THREE.CylinderGeometry(7.7, 10.2, 3.1, 12), darkRootMaterial);
    plinth.position.y = -16.1;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    group.add(plinth);

    var outerPivot = new THREE.Group();
    outerPivot.name = 'Outer celestial ring';
    group.add(outerPivot);
    var outer = new THREE.Mesh(new THREE.TorusGeometry(17.2, 0.72, quality === 0 ? 7 : 10, quality === 0 ? 52 : 84), landmarkBronze);
    outer.castShadow = quality > 0;
    outer.receiveShadow = true;
    outerPivot.add(outer);
    var outerEnergy = energy.clone();
    var outerLight = new THREE.Mesh(new THREE.TorusGeometry(17.2, 0.16, 6, 96), outerEnergy);
    outerLight.scale.set(1.006, 1.006, 1.006);
    outerPivot.add(outerLight);

    var middlePivot = new THREE.Group();
    middlePivot.name = 'Meridian celestial ring';
    middlePivot.rotation.y = 0.28;
    group.add(middlePivot);
    var middle = new THREE.Mesh(new THREE.TorusGeometry(13.25, 0.34, 8, quality === 0 ? 48 : 72), landmarkBronze);
    middle.castShadow = quality > 0;
    middlePivot.add(middle);
    var middleEnergy = energy.clone();
    var middleGlow = new THREE.Mesh(new THREE.TorusGeometry(13.25, 0.11, 5, 82), middleEnergy);
    middlePivot.add(middleGlow);

    var innerPivot = new THREE.Group();
    innerPivot.name = 'Nadir celestial ring';
    innerPivot.rotation.x = 0.24;
    group.add(innerPivot);
    var inner = new THREE.Mesh(new THREE.TorusGeometry(9.25, 0.25, 7, 64), landmarkEdge);
    inner.castShadow = quality > 0;
    innerPivot.add(inner);
    var innerEnergy = energy.clone();
    var innerGlow = new THREE.Mesh(new THREE.TorusGeometry(9.25, 0.09, 5, 72), innerEnergy);
    innerPivot.add(innerGlow);

    var majorSpokes = new THREE.InstancedMesh(unitCylinder, landmarkEdge, 4);
    majorSpokes.name = 'Orrery cardinal spokes';
    var minorSpokes = new THREE.InstancedMesh(unitCylinder, landmarkBronze, 8);
    minorSpokes.name = 'Orrery minor spokes';
    var nodeGeometry = new THREE.OctahedronGeometry(0.34, 0);
    var cardinalNodes = new THREE.InstancedMesh(nodeGeometry, energy, 4);
    cardinalNodes.name = 'Orrery cardinal light nodes';
    var spokeDummy = new THREE.Object3D();
    var majorSpokeIndex = 0;
    var minorSpokeIndex = 0;
    var cardinalNodeIndex = 0;
    for (var spoke = 0; spoke < 12; spoke++) {
      var a = spoke / 12 * Math.PI * 2;
      var isCardinal = spoke % 3 === 0;
      spokeDummy.position.set(Math.sin(a) * 7.85, Math.cos(a) * 7.85, 0);
      spokeDummy.rotation.set(0, 0, -a);
      spokeDummy.scale.set(isCardinal ? 0.13 : 0.07, 15.7, isCardinal ? 0.13 : 0.07);
      spokeDummy.updateMatrix();
      if (isCardinal) majorSpokes.setMatrixAt(majorSpokeIndex++, spokeDummy.matrix);
      else minorSpokes.setMatrixAt(minorSpokeIndex++, spokeDummy.matrix);
      if (spoke % 3 === 0) {
        spokeDummy.position.set(Math.sin(a) * 15.65, Math.cos(a) * 15.65, 0);
        spokeDummy.rotation.set(0, 0, 0);
        spokeDummy.scale.set(1, 1, 1);
        spokeDummy.updateMatrix();
        cardinalNodes.setMatrixAt(cardinalNodeIndex++, spokeDummy.matrix);
      }
    }
    majorSpokes.instanceMatrix.needsUpdate = true;
    minorSpokes.instanceMatrix.needsUpdate = true;
    cardinalNodes.instanceMatrix.needsUpdate = true;
    majorSpokes.castShadow = quality > 0;
    minorSpokes.castShadow = quality > 0;
    outerPivot.add(majorSpokes);
    outerPivot.add(minorSpokes);
    outerPivot.add(cardinalNodes);

    var tree = new THREE.Group();
    tree.name = 'Luminous skyroot tree';
    group.add(tree);
    var trunkPoints = [
      new THREE.Vector3(0, -17.0, 0.5),
      new THREE.Vector3(-1.1, -10.0, 0.3),
      new THREE.Vector3(0.9, -2.2, -0.15),
      new THREE.Vector3(-0.6, 7.0, 0.15),
      new THREE.Vector3(1.1, 14.8, -0.2),
      new THREE.Vector3(0.2, 21.8, 0)
    ];
    var trunkCurve = new THREE.CatmullRomCurve3(trunkPoints);
    var trunk = new THREE.Mesh(new THREE.TubeGeometry(trunkCurve, quality === 0 ? 26 : 46, 1.22, 8, false), treeRootMaterial);
    trunk.castShadow = quality > 0;
    trunk.receiveShadow = true;
    tree.add(trunk);
    var core = new THREE.Mesh(new THREE.TubeGeometry(trunkCurve, quality === 0 ? 22 : 40, 0.11, 5, false), energy);
    core.material = energy.clone();
    core.material.opacity = 0.72;
    tree.add(core);

    var branchData = [
      [[0, 8, 0], [-5, 12, 0.2], [-11, 14, 0.4]],
      [[0.4, 11, 0], [5.5, 15.5, -0.3], [12, 16.5, -0.5]],
      [[0.7, 15, 0], [-3.4, 19, -0.2], [-7.8, 23, -0.5]],
      [[0.4, 18, 0], [4.8, 21, 0.3], [8.6, 24.5, 0.2]],
      [[-0.2, 4, 0], [-6, 7, 0.2], [-10, 8, 0.4]],
      [[0, 1, 0], [6, 5, -0.2], [10, 8, -0.4]]
    ];
    for (var b = 0; b < branchData.length; b++) {
      var bp = branchData[b];
      var branchCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(bp[0][0], bp[0][1], bp[0][2]),
        new THREE.Vector3(bp[1][0], bp[1][1], bp[1][2]),
        new THREE.Vector3(bp[2][0], bp[2][1], bp[2][2])
      ]);
      var branch = new THREE.Mesh(new THREE.TubeGeometry(branchCurve, quality === 0 ? 12 : 22, 0.48 - b * 0.025, 7, false), treeRootMaterial);
      branch.castShadow = quality > 0;
      tree.add(branch);
      if (b < 4) {
        var branchVein = new THREE.Mesh(new THREE.TubeGeometry(branchCurve, 18, 0.045, 4, false), energy.clone());
        branchVein.material.opacity = 0.46;
        tree.add(branchVein);
      }
    }

    var leafGeometry = new THREE.OctahedronGeometry(0.7, 0);
    leafGeometry.scale(0.55, 1.7, 0.28);
    var leafMaterial = new THREE.MeshStandardMaterial({
      name: 'Glassleaf canopy',
      color: 0x94b9a2,
      emissive: new THREE.Color(0x164944),
      emissiveIntensity: 0.86,
      roughness: 0.32,
      metalness: 0.08,
      transparent: true,
      opacity: 0.88
    });
    var leafCount = quality === 2 ? 76 : quality === 1 ? 48 : 28;
    var leaves = new THREE.InstancedMesh(leafGeometry, leafMaterial, leafCount);
    leaves.name = 'Skyroot glassleaf canopy';
    var dummy = new THREE.Object3D();
    for (var li = 0; li < leafCount; li++) {
      var la = rng() * Math.PI * 2;
      var lr = 3.3 + Math.pow(rng(), 0.62) * 9.2;
      var ly = 10.8 + rng() * 15.3 - lr * 0.13;
      dummy.position.set(Math.cos(la) * lr, ly, (rng() - 0.5) * 4.1);
      dummy.rotation.set((rng() - 0.5) * 0.8, la + rng() * 0.8, (rng() - 0.5) * 1.25);
      var ls = 0.55 + rng() * 1.1;
      dummy.scale.set(ls, ls, ls);
      dummy.updateMatrix();
      leaves.setMatrixAt(li, dummy.matrix);
    }
    leaves.instanceMatrix.needsUpdate = true;
    leaves.castShadow = quality > 0;
    tree.add(leaves);

    var dropletMaterial = new THREE.MeshPhysicalMaterial({
      name: 'Suspended skywater',
      color: palette.cyan.clone(),
      emissive: new THREE.Color(0x0c3335),
      emissiveIntensity: 0.75,
      transparent: true,
      opacity: 0.54,
      roughness: 0.05,
      metalness: 0.0,
      depthWrite: false
    });
    var droplets = new THREE.Group();
    droplets.name = 'Suspended skywater droplets';
    var dropletCount = quality === 0 ? 5 : 9;
    for (var di = 0; di < dropletCount; di++) {
      var drop = new THREE.Mesh(new THREE.SphereGeometry(0.35 + rng() * 0.32, 10, 7), dropletMaterial);
      drop.scale.y = 1.6 + rng() * 1.7;
      var da = rng() * Math.PI * 2;
      var dr = 10 + rng() * 8;
      drop.position.set(Math.cos(da) * dr, -3 + rng() * 22, -1.5 + rng() * 3);
      drop.userData.phase = rng() * Math.PI * 2;
      droplets.add(drop);
    }
    group.add(droplets);

    var beacon = new THREE.PointLight(0x72e0db, quality === 0 ? 1.5 : 2.25, 52, 2);
    beacon.name = 'Orrery beacon';
    beacon.position.set(0, 5, 5);
    group.add(beacon);

    group.userData.outerPivot = outerPivot;
    group.userData.middlePivot = middlePivot;
    group.userData.innerPivot = innerPivot;
    group.userData.structuralBands = [outer, middle, inner];
    group.userData.minorSpokes = minorSpokes;
    group.userData.presentationRails = [outerLight, middleGlow];
    group.userData.outerLight = outerLight;
    group.userData.middleGlow = middleGlow;
    group.userData.innerGlow = innerGlow;
    group.userData.tree = tree;
    group.userData.leaves = leaves;
    group.userData.droplets = droplets;
    group.userData.beacon = beacon;
    group.userData.core = core;
    group.userData.cyan = palette.cyan.clone();
    group.userData.gold = palette.gold.clone();
    group.userData.progress = 0;
    group.userData.bossPresentation = false;
    return group;
  }

  function updateOrrery(orrery, dt, elapsed, mechanismProgress, restored, reduceMotion, bossPresentation) {
    var data = orrery.userData;
    bossPresentation = !!bossPresentation;
    if (bossPresentation !== data.bossPresentation) {
      data.bossPresentation = bossPresentation;
      // Keep one luminous meridian as an arena frame while removing the opaque
      // bands and duplicate rails that otherwise slice through both silhouettes.
      for (var bandIndex = 0; bandIndex < data.structuralBands.length; bandIndex++) {
        data.structuralBands[bandIndex].visible = !bossPresentation;
      }
      data.minorSpokes.visible = !bossPresentation;
      for (var railIndex = 0; railIndex < data.presentationRails.length; railIndex++) {
        data.presentationRails[railIndex].visible = !bossPresentation;
      }
    }
    data.progress += (mechanismProgress - data.progress) * (1 - Math.exp(-dt * 2.2));
    var motion = reduceMotion ? 0.16 : 1;
    data.outerPivot.rotation.z = elapsed * 0.018 * motion * (0.2 + data.progress);
    data.middlePivot.rotation.z = -elapsed * 0.031 * motion * (0.15 + data.progress);
    data.middlePivot.rotation.y = 0.28 + Math.sin(elapsed * 0.13) * 0.09 * motion;
    data.innerPivot.rotation.z = elapsed * 0.049 * motion * (0.1 + data.progress);
    data.innerPivot.rotation.x = 0.24 + Math.sin(elapsed * 0.17 + 1.2) * 0.1 * motion;
    data.outerLight.material.opacity = 0.7 + data.progress * 0.12 + restored * 0.14;
    data.middleGlow.material.opacity = 0.48 + clamp(data.progress * 1.4 - 0.3, 0, 1) * 0.18 + restored * 0.16;
    data.innerGlow.material.opacity = 0.28 + clamp(data.progress * 1.5 - 0.75, 0, 1) * 0.22 + restored * 0.18;
    data.outerLight.material.color.copy(data.cyan).lerp(data.gold, restored * 0.58);
    data.middleGlow.material.color.copy(data.cyan).lerp(data.gold, restored * 0.72);
    data.innerGlow.material.color.copy(data.cyan).lerp(data.gold, restored * 0.88);
    data.core.material.opacity = 0.68 + data.progress * 0.12 + restored * 0.16;
    data.beacon.intensity = 1.45 + data.progress * 0.85 + restored * 1.3;
    data.tree.rotation.z = Math.sin(elapsed * 0.11) * 0.005 * motion;
    for (var i = 0; i < data.droplets.children.length; i++) {
      var drop = data.droplets.children[i];
      drop.position.y += Math.sin(elapsed * 0.48 + drop.userData.phase) * dt * 0.035 * motion;
      drop.rotation.y += dt * 0.08 * motion;
    }
  }

  function createMotes(THREE, palette, rng, quality, reduceMotion) {
    var count = quality === 2 ? 260 : quality === 1 ? 150 : 70;
    var positions = [];
    var colors = [];
    var phases = [];
    var c = new THREE.Color();
    for (var i = 0; i < count; i++) {
      var z = 82 - rng() * 170;
      var x = (rng() * 2 - 1) * 46;
      positions.push(x, 0.5 + rng() * 13, z);
      c.copy(rng() > 0.82 ? palette.gold : palette.cyan).lerp(palette.ivory, rng() * 0.35);
      colors.push(c.r, c.g, c.b);
      phases.push(rng() * Math.PI * 2);
    }
    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
    var uniforms = {
      uTime: { value: 0 },
      uRestored: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.6) }
    };
    var material = new THREE.ShaderMaterial({
      name: 'Valley seed motes',
      uniforms: uniforms,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: [
        'uniform float uTime;',
        'uniform float uRestored;',
        'uniform float uPixelRatio;',
        'attribute float aPhase;',
        'varying vec3 vColor;',
        'varying float vAlpha;',
        'void main(){',
        ' vec3 p=position;',
        ' p.x += sin(uTime*0.21+aPhase+p.z*0.04)*0.7;',
        ' p.y += sin(uTime*0.37+aPhase)*0.34;',
        ' vec4 mv=modelViewMatrix*vec4(p,1.0);',
        ' gl_Position=projectionMatrix*mv;',
        ' gl_PointSize=(2.0+uRestored*1.4)*uPixelRatio*clamp(40.0/-mv.z,0.55,2.0);',
        ' vColor=color;',
        ' vAlpha=0.34+uRestored*0.32;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'precision mediump float;',
        'varying vec3 vColor;',
        'varying float vAlpha;',
        'void main(){',
        ' vec2 p=gl_PointCoord-0.5;',
        ' float d=length(p);',
        ' float a=(1.0-smoothstep(0.05,0.5,d))*vAlpha;',
        ' gl_FragColor=vec4(vColor,a);',
        '}'
      ].join('\n')
    });
    var points = new THREE.Points(geometry, material);
    points.name = 'Drifting celestial seed motes';
    points.frustumCulled = true;
    return { points: points, uniforms: uniforms };
  }

  function makeSurfaceTexture(THREE, size, dark, light, seed, style, anisotropy) {
    if (typeof document === 'undefined') {
      var data = new Uint8Array([80, 92, 82, 255, 102, 111, 92, 255, 72, 84, 78, 255, 112, 119, 98, 255]);
      var fallback = new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat);
      fallback.needsUpdate = true;
      fallback.wrapS = fallback.wrapT = THREE.RepeatWrapping;
      return fallback;
    }
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    var ctx = canvas.getContext('2d');
    var localRng = mulberry32(seed);
    var darkRGB = [dark >> 16 & 255, dark >> 8 & 255, dark & 255];
    var lightRGB = [light >> 16 & 255, light >> 8 & 255, light & 255];
    var phases = [];
    for (var phaseIndex = 0; phaseIndex < 9; phaseIndex++) phases.push(localRng());
    var image = ctx.createImageData(size, size);
    var pixels = image.data;
    var tau = Math.PI * 2;
    for (var py = 0; py < size; py++) {
      var v = py / size;
      for (var px = 0; px < size; px++) {
        var u = px / size;
        // Integer-frequency waves are periodic on both axes. Their combination
        // reads as irregular material grain but remains perfectly continuous
        // through RepeatWrapping, even under bilinear filtering.
        var noise = Math.sin(tau * (u + phases[0])) * Math.cos(tau * (v + phases[1])) * 0.2;
        noise += Math.sin(tau * (2 * u - 3 * v + phases[2])) * 0.135;
        noise += Math.cos(tau * (5 * u + 4 * v + phases[3])) * 0.075;
        noise += Math.sin(tau * (11 * u - 7 * v + phases[4])) * 0.038;
        if (style === 'grain') {
          noise += Math.sin(tau * (13 * u + 0.32 * Math.sin(tau * (2 * v + phases[5])))) * 0.105;
          noise += Math.sin(tau * (31 * u + 3 * v + phases[6])) * 0.025;
        } else if (style === 'stone') {
          noise += (Math.abs(Math.sin(tau * (4 * u + 3 * v + phases[5]))) - 0.5) * 0.095;
        } else if (style === 'metal') {
          noise += Math.sin(tau * (2 * u + 24 * v + phases[5])) * 0.034;
        } else {
          noise += Math.cos(tau * (3 * u - 2 * v + phases[5])) * 0.065;
        }
        var blend = clamp(0.5 + noise, 0.08, 0.92);
        var pixelIndex = (py * size + px) * 4;
        pixels[pixelIndex] = Math.round(lerp(darkRGB[0], lightRGB[0], blend));
        pixels[pixelIndex + 1] = Math.round(lerp(darkRGB[1], lightRGB[1], blend));
        pixels[pixelIndex + 2] = Math.round(lerp(darkRGB[2], lightRGB[2], blend));
        pixels[pixelIndex + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);

    // Every mark is painted with translated copies across all four boundaries,
    // so cracks and pores crossing a texture edge continue on the opposite side.
    ctx.globalCompositeOperation = 'overlay';
    var specks = Math.floor(size * (style === 'metal' ? 0.6 : 1.15));
    for (var i = 0; i < specks; i++) {
      var alpha = 0.035 + localRng() * 0.1;
      ctx.fillStyle = localRng() > 0.52 ? 'rgba(255,255,225,' + alpha + ')' : 'rgba(0,12,14,' + alpha + ')';
      var radius = localRng() * (style === 'stone' ? 3.8 : 2.1) + 0.35;
      var spotX = localRng() * size;
      var spotY = localRng() * size;
      var spotAspect = 0.45 + localRng() * 0.55;
      for (var wrapY = -1; wrapY <= 1; wrapY++) {
        for (var wrapX = -1; wrapX <= 1; wrapX++) {
          ctx.beginPath();
          ctx.ellipse(spotX + wrapX * size, spotY + wrapY * size, radius, radius * spotAspect, 0, 0, tau);
          ctx.fill();
        }
      }
    }
    ctx.globalCompositeOperation = 'soft-light';
    ctx.lineWidth = Math.max(0.5, size / 256);
    var lines = style === 'grain' ? 42 : style === 'metal' ? 25 : 16;
    for (var n = 0; n < lines; n++) {
      ctx.strokeStyle = n % 2 ? 'rgba(255,245,205,0.10)' : 'rgba(0,20,18,0.13)';
      var lineX = localRng() * size;
      var lineY = localRng() * size;
      var lineDX = style === 'grain' ? (localRng() - 0.5) * size * 0.08 : size * (0.15 + localRng() * 0.28);
      var lineDY = style === 'grain' ? size * (0.15 + localRng() * 0.28) : (localRng() - 0.5) * size * 0.055;
      for (var lineWrapY = -1; lineWrapY <= 1; lineWrapY++) {
        for (var lineWrapX = -1; lineWrapX <= 1; lineWrapX++) {
          ctx.beginPath();
          ctx.moveTo(lineX + lineWrapX * size, lineY + lineWrapY * size);
          ctx.lineTo(lineX + lineDX + lineWrapX * size, lineY + lineDY + lineWrapY * size);
          ctx.stroke();
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    var texture = new THREE.CanvasTexture(canvas);
    texture.name = 'Procedural ' + style + ' texture';
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = anisotropy || 1;
    if (THREE.sRGBEncoding !== undefined) texture.encoding = THREE.sRGBEncoding;
    texture.needsUpdate = true;
    return texture;
  }

  function makeFacetedRockGeometry(THREE, detail) {
    var geometry = new THREE.DodecahedronGeometry(1, detail || 0);
    var positions = geometry.attributes.position;
    for (var i = 0; i < positions.count; i++) {
      var x = positions.getX(i);
      var y = positions.getY(i);
      var z = positions.getZ(i);
      positions.setXYZ(i, x * (0.88 + (y + 1) * 0.05), y * 0.74, z * (0.92 - y * 0.04));
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  }

  function makeCliffModuleGeometry(THREE, variant) {
    var geometry = new THREE.DodecahedronGeometry(1, 0);
    var positions = geometry.attributes.position;
    for (var i = 0; i < positions.count; i++) {
      var x = positions.getX(i);
      var y = positions.getY(i);
      var z = positions.getZ(i);
      var shelf = 1 + Math.sin((y + 1.1) * 5.3 + variant * 1.7) * (variant ? 0.16 : 0.1);
      var shear = y * (variant ? 0.16 : -0.1);
      positions.setXYZ(
        i,
        x * shelf * (1 + z * 0.08) + shear,
        y * (variant ? 0.72 : 1.0),
        z * (1 - y * 0.08) + x * y * 0.06
      );
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  }

  function makeGrassTuftGeometry(THREE) {
    var positions = [];
    var colors = [];
    var uvs = [];
    var indices = [];
    var bladeColors = [new THREE.Color(0x3d594a), new THREE.Color(0x536a52), new THREE.Color(0x6b7658), new THREE.Color(0x465f4d)];
    for (var b = 0; b < 9; b++) {
      var angle = b * 2.3999632297;
      var ring = Math.sqrt((b + 0.35) / 9) * 0.34;
      var ox = Math.cos(angle) * ring;
      var oz = Math.sin(angle) * ring;
      var width = 0.042 + (b % 3) * 0.014;
      var height = 0.46 + ((b * 37) % 7) * 0.071;
      var lean = 0.06 + (b % 4) * 0.018;
      var dx = Math.cos(angle + Math.PI * 0.5) * width;
      var dz = Math.sin(angle + Math.PI * 0.5) * width;
      var topX = ox + Math.cos(angle) * lean;
      var topZ = oz + Math.sin(angle) * lean;
      var base = positions.length / 3;
      positions.push(
        ox - dx, 0, oz - dz,
        ox + dx, 0, oz + dz,
        topX + dx * 0.08, height, topZ + dz * 0.08,
        topX - dx * 0.08, height, topZ - dz * 0.08
      );
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      var col = bladeColors[b % bladeColors.length];
      for (var j = 0; j < 4; j++) colors.push(col.r, col.g, col.b);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    var geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
  }

  function flattenHeight(value, x, z, cx, cz, radius, target) {
    var d = distance2D(x, z, cx, cz);
    var t = 1 - smoothstep(radius * 0.48, radius, d);
    return lerp(value, target, t);
  }

  function flattenHeightRange(value, x, z, cx, cz, innerRadius, outerRadius, target) {
    var d = distance2D(x, z, cx, cz);
    var t = 1 - smoothstep(innerRadius, outerRadius, d);
    return lerp(value, target, t);
  }

  function pathX(z) {
    // Authored two-bend sightline: it begins under the vista camera, swings
    // through both meadows, then resolves dead-center on the celestial gate.
    var t = clamp((56 - z) / 100, 0, 1);
    return -3.5 * (1 - t) + Math.sin(t * Math.PI * 2) * Math.sin(t * Math.PI) * 7.2;
  }

  function lensBranchDistance(x, z) {
    var branches = [
      [[pathX(31), 31], [-10, 27], [-24, 20]],
      [[pathX(10), 10], [12, 7], [25, 2]],
      [[pathX(-20), -20], [-3, -24], [0, -27]]
    ];
    var minimum = Infinity;
    for (var branchIndex = 0; branchIndex < branches.length; branchIndex++) {
      for (var segment = 0; segment < branches[branchIndex].length - 1; segment++) {
        var a = branches[branchIndex][segment];
        var b = branches[branchIndex][segment + 1];
        minimum = Math.min(minimum, distancePointToSegment2D(x, z, a[0], a[1], b[0], b[1]));
      }
    }
    return minimum;
  }

  function distancePointToSegment2D(px, pz, ax, az, bx, bz) {
    var dx = bx - ax;
    var dz = bz - az;
    var lengthSq = dx * dx + dz * dz;
    var t = lengthSq ? clamp(((px - ax) * dx + (pz - az) * dz) / lengthSq, 0, 1) : 0;
    return distance2D(px, pz, ax + dx * t, az + dz * t);
  }

  function streamX(z) {
    return 7.0 + Math.sin((z + 18) * 0.054) * 8.2 + Math.sin(z * 0.021) * 2.2;
  }

  function valueNoise(x, y) {
    var ix = Math.floor(x);
    var iy = Math.floor(y);
    var fx = x - ix;
    var fy = y - iy;
    var ux = fx * fx * (3 - 2 * fx);
    var uy = fy * fy * (3 - 2 * fy);
    var a = hashGrid(ix, iy);
    var b = hashGrid(ix + 1, iy);
    var c = hashGrid(ix, iy + 1);
    var d = hashGrid(ix + 1, iy + 1);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uy) * 2 - 1;
  }

  function fbm(x, y) {
    var total = 0;
    var amp = 0.58;
    var frequency = 1;
    for (var i = 0; i < 4; i++) {
      total += valueNoise(x * frequency, y * frequency) * amp;
      frequency *= 2.03;
      amp *= 0.48;
    }
    return total;
  }

  function hashGrid(x, y) {
    var h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return ((h ^ h >>> 16) >>> 0) / 4294967295;
  }

  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = seed + 0x6d2b79f5 | 0;
      var t = seed;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function distance2D(x1, z1, x2, z2) {
    var dx = x1 - x2;
    var dz = z1 - z2;
    return Math.sqrt(dx * dx + dz * dz);
  }

  function smoothstep(edge0, edge1, x) {
    var t = clamp((x - edge0) / (edge1 - edge0 || 1), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
})();
