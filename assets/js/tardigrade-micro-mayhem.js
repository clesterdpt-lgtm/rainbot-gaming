/* ============================================================
   Tardigrade: Micro Mayhem
   Low-poly 3D sandbox prototype for Rainbot Network.
   Plain Three.js, no build step.
   ============================================================ */
(() => {
  "use strict";

  const GAME_ID = "tardigrade-micro-mayhem";
  const MAP_AREA_SCALE = 5;
  const MAP_LINEAR_SCALE = Math.sqrt(MAP_AREA_SCALE);
  const SCENIC_RADIUS_SCALE = 1.45;
  const MAP_POPULATION_SCALE = 1.7;
  const mapCoord = (value) => value * MAP_LINEAR_SCALE;
  const mapRadius = (value) => value * MAP_LINEAR_SCALE;
  const scenicRadius = (value) => value * SCENIC_RADIUS_SCALE;
  const populationCount = (value) => Math.max(1, Math.round(value * MAP_POPULATION_SCALE));
  const levelPopulationCount = (value) => {
    const scale = levelConfig().populationScale ?? (levelConfig().id === "aquarium" ? MAP_POPULATION_SCALE : 0.75);
    return Math.max(1, Math.round(value * scale));
  };
  const LEVEL_ONE_RADIUS = 108;
  const LEVEL_TWO_HALF_SIZE = Math.sqrt(MAP_AREA_SCALE * Math.PI * LEVEL_ONE_RADIUS * LEVEL_ONE_RADIUS) / 2;
  const LEVEL_THREE_RADIUS = mapRadius(88);
  const LEVEL_FOUR_RADIUS = mapRadius(84);
  const LEVEL_FIVE_HALF_SIZE = mapRadius(78);
  const WORLD_RADIUS = Math.max(
    LEVEL_TWO_HALF_SIZE * Math.SQRT2,
    LEVEL_THREE_RADIUS,
    LEVEL_FOUR_RADIUS,
    LEVEL_FIVE_HALF_SIZE * Math.SQRT2
  );
  const FINAL_STAGE = 5;
  const PLAYER_RADIUS = 1.55;
  const GRAVITY = 22;
  const GROUND_Y = 0.42;
  const TERRAIN_VISUAL_OFFSET = 0.24;
  const CAMERA_YAW_SENSITIVITY = 0.0048;
  const CAMERA_PITCH_SENSITIVITY = 0.0032;
  const LEVEL_ONE_GOAL_COUNT = 6;
  const LEVEL_CONFIGS = {
    1: {
      id: "petri",
      name: "Petri Dish",
      shortName: "Petri",
      shape: "circle",
      radius: LEVEL_ONE_RADIUS,
      requiredGoals: LEVEL_ONE_GOAL_COUNT,
      populationScale: 0.82,
      advanceTitle: "SCIENTIST INTEREST DETECTED",
      advanceText: "The scientists think you are worth studying more, which is either an honor or a paperwork error.",
      advanceButton: "Accept paperwork error",
      arrivalTitle: "LEVEL 1!",
      arrivalSubtitle: "Petri dish loaded",
      ring: { x: -42, z: -34, radius: 5.8 },
      zones: [
        { id: "agar", name: "Agar Center", x: 0, z: 0, radius: 24, color: 0xf4d58c, material: "zoneAgar" },
        { id: "algae-smear", name: "Algae Smear", x: -30, z: 24, radius: 20, color: 0x87d84a, material: "zonePetriAlgae" },
        { id: "droplet-lane", name: "Droplet Lane", x: 30, z: -22, radius: 19, color: 0x65d5ff, material: "zonePetriWater" },
        { id: "bacteria-track", name: "Bacteria Track", x: -34, z: -25, radius: 18, color: 0xff9d45, material: "zonePetriBacteria" },
      ],
      landmarks: [
        { id: "agar-dimple", name: "Agar Dimple", zone: "agar", x: 18, z: 18, radius: 5.8, color: 0xf4d58c },
        { id: "glass-lip", name: "Glass Lip", zone: "droplet-lane", x: 58, z: -8, radius: 6.4, color: 0x9de8ff },
        { id: "micro-colony", name: "Micro Colony", zone: "algae-smear", x: -46, z: 32, radius: 6.2, color: 0x6bff7d },
        { id: "nutrient-scratch", name: "Nutrient Scratch", zone: "bacteria-track", x: -55, z: -38, radius: 6.0, color: 0xffd43b },
      ],
      toys: [
        { id: "starter-ramp", type: "ramp", name: "Agar Ramp", x: -10, z: 23, yaw: -0.54, radius: 5.6, boost: 17, lift: 6.8 },
        { id: "meniscus-pad", type: "jumpPad", name: "Meniscus Popper", x: 34, z: 9, yaw: 0.2, radius: 5.2, boost: 5.8, lift: 13.2 },
      ],
      creatures: [
        { id: "rotifer-smear", type: "rotifer", centerX: -24, centerZ: 18, radiusX: 18, radiusZ: 9, speed: 0.24, hover: 1.9, phase: 0.1 },
        { id: "ciliate-loop", type: "ciliate", centerX: 24, centerZ: -5, radiusX: 28, radiusZ: 13, speed: 0.2, hover: 3.2, phase: 1.4 },
        { id: "waterbearling-petri", type: "waterbearling", centerX: -34, centerZ: -22, radiusX: 12, radiusZ: 8, speed: 0.28, hover: 1.0, phase: 3.0 },
      ],
      starterProps: [
        ["algae", { x: -2.4, z: 4.4 }],
        ["algae", { x: 1.8, z: 3.1 }],
        ["algae", { x: -4.9, z: 1.0 }],
        ["bacteria", { x: -7.4, z: -4.8 }],
        ["droplet", { x: 6.8, z: -7.2 }],
        ["pollen", { x: -10.8, z: -11.6 }],
        ["pollen", { x: -37.5, z: -31.8 }],
      ],
    },
    2: {
      id: "aquarium",
      name: "Aquarium",
      shortName: "Aquarium",
      shape: "square",
      halfSize: LEVEL_TWO_HALF_SIZE,
      radius: WORLD_RADIUS,
      requiredGoals: 3,
      populationScale: MAP_POPULATION_SCALE,
      advanceTitle: "RESEARCH ESCALATED",
      advanceText: "The aquarium report says you are thriving, so the scientists made the normal decision to involve a rat.",
      advanceButton: "Enter questionable rat study",
      arrivalTitle: "LEVEL 2!",
      arrivalSubtitle: "Aquarium loaded",
      ring: { x: mapCoord(-42), z: mapCoord(-34), radius: scenicRadius(5.8) },
      zones: [
        {
          id: "forest",
          name: "Algae Forest",
          x: mapCoord(-62),
          z: mapCoord(45),
          radius: mapRadius(25),
          color: 0x6bff7d,
          material: "zoneForest",
        },
        {
          id: "flats",
          name: "Droplet Flats",
          x: mapCoord(62),
          z: mapCoord(38),
          radius: mapRadius(24),
          color: 0x37b8ff,
          material: "zoneFlats",
        },
        {
          id: "reef",
          name: "Bacteria Reef",
          x: mapCoord(57),
          z: mapCoord(-64),
          radius: mapRadius(24),
          color: 0xff9d2e,
          material: "zoneReef",
        },
        {
          id: "ridge",
          name: "Spore Ridge",
          x: mapCoord(-58),
          z: mapCoord(-62),
          radius: mapRadius(23),
          color: 0xa5ff4f,
          material: "zoneRidge",
        },
      ],
      landmarks: [
        { id: "algae-crown", name: "Algae Crown", zone: "forest", x: mapCoord(-80), z: mapCoord(59), radius: scenicRadius(7.0), color: 0x6bff7d },
        { id: "glass-moonpool", name: "Glass Moonpool", zone: "flats", x: mapCoord(78), z: mapCoord(48), radius: scenicRadius(7.2), color: 0x37b8ff },
        { id: "orange-spire", name: "Orange Spire", zone: "reef", x: mapCoord(70), z: mapCoord(-74), radius: scenicRadius(7.0), color: 0xff9d2e },
        { id: "spore-crown", name: "Spore Crown", zone: "ridge", x: mapCoord(-76), z: mapCoord(-76), radius: scenicRadius(7.0), color: 0xa5ff4f },
      ],
      toys: [
        { id: "starter-ramp", type: "ramp", name: "Cellulose Ramp", x: -10, z: 23, yaw: -0.54, radius: 5.6, boost: 17, lift: 6.8 },
        { id: "forest-ramp", type: "ramp", name: "Algae Launch Ramp", x: mapCoord(-54), z: mapCoord(28), yaw: -0.9, radius: scenicRadius(6.8), boost: 22, lift: 9.8 },
        { id: "flats-pad", type: "jumpPad", name: "Droplet Spring", x: mapCoord(38), z: mapCoord(20), yaw: 0.2, radius: scenicRadius(5.7), boost: 7.2, lift: 18.6 },
        { id: "ridge-pad", type: "jumpPad", name: "Spore Popper", x: mapCoord(-42), z: mapCoord(-42), yaw: -0.38, radius: scenicRadius(5.7), boost: 8.6, lift: 19.8 },
        { id: "reef-geyser", type: "geyser", name: "Hydro Geyser", x: mapCoord(63), z: mapCoord(-50), yaw: 0.6, radius: scenicRadius(6.2), boost: 10.5, lift: 22.4 },
        { id: "forest-geyser", type: "geyser", name: "Bubble Vent", x: mapCoord(-71), z: mapCoord(20), yaw: -0.35, radius: scenicRadius(5.9), boost: 9.2, lift: 19.5 },
        { id: "spore-ridge", type: "ridge", name: "Spore Stair", x: mapCoord(-58), z: mapCoord(-62), yaw: -0.2, radius: scenicRadius(8.4), boost: 10.2, lift: 5.0 },
        { id: "reef-ridge", type: "ridge", name: "Reef Scramble", x: mapCoord(45), z: mapCoord(-71), yaw: 0.55, radius: scenicRadius(8.0), boost: 9.4, lift: 4.6 },
        { id: "crown-pad", type: "jumpPad", name: "Crown Popper", x: mapCoord(2), z: mapCoord(-70), yaw: 0.05, radius: scenicRadius(6.0), boost: 9.2, lift: 23.0 },
      ],
      creatures: [
        { id: "rotifer-forest", type: "rotifer", centerX: mapCoord(-58), centerZ: mapCoord(34), radiusX: mapRadius(22), radiusZ: mapRadius(12), speed: 0.26, hover: 2.1, phase: 0.1 },
        { id: "rotifer-flats", type: "rotifer", centerX: mapCoord(58), centerZ: mapCoord(34), radiusX: mapRadius(20), radiusZ: mapRadius(11), speed: 0.22, hover: 2.4, phase: 2.4 },
        { id: "ciliate-canal", type: "ciliate", centerX: mapCoord(6), centerZ: mapCoord(-15), radiusX: mapRadius(42), radiusZ: mapRadius(20), speed: 0.18, hover: 4.4, phase: 1.1 },
        { id: "ciliate-ridge", type: "ciliate", centerX: mapCoord(-51), centerZ: mapCoord(-59), radiusX: mapRadius(18), radiusZ: mapRadius(10), speed: 0.25, hover: 3.2, phase: 4.1 },
        { id: "waterbearling", type: "waterbearling", centerX: mapCoord(40), centerZ: mapCoord(-58), radiusX: mapRadius(17), radiusZ: mapRadius(12), speed: 0.3, hover: 1.1, phase: 3.0 },
        { id: "spore-ray", type: "sporeRay", centerX: mapCoord(0), centerZ: mapCoord(50), radiusX: mapRadius(38), radiusZ: mapRadius(16), speed: 0.16, hover: 8.2, phase: 5.2 },
        { id: "nano-shoal-west", type: "sporeRay", centerX: mapCoord(-72), centerZ: mapCoord(-8), radiusX: mapRadius(18), radiusZ: mapRadius(36), speed: 0.21, hover: 7.6, phase: 2.1 },
        { id: "ciliate-filter", type: "ciliate", centerX: mapCoord(76), centerZ: mapCoord(-22), radiusX: mapRadius(12), radiusZ: mapRadius(34), speed: 0.28, hover: 5.4, phase: 0.8 },
      ],
      starterProps: [
        ["algae", { x: -2.4, z: 4.4 }],
        ["algae", { x: 1.8, z: 3.1 }],
        ["algae", { x: -4.9, z: 1.0 }],
        ["bacteria", { x: -7.4, z: -4.8 }],
        ["droplet", { x: 6.8, z: -7.2 }],
        ["pollen", { x: -10.8, z: -11.6 }],
        ["pollen", { x: -37.5, z: -31.8 }],
      ],
    },
    3: {
      id: "stomach",
      name: "Rat Stomach",
      shortName: "Stomach",
      shape: "circle",
      radius: LEVEL_THREE_RADIUS,
      requiredGoals: 4,
      populationScale: 1.35,
      advanceTitle: "DIGESTION STUDY COMPLETE",
      advanceText: "The rat coughed politely, the scientists wrote 'probably fine,' and a lava sample somehow became the next logical step.",
      advanceButton: "Descend to lava lab",
      arrivalTitle: "LEVEL 3!",
      arrivalSubtitle: "Rat stomach research mission",
      ring: { x: mapCoord(-34), z: mapCoord(26), radius: scenicRadius(6.2) },
      zones: [
        { id: "cardia-cove", name: "Cardia Cove", x: mapCoord(-48), z: mapCoord(34), radius: mapRadius(23), color: 0xff7aa8, material: "zoneStomachPink" },
        { id: "mucus-rapids", name: "Mucus Rapids", x: mapCoord(43), z: mapCoord(42), radius: mapRadius(24), color: 0xffb34d, material: "zoneStomachGold" },
        { id: "food-raft", name: "Food Raft", x: mapCoord(51), z: mapCoord(-47), radius: mapRadius(23), color: 0xd883ff, material: "zoneStomachPurple" },
        { id: "enzyme-sump", name: "Enzyme Sump", x: mapCoord(-54), z: mapCoord(-52), radius: mapRadius(24), color: 0x53ead1, material: "zoneStomachMint" },
      ],
      landmarks: [
        { id: "cracker-island", name: "Cracker Island", zone: "food-raft", x: mapCoord(66), z: mapCoord(-38), radius: scenicRadius(7.0), color: 0xffd43b },
        { id: "bubble-burper", name: "Bubble Burper", zone: "mucus-rapids", x: mapCoord(28), z: mapCoord(62), radius: scenicRadius(7.0), color: 0x53ead1 },
        { id: "folded-rugae", name: "Folded Rugae", zone: "cardia-cove", x: mapCoord(-68), z: mapCoord(41), radius: scenicRadius(7.2), color: 0xff7aa8 },
        { id: "enzyme-oracle", name: "Enzyme Oracle", zone: "enzyme-sump", x: mapCoord(-61), z: mapCoord(-68), radius: scenicRadius(7.0), color: 0xd883ff },
      ],
      toys: [
        { id: "peristalsis-ramp", type: "ramp", name: "Peristalsis Ramp", x: mapCoord(-18), z: mapCoord(28), yaw: -0.45, radius: scenicRadius(6.5), boost: 21, lift: 10.4 },
        { id: "mucus-geyser", type: "geyser", name: "Mucus Geyser", x: mapCoord(38), z: mapCoord(18), yaw: 0.3, radius: scenicRadius(6.3), boost: 9.5, lift: 21 },
        { id: "rugae-stair", type: "ridge", name: "Rugae Stair", x: mapCoord(-47), z: mapCoord(-36), yaw: 0.18, radius: scenicRadius(8.4), boost: 9.4, lift: 4.8 },
        { id: "burp-pad", type: "jumpPad", name: "Burp Pad", x: mapCoord(5), z: mapCoord(-57), yaw: -0.2, radius: scenicRadius(5.9), boost: 7.8, lift: 20.5 },
      ],
      creatures: [
        { id: "gut-ciliate", type: "gutWorm", centerX: mapCoord(-46), centerZ: mapCoord(30), radiusX: mapRadius(20), radiusZ: mapRadius(11), speed: 0.24, hover: 3.6, phase: 0.2 },
        { id: "enzyme-eel", type: "gutWorm", centerX: mapCoord(36), centerZ: mapCoord(-30), radiusX: mapRadius(34), radiusZ: mapRadius(16), speed: 0.18, hover: 5.8, phase: 1.7 },
        { id: "crumb-rotifer", type: "rotifer", centerX: mapCoord(49), centerZ: mapCoord(-52), radiusX: mapRadius(15), radiusZ: mapRadius(11), speed: 0.26, hover: 2.5, phase: 3.1 },
        { id: "junior-waterbear-gut", type: "waterbearling", centerX: mapCoord(-44), centerZ: mapCoord(-54), radiusX: mapRadius(14), radiusZ: mapRadius(10), speed: 0.29, hover: 1.2, phase: 5.0 },
      ],
      starterProps: [
        ["foodbit", { x: -3.5, z: 5.5 }],
        ["foodbit", { x: 4.2, z: 3.5 }],
        ["digestiveBubble", { x: -8.8, z: -5.4 }],
        ["enzyme", { x: 8.0, z: -8.6 }],
        ["droplet", { x: -13.5, z: 8.4 }],
        ["pollen", { x: -34, z: 25 }],
      ],
    },
    4: {
      id: "lava",
      name: "Lava Cavern",
      shortName: "Lava",
      shape: "circle",
      radius: LEVEL_FOUR_RADIUS,
      requiredGoals: 4,
      populationScale: 1.18,
      advanceTitle: "GEOTHERMAL NOTES FILED",
      advanceText: "You survived lava, which means the scientists upgraded your file from 'mysterious damp bean' to 'space-program damp bean.'",
      advanceButton: "Board the space station",
      arrivalTitle: "LEVEL 4!",
      arrivalSubtitle: "Underground lava level",
      ring: { x: mapCoord(39), z: mapCoord(-32), radius: scenicRadius(6.0) },
      zones: [
        { id: "basalt-shelf", name: "Basalt Shelf", x: mapCoord(-52), z: mapCoord(38), radius: mapRadius(23), color: 0x6f7488, material: "zoneLavaBasalt" },
        { id: "ember-river", name: "Ember River", x: mapCoord(48), z: mapCoord(32), radius: mapRadius(24), color: 0xff5a2f, material: "zoneLavaRiver" },
        { id: "steam-fissure", name: "Steam Fissure", x: mapCoord(-45), z: mapCoord(-52), radius: mapRadius(22), color: 0xffd43b, material: "zoneLavaSteam" },
        { id: "crystal-caldera", name: "Crystal Caldera", x: mapCoord(52), z: mapCoord(-54), radius: mapRadius(24), color: 0xd883ff, material: "zoneLavaCrystal" },
      ],
      landmarks: [
        { id: "obsidian-tooth", name: "Obsidian Tooth", zone: "basalt-shelf", x: mapCoord(-68), z: mapCoord(50), radius: scenicRadius(7.0), color: 0xf8fbff },
        { id: "magma-heart", name: "Magma Heart", zone: "ember-river", x: mapCoord(60), z: mapCoord(23), radius: scenicRadius(7.2), color: 0xff5a2f },
        { id: "steam-kazoo", name: "Steam Kazoo", zone: "steam-fissure", x: mapCoord(-55), z: mapCoord(-65), radius: scenicRadius(7.0), color: 0xb9f4ff },
        { id: "violet-geode", name: "Violet Geode", zone: "crystal-caldera", x: mapCoord(68), z: mapCoord(-66), radius: scenicRadius(7.0), color: 0xd883ff },
      ],
      toys: [
        { id: "basalt-ramp", type: "ramp", name: "Basalt Ramp", x: mapCoord(-30), z: mapCoord(21), yaw: -0.58, radius: scenicRadius(6.4), boost: 23, lift: 11 },
        { id: "heat-vent", type: "geyser", name: "Heat Vent", x: mapCoord(42), z: mapCoord(0), yaw: 0.52, radius: scenicRadius(6.5), boost: 11.2, lift: 24 },
        { id: "ash-pad", type: "jumpPad", name: "Ash Popper", x: mapCoord(-7), z: mapCoord(-60), yaw: 0.1, radius: scenicRadius(5.9), boost: 8.7, lift: 22.5 },
        { id: "caldera-ridge", type: "ridge", name: "Caldera Scramble", x: mapCoord(43), z: mapCoord(-53), yaw: -0.42, radius: scenicRadius(8.0), boost: 10.5, lift: 5.4 },
      ],
      creatures: [
        { id: "ember-ray", type: "emberSkimmer", centerX: mapCoord(38), centerZ: mapCoord(22), radiusX: mapRadius(24), radiusZ: mapRadius(14), speed: 0.21, hover: 8.4, phase: 0.6 },
        { id: "ash-ciliate", type: "ciliate", centerX: mapCoord(-30), centerZ: mapCoord(-45), radiusX: mapRadius(26), radiusZ: mapRadius(12), speed: 0.25, hover: 4.8, phase: 2.2 },
        { id: "basalt-rotifer", type: "rotifer", centerX: mapCoord(-54), centerZ: mapCoord(34), radiusX: mapRadius(18), radiusZ: mapRadius(11), speed: 0.23, hover: 2.6, phase: 3.4 },
      ],
      starterProps: [
        ["ashCrystal", { x: -4, z: 6 }],
        ["magmaBubble", { x: 7, z: -7 }],
        ["magmaBubble", { x: -10, z: -6 }],
        ["crystal", { x: 12, z: 7 }],
        ["pollen", { x: mapCoord(39), z: mapCoord(-28) }],
      ],
    },
    5: {
      id: "station",
      name: "Space Station",
      shortName: "Station",
      shape: "square",
      halfSize: LEVEL_FIVE_HALF_SIZE,
      radius: LEVEL_FIVE_HALF_SIZE * Math.SQRT2,
      requiredGoals: 3,
      populationScale: 1.08,
      arrivalTitle: "LEVEL 5!",
      arrivalSubtitle: "Space station research mission",
      ring: { x: mapCoord(-22), z: mapCoord(38), radius: scenicRadius(5.8) },
      zones: [
        { id: "airlock-grid", name: "Airlock Grid", x: mapCoord(-50), z: mapCoord(43), radius: mapRadius(21), color: 0x53ead1, material: "zoneStationCyan" },
        { id: "lab-bench", name: "Orbital Lab Bench", x: mapCoord(46), z: mapCoord(40), radius: mapRadius(22), color: 0xf8fbff, material: "zoneStationWhite" },
        { id: "vent-maze", name: "Vent Maze", x: mapCoord(-48), z: mapCoord(-46), radius: mapRadius(22), color: 0xffd43b, material: "zoneStationGold" },
        { id: "window-array", name: "Observation Window", x: mapCoord(50), z: mapCoord(-48), radius: mapRadius(22), color: 0x8c6bff, material: "zoneStationViolet" },
      ],
      landmarks: [
        { id: "camera-dock", name: "Camera Dock", zone: "airlock-grid", x: mapCoord(-62), z: mapCoord(56), radius: scenicRadius(7.0), color: 0x53ead1 },
        { id: "sample-vault", name: "Sample Vault", zone: "lab-bench", x: mapCoord(62), z: mapCoord(50), radius: scenicRadius(7.0), color: 0xf8fbff },
        { id: "fan-shrine", name: "Fan Shrine", zone: "vent-maze", x: mapCoord(-64), z: mapCoord(-58), radius: scenicRadius(7.0), color: 0xffd43b },
        { id: "earth-peek", name: "Earth Peek", zone: "window-array", x: mapCoord(62), z: mapCoord(-62), radius: scenicRadius(7.0), color: 0x8c6bff },
      ],
      toys: [
        { id: "mag-rail", type: "ridge", name: "Mag Rail", x: mapCoord(-24), z: mapCoord(8), yaw: 0.1, radius: scenicRadius(9.0), boost: 12.5, lift: 6.3 },
        { id: "zero-g-pad", type: "jumpPad", name: "Zero-G Pad", x: mapCoord(31), z: mapCoord(9), yaw: -0.2, radius: scenicRadius(6.4), boost: 10.8, lift: 28 },
        { id: "air-vent", type: "geyser", name: "Air Vent", x: mapCoord(-38), z: mapCoord(-26), yaw: 0.3, radius: scenicRadius(6.2), boost: 13, lift: 24 },
        { id: "sample-ramp", type: "ramp", name: "Sample Ramp", x: mapCoord(42), z: mapCoord(-34), yaw: -0.7, radius: scenicRadius(6.3), boost: 23, lift: 12 },
      ],
      creatures: [
        { id: "cleanroom-drone", type: "labDrone", centerX: mapCoord(0), centerZ: mapCoord(45), radiusX: mapRadius(42), radiusZ: mapRadius(13), speed: 0.18, hover: 11.2, phase: 1.0 },
        { id: "lab-ciliate", type: "ciliate", centerX: mapCoord(-52), centerZ: mapCoord(-36), radiusX: mapRadius(19), radiusZ: mapRadius(12), speed: 0.28, hover: 5.8, phase: 2.8 },
        { id: "orbital-waterbearling", type: "waterbearling", centerX: mapCoord(42), centerZ: mapCoord(-44), radiusX: mapRadius(16), radiusZ: mapRadius(11), speed: 0.3, hover: 1.4, phase: 4.6 },
      ],
      starterProps: [
        ["dataChip", { x: -5, z: 5 }],
        ["dataChip", { x: 6, z: -5 }],
        ["toolpod", { x: -11, z: -7 }],
        ["crystal", { x: 12, z: 8 }],
        ["pollen", { x: mapCoord(-22), z: mapCoord(36) }],
      ],
    },
  };
  const RING_TARGET = { ...LEVEL_CONFIGS[1].ring };
  const SANDBOX_SECONDS = 300;
  const GOAL_TARGETS = {
    algae: 2,
    bacteria: 1,
    water: 1,
    ring: 1,
    petriZones: 3,
    petriLandmarks: 2,
    chaos: 4200,
    tankZones: 4,
    tankLandmarks: 4,
    tankChaos: 3600,
    gutZones: 4,
    gutBubbles: 4,
    gutToys: 3,
    gutLandmarks: 3,
    lavaZones: 4,
    lavaHazards: 4,
    lavaToys: 3,
    lavaChaos: 3800,
    stationZones: 4,
    stationScans: 4,
    stationToys: 3,
    stationChaos: 4500,
    time: SANDBOX_SECONDS,
  };
  const SANDBOX_ZONES = cloneLevelEntries(LEVEL_CONFIGS[1].zones);
  const HIDDEN_LANDMARKS = cloneLevelEntries(LEVEL_CONFIGS[1].landmarks);
  const TRAVERSAL_TOYS = cloneLevelEntries(LEVEL_CONFIGS[1].toys);
  const CREATURE_ROUTES = cloneLevelEntries(LEVEL_CONFIGS[1].creatures);
  const STARTER_PROPS = cloneStarterProps(LEVEL_CONFIGS[1].starterProps);
  const SCRIPT_URL = document.currentScript
    ? document.currentScript.src
    : new URL("../assets/js/tardigrade-micro-mayhem.js", window.location.href).href;
  const ASSET_ROOT = new URL("../", SCRIPT_URL).href;
  const RAPIER_URL = new URL("vendor/rapier/rapier-0.19.3.mjs", ASSET_ROOT).href;
  const TEXTURE_ASSETS = {
    floor: new URL("img/tardigrade/micro-floor-speckles.svg", ASSET_ROOT).href,
    algae: new URL("img/tardigrade/algae-cell-tile.svg", ASSET_ROOT).href,
    membrane: new URL("img/tardigrade/membrane-strands.svg", ASSET_ROOT).href,
  };
  const THREE_CDNS = [
    "../assets/vendor/three/three-r128.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
    "https://unpkg.com/three@0.128.0/build/three.min.js",
    "https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js",
  ];

  const GOALS = [
    {
      id: "algae",
      stage: 1,
      title: "Eat some algae",
      text: "Scuttle into two green algae chunks. They heal hydration and teach movement.",
      target: GOAL_TARGETS.algae,
      progress: () => state.snacks,
      hint: "Follow the yellow target tag. Move with WASD, aim with the mouse, and munch two glowing algae.",
      mobileHint: "Left stick moves. Drag the dish to look. Follow the target tag and munch two glowing algae.",
    },
    {
      id: "bacteria",
      stage: 1,
      title: "Bash bacteria",
      text: "Use Shift to bonk the spiky orange bacteria in the dash lane.",
      target: GOAL_TARGETS.bacteria,
      progress: () => state.bacteriaBashed,
      hint: "Face the target bacteria, build a little speed, then tap Shift for a hydro bonk.",
      mobileHint: "Aim at the target bacteria, scuttle forward, then tap Bonk.",
    },
    {
      id: "water",
      stage: 1,
      title: "Move water",
      text: "Shove one blue droplet far enough for the lab to notice.",
      target: GOAL_TARGETS.water,
      progress: () => state.waterMoved,
      hint: "Droplets are heavy. Hit one with a run-up or a dash to push it.",
      mobileHint: "Push the blue droplet with the stick. Bonk gives it extra shove.",
    },
    {
      id: "ring",
      stage: 1,
      title: "Feed the ring",
      text: "Push one golden pollen chunk into the glowing nutrient ring.",
      target: GOAL_TARGETS.ring,
      progress: () => state.ringFed,
      hint: "Follow the beacon to the ring, then bully a gold chunk into the glow.",
      mobileHint: "Follow the target tag. Push the gold pollen into the glowing ring.",
    },
    {
      id: "zones",
      stage: 1,
      title: "Map the dish",
      text: "Visit three petri dish regions so the lab can pretend this is a controlled study.",
      target: GOAL_TARGETS.petriZones,
      progress: () => state.zonesVisited.size,
      hint: "Use the radar to scuttle through three named dish regions before the paperwork notices.",
      mobileHint: "Use the stick and radar to visit three named dish regions.",
    },
    {
      id: "landmarks",
      stage: 1,
      title: "Find odd evidence",
      text: "Discover two tiny dish landmarks. The scientists will call them data because it sounds expensive.",
      target: GOAL_TARGETS.petriLandmarks,
      progress: () => state.landmarksFound.size,
      hint: "Chase the landmark blips near the dish edge and agar patches.",
      mobileHint: "Follow the landmark blips and find two glowing dish clues.",
    },
    {
      id: "zones",
      stage: 2,
      title: "Tour the aquarium",
      text: "Visit four aquarium regions so the radar can map the larger tank.",
      target: GOAL_TARGETS.tankZones,
      progress: () => state.zonesVisited.size,
      hint: "Use the radar and landmarks to tour the larger aquarium zones.",
      mobileHint: "Use the stick and radar to tour the larger aquarium zones.",
    },
    {
      id: "landmarks",
      stage: 2,
      title: "Find tank landmarks",
      text: "Discover four bright aquarium landmarks across the larger floor.",
      target: GOAL_TARGETS.tankLandmarks,
      progress: () => state.landmarksFound.size,
      hint: "Chase the landmark blip between plants, bubble vents, ridges, and reef clusters.",
      mobileHint: "Chase the landmark blip between plants, bubble vents, ridges, and reef clusters.",
    },
    {
      id: "chaos",
      stage: 2,
      title: "Become the aquarium incident",
      text: "Build enough chaos to earn a questionable tank report.",
      target: GOAL_TARGETS.tankChaos,
      progress: () => Math.floor(state.stageChaos),
      hint: "Freestyle mayhem across the aquarium. Mix bonks, snacks, ring feeds, toys, and zone visits.",
    },
    {
      id: "zones",
      stage: 3,
      title: "Tour the stomach biome",
      text: "Map four harmlessly weird stomach regions after the rat study gets very committed.",
      target: GOAL_TARGETS.gutZones,
      progress: () => state.zonesVisited.size,
      hint: "Follow the radar through rugae folds, mucus rapids, food rafts, and enzyme sump.",
      mobileHint: "Use the radar to tour the stomach regions.",
    },
    {
      id: "hazards",
      stage: 3,
      title: "Pop digestive bubbles",
      text: "Bonk four digestive bubbles. They are rude, harmless, and mostly burp-based.",
      target: GOAL_TARGETS.gutBubbles,
      progress: () => state.stageHazards,
      hint: "Aim for glossy digestive bubbles and dash into them for research-grade burps.",
      mobileHint: "Bonk the glossy digestive bubbles.",
      propTypes: ["digestiveBubble"],
    },
    {
      id: "toys",
      stage: 3,
      title: "Ride stomach currents",
      text: "Use three peristalsis toys so the scientists can write 'movement observed' and go to lunch.",
      target: GOAL_TARGETS.gutToys,
      progress: () => state.toysUsed.size,
      hint: "Try the peristalsis ramp, burp pad, mucus geyser, and rugae stair.",
      mobileHint: "Use three stomach launch toys.",
    },
    {
      id: "landmarks",
      stage: 3,
      title: "Find gut landmarks",
      text: "Find three glowing stomach landmarks before anyone asks why this was funded.",
      target: GOAL_TARGETS.gutLandmarks,
      progress: () => state.landmarksFound.size,
      hint: "Chase landmark blips between food bits, bubbles, and folded rugae.",
      mobileHint: "Find three gut landmarks.",
    },
    {
      id: "zones",
      stage: 4,
      title: "Survey the lava cavern",
      text: "Tour four volcanic regions without becoming a toasted crumb with legs.",
      target: GOAL_TARGETS.lavaZones,
      progress: () => state.zonesVisited.size,
      hint: "Use the radar to cross basalt shelves, ember rivers, steam fissures, and crystal caldera.",
      mobileHint: "Tour the four lava regions.",
    },
    {
      id: "hazards",
      stage: 4,
      title: "Burst magma bubbles",
      text: "Bonk four magma bubbles. The lab calls it thermal resilience; you call it hot dodgeball.",
      target: GOAL_TARGETS.lavaHazards,
      progress: () => state.stageHazards,
      hint: "Dash into magma bubbles and use vents to stay moving.",
      mobileHint: "Bonk four magma bubbles.",
      propTypes: ["magmaBubble"],
    },
    {
      id: "toys",
      stage: 4,
      title: "Ride heat vents",
      text: "Use three lava traversal toys to prove physics still works when everything is glowing.",
      target: GOAL_TARGETS.lavaToys,
      progress: () => state.toysUsed.size,
      hint: "Try the heat vent, ash popper, basalt ramp, and caldera scramble.",
      mobileHint: "Use three lava launch toys.",
    },
    {
      id: "chaos",
      stage: 4,
      title: "File a geothermal incident",
      text: "Build enough cavern chaos for a report that smells faintly like burned toast.",
      target: GOAL_TARGETS.lavaChaos,
      progress: () => Math.floor(state.stageChaos),
      hint: "Mix magma bubble bonks, heat vents, crystals, and zone visits.",
    },
    {
      id: "zones",
      stage: 5,
      title: "Tour the space station",
      text: "Visit four orbital research zones while wearing a camera smaller than the grant budget.",
      target: GOAL_TARGETS.stationZones,
      progress: () => state.zonesVisited.size,
      hint: "Use the radar to map the airlock grid, lab bench, vent maze, and observation window.",
      mobileHint: "Tour the four station zones.",
    },
    {
      id: "scans",
      stage: 5,
      title: "Transmit research scans",
      text: "Use the tiny camera to scan four station landmarks for extremely serious science.",
      target: GOAL_TARGETS.stationScans,
      progress: () => state.stageResearchScans,
      hint: "Find station landmarks. The attached camera scans each one automatically.",
      mobileHint: "Find four station scan landmarks.",
    },
    {
      id: "toys",
      stage: 5,
      title: "Test zero-g gadgets",
      text: "Use three station traversal gadgets. The results are peer-reviewed by a blinking light.",
      target: GOAL_TARGETS.stationToys,
      progress: () => state.toysUsed.size,
      hint: "Ride the mag rail, air vent, zero-g pad, and sample ramp.",
      mobileHint: "Use three station gadgets.",
    },
    {
      id: "chaos",
      stage: 5,
      title: "Become space-grade data",
      text: "Build enough station chaos to finish the research mission and mildly concern orbit control.",
      target: GOAL_TARGETS.stationChaos,
      progress: () => Math.floor(state.stageChaos),
      hint: "Scan, bonk, bounce, and shove data pods until the final report gives up.",
    },
  ];

  const MINI_MISSIONS = [
    { id: "algae", title: "Graze Algae", target: 8, progress: () => state.snacks },
    { id: "bacteria", title: "Bash Bacteria", target: 6, progress: () => state.bacteriaBashed },
    { id: "water", title: "Move Water", target: 3, progress: () => state.waterMoved },
    { id: "ring", title: "Feed Ring", target: 3, progress: () => state.ringFed },
    { id: "combo", title: "Chain 8x Combo", target: 8, progress: () => state.maxCombo },
    { id: "toys", title: "Use Traversal Toys", target: 5, progress: () => state.toysUsed.size },
    { id: "landmarks", title: "Find Landmarks", target: () => HIDDEN_LANDMARKS.length, progress: () => state.landmarksFound.size },
    { id: "zones", title: "Tour Zones", target: () => SANDBOX_ZONES.length, progress: () => state.zonesVisited.size },
  ];

  const STORE_STORAGE_KEY = `${GAME_ID}:micro-store-v1`;
  const STARTER_STORE_GEL = 900;
  const STORE_ITEMS = [
    { id: "skin-classic", name: "Classic Squish", slot: "skin", cost: 0, icon: "CL", ownedDefault: true, description: "Original tan water-bear softness." },
    { id: "skin-mint", name: "Mint Moss Suit", slot: "skin", cost: 450, icon: "MT", description: "Fresh chlorophyll drip for algae royalty." },
    { id: "skin-bubblegum", name: "Bubblegum Blush", slot: "skin", cost: 650, icon: "PK", description: "Pink, shiny, and completely unscientific." },
    { id: "skin-starry", name: "Deep Dish Starcoat", slot: "skin", cost: 850, icon: "ST", description: "Midnight purple with suspicious sparkle energy." },
    { id: "hat-party", name: "Party Cone", slot: "head", cost: 250, icon: "PH", description: "For formal lab accidents." },
    { id: "hat-crown", name: "Tiny Crown", slot: "head", cost: 900, icon: "CR", description: "Announces microscopic authority." },
    { id: "face-goggles", name: "Lab Goggles", slot: "face", cost: 550, icon: "GG", description: "Safety first. Chaos immediately after." },
    { id: "back-flag", name: "Snack Flag", slot: "back", cost: 400, icon: "FL", description: "A flag for claiming moist territory." },
    { id: "back-pizza", name: "Pizza Saddle", slot: "back", cost: 700, icon: "PZ", description: "Extra cheese, extra life choices." },
    { id: "back-rocket", name: "Bottle Rockets", slot: "back", cost: 1100, icon: "RK", description: "Not propulsion. Definitely vibes." },
    { id: "trail-confetti", name: "Confetti Trail", slot: "trail", cost: 600, icon: "CF", description: "Leaves little celebration bits while you scuttle." },
  ];
  const STORE_ITEM_BY_ID = new Map(STORE_ITEMS.map((item) => [item.id, item]));
  const STORE_SKINS = {
    "skin-classic": ["tardigradeBelly", "tardigradeA", "tardigradeA", "tardigradeA", "tardigradeB", "tardigradeB"],
    "skin-mint": ["storeMintLight", "storeMint", "storeMint", "storeMint", "storeMoss", "storeMoss"],
    "skin-bubblegum": ["storePinkLight", "storePink", "storePink", "storePink", "storeBerry", "storeBerry"],
    "skin-starry": ["storeStarLight", "storeStar", "storeStar", "storeStar", "storeNight", "storeNight"],
  };

  function defaultStoreState() {
    return {
      coins: STARTER_STORE_GEL,
      owned: new Set(STORE_ITEMS.filter((item) => item.ownedDefault).map((item) => item.id)),
      equipped: { skin: "skin-classic", head: "", face: "", back: "", trail: "" },
      open: false,
      wasPaused: false,
      trailTimer: 0,
    };
  }

  function loadStoreState() {
    const defaults = defaultStoreState();
    try {
      const raw = window.localStorage && window.localStorage.getItem(STORE_STORAGE_KEY);
      if (!raw) return defaults;
      const saved = JSON.parse(raw);
      const owned = new Set(Array.isArray(saved.owned) ? saved.owned.filter((id) => STORE_ITEM_BY_ID.has(id)) : []);
      STORE_ITEMS.forEach((item) => {
        if (item.ownedDefault) owned.add(item.id);
      });
      const equipped = { ...defaults.equipped, ...(saved.equipped || {}) };
      Object.keys(equipped).forEach((slot) => {
        if (equipped[slot] && !owned.has(equipped[slot])) equipped[slot] = slot === "skin" ? "skin-classic" : "";
      });
      return {
        ...defaults,
        coins: Number.isFinite(saved.coins) ? Math.max(0, Math.floor(saved.coins)) : defaults.coins,
        owned,
        equipped,
      };
    } catch (error) {
      return defaults;
    }
  }

  const $ = (id) => document.getElementById(id);
  const canvas = $("gameCanvas");
  const el = {
    overlay: $("overlay"),
    overlayTitle: $("overlay-title"),
    overlaySub: $("overlay-sub"),
    overlayScore: $("overlay-score"),
    primary: $("btn-primary"),
    pause: $("btn-pause"),
    restart: $("btn-restart"),
    store: $("btn-store"),
    storeModal: $("micro-store"),
    storeItems: $("store-items"),
    storeWallet: $("store-wallet"),
    storeWalletChip: $("store-wallet-chip"),
    storeClose: $("btn-store-close"),
    forward: $("btn-forward"),
    back: $("btn-back"),
    left: $("btn-left"),
    right: $("btn-right"),
    jump: $("btn-jump"),
    dash: $("btn-dash"),
    curl: $("btn-curl"),
    touchStick: $("touch-stick"),
    touchStickKnob: $("touch-stick-knob"),
    sound: $("btn-sound"),
    chaos: $("hud-chaos"),
    snacks: $("hud-snacks"),
    hydrate: $("hud-hydrate"),
    combo: $("hud-combo"),
    time: $("hud-time"),
    goal: $("hud-goal"),
    high: $("hud-high"),
    objectiveTitle: $("objective-title"),
    objectiveText: $("objective-text"),
    prompt: $("micro-prompt"),
    dashStatus: $("status-dash"),
    ringStatus: $("status-ring"),
    zoneStatus: $("status-zone"),
    levelStatus: $("status-level"),
    goalCardTitle: $("goal-card-title"),
    goalCardText: $("goal-card-text"),
    goalCardProgress: $("goal-card-progress"),
    labLog: $("lab-log"),
    meterHydrate: $("meter-hydrate"),
    meterHydrateText: $("meter-hydrate-text"),
    meterDash: $("meter-dash"),
    meterDashText: $("meter-dash-text"),
    meterGoal: $("meter-goal"),
    meterGoalText: $("meter-goal-text"),
    arcadeScore: $("arcade-score"),
    arcadeDelta: $("arcade-delta"),
    arcadeLevel: $("arcade-level"),
    arcadeXp: $("arcade-xp"),
    arcadeXpText: $("arcade-xp-text"),
    arcadePhysics: $("arcade-physics"),
    playMeterHydrate: $("play-meter-hydrate"),
    playMeterHydrateText: $("play-meter-hydrate-text"),
    playMeterDash: $("play-meter-dash"),
    playMeterDashText: $("play-meter-dash-text"),
    playMeterGoal: $("play-meter-goal"),
    playMeterGoalText: $("play-meter-goal-text"),
    radar: $("micro-radar"),
    radarPlayer: $("radar-player"),
    radarRing: $("radar-ring"),
    radarGoal: $("radar-goal"),
    radarToy: $("radar-toy"),
    radarLandmark: $("radar-landmark"),
    radarDistance: $("radar-distance"),
    targetMarker: $("micro-target-marker"),
    targetMarkerTitle: $("target-marker-title"),
    targetMarkerDistance: $("target-marker-distance"),
    advance: $("btn-advance-stage"),
    missionAlgae: $("mission-algae"),
    missionBacteria: $("mission-bacteria"),
    missionWater: $("mission-water"),
    missionRing: $("mission-ring"),
    missionCombo: $("mission-combo"),
    missionZones: $("mission-zones"),
    missionElements: document.querySelectorAll("[data-mission]"),
    callout: $("micro-callout"),
    calloutTitle: $("micro-callout-title"),
    calloutSub: $("micro-callout-sub"),
  };

  const api = typeof RB !== "undefined"
    ? RB
    : {
        toast: () => {},
        recordScore: () => false,
        getHighScore: () => 0,
      };

  const state = {
    ready: false,
    running: false,
    paused: false,
    gameOver: false,
    lastTime: 0,
    clock: 0,
    sessionTime: 0,
    chaos: 0,
    snacks: 0,
    bonks: 0,
    ringFed: 0,
    bacteriaBashed: 0,
    waterMoved: 0,
    propsBroken: 0,
    combo: 0,
    comboTimer: 0,
    lastComboAction: "",
    scoreDelta: 0,
    scoreDeltaTimer: 0,
    calloutTimer: 0,
    tipTimer: 0,
    hydrate: 100,
    stage: 1,
    level: 1,
    xp: 0,
    goalIndex: 0,
    promptTimer: 5,
    dashCooldown: 0,
    dashPulse: 0,
    maxCombo: 0,
    goalsCleared: 0,
    stageChaos: 0,
    stageBonks: 0,
    stageHazards: 0,
    stageCollects: 0,
    stageResearchScans: 0,
    stageAdvanceAvailable: false,
    pendingStage: 0,
    researchCameraUnlocked: false,
    zoneId: "",
    zoneName: "Petri Dish",
    zonesVisited: new Set(),
    miniComplete: new Set(),
    toysUsed: new Set(),
    landmarksFound: new Set(),
    qaToyIndex: 0,
    qaLandmarkIndex: 0,
    desiccationActive: false,
    curlHeld: false,
    reducedMotion: window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    store: loadStoreState(),
    player: {
      x: 0,
      y: GROUND_Y,
      z: 8,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: 0,
      targetYaw: 0,
      grounded: true,
      wobble: 0,
    },
    camera: {
      yaw: 0.45,
      pitch: 0.48,
      targetYaw: 0.45,
      targetPitch: 0.48,
      mouseLook: false,
    },
    input: {
      forward: 0,
      right: 0,
      virtualForward: 0,
      virtualRight: 0,
      keyboardCurl: false,
      virtualCurl: false,
    },
  };
  const saveSlot = window.RBGameSaves && window.RBGameSaves.create(GAME_ID, { version: 1 });
  let saveMenu = null;

  const world = {
    renderer: null,
    scene: null,
    camera: null,
    resizeObserver: null,
    materials: {},
    tardigrade: null,
    bodySegments: [],
    legs: [],
    feelers: [],
    props: [],
    creatures: [],
    drift: [],
    effects: [],
    atmosphere: [],
    zones: [],
    traversalToys: [],
    landmarks: [],
    cosmeticRoot: null,
    stageRoot: null,
    ring: null,
    ringCore: null,
    guide: null,
    boundary: null,
    petri: null,
    terrain: null,
    researchCamera: null,
    physics: {
      RAPIER: null,
      world: null,
      ready: false,
      failed: false,
      accumulator: 0,
      fixedStep: 1 / 60,
      boundaryBodies: [],
    },
  };

  const audio = {
    ctx: null,
    enabled: true,
    unlocked: false,
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (items) => items[Math.floor(Math.random() * items.length)];
  const percent = (value) => Math.round(clamp(value, 0, 100)) + "%";
  const format = (value) => Math.floor(value).toLocaleString();
  const formatTime = (seconds) => {
    const safeSeconds = Math.max(0, Math.ceil(seconds));
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = safeSeconds % 60;
    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  };

  function cloneLevelEntries(entries) {
    return entries.map((entry) => ({ ...entry }));
  }

  function cloneStarterProps(entries) {
    return entries.map(([type, point]) => [type, { ...point }]);
  }

  function levelConfig(stage = state.stage || 1) {
    return LEVEL_CONFIGS[stage] || LEVEL_CONFIGS[1];
  }

  function playableRadius(stage = state.stage || 1) {
    return levelConfig(stage).radius;
  }

  function playableHalfSize(stage = state.stage || 1) {
    const config = levelConfig(stage);
    return config.halfSize || config.radius;
  }

  function playableArea(stage = state.stage || 1) {
    const config = levelConfig(stage);
    if (config.shape === "square") return Math.pow(playableHalfSize(stage) * 2, 2);
    return Math.PI * config.radius * config.radius;
  }

  function levelAreaRatio(stage = 2) {
    return playableArea(stage) / playableArea(1);
  }

  function pointInsidePlayable(x, z, margin = 0) {
    if (levelConfig().shape === "square") {
      const limit = playableHalfSize() - margin;
      return Math.abs(x) <= limit && Math.abs(z) <= limit;
    }
    return Math.hypot(x, z) <= playableRadius() - margin;
  }

  function constrainPointToPlayable(x, z, margin = 0) {
    if (levelConfig().shape === "square") {
      const limit = playableHalfSize() - margin;
      const clampedX = clamp(x, -limit, limit);
      const clampedZ = clamp(z, -limit, limit);
      if (clampedX === x && clampedZ === z) {
        return { x, z, nx: 0, nz: 0, clamped: false };
      }
      let nx = x < -limit ? -1 : x > limit ? 1 : 0;
      let nz = z < -limit ? -1 : z > limit ? 1 : 0;
      const normalLength = Math.hypot(nx, nz) || 1;
      nx /= normalLength;
      nz /= normalLength;
      return { x: clampedX, z: clampedZ, nx, nz, clamped: true };
    }

    const limit = playableRadius() - margin;
    const distance = Math.hypot(x, z);
    if (distance <= limit) return { x, z, nx: 0, nz: 0, clamped: false };
    const nx = distance > 0.001 ? x / distance : 1;
    const nz = distance > 0.001 ? z / distance : 0;
    return { x: nx * limit, z: nz * limit, nx, nz, clamped: true };
  }

  function resetArray(target, entries) {
    target.splice(0, target.length, ...cloneLevelEntries(entries));
  }

  function applyLevelConfig(stage) {
    const config = levelConfig(stage);
    Object.assign(RING_TARGET, config.ring);
    resetArray(SANDBOX_ZONES, config.zones);
    resetArray(HIDDEN_LANDMARKS, config.landmarks);
    resetArray(TRAVERSAL_TOYS, config.toys);
    resetArray(CREATURE_ROUTES, config.creatures);
    STARTER_PROPS.splice(0, STARTER_PROPS.length, ...cloneStarterProps(config.starterProps));
  }

  function targetValue(item) {
    if (!item) return 0;
    return typeof item.target === "function" ? item.target() : item.target;
  }

  function currentStageGoals() {
    return GOALS.filter((goal) => goal.stage === state.stage);
  }

  function nextStageNumber(stage = state.stage) {
    for (let next = stage + 1; next <= FINAL_STAGE; next += 1) {
      if (LEVEL_CONFIGS[next]) return next;
    }
    return 0;
  }

  function requiredStageGoalCount(stage = state.stage) {
    return levelConfig(stage).requiredGoals || GOALS.filter((goal) => goal.stage === stage).length;
  }

  function firstGoalIndexForStage(stage) {
    return GOALS.findIndex((goal) => goal.stage === stage);
  }

  function stageAdvanceGoal() {
    const config = levelConfig();
    return {
      id: "advance",
      stage: state.stage,
      title: config.advanceTitle || "Research path unlocked",
      text: config.advanceText || "The next research environment is ready when you are.",
      target: 1,
      progress: () => 1,
      hint: `${config.advanceText || "The next research environment is ready."} Press the continue research button when ready.`,
      mobileHint: `${config.advanceText || "The next research environment is ready."} Tap continue research when ready.`,
    };
  }

  function activeGoal() {
    return state.stageAdvanceAvailable ? stageAdvanceGoal() : (GOALS[state.goalIndex] || GOALS[GOALS.length - 1]);
  }

  function currentStageGoalOrdinal() {
    if (state.stageAdvanceAvailable) return currentStageGoals().length;
    const goals = currentStageGoals();
    const current = GOALS[state.goalIndex];
    const index = goals.findIndex((goal) => goal === current);
    return index >= 0 ? index + 1 : goals.length;
  }

  function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // ===========================================================================
  // PROCEDURAL TERRAIN (Perlin noise)
  // ===========================================================================
  // Each level's ground is ONE continuous, highly subdivided mesh. We push its
  // vertices up and down to sculpt hills, valleys, plateaus and cliffs. The height
  // at any world point (x, z) is decided here using layered Perlin noise, so the
  // landscape looks natural and is repeatable (same seed -> same world) instead of
  // being faked with separate rocks or blocks placed on a flat plane.

  // Build a seeded 2D Perlin-noise function. Returns noise(x, z) in roughly [-1, 1].
  function makePerlinNoise(seed) {
    // The permutation table is the heart of Perlin noise: the values 0..255 in a
    // shuffled order. We shuffle deterministically from `seed` so every level gets
    // its own repeatable terrain.
    const perm = new Uint8Array(512);
    const table = new Uint8Array(256);
    for (let i = 0; i < 256; i++) table[i] = i;
    let s = (seed >>> 0) || 1;
    const random = () => {
      // mulberry32 - a tiny, fast, seeded pseudo-random generator.
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const tmp = table[i];
      table[i] = table[j];
      table[j] = tmp;
    }
    for (let i = 0; i < 512; i++) perm[i] = table[i & 255];

    // Smootherstep easing (Perlin's improved curve) for soft, kink-free blending.
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    // Turn a hashed grid corner into one of 8 gradient directions, dotted with the
    // offset to that corner. This is what makes the noise smooth and wavy.
    const grad = (hash, x, z) => {
      switch (hash & 7) {
        case 0: return x + z;
        case 1: return x - z;
        case 2: return -x + z;
        case 3: return -x - z;
        case 4: return x;
        case 5: return -x;
        case 6: return z;
        default: return -z;
      }
    };

    return function noise2D(x, z) {
      // Which grid cell are we in, and where inside that cell (0..1)?
      const xi = Math.floor(x) & 255;
      const zi = Math.floor(z) & 255;
      const xf = x - Math.floor(x);
      const zf = z - Math.floor(z);
      const u = fade(xf);
      const v = fade(zf);
      // Hash the four corners of the cell, then blend their gradients smoothly.
      const aa = perm[perm[xi] + zi];
      const ba = perm[perm[xi + 1] + zi];
      const ab = perm[perm[xi] + zi + 1];
      const bb = perm[perm[xi + 1] + zi + 1];
      const x1 = lerp(grad(aa, xf, zf), grad(ba, xf - 1, zf), u);
      const x2 = lerp(grad(ab, xf, zf - 1), grad(bb, xf - 1, zf - 1), u);
      return lerp(x1, x2, v);
    };
  }

  // Cache one noise field per seed so we don't rebuild the table on every lookup.
  const noiseFields = new Map();
  function noiseField(seed) {
    let field = noiseFields.get(seed);
    if (!field) {
      field = makePerlinNoise(seed);
      noiseFields.set(seed, field);
    }
    return field;
  }

  // Fractal Brownian motion: add several octaves of noise, each one at a higher
  // frequency but lower amplitude. This is what turns smooth blobs into believable
  // rolling hills with finer detail layered on top.
  function fbm(field, x, z, octaves, lacunarity, gain) {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amplitude * field(x * frequency, z * frequency);
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    // Perlin output clusters near zero, so we scale the averaged result to better
    // fill [-1, 1]. Without this, hills and (especially) the cliff mask come out far
    // gentler than the amplitudes suggest, leaving the terrain too flat.
    return norm > 0 ? (sum / norm) * 1.8 : 0;
  }

  // Ridged noise: fold the noise at zero so its crests become sharp ridge lines.
  // Perfect for the rocky spines and jagged mountain edges in the gut/lava worlds.
  function ridgedNoise(field, x, z, octaves) {
    let amplitude = 0.5;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      const peak = 1 - Math.abs(field(x * frequency, z * frequency));
      sum += amplitude * peak * peak;
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return norm > 0 ? sum / norm : 0; // ~0..1, near 1 along the ridge crests
  }

  // Terracing snaps a smooth height into flat steps joined by short, steep risers.
  // Flat treads + steep faces are what read as plateaus, mesas and cliff drop-offs.
  function terrace(value, steps, riser) {
    const scaled = value * steps;
    const step = Math.floor(scaled);
    const frac = scaled - step;
    // Stay flat across most of the step, then climb fast over the last `riser` slice.
    const climb = smoothstep(1 - riser, 1, frac);
    return (step + climb) / steps;
  }

  // Flatten terrain toward the spawn point so the player never starts buried in a
  // hillside; full detail fades back in beyond `calmRadius`.
  function spawnCalm(distance, calmRadius) {
    return lerp(0.34, 1, smoothstep(calmRadius * 0.4, calmRadius, distance));
  }

  // Per-level terrain shaping + colour palette. One spot to dial in each world's
  // character: how tall the hills are, where the cliffs cut in, and the valley ->
  // peak colour ramp that makes elevation easy to read.
  const TERRAIN_PARAMS = {
    petri: {
      seed: 1207,
      hillFreq: 0.016, octaves: 4, lacunarity: 2, gain: 0.5, hillAmp: 3.6,
      cliffFreq: 0.012, cliffSteps: 4, cliffRiser: 0.14, cliffAmp: 3.4,
      maskFreq: 0.01, cliffMaskStart: 0.48,
      rim: 1.8, calmRadius: 30, min: -4.5, max: 8.5,
      slopeColor: 0x9a7942, slopeRef: 0.34,
    },
    aquarium: {
      seed: 2207,
      hillFreq: 0.009, octaves: 5, lacunarity: 2, gain: 0.5, hillAmp: 5.6,
      cliffFreq: 0.0072, cliffSteps: 4, cliffRiser: 0.13, cliffAmp: 5.8,
      maskFreq: 0.006, cliffMaskStart: 0.46,
      channel: -2.6, rim: 5.4, calmRadius: 48, min: -4.8, max: 14.5,
      slopeColor: 0x214f33, slopeRef: 0.46,
    },
    stomach: {
      seed: 3307,
      hillFreq: 0.011, octaves: 4, lacunarity: 2, gain: 0.5, hillAmp: 4.0,
      ridgeFreq: 0.02, ridgeAmp: 2.8,
      cliffFreq: 0.009, cliffSteps: 3, cliffRiser: 0.13, cliffAmp: 5.2,
      maskFreq: 0.007, cliffMaskStart: 0.44,
      channel: -2.8, rim: 4.4, calmRadius: 50, min: -4.5, max: 12.5,
      slopeColor: 0x320f2c, slopeRef: 0.44,
    },
    lava: {
      seed: 4407,
      hillFreq: 0.0105, octaves: 4, lacunarity: 2, gain: 0.5, hillAmp: 4.8,
      ridgeFreq: 0.018, ridgeAmp: 3.6,
      cliffFreq: 0.0085, cliffSteps: 4, cliffRiser: 0.14, cliffAmp: 6.8,
      maskFreq: 0.006, cliffMaskStart: 0.46,
      channel: -3.4, rim: 5.2, calmRadius: 48, min: -5.2, max: 15.5,
      slopeColor: 0x140f10, slopeRef: 0.52,
    },
    station: {
      seed: 5507,
      hillFreq: 0.012, octaves: 3, lacunarity: 2, gain: 0.5, hillAmp: 2.5,
      cliffFreq: 0.009, cliffSteps: 5, cliffRiser: 0.1, cliffAmp: 5.2,
      maskFreq: 0.0075, cliffMaskStart: 0.44,
      channel: -1.5, rim: 2.3, calmRadius: 44, min: -3.2, max: 9.5,
      slopeColor: 0x2a323c, slopeRef: 0.46,
    },
  };

  // Combine smooth hills + optional sharp ridges + terraced cliffs into one height.
  function noiseTerrain(x, z, p) {
    const hillField = noiseField(p.seed);
    const roughField = noiseField(p.seed + 137);

    // (1) Smooth rolling hills from layered Perlin noise.
    let height = fbm(hillField, x * p.hillFreq, z * p.hillFreq, p.octaves, p.lacunarity, p.gain) * p.hillAmp;

    // (2) Optional sharp ridges that read as mountain spines.
    if (p.ridgeAmp) {
      height += (ridgedNoise(roughField, x * p.ridgeFreq, z * p.ridgeFreq, 3) - 0.4) * p.ridgeAmp;
    }

    // (3) Steep cliffs & flat-topped plateaus. We terrace a noise field, then only
    //     reveal it where a slow, separate mask is high - so mesas and drop-offs
    //     punch through some regions while the rest stays gentle rolling hills.
    if (p.cliffAmp) {
      const raw = (fbm(roughField, x * p.cliffFreq, z * p.cliffFreq, 3, 2, 0.5) + 1) * 0.5;
      const stepped = terrace(raw, p.cliffSteps, p.cliffRiser);
      const maskRaw = (fbm(hillField, x * p.maskFreq + 19.7, z * p.maskFreq - 4.3, 2, 2, 0.5) + 1) * 0.5;
      const mask = smoothstep(p.cliffMaskStart, p.cliffMaskStart + 0.22, maskRaw);
      height += (stepped - 0.5) * 2 * p.cliffAmp * mask;
    }

    return height;
  }

  function petriTerrainOffsetAt(x, z, distance = Math.hypot(x, z)) {
    const p = TERRAIN_PARAMS.petri;
    const normalized = distance / LEVEL_ONE_RADIUS;
    // Noise-sculpted hills + cliffs, flattened toward the central spawn clearing.
    const land = noiseTerrain(x, z, p) * spawnCalm(distance, p.calmRadius);
    // The agar meniscus: the ground curls up into a soft wall around the rim.
    const rim = smoothstep(0.72, 1.0, normalized) * p.rim;
    // Ease off just past the playable edge so the rim never clips hard.
    const edgeSoftening = 1 - smoothstep(0.99, 1.12, normalized) * 0.4;
    return clamp(land * edgeSoftening + rim, p.min, p.max);
  }

  function aquariumTerrainOffsetAt(x, z, distance = Math.hypot(x, z)) {
    const p = TERRAIN_PARAMS.aquarium;
    const tankHalf = LEVEL_CONFIGS[2].halfSize;
    const squareDistance = Math.max(Math.abs(x), Math.abs(z));
    const edgeFade = clamp((tankHalf - 6 - squareDistance) / mapRadius(26), 0, 1);
    const land = noiseTerrain(x, z, p) * spawnCalm(distance, p.calmRadius);
    // A sandy channel carved roughly north-to-south across the tank floor.
    const channel =
      Math.exp(-Math.pow((x - mapCoord(2)) / mapRadius(22), 2)) *
      Math.exp(-Math.pow((z + mapCoord(6)) / mapRadius(82), 2)) *
      p.channel;
    // Gravel banks heap up against the glass walls to enclose the playfield.
    const shelf = smoothstep(tankHalf * 0.6, tankHalf * 0.96, squareDistance) * p.rim;
    return clamp((land + channel) * edgeFade + shelf, p.min, p.max);
  }

  function stomachTerrainOffsetAt(x, z, distance = Math.hypot(x, z)) {
    const p = TERRAIN_PARAMS.stomach;
    const radius = LEVEL_CONFIGS[3].radius;
    const normalized = distance / radius;
    const land = noiseTerrain(x, z, p) * spawnCalm(distance, p.calmRadius);
    // A deep peristalsis trough snakes through the stomach floor.
    const channel =
      Math.exp(-Math.pow((x - mapCoord(8)) / mapRadius(20), 2)) *
      Math.exp(-Math.pow(z / mapRadius(82), 2)) *
      p.channel;
    // The stomach wall rears up steeply at the rim.
    const wall = smoothstep(0.7, 0.99, normalized) * p.rim;
    return clamp(land + channel + wall, p.min, p.max);
  }

  function lavaTerrainOffsetAt(x, z, distance = Math.hypot(x, z)) {
    const p = TERRAIN_PARAMS.lava;
    const radius = LEVEL_CONFIGS[4].radius;
    const normalized = distance / radius;
    const land = noiseTerrain(x, z, p) * spawnCalm(distance, p.calmRadius);
    // A glowing lava canyon cuts a deep channel through the rock.
    const river =
      Math.exp(-Math.pow((x - mapCoord(28)) / mapRadius(20), 2)) *
      Math.exp(-Math.pow((z - mapCoord(5)) / mapRadius(80), 2)) *
      p.channel;
    const rim = smoothstep(0.74, 0.99, normalized) * p.rim;
    return clamp(land + river + rim, p.min, p.max);
  }

  function stationTerrainOffsetAt(x, z) {
    const p = TERRAIN_PARAMS.station;
    const half = LEVEL_CONFIGS[5].halfSize;
    const distance = Math.hypot(x, z);
    const squareDistance = Math.max(Math.abs(x), Math.abs(z));
    const edgeFade = clamp((half - 5 - squareDistance) / mapRadius(20), 0, 1);
    const land = noiseTerrain(x, z, p) * spawnCalm(distance, p.calmRadius);
    // A recessed mag-rail groove runs down the station's central axis.
    const groove =
      Math.exp(-Math.pow(z / mapRadius(20), 2)) *
      Math.exp(-Math.pow(x / mapRadius(96), 2)) *
      p.channel;
    const rim = smoothstep(half * 0.78, half * 0.97, squareDistance) * p.rim;
    return clamp((land + groove) * edgeFade + rim, p.min, p.max);
  }

  function terrainOffsetAt(x, z) {
    const distance = Math.hypot(x, z);
    const id = levelConfig().id;
    if (id === "petri") return petriTerrainOffsetAt(x, z, distance);
    if (id === "aquarium") return aquariumTerrainOffsetAt(x, z, distance);
    if (id === "stomach") return stomachTerrainOffsetAt(x, z, distance);
    if (id === "lava") return lavaTerrainOffsetAt(x, z, distance);
    if (id === "station") return stationTerrainOffsetAt(x, z);
    const petri = petriTerrainOffsetAt(x, z, distance);
    const aquarium = aquariumTerrainOffsetAt(x, z, distance);
    const blend = smoothstep(LEVEL_ONE_RADIUS - 8, LEVEL_ONE_RADIUS + 20, distance);
    return lerp(petri, aquarium, blend);
  }

  function groundYAt(x, z) {
    return GROUND_Y + terrainOffsetAt(x, z);
  }

  function terrainVisualYAt(x, z) {
    return groundYAt(x, z) - TERRAIN_VISUAL_OFFSET;
  }

  function bootThree() {
    initThree().catch((error) => {
      console.error(error);
      fatal("The microscope failed to boot. Reload to reseat the slide.");
    });
  }

  function loadThree(index = 0) {
    if (window.THREE) {
      bootThree();
      return;
    }
    if (index >= THREE_CDNS.length) {
      fatal("Three.js could not load. The microscope stayed dark.");
      return;
    }
    const script = document.createElement("script");
    script.src = THREE_CDNS[index];
    script.onload = () => (window.THREE ? bootThree() : loadThree(index + 1));
    script.onerror = () => loadThree(index + 1);
    document.head.appendChild(script);
  }

  function fatal(message) {
    showOverlay("MICROSCOPE OFFLINE", message, "Retry");
    el.primary.onclick = () => location.reload();
  }

  async function initThree() {
    const THREE = window.THREE;
    state.ready = true;

    world.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    world.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    world.renderer.setClearColor(0x057eb7, 1);
    world.renderer.outputEncoding = THREE.sRGBEncoding;
    if (THREE.ACESFilmicToneMapping) {
      world.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      world.renderer.toneMappingExposure = 0.62;
    }
    world.renderer.shadowMap.enabled = true;
    world.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    world.scene = new THREE.Scene();
    world.scene.fog = new THREE.FogExp2(0x078ec8, 0.00155);
    world.camera = new THREE.PerspectiveCamera(64, 960 / 620, 0.1, Math.max(430, WORLD_RADIUS * 2.35));

    buildMaterials();
    applyAssetTextures();
    buildScene();
    await initPhysics();
    bindInputs();
    resetGame(false);
    resize();
    updateHUD();
    syncStoreUi();

    world.resizeObserver = new ResizeObserver(resize);
    world.resizeObserver.observe(canvas.parentElement || canvas);
    window.addEventListener("resize", resize);
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      showOverlay("MICROSCOPE LOST FOCUS", "The WebGL context dropped. Reload to restore the dish.", "Reload");
      el.primary.onclick = () => location.reload();
    });
    requestAnimationFrame(loop);
  }

  function buildMaterials() {
    const THREE = window.THREE;
    const mat = (color, options = {}) => new THREE.MeshStandardMaterial({
      color,
      roughness: options.roughness ?? 0.72,
      metalness: options.metalness ?? 0.06,
      emissive: options.emissive ?? 0x000000,
      emissiveIntensity: options.emissiveIntensity ?? 0.45,
      transparent: options.transparent ?? false,
      opacity: options.opacity ?? 1,
      depthWrite: options.depthWrite ?? true,
      flatShading: true,
    });
    const basic = (color, options = {}) => new THREE.MeshBasicMaterial({
      color,
      transparent: options.transparent ?? true,
      opacity: options.opacity ?? 0.55,
      depthWrite: options.depthWrite ?? false,
      fog: options.fog ?? true,
      side: options.side ?? THREE.DoubleSide,
    });

    world.materials = {
      dish: mat(0x63bf1f, { roughness: 0.9, metalness: 0.01, emissive: 0x092402, emissiveIntensity: 0.05 }),
      dishDark: mat(0x046f9d, { roughness: 0.74, metalness: 0.02, emissive: 0x011e31, emissiveIntensity: 0.14 }),
      agarBase: mat(0xf0cf87, { roughness: 0.94, metalness: 0.01, emissive: 0x2e2007, emissiveIntensity: 0.09 }),
      agarEdge: mat(0xffe3a7, { roughness: 0.76, metalness: 0.02, emissive: 0x3b2808, emissiveIntensity: 0.12, transparent: true, opacity: 0.7 }),
      glass: mat(0xc8f8ff, { roughness: 0.16, metalness: 0.02, emissive: 0x0c6a8d, emissiveIntensity: 0.22, transparent: true, opacity: 0.28, depthWrite: false }),
      gravel: mat(0xc9a77a, { roughness: 0.96, metalness: 0.02, emissive: 0x1f1204, emissiveIntensity: 0.05 }),
      cliff: mat(0x65553e, { roughness: 0.94, metalness: 0.02, emissive: 0x0e0903, emissiveIntensity: 0.03 }),
      grassLight: mat(0x8ed927, { roughness: 0.86, metalness: 0.01, emissive: 0x123b00, emissiveIntensity: 0.08 }),
      terrain: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.9,
        metalness: 0.01,
        emissive: 0x000000,
        emissiveIntensity: 0.02,
        fog: true,
        side: THREE.DoubleSide,
        flatShading: true,
      }),
      water: mat(0x28b9ee, { roughness: 0.34, metalness: 0.02, emissive: 0x043957, emissiveIntensity: 0.32, transparent: true, opacity: 0.56, depthWrite: false }),
      ring: mat(0xffd43b, { emissive: 0x6b4d00, emissiveIntensity: 0.8 }),
      ringCore: mat(0x6bff7d, { emissive: 0x164f20, transparent: true, opacity: 0.48 }),
      guide: mat(0xfff05a, { emissive: 0xff5c9f, emissiveIntensity: 1.1, transparent: true, opacity: 0.78 }),
      guideCore: mat(0xd883ff, { emissive: 0x8c1aff, emissiveIntensity: 1.25, transparent: true, opacity: 0.62 }),
      ramp: mat(0xd5b267, { roughness: 0.8, metalness: 0.02, emissive: 0x4f3509, emissiveIntensity: 0.18 }),
      rampStripe: mat(0xffd43b, { emissive: 0x6b4d00, emissiveIntensity: 0.6 }),
      jumpPad: mat(0x37c8ff, { emissive: 0x0b5d8f, emissiveIntensity: 0.7 }),
      jumpPadCore: mat(0xd883ff, { emissive: 0x7a24b8, emissiveIntensity: 0.92 }),
      geyser: mat(0xb9f4ff, { emissive: 0x15769b, emissiveIntensity: 0.72, transparent: true, opacity: 0.62, depthWrite: false }),
      ridgeStep: mat(0x8ec34a, { roughness: 0.86, metalness: 0.02, emissive: 0x243d08, emissiveIntensity: 0.22 }),
      landmark: mat(0xf8fbff, { emissive: 0x4b9bd9, emissiveIntensity: 0.6 }),
      landmarkGlow: mat(0xffd43b, { emissive: 0xff9d2e, emissiveIntensity: 1.1, transparent: true, opacity: 0.72 }),
      zoneForest: mat(0x5fbe27, { emissive: 0x1b5a0b, emissiveIntensity: 0.32, transparent: true, opacity: 0.58 }),
      zoneFlats: mat(0x36c8f4, { emissive: 0x0a668d, emissiveIntensity: 0.38, transparent: true, opacity: 0.52 }),
      zoneReef: mat(0xffa83d, { emissive: 0x803005, emissiveIntensity: 0.36, transparent: true, opacity: 0.54 }),
      zoneRidge: mat(0xb9e34a, { emissive: 0x425608, emissiveIntensity: 0.32, transparent: true, opacity: 0.52 }),
      zoneAgar: mat(0xf4d58c, { emissive: 0x4a3107, emissiveIntensity: 0.28, transparent: true, opacity: 0.5 }),
      zonePetriAlgae: mat(0x87d84a, { emissive: 0x1e5a0c, emissiveIntensity: 0.3, transparent: true, opacity: 0.52 }),
      zonePetriWater: mat(0x65d5ff, { emissive: 0x0b668f, emissiveIntensity: 0.34, transparent: true, opacity: 0.48 }),
      zonePetriBacteria: mat(0xff9d45, { emissive: 0x713006, emissiveIntensity: 0.32, transparent: true, opacity: 0.5 }),
      zoneStomachPink: mat(0xff7aa8, { emissive: 0x61102e, emissiveIntensity: 0.34, transparent: true, opacity: 0.5 }),
      zoneStomachGold: mat(0xffb34d, { emissive: 0x6b3000, emissiveIntensity: 0.38, transparent: true, opacity: 0.5 }),
      zoneStomachPurple: mat(0xd883ff, { emissive: 0x4a166a, emissiveIntensity: 0.34, transparent: true, opacity: 0.48 }),
      zoneStomachMint: mat(0x53ead1, { emissive: 0x0b4d45, emissiveIntensity: 0.34, transparent: true, opacity: 0.48 }),
      zoneLavaBasalt: mat(0x6f7488, { emissive: 0x11131b, emissiveIntensity: 0.22, transparent: true, opacity: 0.5 }),
      zoneLavaRiver: mat(0xff5a2f, { emissive: 0x9a1600, emissiveIntensity: 0.72, transparent: true, opacity: 0.52 }),
      zoneLavaSteam: mat(0xffd43b, { emissive: 0x6b4d00, emissiveIntensity: 0.5, transparent: true, opacity: 0.48 }),
      zoneLavaCrystal: mat(0xd883ff, { emissive: 0x4d1978, emissiveIntensity: 0.44, transparent: true, opacity: 0.5 }),
      zoneStationCyan: mat(0x53ead1, { emissive: 0x0d5a50, emissiveIntensity: 0.42, transparent: true, opacity: 0.42 }),
      zoneStationWhite: mat(0xf8fbff, { emissive: 0x526578, emissiveIntensity: 0.24, transparent: true, opacity: 0.38 }),
      zoneStationGold: mat(0xffd43b, { emissive: 0x6b4d00, emissiveIntensity: 0.4, transparent: true, opacity: 0.44 }),
      zoneStationViolet: mat(0x8c6bff, { emissive: 0x281568, emissiveIntensity: 0.44, transparent: true, opacity: 0.42 }),
      tardigradeA: mat(0xcaa36f, { roughness: 0.64 }),
      tardigradeB: mat(0xa8784d, { roughness: 0.7 }),
      tardigradeBelly: mat(0xe6c89d, { roughness: 0.68 }),
      tardigradePlate: mat(0xd9b983, { roughness: 0.58, emissive: 0x261704, emissiveIntensity: 0.08 }),
      tardigradeStripe: mat(0x8c603e, { roughness: 0.74, emissive: 0x140905, emissiveIntensity: 0.04 }),
      tardigradeMuzzle: mat(0xe8c592, { roughness: 0.66, emissive: 0x261704, emissiveIntensity: 0.05 }),
      oralRing: mat(0xb98658, { roughness: 0.72, emissive: 0x241004, emissiveIntensity: 0.08 }),
      mouthDark: mat(0x432312, { roughness: 0.68, emissive: 0x150704, emissiveIntensity: 0.08 }),
      claw: mat(0xf7fbff, { roughness: 0.52 }),
      eye: mat(0x05070d, { roughness: 0.4 }),
      eyeGlint: mat(0xf8fbff, { roughness: 0.25, emissive: 0x90eaff, emissiveIntensity: 0.45 }),
      storeMintLight: mat(0xd5ffd0, { roughness: 0.64, emissive: 0x153b0a, emissiveIntensity: 0.12 }),
      storeMint: mat(0x7be85d, { roughness: 0.62, emissive: 0x16450b, emissiveIntensity: 0.16 }),
      storeMoss: mat(0x3f9f42, { roughness: 0.72, emissive: 0x0c2f08, emissiveIntensity: 0.14 }),
      storePinkLight: mat(0xffd2e7, { roughness: 0.6, emissive: 0x4f1430, emissiveIntensity: 0.12 }),
      storePink: mat(0xff7abf, { roughness: 0.62, emissive: 0x5b163b, emissiveIntensity: 0.18 }),
      storeBerry: mat(0xc84c9f, { roughness: 0.68, emissive: 0x3b0d2d, emissiveIntensity: 0.2 }),
      storeStarLight: mat(0x9edcff, { roughness: 0.54, emissive: 0x0f4865, emissiveIntensity: 0.24 }),
      storeStar: mat(0x635bff, { roughness: 0.58, emissive: 0x15106a, emissiveIntensity: 0.32 }),
      storeNight: mat(0x231b64, { roughness: 0.66, emissive: 0x09062c, emissiveIntensity: 0.36 }),
      storeGold: mat(0xffd43b, { roughness: 0.42, metalness: 0.12, emissive: 0x6b4d00, emissiveIntensity: 0.55 }),
      storeRed: mat(0xff5a57, { roughness: 0.58, emissive: 0x5f120f, emissiveIntensity: 0.3 }),
      storeHotPink: mat(0xff3aa7, { roughness: 0.56, emissive: 0x5a0f3d, emissiveIntensity: 0.34 }),
      storeRocket: mat(0x5f6d7e, { roughness: 0.48, metalness: 0.18, emissive: 0x0d1520, emissiveIntensity: 0.18 }),
      storeFlag: mat(0x37c8ff, { roughness: 0.54, emissive: 0x0b5d8f, emissiveIntensity: 0.42 }),
      storePizza: mat(0xffc95c, { roughness: 0.74, emissive: 0x6b3900, emissiveIntensity: 0.22 }),
      storeTrail: mat(0xf8fbff, { roughness: 0.4, emissive: 0xff5c9f, emissiveIntensity: 0.7 }),
      algae: mat(0x5bd924, { emissive: 0x123e08, emissiveIntensity: 0.38 }),
      pollen: mat(0xffd43b, { emissive: 0x4e3700, emissiveIntensity: 0.58 }),
      cell: mat(0xff5c9f, { emissive: 0x56152f, emissiveIntensity: 0.45 }),
      bubble: mat(0xc8f8ff, { emissive: 0x075f86, emissiveIntensity: 0.42, transparent: true, opacity: 0.38, depthWrite: false }),
      crystal: mat(0x9f8cff, { emissive: 0x2c186b, emissiveIntensity: 0.48 }),
      bacteria: mat(0xff9d2e, { emissive: 0x642600, emissiveIntensity: 0.72 }),
      bacteriaDark: mat(0x8f3a1f, { roughness: 0.78 }),
      droplet: mat(0x37c8ff, { emissive: 0x0b5d8f, emissiveIntensity: 0.5, transparent: true, opacity: 0.72, depthWrite: false }),
      capsulePink: mat(0xff5c9f, { emissive: 0x5c1433, emissiveIntensity: 0.55 }),
      capsuleBlue: mat(0x53ead1, { emissive: 0x0f4c44, emissiveIntensity: 0.45 }),
      enzyme: mat(0xd883ff, { emissive: 0x4d1978, emissiveIntensity: 0.64 }),
      platelet: mat(0xff6b5a, { emissive: 0x4f150f, emissiveIntensity: 0.42 }),
      spore: mat(0xa5ff4f, { emissive: 0x285609, emissiveIntensity: 0.58 }),
      foodbit: mat(0xffc66d, { roughness: 0.82, emissive: 0x5f2d00, emissiveIntensity: 0.3 }),
      digestiveBubble: mat(0xb2ff5f, { emissive: 0x2e7000, emissiveIntensity: 0.7, transparent: true, opacity: 0.66, depthWrite: false }),
      magmaBubble: mat(0xff4a21, { roughness: 0.45, emissive: 0xff2400, emissiveIntensity: 1.08 }),
      ashCrystal: mat(0xb7a6ff, { roughness: 0.5, emissive: 0x3d1f8c, emissiveIntensity: 0.55 }),
      dataChip: mat(0x5ff8ff, { roughness: 0.42, metalness: 0.18, emissive: 0x0a6370, emissiveIntensity: 0.62 }),
      toolpod: mat(0xd9e4f2, { roughness: 0.46, metalness: 0.14, emissive: 0x283747, emissiveIntensity: 0.24 }),
      shard: mat(0xf8fbff, { emissive: 0x6a4a10, emissiveIntensity: 0.32 }),
      fiberA: mat(0x2f9710, { emissive: 0x0b2d03, emissiveIntensity: 0.24 }),
      fiberB: mat(0xf136a8, { emissive: 0x4c0d31, emissiveIntensity: 0.25 }),
      coralPink: mat(0xf035ad, { emissive: 0x5c0d3d, emissiveIntensity: 0.3 }),
      coralPurple: mat(0x9465ff, { emissive: 0x291268, emissiveIntensity: 0.26 }),
      coralGreen: mat(0x61bf1f, { emissive: 0x143c05, emissiveIntensity: 0.22 }),
      coralOrange: mat(0xff9a2f, { emissive: 0x6b2600, emissiveIntensity: 0.3 }),
      coralYellow: mat(0xffe34d, { emissive: 0x5c4900, emissiveIntensity: 0.34 }),
      coralTeal: mat(0x27d9b3, { emissive: 0x064c41, emissiveIntensity: 0.3 }),
      flowerPetal: mat(0xff8fd5, { emissive: 0x561236, emissiveIntensity: 0.22 }),
      shadow: mat(0x041014, { roughness: 1 }),
      white: mat(0xf7fbff, { roughness: 0.5 }),
      caustic: basic(0xf1ffb7, { opacity: 0.12, fog: false }),
      mist: basic(0xbdf4ff, { opacity: 0.12, fog: false }),
      labWall: mat(0xe8eef2, { roughness: 0.92, metalness: 0.01, emissive: 0x35434c, emissiveIntensity: 0.05 }),
      labCounter: mat(0xc7dde4, { roughness: 0.88, metalness: 0.03, emissive: 0x20373d, emissiveIntensity: 0.08 }),
      labMetal: mat(0x8d9aa5, { roughness: 0.5, metalness: 0.22, emissive: 0x101820, emissiveIntensity: 0.08 }),
      labGlass: mat(0xbfefff, { roughness: 0.16, metalness: 0.02, emissive: 0x2b6f89, emissiveIntensity: 0.18, transparent: true, opacity: 0.38, depthWrite: false }),
      roomWall: mat(0xd7b88f, { roughness: 0.92, metalness: 0.01, emissive: 0x2d190a, emissiveIntensity: 0.08 }),
      roomFloor: mat(0x8f5d34, { roughness: 0.86, metalness: 0.02, emissive: 0x1f0d04, emissiveIntensity: 0.08 }),
      couch: mat(0x426f98, { roughness: 0.82, metalness: 0.01, emissive: 0x071f33, emissiveIntensity: 0.1 }),
      furnitureWood: mat(0x6f3f22, { roughness: 0.8, metalness: 0.02, emissive: 0x1a0902, emissiveIntensity: 0.08 }),
      lampShade: mat(0xffe0a0, { roughness: 0.72, metalness: 0.01, emissive: 0x6c450d, emissiveIntensity: 0.38 }),
      backdropBlue: mat(0x1779b9, { roughness: 0.86, metalness: 0.01, emissive: 0x06395a, emissiveIntensity: 0.18 }),
      backdropGreen: mat(0x4da52c, { roughness: 0.88, metalness: 0.01, emissive: 0x143807, emissiveIntensity: 0.14 }),
      backdropPurple: mat(0x8d78d9, { roughness: 0.84, metalness: 0.02, emissive: 0x26184f, emissiveIntensity: 0.18 }),
      creatureA: mat(0xffd19a, { roughness: 0.6, emissive: 0x4d2408, emissiveIntensity: 0.16 }),
      creatureB: mat(0x53ead1, { roughness: 0.5, emissive: 0x0b4d45, emissiveIntensity: 0.36 }),
      creatureC: mat(0xd883ff, { roughness: 0.55, emissive: 0x411260, emissiveIntensity: 0.32 }),
      creatureFin: mat(0xf8fbff, { roughness: 0.36, transparent: true, opacity: 0.66, depthWrite: false }),
      cameraBody: mat(0x1d2533, { roughness: 0.45, metalness: 0.18, emissive: 0x0a1018, emissiveIntensity: 0.18 }),
      cameraLens: mat(0x53ead1, { roughness: 0.22, metalness: 0.08, emissive: 0x0a5d55, emissiveIntensity: 0.85 }),
    };
  }

  function applyAssetTextures() {
    const THREE = window.THREE;
    const loader = new THREE.TextureLoader();
    const applyTexture = (materialName, url, repeatX, repeatY) => {
      const material = world.materials[materialName];
      if (!material) return;
      loader.load(
        url,
        (texture) => {
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.repeat.set(repeatX, repeatY);
          texture.encoding = THREE.sRGBEncoding;
          material.map = texture;
          material.needsUpdate = true;
        },
        undefined,
        () => {}
      );
    };

    applyTexture("dish", TEXTURE_ASSETS.floor, 8 * MAP_LINEAR_SCALE, 8 * MAP_LINEAR_SCALE);
    applyTexture("agarBase", TEXTURE_ASSETS.floor, 5, 5);
    applyTexture("algae", TEXTURE_ASSETS.algae, 1.8, 1.8);
    applyTexture("fiberA", TEXTURE_ASSETS.membrane, 2, 6);
  }

  async function initPhysics() {
    if (world.physics.ready || world.physics.failed) return;
    try {
      const rapierModule = await import(RAPIER_URL);
      const RAPIER = rapierModule.default && rapierModule.default.World ? rapierModule.default : rapierModule;
      await (RAPIER.init ? RAPIER.init() : rapierModule.init());
      const physicsWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
      physicsWorld.timestep = world.physics.fixedStep;
      world.physics.RAPIER = RAPIER;
      world.physics.world = physicsWorld;
      world.physics.ready = true;
      buildPhysicsBoundary();
      updatePhysicsStatus();
    } catch (error) {
      console.warn("Rapier physics unavailable; using fallback prop motion.", error);
      world.physics.failed = true;
      updatePhysicsStatus();
    }
  }

  function updatePhysicsStatus() {
    if (!el.arcadePhysics) return;
    el.arcadePhysics.textContent = world.physics.ready ? "Rapier physics" : "Fallback physics";
  }

  function clearPhysicsBoundary() {
    if (!world.physics.ready || !world.physics.world) return;
    world.physics.boundaryBodies.forEach((body) => {
      if (body) world.physics.world.removeRigidBody(body);
    });
    world.physics.boundaryBodies.length = 0;
  }

  function buildPhysicsBoundary() {
    if (!world.physics.ready || world.physics.boundaryBodies.length) return;
    const RAPIER = world.physics.RAPIER;
    if (levelConfig().shape === "square") {
      const half = playableHalfSize() - 0.25;
      [
        { x: 0, z: -half, hx: half, hz: 0.52 },
        { x: 0, z: half, hx: half, hz: 0.52 },
        { x: -half, z: 0, hx: 0.52, hz: half },
        { x: half, z: 0, hx: 0.52, hz: half },
      ].forEach((wall) => {
        const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(wall.x, 0, wall.z);
        const body = world.physics.world.createRigidBody(bodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.cuboid(wall.hx, 1.2, wall.hz)
          .setRestitution(0.86)
          .setFriction(0.52);
        world.physics.world.createCollider(colliderDesc, body);
        world.physics.boundaryBodies.push(body);
      });
      return;
    }

    const radius = playableRadius() - 0.25;
    const bodyCount = Math.max(48, Math.ceil(88 * radius / LEVEL_ONE_RADIUS));
    const tangentHalf = (Math.PI * radius * 2) / bodyCount / 2;
    for (let i = 0; i < bodyCount; i++) {
      const angle = (i / bodyCount) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const yaw = -angle;
      const bodyDesc = RAPIER.RigidBodyDesc.fixed()
        .setTranslation(x, 0, z)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
      const body = world.physics.world.createRigidBody(bodyDesc);
      const colliderDesc = RAPIER.ColliderDesc.cuboid(tangentHalf, 1.2, 0.52)
        .setRestitution(0.86)
        .setFriction(0.52);
      world.physics.world.createCollider(colliderDesc, body);
      world.physics.boundaryBodies.push(body);
    }
  }

  function rebuildPhysicsBoundary() {
    clearPhysicsBoundary();
    buildPhysicsBoundary();
  }

  function attachPhysicsBody(prop, config) {
    if (!world.physics.ready) return;
    const RAPIER = world.physics.RAPIER;
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(prop.position.x, 0, prop.position.z)
      .setGravityScale(0)
      .setLinearDamping(config.damping ?? 2.2)
      .setAngularDamping(config.angularDamping ?? 2.6)
      .setCanSleep(false)
      .enabledTranslations(true, false, true)
      .enabledRotations(false, true, false);
    const body = world.physics.world.createRigidBody(bodyDesc);
    let colliderDesc;
    if (config.collider === "cuboid") {
      colliderDesc = RAPIER.ColliderDesc.cuboid(config.radius * 0.95, 0.62, config.radius * 0.42);
    } else if (config.collider === "capsule") {
      colliderDesc = RAPIER.ColliderDesc.capsule(config.radius * 0.65, config.radius * 0.45);
    } else {
      colliderDesc = RAPIER.ColliderDesc.ball(config.physicsRadius || config.radius * 0.82);
    }
    colliderDesc = colliderDesc
      .setMass(config.mass || 1)
      .setRestitution(config.restitution ?? 0.58)
      .setFriction(config.friction ?? 0.62);
    if (config.collect) colliderDesc.setSensor(true);
    prop.userData.body = body;
    prop.userData.collider = world.physics.world.createCollider(colliderDesc, body);
  }

  function removePhysicsBody(prop) {
    if (!world.physics.ready || !prop || !prop.userData || !prop.userData.body) return;
    world.physics.world.removeRigidBody(prop.userData.body);
    prop.userData.body = null;
    prop.userData.collider = null;
  }

  function stepPhysics(dt) {
    if (!world.physics.ready) return;
    world.physics.accumulator += dt;
    let steps = 0;
    while (world.physics.accumulator >= world.physics.fixedStep && steps < 4) {
      world.physics.world.step();
      world.physics.accumulator -= world.physics.fixedStep;
      steps += 1;
    }
    if (steps >= 4) world.physics.accumulator = 0;
  }

  function buildScene() {
    const THREE = window.THREE;
    const scene = world.scene;
    scene.background = makeSkyTexture();

    scene.add(new THREE.HemisphereLight(0xd8fcff, 0x245f20, 0.78));
    scene.add(new THREE.AmbientLight(0x73eaff, 0.08));

    const key = new THREE.DirectionalLight(0xffe1a0, 1.05);
    key.position.set(-28, 46, 20);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = Math.max(180, WORLD_RADIUS * 1.4);
    key.shadow.camera.left = -WORLD_RADIUS * 0.62;
    key.shadow.camera.right = WORLD_RADIUS * 0.62;
    key.shadow.camera.top = WORLD_RADIUS * 0.62;
    key.shadow.camera.bottom = -WORLD_RADIUS * 0.62;
    scene.add(key);

    const rim = new THREE.PointLight(0xff8cd8, 1.05, 82);
    rim.position.set(24, 13, -25);
    scene.add(rim);

    const cool = new THREE.PointLight(0x58e5ff, 1.05, 78);
    cool.position.set(-30, 14, 24);
    scene.add(cool);

    const gardenFill = new THREE.PointLight(0xa5ff4f, 0.62, 70);
    gardenFill.position.set(-10, 9, 12);
    scene.add(gardenFill);

    buildDish();
    world.tardigrade = makeTardigrade();
    scene.add(world.tardigrade);
    world.guide = makeGuideBeacon();
    scene.add(world.guide);
  }

  function removeSceneObjects(items) {
    items.forEach((item) => {
      if (!item) return;
      world.scene.remove(item);
      disposeObject(item);
    });
    items.length = 0;
  }

  function addStageScenery(object, bucket = "") {
    if (!object) return object;
    (world.stageRoot || world.scene).add(object);
    if (bucket === "drift") world.drift.push(object);
    if (bucket === "atmosphere") world.atmosphere.push(object);
    return object;
  }

  function clearStageScenery() {
    if (world.stageRoot) {
      world.scene.remove(world.stageRoot);
      disposeObject(world.stageRoot);
      world.stageRoot = null;
    }
    world.terrain = null;
    world.boundary = null;
    world.drift.length = 0;
    world.atmosphere.length = 0;
  }

  function rebuildStageScenery() {
    const THREE = window.THREE;
    clearStageScenery();
    applyStageAtmosphere();
    world.stageRoot = new THREE.Group();
    world.stageRoot.userData.kind = `${levelConfig().id}-stage-scenery`;
    world.scene.add(world.stageRoot);
    makeRollingTerrain();
    makePlayableBoundary();

    if (levelConfig().id === "petri") {
      makeLabBackdrop();
      makePetriDishDetails();
      makePetriWaterPatches();
    } else if (levelConfig().id === "aquarium") {
      makeLivingRoomBackdrop();
      makeAquariumBoundaryDetails();
      makeAquariumFloorAccents();
      makeAquariumWaterPatches();
      buildScenicDepth();
      buildEnvironment();
    } else if (levelConfig().id === "stomach") {
      makeStomachBackdrop();
      makeStomachDetails();
      buildEnvironment();
    } else if (levelConfig().id === "lava") {
      makeLavaBackdrop();
      makeLavaDetails();
      buildEnvironment();
    } else if (levelConfig().id === "station") {
      makeStationBackdrop();
      makeStationDetails();
      buildEnvironment();
    }
  }

  function applyStageAtmosphere() {
    const THREE = window.THREE;
    const id = levelConfig().id;
    updateWorldBaseForStage(id);
    if (id === "petri") {
      world.renderer.setClearColor(0xeaf7ff, 1);
      world.scene.fog = new THREE.FogExp2(0xeaf7ff, 0.0009);
      world.scene.background = makePetriSkyTexture();
      return;
    }
    if (id === "stomach") {
      world.renderer.setClearColor(0x3a0d2a, 1);
      world.scene.fog = new THREE.FogExp2(0x5a1b36, 0.0011);
      world.scene.background = makeStomachSkyTexture();
      return;
    }
    if (id === "lava") {
      world.renderer.setClearColor(0x170b10, 1);
      world.scene.fog = new THREE.FogExp2(0x3a1a18, 0.00092);
      world.scene.background = makeLavaSkyTexture();
      return;
    }
    if (id === "station") {
      world.renderer.setClearColor(0x050914, 1);
      world.scene.fog = new THREE.FogExp2(0x091427, 0.00058);
      world.scene.background = makeStationSkyTexture();
      return;
    }
    world.renderer.setClearColor(0xd7b88f, 1);
    world.scene.fog = new THREE.FogExp2(0x9bd7df, 0.00072);
    world.scene.background = makeLivingRoomSkyTexture();
  }

  function updateWorldBaseForStage(id) {
    if (!world.petri) return;
    const baseMaterials = {
      petri: world.materials.labCounter,
      aquarium: world.materials.dishDark,
      stomach: world.materials.zoneStomachPurple,
      lava: world.materials.cliff,
      station: world.materials.cameraBody,
    };
    world.petri.material = baseMaterials[id] || world.materials.dishDark;
  }

  function clearInteractiveLevel() {
    removeSceneObjects(world.zones);
    removeSceneObjects(world.traversalToys);
    removeSceneObjects(world.landmarks);
    removeSceneObjects(world.creatures);
    if (world.ring) {
      world.scene.remove(world.ring);
      disposeObject(world.ring);
      world.ring = null;
      world.ringCore = null;
    }
  }

  function rebuildInteractiveLevel() {
    clearInteractiveLevel();
    buildSandboxZones();
    buildTraversalToys();
    buildHiddenLandmarks();
    buildRoamingCreatures();
    world.ring = makeNutrientRing();
    world.scene.add(world.ring);
  }

  function makeSkyTexture() {
    const THREE = window.THREE;
    const sky = document.createElement("canvas");
    sky.width = 96;
    sky.height = 256;
    const ctx = sky.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, sky.height);
    gradient.addColorStop(0, "#0069a9");
    gradient.addColorStop(0.34, "#0baee0");
    gradient.addColorStop(0.72, "#48d8f7");
    gradient.addColorStop(1, "#b7fbff");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, sky.width, sky.height);
    const reefGradient = ctx.createLinearGradient(0, sky.height * 0.45, 0, sky.height);
    reefGradient.addColorStop(0, "rgba(0,70,104,0)");
    reefGradient.addColorStop(0.62, "rgba(5,91,110,0.32)");
    reefGradient.addColorStop(1, "rgba(3,78,62,0.46)");
    ctx.fillStyle = reefGradient;
    ctx.beginPath();
    ctx.moveTo(0, sky.height);
    for (let i = 0; i <= 14; i++) {
      const x = (i / 14) * sky.width;
      const y = sky.height * (0.58 + Math.sin(i * 1.37) * 0.06 + (i % 3) * 0.025);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(sky.width, sky.height);
    ctx.closePath();
    ctx.fill();
    for (let i = 0; i < 7; i++) {
      const x = 4 + i * 15;
      const shaft = ctx.createLinearGradient(x, 0, x + 16, sky.height);
      shaft.addColorStop(0, "rgba(255,255,220,0.35)");
      shaft.addColorStop(0.58, "rgba(190,255,246,0.11)");
      shaft.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = shaft;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 13, 0);
      ctx.lineTo(x + 2, sky.height);
      ctx.lineTo(x - 18, sky.height);
      ctx.closePath();
      ctx.fill();
    }
    for (let i = 0; i < 150; i++) {
      const size = Math.random() * 2.1 + 0.35;
      ctx.fillStyle = i % 5 === 0 ? "rgba(255,255,255,0.62)" : "rgba(198,252,255,0.38)";
      ctx.beginPath();
      ctx.arc(Math.random() * sky.width, Math.random() * sky.height * 0.82, size, 0, Math.PI * 2);
      ctx.fill();
    }
    const texture = new THREE.CanvasTexture(sky);
    texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  function makePetriSkyTexture() {
    const THREE = window.THREE;
    const sky = document.createElement("canvas");
    sky.width = 96;
    sky.height = 256;
    const ctx = sky.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, sky.height);
    gradient.addColorStop(0, "#f8fbff");
    gradient.addColorStop(0.42, "#e6f4ff");
    gradient.addColorStop(1, "#d4edf6");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, sky.width, sky.height);
    for (let i = 0; i < 5; i++) {
      const x = 6 + i * 21;
      const beam = ctx.createLinearGradient(x, 0, x + 12, sky.height);
      beam.addColorStop(0, "rgba(255,255,255,0.58)");
      beam.addColorStop(0.5, "rgba(210,236,255,0.18)");
      beam.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 10, 0);
      ctx.lineTo(x + 2, sky.height);
      ctx.lineTo(x - 16, sky.height);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(126,160,178,0.08)";
    ctx.lineWidth = 1;
    for (let y = 22; y < sky.height; y += 34) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(sky.width, y + Math.sin(y) * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 64; i++) {
      const size = Math.random() * 1.6 + 0.25;
      ctx.fillStyle = i % 6 === 0 ? "rgba(255,255,255,0.62)" : "rgba(142,170,180,0.22)";
      ctx.beginPath();
      ctx.arc(Math.random() * sky.width, Math.random() * sky.height * 0.74, size, 0, Math.PI * 2);
      ctx.fill();
    }
    const texture = new THREE.CanvasTexture(sky);
    texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  function makeLivingRoomSkyTexture() {
    const THREE = window.THREE;
    const sky = document.createElement("canvas");
    sky.width = 128;
    sky.height = 256;
    const ctx = sky.getContext("2d");
    const wall = ctx.createLinearGradient(0, 0, 0, sky.height);
    wall.addColorStop(0, "#d9c39f");
    wall.addColorStop(0.52, "#c9a77b");
    wall.addColorStop(0.53, "#8a5a33");
    wall.addColorStop(1, "#6f4527");
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, sky.width, sky.height);

    ctx.fillStyle = "rgba(255,245,220,0.12)";
    for (let y = 24; y < sky.height * 0.5; y += 34) {
      ctx.fillRect(0, y, sky.width, 2);
    }
    ctx.fillStyle = "rgba(88,55,30,0.38)";
    ctx.fillRect(0, Math.floor(sky.height * 0.52), sky.width, 5);

    const texture = new THREE.CanvasTexture(sky);
    texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  function makeStomachSkyTexture() {
    const THREE = window.THREE;
    const sky = document.createElement("canvas");
    sky.width = 128;
    sky.height = 256;
    const ctx = sky.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, sky.height);
    gradient.addColorStop(0, "#5a1837");
    gradient.addColorStop(0.48, "#8b2e54");
    gradient.addColorStop(1, "#3d1030");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, sky.width, sky.height);
    for (let y = 18; y < sky.height; y += 24) {
      ctx.strokeStyle = "rgba(255,171,118,0.18)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let x = 0; x <= sky.width; x += 8) {
        const waveY = y + Math.sin(x * 0.22 + y * 0.11) * 4;
        if (x === 0) ctx.moveTo(x, waveY);
        else ctx.lineTo(x, waveY);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 80; i++) {
      ctx.fillStyle = i % 4 ? "rgba(255,179,77,0.2)" : "rgba(178,255,95,0.28)";
      ctx.beginPath();
      ctx.arc(Math.random() * sky.width, Math.random() * sky.height, Math.random() * 1.8 + 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    const texture = new THREE.CanvasTexture(sky);
    texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  function makeLavaSkyTexture() {
    const THREE = window.THREE;
    const sky = document.createElement("canvas");
    sky.width = 128;
    sky.height = 256;
    const ctx = sky.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, sky.height);
    gradient.addColorStop(0, "#120810");
    gradient.addColorStop(0.45, "#2a1620");
    gradient.addColorStop(1, "#5c160f");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, sky.width, sky.height);
    for (let i = 0; i < 9; i++) {
      const x = 6 + i * 15;
      const glow = ctx.createLinearGradient(x, sky.height, x + 12, 0);
      glow.addColorStop(0, "rgba(255,74,33,0.48)");
      glow.addColorStop(0.5, "rgba(255,212,59,0.16)");
      glow.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.moveTo(x, sky.height);
      ctx.lineTo(x + 18, sky.height);
      ctx.lineTo(x + 9, 0);
      ctx.lineTo(x - 8, 0);
      ctx.closePath();
      ctx.fill();
    }
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = i % 5 ? "rgba(255,179,77,0.26)" : "rgba(248,251,255,0.22)";
      ctx.fillRect(Math.random() * sky.width, Math.random() * sky.height, Math.random() * 2 + 0.5, Math.random() * 2 + 0.5);
    }
    const texture = new THREE.CanvasTexture(sky);
    texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  function makeStationSkyTexture() {
    const THREE = window.THREE;
    const sky = document.createElement("canvas");
    sky.width = 128;
    sky.height = 256;
    const ctx = sky.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, sky.height);
    gradient.addColorStop(0, "#060914");
    gradient.addColorStop(0.54, "#111c31");
    gradient.addColorStop(1, "#283747");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, sky.width, sky.height);
    for (let i = 0; i < 120; i++) {
      const alpha = Math.random() * 0.5 + 0.24;
      ctx.fillStyle = `rgba(248,251,255,${alpha})`;
      ctx.fillRect(Math.random() * sky.width, Math.random() * sky.height * 0.62, 1, 1);
    }
    ctx.fillStyle = "rgba(83,234,209,0.16)";
    for (let y = 142; y < sky.height; y += 24) {
      ctx.fillRect(0, y, sky.width, 2);
    }
    ctx.fillStyle = "rgba(248,251,255,0.32)";
    ctx.beginPath();
    ctx.arc(92, 58, 13, 0, Math.PI * 2);
    ctx.fill();
    const texture = new THREE.CanvasTexture(sky);
    texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  function buildDish() {
    const THREE = window.THREE;
    const waterBase = new THREE.Mesh(
      new THREE.CylinderGeometry(WORLD_RADIUS, WORLD_RADIUS, 0.36, 72),
      world.materials.dishDark
    );
    waterBase.position.y = -1.12;
    waterBase.receiveShadow = true;
    world.scene.add(waterBase);
    world.petri = waterBase;

  }

  function makeBackdropBox(x, y, z, width, height, depth, material, rotationY = 0) {
    const THREE = window.THREE;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotationY;
    mesh.receiveShadow = true;
    addStageScenery(mesh);
    return mesh;
  }

  function makeBackdropCylinder(x, y, z, radiusTop, radiusBottom, height, material, segments = 16) {
    const THREE = window.THREE;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    addStageScenery(mesh);
    return mesh;
  }

  function makeLabBackdrop() {
    const THREE = window.THREE;
    makeBackdropBox(0, -1.55, 0, WORLD_RADIUS * 2.45, 0.5, WORLD_RADIUS * 2.45, world.materials.labCounter);
    makeBackdropBox(0, 70, -270, 560, 140, 5, world.materials.labWall);
    makeBackdropBox(0, 8, -268, 560, 4, 8, world.materials.labMetal);
    makeBackdropBox(-190, 44, -250, 70, 72, 6, world.materials.labMetal);
    makeBackdropBox(-190, 26, -222, 38, 12, 58, world.materials.labMetal, -0.22);
    const scopeArm = makeBackdropCylinder(-155, 70, -230, 7.5, 7.5, 74, world.materials.labMetal, 18);
    scopeArm.rotation.z = Math.PI / 2.9;
    scopeArm.rotation.y = -0.22;
    const scopeLens = makeBackdropCylinder(-118, 55, -208, 15, 18, 24, world.materials.labGlass, 20);
    scopeLens.rotation.x = Math.PI / 2;
    scopeLens.rotation.z = -0.24;

    makeBackdropBox(122, 15, -246, 84, 9, 34, world.materials.labMetal);
    [-18, 0, 18].forEach((offset, index) => {
      const tube = makeBackdropCylinder(104 + offset, 43, -248, 7, 8, 54 + index * 7, world.materials.labGlass, 18);
      tube.scale.x = 0.68;
      const liquid = makeBackdropCylinder(104 + offset, 23, -248, 6.2, 7, 16 + index * 4, index === 1 ? world.materials.droplet : world.materials.cell, 18);
      liquid.scale.x = 0.64;
    });

    const flask = makeBackdropCylinder(214, 25, -234, 20, 35, 40, world.materials.labGlass, 24);
    flask.scale.z = 0.72;
    const flaskNeck = makeBackdropCylinder(214, 57, -234, 8, 8, 36, world.materials.labGlass, 18);
    flaskNeck.scale.z = 0.7;
    const flaskLiquid = makeBackdropCylinder(214, 13, -234, 18, 31, 16, world.materials.zonePetriWater, 24);
    flaskLiquid.scale.z = 0.68;

    for (let i = 0; i < 7; i++) {
      const x = -240 + i * 78;
      makeBackdropBox(x, 124, -266, 26, 7, 4, world.materials.white);
    }
  }

  function makeLivingRoomBackdrop() {
    const half = playableHalfSize();
    makeBackdropBox(0, -1.7, 0, half * 3.6, 0.52, half * 3.6, world.materials.roomFloor);
    makeBackdropBox(0, 104, -half - 96, half * 2.9, 208, 7, world.materials.roomWall);
    makeBackdropBox(-half - 96, 104, 0, 7, 208, half * 2.9, world.materials.roomWall);

    makeBackdropBox(-132, 58, -half - 68, 196, 72, 42, world.materials.couch);
    makeBackdropBox(-205, 93, -half - 82, 54, 70, 30, world.materials.couch);
    makeBackdropBox(-62, 93, -half - 82, 54, 70, 30, world.materials.couch);
    makeBackdropBox(-132, 25, -half - 42, 184, 28, 58, world.materials.couch);
    makeBackdropBox(-154, 70, -half - 37, 34, 24, 10, world.materials.lampShade);
    makeBackdropBox(-101, 73, -half - 37, 36, 28, 10, world.materials.coralPink);

    const lampX = half + 86;
    makeBackdropBox(lampX, 58, -half - 60, 24, 112, 24, world.materials.furnitureWood);
    const shade = makeBackdropCylinder(lampX, 132, -half - 60, 36, 54, 46, world.materials.lampShade, 24);
    shade.scale.z = 0.72;
    makeBackdropBox(lampX, 158, -half - 60, 88, 8, 88, world.materials.lampShade);

    makeBackdropBox(42, 18, half + 146, 128, 18, 58, world.materials.furnitureWood, 0.15);
    const shelfX = -half - 86;
    makeBackdropBox(shelfX, 64, 86, 40, 110, 86, world.materials.furnitureWood);
    [26, 52, 78, 104].forEach((y, index) => {
      makeBackdropBox(shelfX, y, 86, 42, 4, 88, index % 2 ? world.materials.roomWall : world.materials.labMetal);
    });
  }

  function makeStomachBackdrop() {
    const radius = playableRadius();
    makeBackdropBox(0, -1.85, 0, radius * 2.55, 0.6, radius * 2.55, world.materials.zoneStomachPink);
    makeBackdropBox(0, 82, -radius - 82, radius * 2.3, 164, 8, world.materials.zoneStomachPink);
    makeBackdropBox(-radius - 82, 82, 0, 8, 164, radius * 2.3, world.materials.zoneStomachPurple);
    makeBackdropBox(radius + 82, 82, 0, 8, 164, radius * 2.3, world.materials.zoneStomachGold);
    for (let i = 0; i < 9; i++) {
      const x = -radius * 0.92 + i * (radius * 0.23);
      const fold = makeBackdropCylinder(x, 58 + (i % 3) * 8, -radius - 70, 6, 11, 118, i % 2 ? world.materials.zoneStomachGold : world.materials.zoneStomachPink, 10);
      fold.rotation.z = 0.18 + Math.sin(i) * 0.12;
    }
  }

  function makeLavaBackdrop() {
    const radius = playableRadius();
    makeBackdropBox(0, -2.0, 0, radius * 2.62, 0.6, radius * 2.62, world.materials.zoneLavaBasalt);
    makeBackdropBox(0, 92, -radius - 88, radius * 2.4, 184, 10, world.materials.cliff);
    makeBackdropBox(-radius - 90, 84, 0, 10, 168, radius * 2.4, world.materials.cliff);
    makeBackdropBox(radius + 90, 84, 0, 10, 168, radius * 2.4, world.materials.cliff);
    for (let i = 0; i < 10; i++) {
      const x = -radius * 0.9 + i * radius * 0.2;
      const spire = makeBackdropCylinder(x, 42 + (i % 4) * 12, -radius - 72, 9, 17, 82 + (i % 3) * 18, i % 2 ? world.materials.zoneLavaCrystal : world.materials.zoneLavaBasalt, 6);
      spire.rotation.z = Math.sin(i * 1.7) * 0.16;
    }
  }

  function makeStationBackdrop() {
    const half = playableHalfSize();
    makeBackdropBox(0, -1.9, 0, half * 3.2, 0.55, half * 3.2, world.materials.zoneStationWhite);
    makeBackdropBox(0, 98, -half - 86, half * 2.75, 196, 8, world.materials.cameraBody);
    makeBackdropBox(-half - 88, 98, 0, 8, 196, half * 2.75, world.materials.cameraBody);
    makeBackdropBox(half + 88, 98, 0, 8, 196, half * 2.75, world.materials.cameraBody);
    for (let i = 0; i < 5; i++) {
      const x = -half * 0.68 + i * half * 0.34;
      makeBackdropBox(x, 94, -half - 80, 44, 32, 5, world.materials.labGlass);
      makeBackdropBox(x, 94, -half - 76, 50, 4, 6, world.materials.labMetal);
      makeBackdropBox(x, 76, -half - 76, 50, 4, 6, world.materials.labMetal);
    }
    makeBackdropBox(-half - 70, 34, 76, 72, 26, 92, world.materials.labMetal, 0.12);
    makeBackdropBox(half + 70, 42, -68, 82, 34, 74, world.materials.toolpod, -0.18);
  }

  function makeStomachDetails() {
    const mats = [world.materials.zoneStomachPink, world.materials.zoneStomachGold, world.materials.foodbit, world.materials.digestiveBubble];
    [
      [mapCoord(-44), mapCoord(31), scenicRadius(9.2), 16, mats],
      [mapCoord(40), mapCoord(42), scenicRadius(8.4), 15, [world.materials.digestiveBubble, world.materials.zoneStomachMint, world.materials.foodbit]],
      [mapCoord(48), mapCoord(-48), scenicRadius(10.4), 17, [world.materials.foodbit, world.materials.pollen, world.materials.zoneStomachGold]],
      [mapCoord(-54), mapCoord(-52), scenicRadius(9.4), 16, [world.materials.enzyme, world.materials.zoneStomachPurple, world.materials.digestiveBubble]],
    ].forEach(([x, z, radius, count, materials]) => makeTubeCluster(x, z, radius, count, materials));
    [
      [mapCoord(4), mapCoord(12), scenicRadius(14), 0.32, 0.2, world.materials.zoneStomachGold],
      [mapCoord(-24), mapCoord(-30), scenicRadius(12), 0.42, -0.35, world.materials.zoneStomachPink],
      [mapCoord(46), mapCoord(-8), scenicRadius(11), 0.36, 0.65, world.materials.zoneStomachMint],
    ].forEach(([x, z, radius, scaleZ, rotation, material]) => makeMaterialPatch(x, z, radius, scaleZ, rotation, material));
    for (let i = 0; i < 46; i++) {
      const pos = randomPlayablePoint(8);
      makeSuspendedDroplet(pos.x, pos.z, rand(0.45, 1.2), rand(3.8, 24));
    }
    makeBubbleColumn(mapCoord(34), mapCoord(46), 23, 20);
    makeBubbleColumn(mapCoord(-50), mapCoord(-46), 20, 18);
    makeCurrentRibbon(mapCoord(5), mapCoord(8), 60, 10, 0.15);
    makeCurrentRibbon(mapCoord(-28), mapCoord(38), 52, 8, -0.45);
  }

  function makeLavaDetails() {
    [
      [mapCoord(32), mapCoord(26), scenicRadius(15), 0.26, 0.2, world.materials.zoneLavaRiver],
      [mapCoord(6), mapCoord(-12), scenicRadius(18), 0.2, -0.38, world.materials.magmaBubble],
      [mapCoord(-42), mapCoord(-50), scenicRadius(10), 0.36, 0.68, world.materials.zoneLavaSteam],
    ].forEach(([x, z, radius, scaleZ, rotation, material]) => makeMaterialPatch(x, z, radius, scaleZ, rotation, material));
    [
      [mapCoord(-56), mapCoord(40), scenicRadius(9.6), 13, [world.materials.cliff, world.materials.zoneLavaBasalt, world.materials.ashCrystal]],
      [mapCoord(54), mapCoord(-54), scenicRadius(10.6), 16, [world.materials.ashCrystal, world.materials.crystal, world.materials.zoneLavaCrystal]],
      [mapCoord(50), mapCoord(28), scenicRadius(8.8), 12, [world.materials.magmaBubble, world.materials.coralOrange, world.materials.zoneLavaRiver]],
    ].forEach(([x, z, radius, count, materials]) => makeTubeCluster(x, z, radius, count, materials));
    for (let i = 0; i < 40; i++) {
      const pos = randomPlayablePoint(8);
      const ember = new window.THREE.Mesh(new window.THREE.TetrahedronGeometry(rand(0.1, 0.32), 0), pick([world.materials.magmaBubble, world.materials.zoneLavaSteam, world.materials.ashCrystal]));
      ember.position.set(pos.x, rand(3.5, 30), pos.z);
      ember.userData.baseY = ember.position.y;
      ember.userData.speed = rand(0.45, 1.4);
      ember.userData.phase = rand(0, Math.PI * 2);
      addStageScenery(ember, "drift");
    }
    makeBubbleColumn(mapCoord(42), mapCoord(0), 26, 18, world.materials.magmaBubble);
    makeBubbleColumn(mapCoord(-44), mapCoord(-52), 22, 16, world.materials.zoneLavaSteam);
    makeCurrentRibbon(mapCoord(20), mapCoord(14), 72, 12, 0.35, world.materials.zoneLavaRiver, 0.18);
  }

  function makeStationDetails() {
    [
      [mapCoord(-50), mapCoord(43), scenicRadius(8.8), 12, [world.materials.dataChip, world.materials.labMetal, world.materials.zoneStationCyan]],
      [mapCoord(46), mapCoord(40), scenicRadius(9.2), 13, [world.materials.toolpod, world.materials.white, world.materials.labGlass]],
      [mapCoord(-48), mapCoord(-46), scenicRadius(8.6), 12, [world.materials.zoneStationGold, world.materials.labMetal, world.materials.cameraLens]],
      [mapCoord(50), mapCoord(-48), scenicRadius(8.8), 14, [world.materials.zoneStationViolet, world.materials.crystal, world.materials.dataChip]],
    ].forEach(([x, z, radius, count, materials]) => makeTubeCluster(x, z, radius, count, materials));
    for (let i = 0; i < 18; i++) {
      const pos = randomPlayablePoint(10);
      const panel = new window.THREE.Mesh(new window.THREE.BoxGeometry(rand(2.2, 5.8), 0.12, rand(1.2, 3.8)), pick([world.materials.labMetal, world.materials.dataChip, world.materials.toolpod]));
      panel.position.set(pos.x, terrainVisualYAt(pos.x, pos.z) + 0.16, pos.z);
      panel.rotation.y = rand(0, Math.PI);
      panel.receiveShadow = true;
      addStageScenery(panel);
    }
    for (let i = 0; i < 54; i++) {
      const pos = randomPlayablePoint(5);
      const dust = new window.THREE.Mesh(new window.THREE.IcosahedronGeometry(rand(0.06, 0.22), 0), pick([world.materials.cameraLens, world.materials.white, world.materials.dataChip]));
      dust.position.set(pos.x, rand(4, 34), pos.z);
      dust.userData.baseY = dust.position.y;
      dust.userData.speed = rand(0.2, 0.72);
      dust.userData.phase = rand(0, Math.PI * 2);
      addStageScenery(dust, "drift");
    }
    makeCurrentRibbon(mapCoord(-28), mapCoord(-28), 42, 8, -0.2);
    makeCurrentRibbon(mapCoord(36), mapCoord(8), 54, 7, 0.44);
  }

  function makePlayableBoundary() {
    const THREE = window.THREE;
    if (levelConfig().shape === "square") {
      makeSquareAquariumBoundary();
      return;
    }

    const radius = playableRadius();
    const boundaryMaterial = levelConfig().id === "petri"
      ? world.materials.agarEdge
      : levelConfig().id === "stomach"
        ? world.materials.zoneStomachPink
        : levelConfig().id === "lava"
          ? world.materials.zoneLavaRiver
          : world.materials.water;
    const boundary = new THREE.Mesh(
      new THREE.TorusGeometry(radius, levelConfig().id === "petri" ? 0.42 : 0.34, 10, 112),
      boundaryMaterial
    );
    boundary.rotation.x = Math.PI / 2;
    boundary.position.y = 0.08;
    boundary.receiveShadow = true;
    addStageScenery(boundary);
    world.boundary = boundary;

    const inner = new THREE.Mesh(
      new THREE.TorusGeometry(radius - 5.2, 0.035, 6, 112),
      levelConfig().id === "lava" ? world.materials.magmaBubble : world.materials.ring
    );
    inner.rotation.x = Math.PI / 2;
    inner.position.y = 0.05;
    addStageScenery(inner);
  }

  function makeSquareAquariumBoundary() {
    const half = playableHalfSize();
    const isStation = levelConfig().id === "station";
    const wallHeight = isStation ? 24 : 38;
    const wallY = wallHeight / 2 - 0.5;
    const sideLength = half * 2 + 5.6;
    const glass = isStation ? world.materials.labGlass : world.materials.glass;
    const water = isStation ? world.materials.labMetal : world.materials.water;

    const group = new window.THREE.Group();
    group.userData.kind = `${levelConfig().id}-square-boundary`;
    [
      { x: 0, z: -half - 1.4, w: sideLength, h: wallHeight, d: 1.8 },
      { x: 0, z: half + 1.4, w: sideLength, h: wallHeight, d: 1.8 },
      { x: -half - 1.4, z: 0, w: 1.8, h: wallHeight, d: sideLength },
      { x: half + 1.4, z: 0, w: 1.8, h: wallHeight, d: sideLength },
    ].forEach((wall) => {
      const mesh = new window.THREE.Mesh(new window.THREE.BoxGeometry(wall.w, wall.h, wall.d), glass);
      mesh.position.set(wall.x, wallY, wall.z);
      mesh.renderOrder = 1;
      group.add(mesh);
    });

    [
      { x: 0, z: -half - 1.8, w: sideLength, d: 2.3 },
      { x: 0, z: half + 1.8, w: sideLength, d: 2.3 },
      { x: -half - 1.8, z: 0, w: 2.3, d: sideLength },
      { x: half + 1.8, z: 0, w: 2.3, d: sideLength },
    ].forEach((rim) => {
      const top = new window.THREE.Mesh(new window.THREE.BoxGeometry(rim.w, 1.25, rim.d), glass);
      top.position.set(rim.x, wallHeight + 1.2, rim.z);
      group.add(top);
      const floorEdge = new window.THREE.Mesh(new window.THREE.BoxGeometry(rim.w, 0.22, rim.d), water);
      floorEdge.position.set(rim.x, 0.12, rim.z);
      group.add(floorEdge);
    });

    addStageScenery(group);
    world.boundary = group;
  }

  function makePetriDishDetails() {
    const THREE = window.THREE;
    const agarGlow = new THREE.Mesh(
      new THREE.CylinderGeometry(LEVEL_ONE_RADIUS - 4, LEVEL_ONE_RADIUS - 6, 0.18, 96),
      world.materials.agarBase
    );
    agarGlow.position.y = -0.76;
    agarGlow.receiveShadow = true;
    addStageScenery(agarGlow);

    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(LEVEL_ONE_RADIUS + 1.2, LEVEL_ONE_RADIUS + 1.2, 2.35, 128, 1, true),
      world.materials.glass
    );
    wall.position.y = 0.88;
    wall.renderOrder = 2;
    addStageScenery(wall);

    const lip = new THREE.Mesh(
      new THREE.TorusGeometry(LEVEL_ONE_RADIUS + 1.2, 0.72, 10, 128),
      world.materials.glass
    );
    lip.rotation.x = Math.PI / 2;
    lip.position.y = 1.92;
    lip.renderOrder = 3;
    addStageScenery(lip);

    const agarMeniscus = new THREE.Mesh(
      new THREE.TorusGeometry(LEVEL_ONE_RADIUS - 6.4, 0.11, 6, 128),
      world.materials.agarEdge
    );
    agarMeniscus.rotation.x = Math.PI / 2;
    agarMeniscus.position.y = 0.72;
    addStageScenery(agarMeniscus);

    for (let i = 0; i < 48; i++) {
      const angle = rand(0, Math.PI * 2);
      const distance = Math.sqrt(Math.random()) * (LEVEL_ONE_RADIUS - 12);
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      const speck = new THREE.Mesh(
        new THREE.CylinderGeometry(rand(0.12, 0.44), rand(0.1, 0.38), 0.025, 7),
        pick([world.materials.gravel, world.materials.pollen, world.materials.algae, world.materials.cell])
      );
      speck.position.set(x, terrainVisualYAt(x, z) + 0.11, z);
      speck.scale.z = rand(0.45, 1.2);
      speck.rotation.set(rand(-0.05, 0.05), rand(0, Math.PI), rand(-0.05, 0.05));
      speck.receiveShadow = true;
      addStageScenery(speck);
    }

    [
      [-64, 18, 8.2, -0.3],
      [42, 39, 6.8, 0.46],
      [58, -42, 7.4, -0.15],
      [-28, -58, 5.8, 0.7],
    ].forEach(([x, z, radius, rotation]) => makeLabReflection(x, z, radius, rotation));
  }

  function makeLabReflection(x, z, radius, rotation) {
    const THREE = window.THREE;
    const glint = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.035, 4, 32),
      world.materials.caustic.clone()
    );
    glint.position.set(x, terrainVisualYAt(x, z) + 0.12, z);
    glint.rotation.x = Math.PI / 2;
    glint.rotation.z = rotation;
    glint.scale.z = 0.32;
    glint.userData.phase = rand(0, Math.PI * 2);
    glint.userData.baseOpacity = rand(0.05, 0.12);
    glint.userData.baseScale = glint.scale.clone();
    addStageScenery(glint, "atmosphere");
  }

  function makeAquariumBoundaryDetails() {
    const THREE = window.THREE;
    const half = playableHalfSize();
    const airStone = new THREE.Mesh(
      new THREE.BoxGeometry(11.5, 1.2, 4.2),
      world.materials.gravel
    );
    airStone.position.set(half - 30, terrainVisualYAt(half - 30, -54) + 0.72, -54);
    airStone.rotation.y = -0.4;
    airStone.receiveShadow = true;
    addStageScenery(airStone);

    makeBubbleColumn(half - 30, -54, 26, 22);
    makeBubbleColumn(-half + 42, mapCoord(53), 18, 16);
    makeBubbleColumn(mapCoord(12), -half + 32, 22, 18);
    makeCurrentRibbon(mapCoord(-20), mapCoord(66), 46, 8, -0.4);
    makeCurrentRibbon(mapCoord(68), mapCoord(-44), 52, 7, 0.5);
  }

  function makeAquariumFloorAccents() {
    [
      [mapCoord(-74), mapCoord(48), 9.4, 18, [world.materials.fiberA, world.materials.algae, world.materials.coralGreen]],
      [mapCoord(68), mapCoord(36), 8.4, 15, [world.materials.coralTeal, world.materials.droplet, world.materials.algae]],
      [mapCoord(58), mapCoord(-66), 10.4, 17, [world.materials.coralPink, world.materials.bacteria, world.materials.coralPurple]],
      [mapCoord(-58), mapCoord(-64), 9.6, 16, [world.materials.spore, world.materials.coralPurple, world.materials.crystal]],
      [mapCoord(6), mapCoord(-78), 7.4, 13, [world.materials.coralYellow, world.materials.coralTeal, world.materials.spore]],
    ].forEach(([x, z, radius, count, materials]) => makeTubeCluster(x, z, radius, count, materials));

    for (let i = 0; i < 28; i++) {
      const pos = randomPlayablePoint(12);
      makePebblePatch(pos.x, pos.z, rand(0.8, 1.8));
    }
  }

  function makePetriWaterPatches() {
    [
      [-42, 34, 13.5, 0.34, 0.15],
      [34, -26, 11.0, 0.42, -0.52],
      [6, 52, 8.4, 0.36, 0.48],
      [-58, -38, 9.2, 0.32, -0.22],
      [54, 12, 7.4, 0.4, 0.72],
    ].forEach(([x, z, radius, scaleZ, rotation]) => makeWaterPatch(x, z, radius, scaleZ, rotation));
  }

  function makeAquariumWaterPatches() {
    [
      [mapCoord(-18), mapCoord(22), scenicRadius(7.6), 0.42, 0.15],
      [mapCoord(25), mapCoord(18), scenicRadius(7.2), 0.5, -0.55],
      [mapCoord(-22), mapCoord(-8), scenicRadius(6.2), 0.38, 0.8],
      [mapCoord(43), mapCoord(-20), scenicRadius(8.4), 0.5, 0.4],
      [mapCoord(-62), mapCoord(11), scenicRadius(7.2), 0.52, -0.2],
      [mapCoord(6), mapCoord(-43), scenicRadius(8.4), 0.46, 0.7],
      [mapCoord(74), mapCoord(42), scenicRadius(10.6), 0.42, 0.1],
      [mapCoord(-78), mapCoord(-43), scenicRadius(9.2), 0.48, -0.35],
      [mapCoord(4), mapCoord(60), scenicRadius(10.2), 0.5, 0.55],
      [mapCoord(66), mapCoord(-72), scenicRadius(7.4), 0.44, -0.85],
      [mapCoord(-12), mapCoord(-76), scenicRadius(9.8), 0.4, 0.2],
    ].forEach(([x, z, radius, scaleZ, rotation]) => makeWaterPatch(x, z, radius, scaleZ, rotation));
  }

  function makeBubbleColumn(x, z, height, count, material = world.materials.bubble) {
    const THREE = window.THREE;
    for (let i = 0; i < count; i++) {
      const bubble = new THREE.Mesh(
        new THREE.SphereGeometry(rand(0.16, 0.68), 8, 6),
        material
      );
      bubble.position.set(x + rand(-2.1, 2.1), rand(2, height), z + rand(-2.1, 2.1));
      bubble.userData.baseY = bubble.position.y;
      bubble.userData.speed = rand(0.7, 1.7);
      bubble.userData.phase = rand(0, Math.PI * 2);
      addStageScenery(bubble, "drift");
    }
  }

  function makeCurrentRibbon(x, z, width, height, yaw, material = world.materials.mist, baseOpacity = 0.085) {
    const THREE = window.THREE;
    const ribbonMaterial = material.clone();
    if ("opacity" in ribbonMaterial) {
      ribbonMaterial.transparent = true;
      ribbonMaterial.opacity = baseOpacity;
      ribbonMaterial.depthWrite = false;
    }
    const ribbon = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      ribbonMaterial
    );
    ribbon.position.set(x, terrainVisualYAt(x, z) + height * 0.35, z);
    ribbon.rotation.y = yaw;
    ribbon.rotation.z = rand(-0.08, 0.08);
    ribbon.userData.phase = rand(0, Math.PI * 2);
    ribbon.userData.baseOpacity = baseOpacity;
    ribbon.userData.baseScale = ribbon.scale.clone();
    addStageScenery(ribbon, "atmosphere");
  }

  function makeRollingTerrain() {
    const THREE = window.THREE;
    if (levelConfig().shape === "square") return makeSquareTerrain();

    // A dense radial grid of vertices. More rings/segments means cliffs and ridges
    // render crisply instead of melting into smooth ramps.
    const radiusLimit = playableRadius();
    const rings = Math.max(44, Math.round(50 * radiusLimit / LEVEL_ONE_RADIUS));
    const segments = Math.max(132, Math.round(160 * radiusLimit / LEVEL_ONE_RADIUS));
    const positions = [];
    const colors = [];
    const indices = [];
    for (let ring = 0; ring <= rings; ring++) {
      const radius = (ring / rings) * (radiusLimit - 4.8);
      for (let segment = 0; segment <= segments; segment++) {
        const angle = (segment / segments) * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        // Sample the procedural height once, then displace this vertex vertically.
        const elevation = terrainOffsetAt(x, z);
        const y = GROUND_Y + elevation - TERRAIN_VISUAL_OFFSET;
        positions.push(x, y, z);
        const color = terrainColorAt(x, z, elevation);
        colors.push(color.r, color.g, color.b);
      }
    }
    for (let ring = 0; ring < rings; ring++) {
      for (let segment = 0; segment < segments; segment++) {
        const a = ring * (segments + 1) + segment;
        const b = a + 1;
        const c = (ring + 1) * (segments + 1) + segment;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const terrain = new THREE.Mesh(geometry, world.materials.terrain);
    terrain.receiveShadow = true;
    addStageScenery(terrain);
    world.terrain = terrain;
    return terrain;
  }

  function makeSquareTerrain() {
    const THREE = window.THREE;
    // A dense square grid of vertices, displaced vertically by the noise height.
    const half = playableHalfSize();
    const inset = 4.8;
    const divisions = Math.max(84, Math.round(86 * half / LEVEL_ONE_RADIUS));
    const positions = [];
    const colors = [];
    const indices = [];
    for (let row = 0; row <= divisions; row++) {
      const z = lerp(-half + inset, half - inset, row / divisions);
      for (let column = 0; column <= divisions; column++) {
        const x = lerp(-half + inset, half - inset, column / divisions);
        // Sample the procedural height once, then displace this vertex vertically.
        const elevation = terrainOffsetAt(x, z);
        const y = GROUND_Y + elevation - TERRAIN_VISUAL_OFFSET;
        positions.push(x, y, z);
        const color = terrainColorAt(x, z, elevation);
        colors.push(color.r, color.g, color.b);
      }
    }
    for (let row = 0; row < divisions; row++) {
      for (let column = 0; column < divisions; column++) {
        const a = row * (divisions + 1) + column;
        const b = a + 1;
        const c = (row + 1) * (divisions + 1) + column;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const terrain = new THREE.Mesh(geometry, world.materials.terrain);
    terrain.receiveShadow = true;
    addStageScenery(terrain);
    world.terrain = terrain;
    return terrain;
  }

  // Choose a vertex colour for the ground. Each level keeps its own palette (tuned
  // to that world's lighting), picking the colour by elevation so high ground reads
  // differently from low ground. We then darken steep faces so cliffs and drop-offs
  // pop. `elevation` can be passed in to reuse the height the mesh already computed.
  function terrainColorAt(x, z, elevation = terrainOffsetAt(x, z)) {
    const THREE = window.THREE;
    const config = levelConfig();
    const p = TERRAIN_PARAMS[config.id] || TERRAIN_PARAMS.aquarium;
    const distance = Math.hypot(x, z);
    let color;

    if (config.id === "petri") {
      color = new THREE.Color(elevation > 1.4 ? 0xf9de9b : 0xecc77b);
      if (elevation < -0.5) color.lerp(new THREE.Color(0xdcae6d), 0.5);
      LEVEL_CONFIGS[1].zones.forEach((zone) => {
        const influence = clamp(1 - Math.hypot(x - zone.x, z - zone.z) / (zone.radius * 1.08), 0, 1);
        if (influence > 0) color.lerp(new THREE.Color(zone.color), influence * 0.18);
      });
      color.lerp(new THREE.Color(0xffefbd), smoothstep(LEVEL_ONE_RADIUS * 0.78, LEVEL_ONE_RADIUS, distance) * 0.28);
    } else if (config.id === "stomach") {
      color = new THREE.Color(elevation > 3.2 ? 0xb34a75 : 0x7e274b);
      if (elevation < -1.4) color.set(0x4e1b43);
      config.zones.forEach((zone) => {
        const influence = clamp(1 - Math.hypot(x - zone.x, z - zone.z) / (zone.radius * 1.05), 0, 1);
        if (influence > 0) color.lerp(new THREE.Color(zone.color), influence * 0.26);
      });
      color.lerp(new THREE.Color(0xffb34d), smoothstep(config.radius * 0.72, config.radius, distance) * 0.18);
    } else if (config.id === "lava") {
      // Typical ground is dark cooled rock; the deepest channels glow with magma.
      color = new THREE.Color(elevation > 3.6 ? 0x5c5662 : 0x2d2630);
      if (elevation < -1.6) color.set(0xb32719);
      config.zones.forEach((zone) => {
        const influence = clamp(1 - Math.hypot(x - zone.x, z - zone.z) / (zone.radius * 1.04), 0, 1);
        if (influence > 0) color.lerp(new THREE.Color(zone.color), influence * 0.24);
      });
      color.lerp(new THREE.Color(0xff5a2f), clamp(-elevation, 0, 3) * 0.1);
    } else if (config.id === "station") {
      color = new THREE.Color(elevation > 2.0 ? 0xaeb8c6 : 0x657080);
      if (elevation < -0.8) color.set(0x44505f);
      config.zones.forEach((zone) => {
        const influence = clamp(1 - Math.hypot(x - zone.x, z - zone.z) / (zone.radius * 1.05), 0, 1);
        if (influence > 0) color.lerp(new THREE.Color(zone.color), influence * 0.2);
      });
      const seam = (Math.abs(Math.sin(x * 0.19)) < 0.035 || Math.abs(Math.sin(z * 0.19)) < 0.035) ? 0.12 : 0;
      if (seam) color.lerp(new THREE.Color(0xf8fbff), seam);
    } else {
      // Aquarium / default: sunlit weedy gravel, lighter on the high mounds.
      color = new THREE.Color(elevation > 3.0 ? 0x82d22a : 0x55b61f);
      if (elevation < -0.6) color.set(0x31a65a);
      config.zones.forEach((zone) => {
        const influence = clamp(1 - Math.hypot(x - zone.x, z - zone.z) / (zone.radius * 1.05), 0, 1);
        if (influence > 0) color.lerp(new THREE.Color(zone.color), influence * 0.22);
      });
      const edge = config.shape === "square"
        ? Math.max(Math.abs(x), Math.abs(z)) / playableHalfSize()
        : distance / WORLD_RADIUS;
      if (edge > 0.82) color.lerp(new THREE.Color(0x257f31), (edge - 0.82) / 0.18 * 0.6);
    }

    // Slope shading (every level): sample neighbouring heights to gauge steepness,
    // then darken steep faces so cliffs, ridges and drop-offs read clearly.
    const e = 1.8;
    const dx = terrainOffsetAt(x + e, z) - terrainOffsetAt(x - e, z);
    const dz = terrainOffsetAt(x, z + e) - terrainOffsetAt(x, z - e);
    const slope = clamp(Math.hypot(dx, dz) / (2 * e) / p.slopeRef, 0, 1);
    color.lerp(new THREE.Color(p.slopeColor), slope * 0.42);

    return color;
  }

  function makeWaterPatch(x, z, radius, scaleZ, rotation) {
    return makeMaterialPatch(x, z, radius, scaleZ, rotation, world.materials.water);
  }

  function makeMaterialPatch(x, z, radius, scaleZ, rotation, material) {
    const THREE = window.THREE;
    const patch = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius * 0.94, 0.035, 18),
      material || world.materials.water
    );
    patch.position.set(x, terrainVisualYAt(x, z) + 0.08, z);
    patch.scale.z = scaleZ;
    patch.rotation.y = rotation;
    addStageScenery(patch);
    return patch;
  }

  function buildScenicDepth() {
    [
      [mapCoord(-88), mapCoord(58), 18.4, 1.04, world.materials.coralPink],
      [mapCoord(-94), mapCoord(7), 16.8, 0.82, world.materials.coralPurple],
      [mapCoord(-78), mapCoord(-86), 20.8, 0.92, world.materials.coralTeal],
      [mapCoord(-45), mapCoord(-91), 22.4, 1.0, world.materials.coralGreen],
      [mapCoord(3), mapCoord(-98), 19.6, 0.92, world.materials.coralOrange],
      [mapCoord(48), mapCoord(-89), 18.8, 0.86, world.materials.coralPink],
      [mapCoord(90), mapCoord(-52), 21.4, 0.92, world.materials.coralYellow],
      [mapCoord(96), mapCoord(39), 17.6, 0.82, world.materials.coralTeal],
      [mapCoord(-8), mapCoord(92), 20.2, 0.9, world.materials.coralGreen],
    ].forEach(([x, z, height, radius, material]) => makeTallCoralPillar(x, z, height, radius, material));

    [
      [mapCoord(-78), mapCoord(-73), scenicRadius(8.6), 16, [world.materials.coralTeal, world.materials.coralPink, world.materials.coralGreen]],
      [mapCoord(-16), mapCoord(-88), scenicRadius(9.4), 18, [world.materials.coralYellow, world.materials.coralGreen, world.materials.algae]],
      [mapCoord(55), mapCoord(-82), scenicRadius(8.8), 16, [world.materials.coralOrange, world.materials.coralPink, world.materials.bacteria]],
      [mapCoord(82), mapCoord(43), scenicRadius(7.6), 15, [world.materials.coralPurple, world.materials.coralTeal, world.materials.crystal]],
      [mapCoord(-82), mapCoord(62), scenicRadius(8.0), 14, [world.materials.coralGreen, world.materials.algae, world.materials.spore]],
    ].forEach(([x, z, radius, count, materials]) => makeTubeCluster(x, z, radius, count, materials));

    for (let i = 0; i < populationCount(18); i++) {
      const pos = randomPlayablePoint(8);
      makeCausticGlint(pos.x, pos.z, rand(1.0, 3.1), rand(0, Math.PI));
    }

    for (let i = 0; i < populationCount(26); i++) {
      const pos = randomPlayablePoint(4);
      makeSuspendedDroplet(pos.x, pos.z, rand(0.55, 1.65), rand(7.5, 32));
    }

    [
      [mapCoord(-70), mapCoord(-60), 6.4, 44, -0.25],
      [mapCoord(-28), mapCoord(-70), 5.2, 48, 0.12],
      [mapCoord(10), mapCoord(-68), 6.8, 52, -0.05],
      [mapCoord(52), mapCoord(-55), 5.8, 46, 0.25],
      [mapCoord(74), mapCoord(-24), 4.8, 42, -0.2],
      [mapCoord(-78), mapCoord(23), 4.5, 40, 0.3],
    ].forEach(([x, z, width, height, yaw]) => makeLightShaft(x, z, width, height, yaw));
  }

  function makeTallCoralPillar(x, z, height, radius, material) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.55, radius, height, 6),
      material
    );
    trunk.position.y = height / 2;
    trunk.rotation.x = rand(-0.08, 0.08);
    trunk.rotation.z = rand(-0.08, 0.08);
    trunk.castShadow = false;
    group.add(trunk);

    for (let i = 0; i < 4; i++) {
      const branchHeight = rand(1.5, 3.8);
      const branch = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.28, radius * 0.42, branchHeight, 5),
        pick([world.materials.coralPink, world.materials.coralPurple, world.materials.coralTeal, world.materials.coralYellow])
      );
      const angle = (i / 4) * Math.PI * 2 + rand(-0.35, 0.35);
      branch.position.set(Math.cos(angle) * radius * 0.75, height * rand(0.36, 0.78), Math.sin(angle) * radius * 0.75);
      branch.rotation.z = Math.cos(angle) * 0.55;
      branch.rotation.x = Math.sin(angle) * 0.55;
      group.add(branch);
    }

    const cap = new THREE.Mesh(new THREE.DodecahedronGeometry(radius * 0.95, 0), pick([material, world.materials.crystal, world.materials.spore]));
    cap.position.y = height + radius * 0.5;
    group.add(cap);

    group.position.set(x, terrainOffsetAt(x, z) + 0.14, z);
    group.userData.phase = rand(0, Math.PI * 2);
    addStageScenery(group, "drift");
    return group;
  }

  function makeCausticGlint(x, z, radius, rotation) {
    const THREE = window.THREE;
    const material = world.materials.caustic.clone();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.035, 4, 28),
      material
    );
    ring.position.set(x, terrainVisualYAt(x, z) + 0.075, z);
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = rotation;
    ring.scale.z = rand(0.34, 0.78);
    ring.userData.phase = rand(0, Math.PI * 2);
    ring.userData.baseOpacity = rand(0.045, 0.11);
    ring.userData.baseScale = ring.scale.clone();
    addStageScenery(ring, "atmosphere");
    return ring;
  }

  function makeSuspendedDroplet(x, z, radius, y) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const bubble = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 9, 7),
      radius > 1.05 ? world.materials.droplet : world.materials.bubble
    );
    bubble.scale.set(1, rand(0.82, 1.18), rand(0.86, 1.12));
    group.add(bubble);

    const shine = new THREE.Mesh(new THREE.IcosahedronGeometry(radius * 0.16, 0), world.materials.white);
    shine.position.set(-radius * 0.34, radius * 0.32, -radius * 0.38);
    group.add(shine);

    group.position.set(x, y, z);
    group.userData.baseY = y;
    group.userData.speed = rand(0.25, 0.8);
    group.userData.phase = rand(0, Math.PI * 2);
    addStageScenery(group, "drift");
    return group;
  }

  function makeLightShaft(x, z, width, height, yaw) {
    const THREE = window.THREE;
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(width, height), world.materials.mist.clone());
    shaft.position.set(x, height * 0.35, z);
    shaft.rotation.y = yaw;
    shaft.rotation.z = rand(-0.08, 0.08);
    shaft.userData.phase = rand(0, Math.PI * 2);
    shaft.userData.baseOpacity = rand(0.045, 0.12);
    shaft.userData.baseScale = shaft.scale.clone();
    addStageScenery(shaft, "atmosphere");
    return shaft;
  }

  function buildStomachEnvironment() {
    for (let i = 0; i < populationCount(30); i++) {
      const pos = randomPlayablePoint(7);
      makePebblePatch(pos.x, pos.z, rand(0.65, 1.25));
    }
    for (let i = 0; i < populationCount(24); i++) {
      const pos = randomPlayablePoint(8);
      makeMicroFlower(pos.x, pos.z, rand(0.55, 1.0));
    }
    for (let i = 0; i < populationCount(28); i++) {
      const pos = randomPlayablePoint(7);
      const morsel = new window.THREE.Mesh(new window.THREE.DodecahedronGeometry(rand(0.2, 0.58), 0), pick([world.materials.foodbit, world.materials.pollen, world.materials.digestiveBubble]));
      morsel.position.set(pos.x, rand(2.4, 18), pos.z);
      morsel.userData.baseY = morsel.position.y;
      morsel.userData.speed = rand(0.4, 1.1);
      morsel.userData.phase = rand(0, Math.PI * 2);
      addStageScenery(morsel, "drift");
    }
  }

  function buildLavaEnvironment() {
    for (let i = 0; i < populationCount(34); i++) {
      const pos = randomPlayablePoint(8);
      makePebblePatch(pos.x, pos.z, rand(0.75, 1.55));
    }
    [
      [mapCoord(-64), mapCoord(48), scenicRadius(8.0), 13, [world.materials.cliff, world.materials.ashCrystal, world.materials.zoneLavaBasalt]],
      [mapCoord(62), mapCoord(-60), scenicRadius(10.0), 17, [world.materials.ashCrystal, world.materials.crystal, world.materials.zoneLavaCrystal]],
      [mapCoord(55), mapCoord(26), scenicRadius(7.8), 12, [world.materials.magmaBubble, world.materials.zoneLavaRiver, world.materials.coralOrange]],
    ].forEach(([x, z, radius, count, materials]) => makeTubeCluster(x, z, radius, count, materials));
  }

  function buildStationEnvironment() {
    for (let i = 0; i < populationCount(20); i++) {
      const pos = randomPlayablePoint(10);
      const mast = new window.THREE.Group();
      const height = rand(2.2, 6.2);
      const post = new window.THREE.Mesh(new window.THREE.CylinderGeometry(0.08, 0.12, height, 6), world.materials.labMetal);
      post.position.y = height / 2;
      mast.add(post);
      const node = new window.THREE.Mesh(new window.THREE.BoxGeometry(0.8, 0.24, 0.8), pick([world.materials.dataChip, world.materials.cameraLens, world.materials.toolpod]));
      node.position.y = height + 0.18;
      mast.add(node);
      mast.position.set(pos.x, terrainOffsetAt(pos.x, pos.z) + 0.12, pos.z);
      mast.rotation.y = rand(0, Math.PI);
      addStageScenery(mast);
    }
  }

  function buildEnvironment() {
    const THREE = window.THREE;
    const id = levelConfig().id;
    if (id === "stomach") return buildStomachEnvironment();
    if (id === "lava") return buildLavaEnvironment();
    if (id === "station") return buildStationEnvironment();

    const tubeClusters = [
      [-18, 18, 4.2, 8, [world.materials.fiberA, world.materials.coralGreen, world.materials.coralPink]],
      [20, 18, 4.2, 8, [world.materials.fiberA, world.materials.coralPink, world.materials.coralPurple]],
      [mapCoord(-64), mapCoord(45), scenicRadius(11.8), 14, [world.materials.fiberA, world.materials.coralGreen, world.materials.algae]],
      [mapCoord(-76), mapCoord(19), scenicRadius(9.8), 10, [world.materials.coralPink, world.materials.coralPurple]],
      [mapCoord(63), mapCoord(38), scenicRadius(11.6), 14, [world.materials.fiberA, world.materials.algae, world.materials.coralGreen]],
      [mapCoord(72), mapCoord(-27), scenicRadius(10.0), 11, [world.materials.coralPink, world.materials.bacteria]],
      [mapCoord(58), mapCoord(-64), scenicRadius(12.4), 15, [world.materials.coralPink, world.materials.bacteria, world.materials.coralPurple]],
      [mapCoord(-58), mapCoord(-62), scenicRadius(11.2), 13, [world.materials.coralPurple, world.materials.spore, world.materials.capsulePink]],
      [mapCoord(-22), mapCoord(-78), scenicRadius(8.6), 9, [world.materials.fiberA, world.materials.algae]],
      [mapCoord(8), mapCoord(66), scenicRadius(9.4), 16, [world.materials.coralGreen, world.materials.flowerPetal]],
      [mapCoord(83), mapCoord(54), scenicRadius(8.2), 14, [world.materials.fiberA, world.materials.coralPink]],
      [mapCoord(-83), mapCoord(-46), scenicRadius(8.4), 14, [world.materials.coralPurple, world.materials.spore]],
    ];
    tubeClusters.forEach(([x, z, radius, count, materials]) => makeTubeCluster(x, z, radius, count, materials));

    for (let i = 0; i < populationCount(78); i++) {
      const bubble = new THREE.Mesh(
        new THREE.SphereGeometry(rand(0.12, 0.62), 9, 7),
        world.materials.bubble
      );
      const pos = randomPlayablePoint(4);
      bubble.position.set(pos.x, rand(3.4, 28), pos.z);
      bubble.userData.baseY = bubble.position.y;
      bubble.userData.speed = rand(0.35, 1.15);
      bubble.userData.phase = rand(0, Math.PI * 2);
      addStageScenery(bubble, "drift");
    }

    for (let i = 0; i < populationCount(42); i++) {
      const cell = new THREE.Mesh(
        new THREE.IcosahedronGeometry(rand(0.2, 0.58), 0),
        pick([world.materials.cell, world.materials.algae, world.materials.crystal, world.materials.spore])
      );
      const pos = randomPlayablePoint(5);
      cell.position.set(pos.x, rand(2.6, 18.5), pos.z);
      cell.userData.baseY = cell.position.y;
      cell.userData.speed = rand(0.55, 1.55);
      cell.userData.phase = rand(0, Math.PI * 2);
      addStageScenery(cell, "drift");
    }

    for (let i = 0; i < populationCount(44); i++) {
      const pos = randomPlayablePoint(5);
      makePebblePatch(pos.x, pos.z, rand(0.55, 1.4));
    }

    for (let i = 0; i < populationCount(34); i++) {
      const pos = randomPlayablePoint(6);
      makeMicroFlower(pos.x, pos.z, rand(0.55, 1.1));
    }

    for (let i = 0; i < populationCount(26); i++) {
      const cilia = new THREE.Group();
      const pos = randomPlayablePoint(7);
      const height = rand(2.6, 5.2);
      const stem = new THREE.Mesh(
        new THREE.ConeGeometry(rand(0.18, 0.34), height, 5),
        i % 3 ? world.materials.fiberA : world.materials.cell
      );
      stem.position.y = height / 2;
      stem.rotation.x = rand(-0.16, 0.16);
      stem.rotation.z = rand(-0.16, 0.16);
      stem.castShadow = i % 2 === 0;
      cilia.add(stem);
      cilia.position.set(pos.x, terrainOffsetAt(pos.x, pos.z) + 0.12, pos.z);
      cilia.userData.phase = rand(0, Math.PI * 2);
      addStageScenery(cilia, "drift");
    }

    makeMicroDebris();
  }

  function makeTubeCluster(x, z, radius, count, materials) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    for (let i = 0; i < count; i++) {
      const angle = rand(0, Math.PI * 2);
      const distance = Math.sqrt(Math.random()) * radius;
      const height = rand(2.6, 8.4) * (i % 5 === 0 ? 1.26 : 1);
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(rand(0.16, 0.36), rand(0.22, 0.48), height, 6),
        pick(materials)
      );
      tube.position.set(Math.cos(angle) * distance, height / 2 + 0.12, Math.sin(angle) * distance);
      tube.rotation.x = rand(-0.18, 0.18);
      tube.rotation.z = rand(-0.18, 0.18);
      tube.castShadow = i % 4 === 0;
      group.add(tube);

      if (i % 3 === 0) {
        const cap = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.28, 0.58), 0), pick(materials));
        cap.position.set(tube.position.x, height + rand(0.32, 0.74), tube.position.z);
        cap.castShadow = false;
        group.add(cap);
      }
    }
    group.position.set(x, terrainOffsetAt(x, z), z);
    group.userData.phase = rand(0, Math.PI * 2);
    addStageScenery(group);
    return group;
  }

  function makePebblePatch(x, z, scale) {
    const THREE = window.THREE;
    const count = Math.floor(rand(3, 7));
    const group = new THREE.Group();
    for (let i = 0; i < count; i++) {
      const pebble = new THREE.Mesh(
        new THREE.DodecahedronGeometry(rand(0.18, 0.44) * scale, 0),
        pick([world.materials.cliff, world.materials.crystal, world.materials.pollen, world.materials.algae])
      );
      const angle = rand(0, Math.PI * 2);
      const distance = rand(0.15, 1.2) * scale;
      pebble.position.set(Math.cos(angle) * distance, rand(0.16, 0.38) * scale, Math.sin(angle) * distance);
      pebble.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI));
      pebble.receiveShadow = true;
      group.add(pebble);
    }
    group.position.set(x, terrainOffsetAt(x, z) + 0.12, z);
    addStageScenery(group);
  }

  function makeMicroFlower(x, z, scale) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * scale, 0.08 * scale, 0.55 * scale, 5), world.materials.fiberA);
    stem.position.y = 0.42 * scale;
    group.add(stem);
    for (let i = 0; i < 5; i++) {
      const petal = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16 * scale, 0), world.materials.flowerPetal);
      const angle = (i / 5) * Math.PI * 2;
      petal.position.set(Math.cos(angle) * 0.22 * scale, 0.74 * scale, Math.sin(angle) * 0.22 * scale);
      petal.scale.set(1.1, 0.55, 0.72);
      group.add(petal);
    }
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1 * scale, 0), world.materials.pollen);
    core.position.y = 0.74 * scale;
    group.add(core);
    group.position.set(x, terrainOffsetAt(x, z) + 0.14, z);
    group.rotation.y = rand(0, Math.PI * 2);
    addStageScenery(group);
  }

  function makeMicroDebris() {
    const THREE = window.THREE;
    const leafLitter = new THREE.Group();
    const leafMats = [world.materials.algae, world.materials.coralTeal, world.materials.fiberA, world.materials.coralGreen];
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(rand(0.34, 0.56), 10, 6), pick(leafMats));
      leaf.scale.set(rand(0.8, 1.25), rand(0.1, 0.16), rand(3.2, 5.1));
      leaf.position.set((i - 3) * rand(0.42, 0.76), rand(0.18, 0.44), rand(-0.7, 0.7));
      leaf.rotation.set(rand(-0.18, 0.18), rand(-0.95, 0.95), rand(-0.16, 0.16));
      leaf.castShadow = i % 3 === 0;
      leaf.receiveShadow = true;
      leafLitter.add(leaf);
    }
    const leafX = mapCoord(2);
    const leafZ = mapCoord(23);
    leafLitter.position.set(leafX, terrainOffsetAt(leafX, leafZ) + 0.42, leafZ);
    leafLitter.rotation.set(0.02, -0.72, 0.04);
    addStageScenery(leafLitter);

    const crater = new THREE.Mesh(new THREE.DodecahedronGeometry(3.2, 0), world.materials.pollen);
    crater.position.set(mapCoord(58), terrainOffsetAt(mapCoord(58), mapCoord(-10)) + 2.6, mapCoord(-10));
    crater.scale.set(1.1, 0.82, 0.95);
    crater.rotation.set(0.4, -0.2, 0.12);
    crater.castShadow = true;
    addStageScenery(crater);
    for (let i = 0; i < 16; i++) {
      const pit = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.18, 0.42), 0), world.materials.cliff);
      const angle = rand(0, Math.PI * 2);
      const px = mapCoord(58) + Math.cos(angle) * rand(0.8, 2.8);
      const pz = mapCoord(-10) + Math.sin(angle) * rand(0.8, 2.3);
      pit.position.set(px, terrainOffsetAt(px, pz) + 3.05, pz);
      pit.scale.y = 0.2;
      addStageScenery(pit);
    }
  }

  function toyForward(toy) {
    const yaw = toy.yaw || 0;
    return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  }

  function buildTraversalToys() {
    world.traversalToys = [];
    TRAVERSAL_TOYS.forEach((toy) => {
      const group = makeTraversalToy(toy);
      group.userData.cooldown = 0;
      group.userData.pulse = rand(0, Math.PI * 2);
      world.scene.add(group);
      world.traversalToys.push(group);
    });
  }

  function makeTraversalToy(toy) {
    if (toy.type === "ramp") return makeRampToy(toy);
    if (toy.type === "jumpPad") return makeJumpPadToy(toy);
    if (toy.type === "geyser") return makeGeyserToy(toy);
    return makeRidgeToy(toy);
  }

  function makeRampToy(toy) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    group.userData = { ...toy };
    group.position.set(toy.x, terrainOffsetAt(toy.x, toy.z) + 0.22, toy.z);
    group.rotation.y = toy.yaw;

    const deck = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.46, 9.2), world.materials.ramp);
    deck.position.y = 0.65;
    deck.rotation.x = -0.28;
    deck.castShadow = true;
    deck.receiveShadow = true;
    group.add(deck);

    [-1.6, 0, 1.6].forEach((x, index) => {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 5.8), world.materials.rampStripe);
      stripe.position.set(x, 0.96 + index * 0.02, -0.2);
      stripe.rotation.x = -0.28;
      group.add(stripe);
    });

    const lip = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 5), world.materials.jumpPadCore);
    lip.position.set(0, 1.65, -4.35);
    lip.rotation.x = -Math.PI / 2;
    group.add(lip);
    return group;
  }

  function makeJumpPadToy(toy) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    group.userData = { ...toy };
    group.position.set(toy.x, terrainOffsetAt(toy.x, toy.z) + 0.18, toy.z);
    group.rotation.y = toy.yaw;

    const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 3.2, 0.36, 10), world.materials.jumpPad);
    pad.position.y = 0.2;
    pad.receiveShadow = true;
    group.add(pad);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.35, 0.12, 6, 32), world.materials.jumpPadCore);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.46;
    group.add(ring);

    const spring = new THREE.Mesh(new THREE.ConeGeometry(0.72, 1.4, 6), world.materials.rampStripe);
    spring.position.y = 1.05;
    group.add(spring);
    group.userData.ring = ring;
    group.userData.spring = spring;
    return group;
  }

  function makeGeyserToy(toy) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    group.userData = { ...toy };
    group.position.set(toy.x, terrainOffsetAt(toy.x, toy.z) + 0.1, toy.z);

    const pool = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 2.8, 0.18, 14), world.materials.water);
    pool.position.y = 0.08;
    pool.scale.z = 0.72;
    pool.rotation.y = toy.yaw;
    group.add(pool);

    const plume = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, rand(2.8, 5.8), 6), world.materials.geyser);
      const angle = (i / 6) * Math.PI * 2;
      jet.position.set(Math.cos(angle) * rand(0.15, 0.8), jet.geometry.parameters.height / 2 + 0.24, Math.sin(angle) * rand(0.15, 0.8));
      jet.rotation.x = Math.sin(angle) * 0.14;
      jet.rotation.z = Math.cos(angle) * 0.14;
      plume.add(jet);
    }
    group.add(plume);
    group.userData.plume = plume;
    return group;
  }

  function makeRidgeToy(toy) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    group.userData = { ...toy };
    const forward = toyForward(toy);
    const baseOffset = terrainOffsetAt(toy.x, toy.z);
    group.position.set(toy.x, baseOffset + 0.06, toy.z);
    for (let i = 0; i < 9; i++) {
      const offset = (i - 4) * 2.15;
      const px = toy.x + forward.x * offset;
      const pz = toy.z + forward.z * offset;
      const step = new THREE.Mesh(new THREE.BoxGeometry(4.8 - Math.abs(i - 4) * 0.18, 0.38, 1.72), world.materials.ridgeStep);
      step.position.set(forward.x * offset, terrainOffsetAt(px, pz) - baseOffset + 0.18 + i * 0.055, forward.z * offset);
      step.rotation.y = toy.yaw;
      step.castShadow = i % 2 === 0;
      step.receiveShadow = true;
      group.add(step);
    }
    const marker = new THREE.Mesh(new THREE.ConeGeometry(0.75, 2.3, 5), world.materials.spore);
    marker.position.y = 2.0;
    group.add(marker);
    group.userData.marker = marker;
    return group;
  }

  function buildHiddenLandmarks() {
    world.landmarks = [];
    HIDDEN_LANDMARKS.forEach((landmark) => {
      const group = makeHiddenLandmark(landmark);
      group.userData.pulse = rand(0, Math.PI * 2);
      world.scene.add(group);
      world.landmarks.push(group);
    });
  }

  function makeHiddenLandmark(landmark) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    group.userData = { ...landmark, found: false };
    group.position.set(landmark.x, terrainOffsetAt(landmark.x, landmark.z) + 0.18, landmark.z);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.6, 0.52, 8), world.materials.cliff);
    base.position.y = 0.25;
    base.receiveShadow = true;
    group.add(base);

    const core = new THREE.Mesh(new THREE.DodecahedronGeometry(0.86, 0), world.materials.landmark);
    core.position.y = 1.35;
    core.castShadow = true;
    group.add(core);

    const halo = new THREE.Mesh(new THREE.TorusGeometry(1.36, 0.055, 6, 28), world.materials.landmarkGlow);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 1.42;
    group.add(halo);

    for (let i = 0; i < 5; i++) {
      const frond = new THREE.Mesh(new THREE.ConeGeometry(0.12, rand(1.1, 2.0), 5), i % 2 ? world.materials.fiberA : world.materials.coralPink);
      const angle = (i / 5) * Math.PI * 2;
      frond.position.set(Math.cos(angle) * 1.45, 0.82, Math.sin(angle) * 1.45);
      frond.rotation.z = Math.cos(angle) * 0.42;
      frond.rotation.x = Math.sin(angle) * 0.42;
      group.add(frond);
    }

    group.userData.core = core;
    group.userData.halo = halo;
    return group;
  }

  function buildSandboxZones() {
    const THREE = window.THREE;
    world.zones = [];
    SANDBOX_ZONES.forEach((zone) => {
      const group = new THREE.Group();
      const zoneOffset = terrainOffsetAt(zone.x, zone.z);
      const floor = new THREE.Mesh(
        new THREE.CylinderGeometry(zone.radius, zone.radius * 0.92, 0.045, 18),
        world.materials[zone.material]
      );
      floor.position.y = 0.035;
      floor.rotation.y = rand(0, Math.PI);
      floor.receiveShadow = true;
      group.add(floor);

      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(zone.radius * 0.93, 0.055, 6, 36),
        world.materials[zone.material]
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.12;
      group.add(rim);

      const levelId = levelConfig().id;
      if (zone.id === "forest") {
        for (let i = 0; i < populationCount(15); i++) {
          const blade = new THREE.Mesh(
            new THREE.ConeGeometry(rand(0.2, 0.52), rand(2.8, 7.4), 5),
            i % 5 === 0 ? world.materials.coralGreen : i % 3 ? world.materials.algae : world.materials.fiberA
          );
          const pos = randomPointNear(zone, zone.radius * 0.82);
          const localY = terrainOffsetAt(pos.x, pos.z) - zoneOffset;
          blade.position.set(pos.x - zone.x, localY + blade.geometry.parameters.height / 2, pos.z - zone.z);
          blade.rotation.x = rand(-0.22, 0.22);
          blade.rotation.z = rand(-0.22, 0.22);
          blade.castShadow = true;
          group.add(blade);
        }
      } else if (zone.id === "flats") {
        for (let i = 0; i < populationCount(12); i++) {
          const puddle = new THREE.Mesh(
            new THREE.CylinderGeometry(rand(1.2, 2.4), rand(1.1, 2.2), 0.035, 14),
            i % 3 === 0 ? world.materials.water : world.materials.droplet
          );
          const pos = randomPointNear(zone, zone.radius * 0.75);
          const localY = terrainOffsetAt(pos.x, pos.z) - zoneOffset;
          puddle.position.set(pos.x - zone.x, localY + 0.08, pos.z - zone.z);
          puddle.scale.z = rand(0.55, 0.9);
          puddle.rotation.y = rand(0, Math.PI);
          group.add(puddle);
        }
      } else if (zone.id === "ridge") {
        for (let i = 0; i < populationCount(13); i++) {
          const spire = new THREE.Group();
          const height = rand(2.4, 7.2);
          const core = new THREE.Mesh(
            new THREE.ConeGeometry(rand(0.26, 0.64), height, 5),
            i % 2 ? world.materials.spore : world.materials.coralPurple
          );
          core.position.y = height / 2;
          core.castShadow = i % 3 === 0;
          spire.add(core);
          const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.22, 0.46), 0), world.materials.crystal);
          cap.position.y = height + 0.24;
          spire.add(cap);
          const pos = randomPointNear(zone, zone.radius * 0.82);
          const localY = terrainOffsetAt(pos.x, pos.z) - zoneOffset;
          spire.position.set(pos.x - zone.x, localY + 0.1, pos.z - zone.z);
          spire.rotation.z = rand(-0.16, 0.16);
          group.add(spire);
        }
      } else if (levelId === "stomach") {
        for (let i = 0; i < populationCount(14); i++) {
          const fold = new THREE.Group();
          const height = rand(2.0, 6.6);
          const core = new THREE.Mesh(
            new THREE.CylinderGeometry(rand(0.22, 0.42), rand(0.36, 0.74), height, 6),
            pick([world.materials.zoneStomachPink, world.materials.zoneStomachGold, world.materials.digestiveBubble, world.materials.foodbit])
          );
          core.position.y = height / 2;
          core.scale.z = rand(0.45, 0.82);
          fold.add(core);
          const cap = new THREE.Mesh(new THREE.SphereGeometry(rand(0.18, 0.38), 8, 6), pick([world.materials.digestiveBubble, world.materials.zoneStomachMint]));
          cap.position.y = height + 0.2;
          fold.add(cap);
          const pos = randomPointNear(zone, zone.radius * 0.8);
          const localY = terrainOffsetAt(pos.x, pos.z) - zoneOffset;
          fold.position.set(pos.x - zone.x, localY + 0.1, pos.z - zone.z);
          fold.rotation.z = rand(-0.22, 0.22);
          group.add(fold);
        }
      } else if (levelId === "lava") {
        for (let i = 0; i < populationCount(15); i++) {
          const vent = new THREE.Group();
          const height = rand(1.6, 6.2);
          const core = new THREE.Mesh(
            new THREE.ConeGeometry(rand(0.34, 0.86), height, 6),
            pick([world.materials.cliff, world.materials.ashCrystal, world.materials.zoneLavaBasalt, world.materials.zoneLavaCrystal])
          );
          core.position.y = height / 2;
          core.castShadow = true;
          vent.add(core);
          if (i % 3 === 0) {
            const glow = new THREE.Mesh(new THREE.SphereGeometry(rand(0.25, 0.56), 8, 6), world.materials.magmaBubble);
            glow.position.y = height + 0.22;
            vent.add(glow);
          }
          const pos = randomPointNear(zone, zone.radius * 0.78);
          const localY = terrainOffsetAt(pos.x, pos.z) - zoneOffset;
          vent.position.set(pos.x - zone.x, localY + 0.12, pos.z - zone.z);
          vent.rotation.z = rand(-0.15, 0.15);
          group.add(vent);
        }
      } else if (levelId === "station") {
        for (let i = 0; i < populationCount(13); i++) {
          const module = new THREE.Group();
          const panel = new THREE.Mesh(
            new THREE.BoxGeometry(rand(1.8, 4.6), rand(0.26, 0.52), rand(1.2, 3.4)),
            pick([world.materials.labMetal, world.materials.toolpod, world.materials.dataChip, world.materials.cameraBody])
          );
          panel.position.y = 0.3;
          panel.castShadow = i % 2 === 0;
          module.add(panel);
          const light = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 1.2), pick([world.materials.cameraLens, world.materials.zoneStationGold]));
          light.position.y = 0.62;
          module.add(light);
          const pos = randomPointNear(zone, zone.radius * 0.76);
          const localY = terrainOffsetAt(pos.x, pos.z) - zoneOffset;
          module.position.set(pos.x - zone.x, localY + 0.16, pos.z - zone.z);
          module.rotation.y = rand(0, Math.PI);
          group.add(module);
        }
      } else {
        for (let i = 0; i < populationCount(16); i++) {
          const coral = new THREE.Group();
          const core = new THREE.Mesh(
            new THREE.DodecahedronGeometry(rand(0.38, 0.82), 0),
            pick([world.materials.bacteria, world.materials.bacteriaDark, world.materials.coralPink, world.materials.coralPurple])
          );
          core.castShadow = true;
          coral.add(core);
          for (let j = 0; j < 5; j++) {
            const spike = new THREE.Mesh(
              new THREE.ConeGeometry(0.08, rand(0.45, 0.98), 5),
              j % 2 ? world.materials.bacteriaDark : world.materials.coralPink
            );
            const angle = (j / 5) * Math.PI * 2;
            spike.position.set(Math.cos(angle) * 0.55, 0.1, Math.sin(angle) * 0.55);
            spike.rotation.z = Math.cos(angle) * 0.8;
            spike.rotation.x = Math.sin(angle) * 0.8;
            coral.add(spike);
          }
          const pos = randomPointNear(zone, zone.radius * 0.78);
          const localY = terrainOffsetAt(pos.x, pos.z) - zoneOffset;
          coral.position.set(pos.x - zone.x, localY + 0.7, pos.z - zone.z);
          group.add(coral);
        }
      }

      group.position.set(zone.x, zoneOffset, zone.z);
      group.userData.zone = zone;
      world.scene.add(group);
      world.zones.push(group);
    });
  }

  function makeNutrientRing() {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(RING_TARGET.radius, 0.16, 10, 54),
      world.materials.ring
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.18;
    group.add(ring);

    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(RING_TARGET.radius * 0.8, RING_TARGET.radius * 0.8, 0.05, 36),
      world.materials.ringCore
    );
    core.position.y = 0.04;
    group.add(core);
    world.ringCore = core;

    const beacon = new THREE.Mesh(
      new THREE.ConeGeometry(0.55, 1.8, 5),
      world.materials.ring
    );
    beacon.position.set(0, 2.1, 0);
    group.add(beacon);

    const light = new THREE.PointLight(0xffd43b, 2.8, 22);
    light.position.set(0, 2.4, 0);
    group.add(light);

    group.position.set(RING_TARGET.x, terrainOffsetAt(RING_TARGET.x, RING_TARGET.z) + 0.04, RING_TARGET.z);
    return group;
  }

  function makeGuideBeacon() {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.15, 0.055, 6, 28),
      world.materials.guide
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.12;
    group.add(ring);

    const pointer = new THREE.Mesh(
      new THREE.ConeGeometry(0.34, 1.2, 5),
      world.materials.guideCore
    );
    pointer.position.y = 2.2;
    pointer.rotation.x = Math.PI;
    group.add(pointer);

    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 1.55, 5),
      world.materials.guide
    );
    stem.position.y = 1.15;
    group.add(stem);

    const light = new THREE.PointLight(0xffd43b, 1.6, 10);
    light.position.y = 1.9;
    group.add(light);

    group.visible = false;
    group.userData.ring = ring;
    group.userData.pointer = pointer;
    return group;
  }

  function makeTardigrade() {
    const THREE = window.THREE;
    const group = new THREE.Group();
    world.bodySegments = [];
    world.legs = [];
    world.feelers = [];

    const segmentPositions = [
      [0, 1.28, -2.32, 1.12, 0.88, 0.86, world.materials.tardigradeBelly],
      [0, 1.2, -1.34, 1.45, 1.03, 1.04, world.materials.tardigradeA],
      [0, 1.16, -0.34, 1.66, 1.12, 1.14, world.materials.tardigradeA],
      [0, 1.14, 0.72, 1.68, 1.1, 1.16, world.materials.tardigradeA],
      [0, 1.18, 1.72, 1.46, 1.0, 1.02, world.materials.tardigradeB],
      [0, 1.22, 2.48, 1.02, 0.78, 0.78, world.materials.tardigradeB],
    ];

    segmentPositions.forEach(([x, y, z, sx, sy, sz, material], index) => {
      const segment = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material);
      segment.scale.set(sx, sy, sz);
      segment.position.set(x, y, z);
      segment.castShadow = true;
      segment.receiveShadow = true;
      segment.userData.base = { x, y, z };
      segment.userData.phase = index * 0.65;
      group.add(segment);
      world.bodySegments.push(segment);

      if (index > 0) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.045, 5, 18), world.materials.tardigradeStripe);
        band.position.set(x, y + 0.02, z - 0.42);
        band.scale.set(sx * 0.92, sy * 0.72, 1);
        band.castShadow = true;
        group.add(band);
      }

      if (index > 0 && index < segmentPositions.length - 1) {
        const plate = new THREE.Mesh(new THREE.DodecahedronGeometry(0.32 + index * 0.015, 0), world.materials.tardigradePlate);
        plate.position.set(0, y + sy * 0.78, z - 0.08);
        plate.scale.set(1.35, 0.34, 0.86);
        plate.rotation.y = index * 0.28;
        plate.castShadow = true;
        group.add(plate);
      }
    });

    const headMask = new THREE.Mesh(new THREE.SphereGeometry(0.72, 9, 6), world.materials.tardigradeMuzzle);
    headMask.position.set(0, 1.2, -3.0);
    headMask.scale.set(0.95, 0.76, 0.52);
    headMask.castShadow = true;
    group.add(headMask);

    const oralTube = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.24, 0.22, 8), world.materials.oralRing);
    oralTube.position.set(0, 1.16, -3.47);
    oralTube.rotation.x = Math.PI / 2;
    oralTube.castShadow = true;
    group.add(oralTube);

    const oralRim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 5, 12), world.materials.tardigradePlate);
    oralRim.position.set(0, 1.16, -3.59);
    oralRim.scale.set(0.95, 0.78, 1);
    group.add(oralRim);

    const oralOpening = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.092, 0.026, 8), world.materials.mouthDark);
    oralOpening.position.set(0, 1.16, -3.62);
    oralOpening.rotation.x = Math.PI / 2;
    group.add(oralOpening);

    [-0.16, 0.16].forEach((x) => {
      const stylet = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.26, 5), world.materials.claw);
      stylet.position.set(x, 1.15, -3.69);
      stylet.rotation.x = Math.PI / 2;
      stylet.rotation.z = x < 0 ? -0.12 : 0.12;
      group.add(stylet);
    });

    [-0.42, 0.42].forEach((x) => {
      const eyePad = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 0), world.materials.tardigradePlate);
      eyePad.position.set(x, 1.56, -3.0);
      eyePad.scale.set(1.0, 0.88, 0.38);
      eyePad.castShadow = true;
      group.add(eyePad);

      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 9, 7), world.materials.eye);
      eye.position.set(x, 1.58, -3.17);
      eye.scale.set(0.86, 1.02, 0.52);
      group.add(eye);

      const glint = new THREE.Mesh(new THREE.IcosahedronGeometry(0.052, 0), world.materials.eyeGlint);
      glint.position.set(x - 0.055 * Math.sign(x), 1.66, -3.3);
      group.add(glint);
    });

    const legPairs = [
      [-1.1, -1.55],
      [-1.34, -0.58],
      [-1.32, 0.54],
      [-1.02, 1.58],
      [1.1, -1.55],
      [1.34, -0.58],
      [1.32, 0.54],
      [1.02, 1.58],
    ];
    legPairs.forEach(([x, z], index) => {
      const leg = new THREE.Group();
      const upper = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.92, 5), world.materials.tardigradeB);
      upper.position.set(x, 0.77, z);
      upper.rotation.z = x < 0 ? -0.52 : 0.52;
      upper.castShadow = true;
      leg.add(upper);

      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 5), world.materials.tardigradeBelly);
      foot.position.set(x * 1.12, 0.28, z + (index % 2 ? 0.14 : -0.08));
      foot.scale.set(1.1, 0.58, 0.72);
      foot.castShadow = true;
      leg.add(foot);

      [-0.16, 0.16].forEach((offset) => {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.26, 5), world.materials.claw);
        claw.position.set(x * 1.18, 0.18, z + offset);
        claw.rotation.x = Math.PI;
        claw.rotation.z = x < 0 ? -0.28 : 0.28;
        leg.add(claw);
      });

      const toe = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.34, 5), world.materials.claw);
      toe.position.set(x * 1.18, 0.22, z + (index % 2 ? 0.3 : -0.24));
      foot.rotation.x = Math.PI;
      toe.rotation.x = Math.PI;
      leg.add(toe);

      leg.userData.side = x < 0 ? -1 : 1;
      leg.userData.baseZ = z;
      leg.userData.phase = index * 0.75;
      group.add(leg);
      world.legs.push(leg);
    });

    [-0.42, 0.42].forEach((x) => {
      const feeler = new THREE.Mesh(new THREE.ConeGeometry(0.052, 1.06, 5), world.materials.fiberA);
      feeler.position.set(x, 1.82, -2.88);
      feeler.rotation.x = -0.9;
      feeler.rotation.z = x * 0.45;
      group.add(feeler);
      world.feelers.push(feeler);
    });

    const tailNub = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.48, 6), world.materials.tardigradeStripe);
    tailNub.position.set(0, 1.16, 3.06);
    tailNub.rotation.x = Math.PI / 2;
    group.add(tailNub);

    const cosmeticRoot = new THREE.Group();
    cosmeticRoot.userData.kind = "cosmetics";
    group.add(cosmeticRoot);
    world.cosmeticRoot = cosmeticRoot;

    const researchCamera = makeResearchCameraAttachment();
    researchCamera.visible = false;
    group.add(researchCamera);
    world.researchCamera = researchCamera;

    group.traverse((child) => {
      if (child.isMesh) child.castShadow = false;
    });
    group.scale.setScalar(1.14);
    applyStoreCosmetics();
    return group;
  }

  function makeResearchCameraAttachment() {
    const THREE = window.THREE;
    const mount = new THREE.Group();
    mount.userData.kind = "research-camera";
    mount.position.set(0.42, 2.36, 0.92);
    mount.rotation.set(-0.12, -0.08, -0.18);

    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.035, 5, 18), world.materials.cameraBody);
    strap.position.set(-0.08, -0.08, 0);
    strap.rotation.x = Math.PI / 2;
    strap.scale.set(1.22, 0.72, 1);
    mount.add(strap);

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.42, 0.5), world.materials.cameraBody);
    body.castShadow = false;
    mount.add(body);

    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.18, 12), world.materials.cameraLens);
    lens.position.z = -0.34;
    lens.rotation.x = Math.PI / 2;
    mount.add(lens);

    const light = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), world.materials.cameraLens);
    light.position.set(0.22, 0.12, -0.28);
    mount.add(light);
    mount.userData.light = light;
    return mount;
  }

  function buildRoamingCreatures() {
    world.creatures = CREATURE_ROUTES.map((route) => {
      const creature = makeRoamingCreature(route);
      creature.userData.angle = route.phase || 0;
      creature.userData.baseScale = creatureBaseScale(route.type);
      creature.userData.bonkCooldown = 0;
      const start = creatureRoutePosition(creature.userData, 0);
      creature.position.set(start.x, start.y, start.z);
      creature.userData.prevX = start.x;
      creature.userData.prevZ = start.z;
      world.scene.add(creature);
      return creature;
    });
  }

  function makeRoamingCreature(route) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    group.userData = { ...route };

    if (route.type === "gutWorm") {
      for (let i = 0; i < 5; i++) {
        const segment = new THREE.Mesh(new THREE.SphereGeometry(0.58 - i * 0.035, 9, 7), pick([world.materials.foodbit, world.materials.zoneStomachPink, world.materials.digestiveBubble]));
        segment.position.z = -1.2 + i * 0.58;
        segment.scale.set(0.86, 0.62, 1.05);
        segment.userData.kind = "gutSegment";
        segment.userData.phase = i * 0.7;
        group.add(segment);
      }
      const whisker = new THREE.Mesh(new THREE.ConeGeometry(0.07, 1.1, 5), world.materials.zoneStomachMint);
      whisker.position.set(0, 0.08, -1.72);
      whisker.rotation.x = -Math.PI / 2;
      whisker.userData.kind = "tail";
      group.add(whisker);
    } else if (route.type === "emberSkimmer") {
      const body = new THREE.Mesh(new THREE.TetrahedronGeometry(1.05, 0), world.materials.magmaBubble);
      body.scale.set(1.3, 0.42, 1.1);
      body.rotation.y = Math.PI / 4;
      group.add(body);
      [-1, 1].forEach((side) => {
        const wing = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.6, 5), world.materials.zoneLavaSteam);
        wing.position.set(side * 0.76, 0.02, 0.16);
        wing.rotation.z = side * 1.1;
        wing.userData.kind = "fin";
        group.add(wing);
      });
      const spark = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), world.materials.zoneLavaSteam);
      spark.position.z = -0.9;
      spark.userData.kind = "rotor";
      group.add(spark);
    } else if (route.type === "labDrone") {
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.56, 1.05), world.materials.cameraBody);
      body.castShadow = true;
      group.add(body);
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.18, 12), world.materials.cameraLens);
      lens.position.z = -0.62;
      lens.rotation.x = Math.PI / 2;
      group.add(lens);
      [-0.82, 0.82].forEach((x) => {
        const rotor = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 5, 16), world.materials.labGlass);
        rotor.position.set(x, 0.08, 0);
        rotor.rotation.x = Math.PI / 2;
        rotor.userData.kind = "rotor";
        group.add(rotor);
      });
    } else if (route.type === "rotifer") {
      const body = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 7), world.materials.creatureA);
      body.scale.set(1.05, 0.58, 1.9);
      body.castShadow = true;
      group.add(body);

      const crown = new THREE.Group();
      for (let i = 0; i < 9; i++) {
        const angle = (i / 9) * Math.PI * 2;
        const cilium = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.72, 5), world.materials.creatureFin);
        cilium.position.set(Math.cos(angle) * 0.48, 0.08 + Math.sin(angle) * 0.12, -1.64 + Math.sin(angle) * 0.2);
        cilium.rotation.x = -0.8 + Math.sin(angle) * 0.22;
        cilium.rotation.z = Math.cos(angle) * 0.55;
        crown.add(cilium);
      }
      crown.userData.kind = "crown";
      group.add(crown);

      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.2, 5), world.materials.creatureB);
      tail.position.z = 1.8;
      tail.rotation.x = Math.PI / 2;
      tail.userData.kind = "tail";
      group.add(tail);
    } else if (route.type === "waterbearling") {
      const body = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 7), world.materials.tardigradeBelly);
      body.scale.set(0.78, 0.58, 1.06);
      group.add(body);
      for (let i = 0; i < 4; i++) {
        const z = -0.58 + i * 0.38;
        [-0.58, 0.58].forEach((x) => {
          const leg = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.42, 5), world.materials.claw);
          leg.position.set(x, -0.36, z);
          leg.rotation.z = x < 0 ? -0.7 : 0.7;
          group.add(leg);
        });
      }
      const eye = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), world.materials.eye);
      eye.position.set(0.34, 0.28, -0.88);
      group.add(eye);
    } else if (route.type === "sporeRay") {
      const body = new THREE.Mesh(new THREE.TetrahedronGeometry(1.12, 0), world.materials.creatureC);
      body.scale.set(1.35, 0.32, 1.1);
      body.rotation.y = Math.PI / 4;
      group.add(body);
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.58, 1.8, 5), world.materials.creatureFin);
      fin.position.z = 0.92;
      fin.rotation.x = Math.PI / 2;
      fin.userData.kind = "fin";
      group.add(fin);
    } else {
      const body = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 7), world.materials.creatureB);
      body.scale.set(0.72, 0.46, 2.05);
      group.add(body);
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.035, 5, 16), world.materials.creatureC);
      stripe.position.z = -0.45;
      stripe.scale.y = 0.58;
      group.add(stripe);
      for (let i = 0; i < 8; i++) {
        const fin = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.56, 5), world.materials.creatureFin);
        const side = i % 2 ? 1 : -1;
        fin.position.set(side * 0.58, 0.02, -0.9 + i * 0.26);
        fin.rotation.z = side * 0.95;
        fin.userData.kind = "fin";
        group.add(fin);
      }
    }

    group.scale.setScalar(creatureBaseScale(route.type));
    return group;
  }

  function creatureBaseScale(type) {
    if (type === "labDrone") return 1.55;
    if (type === "emberSkimmer") return 1.7;
    if (type === "gutWorm") return 1.55;
    if (type === "sporeRay") return 2.0;
    if (type === "rotifer") return 1.65;
    if (type === "ciliate") return 1.5;
    if (type === "waterbearling") return 1.35;
    return 1.25;
  }

  function creatureRoutePosition(data, clockOffset) {
    const angle = data.angle + clockOffset;
    const wobble = Math.sin(angle * 1.7 + data.phase) * 2.6;
    const x = data.centerX + Math.cos(angle) * data.radiusX + Math.sin(angle * 0.5 + 1.3) * wobble;
    const z = data.centerZ + Math.sin(angle * 0.92) * data.radiusZ + Math.cos(angle * 0.62) * wobble;
    return {
      x,
      z,
      y: groundYAt(x, z) + data.hover + Math.sin(state.clock * 1.8 + data.phase) * 0.38,
    };
  }

  function updateCreatures(dt, active) {
    const THREE = window.THREE;
    const player = state.player;
    world.creatures.forEach((creature, index) => {
      const data = creature.userData;
      data.angle += dt * data.speed * (active ? 1 : 0.58);
      data.bonkCooldown = Math.max(0, data.bonkCooldown - dt);
      const next = creatureRoutePosition(data, index * 0.21);
      const dx = next.x - (data.prevX ?? creature.position.x);
      const dz = next.z - (data.prevZ ?? creature.position.z);
      creature.position.set(next.x, next.y, next.z);
      if (Math.hypot(dx, dz) > 0.001) {
        creature.rotation.y = Math.atan2(-dx, -dz);
      }
      creature.rotation.x = Math.sin(state.clock * 1.4 + data.phase) * 0.05;
      creature.rotation.z = Math.cos(state.clock * 1.7 + data.phase) * 0.08;
      creature.children.forEach((child, childIndex) => {
        if (child.userData.kind === "crown") child.rotation.z += dt * 4.2;
        if (child.userData.kind === "fin") child.rotation.y = Math.sin(state.clock * 6 + childIndex) * 0.26;
        if (child.userData.kind === "tail") child.rotation.z = Math.sin(state.clock * 5 + data.phase) * 0.32;
        if (child.userData.kind === "rotor") child.rotation.z += dt * 8.5;
        if (child.userData.kind === "gutSegment") child.position.x = Math.sin(state.clock * 3.5 + child.userData.phase) * 0.12;
      });
      data.prevX = next.x;
      data.prevZ = next.z;
      const baseScale = data.baseScale || creatureBaseScale(data.type);
      creature.scale.lerp(new THREE.Vector3(baseScale, baseScale, baseScale), Math.min(1, dt * 4));

      if (!active || data.bonkCooldown > 0) return;
      const distance = Math.hypot(creature.position.x - player.x, creature.position.z - player.z);
      const playerSpeed = Math.hypot(player.vx, player.vz);
      if (distance < 3.2 && playerSpeed > 8) {
        data.bonkCooldown = 2.5;
        creature.scale.setScalar(baseScale * 1.22);
        const comboInfo = extendCombo("creature", 1, 3.2);
        const score = scoreWithCombo(210);
        addChaos(score, "Roaming microbe startled");
        showCallout("SQUIRM!", `+${score.toLocaleString()} roaming microbe startled${comboTag(comboInfo)}`);
        playTone("bonk", 0.9);
      }
    });
  }

  function zoneById(id) {
    return SANDBOX_ZONES.find((zone) => zone.id === id);
  }

  function randomPointNear(zone, spread = zone.radius) {
    let point = { x: zone.x, z: zone.z };
    for (let i = 0; i < 16; i++) {
      const angle = rand(0, Math.PI * 2);
      const distance = Math.sqrt(Math.random()) * spread;
      const x = zone.x + Math.cos(angle) * distance;
      const z = zone.z + Math.sin(angle) * distance;
      if (pointInsidePlayable(x, z, 5)) {
        point = { x, z };
        break;
      }
    }
    return point;
  }

  function addZoneProps(zoneId, entries) {
    const zone = zoneById(zoneId);
    if (!zone) return;
    entries.forEach(([type, count, spread]) => {
      for (let i = 0; i < levelPopulationCount(count); i++) addProp(type, randomPointNear(zone, spread || zone.radius * 0.82));
    });
  }

  function firstAvailableZone(ids) {
    return ids.map(zoneById).find(Boolean) || SANDBOX_ZONES[0];
  }

  function populateProps() {
    clearProps();
    clearEffects();
    STARTER_PROPS.forEach(([type, point]) => addProp(type, point));

    if (levelConfig().id === "petri") {
      addZoneProps("agar", [
        ["algae", 4],
        ["cell", 3],
        ["pollen", 2],
      ]);
      addZoneProps("algae-smear", [
        ["algae", 7],
        ["spore", 2],
        ["cell", 2],
      ]);
      addZoneProps("droplet-lane", [
        ["droplet", 3],
        ["bubble", 4],
        ["platelet", 2],
      ]);
      addZoneProps("bacteria-track", [
        ["bacteria", 4],
        ["enzyme", 2],
        ["capsule", 2],
      ]);
    } else if (levelConfig().id === "aquarium") {
      addZoneProps("forest", [
        ["algae", 14],
        ["spore", 5],
        ["cell", 5],
        ["bacteria", 2],
      ]);
      addZoneProps("flats", [
        ["droplet", 6],
        ["bubble", 7],
        ["platelet", 5],
        ["capsule", 3],
      ]);
      addZoneProps("reef", [
        ["bacteria", 8],
        ["enzyme", 4],
        ["crystal", 4],
        ["capsule", 3],
      ]);
      addZoneProps("ridge", [
        ["spore", 7],
        ["crystal", 5],
        ["enzyme", 3],
        ["pollen", 4],
      ]);
    } else if (levelConfig().id === "stomach") {
      addZoneProps("cardia-cove", [
        ["foodbit", 8],
        ["digestiveBubble", 4],
        ["cell", 3],
      ]);
      addZoneProps("mucus-rapids", [
        ["digestiveBubble", 8],
        ["droplet", 4],
        ["enzyme", 4],
      ]);
      addZoneProps("food-raft", [
        ["foodbit", 12],
        ["pollen", 4],
        ["capsule", 3],
      ]);
      addZoneProps("enzyme-sump", [
        ["enzyme", 6],
        ["digestiveBubble", 5],
        ["spore", 3],
      ]);
    } else if (levelConfig().id === "lava") {
      addZoneProps("basalt-shelf", [
        ["ashCrystal", 7],
        ["crystal", 4],
        ["spore", 2],
      ]);
      addZoneProps("ember-river", [
        ["magmaBubble", 9],
        ["ashCrystal", 3],
        ["crystal", 3],
      ]);
      addZoneProps("steam-fissure", [
        ["magmaBubble", 5],
        ["ashCrystal", 5],
        ["crystal", 4],
      ]);
      addZoneProps("crystal-caldera", [
        ["ashCrystal", 8],
        ["crystal", 6],
        ["pollen", 3],
      ]);
    } else if (levelConfig().id === "station") {
      addZoneProps("airlock-grid", [
        ["dataChip", 7],
        ["toolpod", 4],
        ["crystal", 3],
      ]);
      addZoneProps("lab-bench", [
        ["dataChip", 8],
        ["toolpod", 5],
        ["capsule", 3],
      ]);
      addZoneProps("vent-maze", [
        ["dataChip", 6],
        ["toolpod", 6],
        ["dataChip", 3],
      ]);
      addZoneProps("window-array", [
        ["dataChip", 6],
        ["crystal", 5],
        ["toolpod", 3],
      ]);
    }

    const id = levelConfig().id;
    const clusterZone = firstAvailableZone(["reef", "bacteria-track", "algae-smear", "agar"]);
    if ((id === "petri" || id === "aquarium") && clusterZone) {
      for (let i = 0; i < levelPopulationCount(5); i++) addProp("pollen", randomPointNear(clusterZone, scenicRadius(13)));
    }
    const fillers = {
      petri: [["algae", 16, 8], ["pollen", 6, 9], ["cell", 7, 9], ["bubble", 8, 9], ["crystal", 7, 10], ["capsule", 7, 9], ["droplet", 4, 10]],
      aquarium: [["algae", 16, 8], ["pollen", 6, 9], ["cell", 7, 9], ["bubble", 8, 9], ["crystal", 7, 10], ["capsule", 7, 9], ["droplet", 4, 10]],
      stomach: [["foodbit", 12, 8], ["digestiveBubble", 7, 9], ["enzyme", 6, 9], ["pollen", 5, 10], ["cell", 5, 9], ["droplet", 3, 10]],
      lava: [["ashCrystal", 10, 9], ["magmaBubble", 7, 10], ["crystal", 8, 10], ["pollen", 5, 11], ["cell", 4, 10]],
      station: [["dataChip", 10, 8], ["toolpod", 8, 9], ["crystal", 7, 10], ["capsule", 5, 9], ["pollen", 3, 10]],
    }[id] || [];
    fillers.forEach(([type, count, margin]) => {
      for (let i = 0; i < levelPopulationCount(count); i++) addProp(type, randomPlayablePoint(margin));
    });
  }

  function addProp(type, point) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    const config = {
      algae: { radius: 0.78, y: 0.72, score: 120, collect: true, mass: 0.18, material: world.materials.algae, damping: 4.2 },
      pollen: { radius: 1.35, y: 1.18, score: 180, mass: 1.4, material: world.materials.pollen, restitution: 0.74 },
      cell: { radius: 1.18, y: 0.98, score: 130, mass: 1.1, material: world.materials.cell, restitution: 0.65 },
      bubble: { radius: 1.0, y: 1.05, score: 90, mass: 0.65, material: world.materials.bubble, restitution: 0.95, friction: 0.2 },
      crystal: { radius: 1.05, y: 0.98, score: 150, mass: 1.8, material: world.materials.crystal, restitution: 0.55 },
      bacteria: { radius: 1.18, y: 1.05, score: 260, mass: 1.2, material: world.materials.bacteria, health: 2, restitution: 0.62 },
      droplet: { radius: 2.05, y: 1.46, score: 420, mass: 5.4, material: world.materials.droplet, restitution: 0.32, damping: 1.25, physicsRadius: 1.55 },
      capsule: { radius: 1.25, y: 1.08, score: 160, mass: 0.9, material: world.materials.capsulePink, collider: "cuboid", restitution: 0.82, friction: 0.36 },
      enzyme: { radius: 1.1, y: 1.06, score: 310, mass: 1.35, material: world.materials.enzyme, health: 2, restitution: 0.72 },
      platelet: { radius: 1.28, y: 0.72, score: 170, mass: 1.25, material: world.materials.platelet, collider: "cuboid", restitution: 0.78, friction: 0.42 },
      spore: { radius: 0.92, y: 0.82, score: 145, mass: 0.55, material: world.materials.spore, restitution: 0.96, friction: 0.22 },
      foodbit: { radius: 1.05, y: 0.88, score: 190, collect: true, mass: 0.28, material: world.materials.foodbit, damping: 3.8 },
      digestiveBubble: { radius: 1.28, y: 1.18, score: 330, mass: 0.72, material: world.materials.digestiveBubble, health: 1, hazard: true, restitution: 0.95, friction: 0.18 },
      magmaBubble: { radius: 1.24, y: 1.12, score: 380, mass: 0.88, material: world.materials.magmaBubble, health: 1, hazard: true, restitution: 0.82, friction: 0.28 },
      ashCrystal: { radius: 1.08, y: 1.02, score: 220, mass: 1.65, material: world.materials.ashCrystal, restitution: 0.5 },
      dataChip: { radius: 0.98, y: 0.82, score: 260, collect: true, mass: 0.2, material: world.materials.dataChip, damping: 4.1 },
      toolpod: { radius: 1.26, y: 1.04, score: 240, mass: 1.4, material: world.materials.toolpod, collider: "cuboid", restitution: 0.68, friction: 0.5 },
    }[type];

    let mesh;
    if (type === "algae") {
      mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(config.radius, 0), config.material);
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.55, 5), world.materials.fiberA);
      leaf.position.set(0.28, 0.42, 0.1);
      leaf.rotation.z = -0.7;
      group.add(leaf);
    } else if (type === "pollen") {
      mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(config.radius, 0), config.material);
      for (let i = 0; i < 10; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 5), config.material);
        const angle = (i / 10) * Math.PI * 2;
        spike.position.set(Math.cos(angle) * 1.08, 0.1 + (i % 2) * 0.45, Math.sin(angle) * 1.08);
        spike.rotation.z = Math.cos(angle) * 0.8;
        spike.rotation.x = Math.sin(angle) * 0.8;
        group.add(spike);
      }
    } else if (type === "cell") {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(config.radius, config.radius, 0.36, 14), config.material);
      mesh.scale.z = 0.72;
      mesh.rotation.x = Math.PI / 2;
    } else if (type === "bubble") {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(config.radius, 10, 7), config.material);
      const shine = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), world.materials.white);
      shine.position.set(-0.32, 0.32, -0.42);
      group.add(shine);
    } else if (type === "bacteria") {
      mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(config.radius, 0), config.material);
      for (let i = 0; i < 14; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.62, 5), world.materials.bacteriaDark);
        const angle = (i / 14) * Math.PI * 2;
        spike.position.set(Math.cos(angle) * 1.06, 0.12 + (i % 3) * 0.26, Math.sin(angle) * 1.06);
        spike.rotation.z = Math.cos(angle) * 0.95;
        spike.rotation.x = Math.sin(angle) * 0.95;
        spike.castShadow = true;
        group.add(spike);
      }
    } else if (type === "droplet") {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(config.radius, 12, 8), config.material);
      mesh.scale.set(1.05, 0.74, 0.92);
      const shine = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), world.materials.white);
      shine.position.set(-0.72, 0.58, -0.55);
      group.add(shine);
    } else if (type === "capsule") {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 2.4, 8), config.material);
      body.rotation.z = Math.PI / 2;
      body.castShadow = true;
      group.add(body);
      const capA = new THREE.Mesh(new THREE.SphereGeometry(0.47, 8, 6), world.materials.capsuleBlue);
      const capB = new THREE.Mesh(new THREE.SphereGeometry(0.47, 8, 6), config.material);
      capA.position.x = -1.2;
      capB.position.x = 1.2;
      capA.castShadow = true;
      capB.castShadow = true;
      group.add(capA, capB);
      mesh = new THREE.Object3D();
    } else if (type === "enzyme") {
      mesh = new THREE.Mesh(new THREE.TetrahedronGeometry(config.radius, 0), config.material);
      for (let i = 0; i < 5; i++) {
        const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(0.28, 0), i % 2 ? world.materials.crystal : config.material);
        const angle = (i / 5) * Math.PI * 2;
        shard.position.set(Math.cos(angle) * 0.82, 0.16 + (i % 2) * 0.34, Math.sin(angle) * 0.82);
        shard.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI));
        shard.castShadow = true;
        group.add(shard);
      }
    } else if (type === "platelet") {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(config.radius, config.radius * 0.92, 0.34, 9), config.material);
      mesh.rotation.x = Math.PI / 2;
      mesh.scale.z = 0.52;
    } else if (type === "spore") {
      mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(config.radius, 0), config.material);
      for (let i = 0; i < 6; i++) {
        const nub = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), config.material);
        const angle = (i / 6) * Math.PI * 2;
        nub.position.set(Math.cos(angle) * 0.78, 0.12 + (i % 2) * 0.35, Math.sin(angle) * 0.78);
        group.add(nub);
      }
    } else if (type === "foodbit") {
      mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(config.radius, 0), config.material);
      mesh.scale.set(1.2, 0.62, 0.92);
      const crumb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), world.materials.pollen);
      crumb.position.set(0.38, 0.46, -0.22);
      group.add(crumb);
    } else if (type === "digestiveBubble") {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(config.radius, 12, 8), config.material);
      mesh.scale.set(1.0, 0.82, 1.08);
      const shine = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 0), world.materials.white);
      shine.position.set(-0.36, 0.48, -0.52);
      group.add(shine);
    } else if (type === "magmaBubble") {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(config.radius, 10, 7), config.material);
      mesh.scale.set(1.08, 0.76, 0.96);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.84, 6), world.materials.zoneLavaSteam);
      cap.position.set(0.12, 0.92, 0);
      group.add(cap);
    } else if (type === "ashCrystal") {
      mesh = new THREE.Mesh(new THREE.OctahedronGeometry(config.radius, 0), config.material);
      mesh.scale.set(0.84, 1.28, 0.92);
    } else if (type === "dataChip") {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.26, 1.05), config.material);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.16), world.materials.cameraLens);
      stripe.position.y = 0.16;
      group.add(stripe);
    } else if (type === "toolpod") {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 2.1, 8), config.material);
      mesh.rotation.z = Math.PI / 2;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), world.materials.labMetal);
      tip.position.x = 1.05;
      group.add(tip);
    } else {
      mesh = new THREE.Mesh(new THREE.OctahedronGeometry(config.radius, 0), config.material);
      mesh.scale.y = 1.35;
    }

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const baseY = config.y + terrainOffsetAt(point.x, point.z);
    group.position.set(point.x, baseY, point.z);
    group.rotation.y = rand(0, Math.PI * 2);
    group.userData = {
      type,
      radius: config.radius,
      mass: config.mass || 1,
      collect: !!config.collect,
      score: config.score,
      velocity: new THREE.Vector3(0, 0, 0),
      spin: new THREE.Vector3(rand(-0.5, 0.5), rand(-0.8, 0.8), rand(-0.5, 0.5)),
      hitCooldown: 0,
      delivered: false,
      moved: false,
      spawnX: point.x,
      spawnZ: point.z,
      destructible: type === "bacteria" || type === "capsule" || type === "enzyme" || !!config.hazard,
      hazard: !!config.hazard,
      health: config.health || (type === "capsule" ? 1 : 0),
      baseHeight: config.y,
      baseY,
    };
    attachPhysicsBody(group, config);
    world.scene.add(group);
    world.props.push(group);
  }

  function randomPoint(radius) {
    let x = 0;
    let z = 0;
    let tries = 0;
    do {
      const angle = rand(0, Math.PI * 2);
      const distance = Math.sqrt(Math.random()) * radius;
      x = Math.cos(angle) * distance;
      z = Math.sin(angle) * distance;
      tries += 1;
    } while (
      tries < 18 &&
      Math.hypot(x - state.player.x, z - state.player.z) < 7
    );
    return { x, z };
  }

  function randomPlayablePoint(margin = 0) {
    if (levelConfig().shape === "square") {
      const limit = playableHalfSize() - margin;
      let x = 0;
      let z = 0;
      let tries = 0;
      do {
        x = rand(-limit, limit);
        z = rand(-limit, limit);
        tries += 1;
      } while (
        tries < 18 &&
        Math.hypot(x - state.player.x, z - state.player.z) < 7
      );
      return { x, z };
    }
    return randomPoint(playableRadius() - margin);
  }

  function clearProps() {
    world.props.forEach((prop) => {
      removePhysicsBody(prop);
      world.scene.remove(prop);
      disposeObject(prop);
    });
    world.props = [];
  }

  function clearEffects() {
    world.effects.forEach((effect) => {
      world.scene.remove(effect);
      disposeObject(effect);
    });
    world.effects = [];
  }

  function disposeObject(object) {
    object.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
    });
  }

  function saveStoreState() {
    try {
      if (!window.localStorage) return;
      window.localStorage.setItem(STORE_STORAGE_KEY, JSON.stringify({
        coins: state.store.coins,
        owned: [...state.store.owned],
        equipped: state.store.equipped,
      }));
    } catch (error) {}
  }

  function addStoreCoins(amount, announce = false) {
    const gain = Math.max(0, Math.floor(amount));
    if (!gain) return;
    state.store.coins += gain;
    saveStoreState();
    syncStoreUi();
    if (announce) showPrompt(`+${gain.toLocaleString()} GEL added to the micro wallet.`);
  }

  function syncStoreUi() {
    if (el.storeWallet) el.storeWallet.textContent = `${state.store.coins.toLocaleString()} GEL`;
    if (el.storeWalletChip) el.storeWalletChip.textContent = state.store.coins.toLocaleString();
    if (state.store.open) renderStore();
  }

  function renderStore() {
    if (!el.storeItems) return;
    if (el.storeWallet) el.storeWallet.textContent = `${state.store.coins.toLocaleString()} GEL`;
    if (el.storeWalletChip) el.storeWalletChip.textContent = state.store.coins.toLocaleString();
    el.storeItems.innerHTML = STORE_ITEMS.map((item) => {
      const owned = state.store.owned.has(item.id);
      const equipped = state.store.equipped[item.slot] === item.id;
      const affordable = state.store.coins >= item.cost;
      const action = owned ? "equip" : "buy";
      const disabled = owned ? false : !affordable;
      const buttonLabel = owned
        ? (equipped ? (item.slot === "skin" ? "Equipped" : "Unequip") : "Equip")
        : `Buy ${item.cost.toLocaleString()}`;
      return `
        <article class="micro-store-card${equipped ? " is-equipped" : ""}">
          <i class="micro-store-card__icon" aria-hidden="true">${item.icon}</i>
          <span class="micro-store-card__copy">
            <b>${item.name}</b>
            <span>${item.description}</span>
            <em>${owned ? (equipped ? "Equipped" : "Owned") : item.cost.toLocaleString() + " GEL"}</em>
          </span>
          <button class="btn ${owned ? "btn--secondary" : "btn--yellow"}" type="button" data-store-action="${action}" data-store-id="${item.id}"${disabled || (owned && equipped && item.slot === "skin") ? " disabled" : ""}>${buttonLabel}</button>
        </article>
      `;
    }).join("");
  }

  function openStore() {
    if (!el.storeModal) return;
    state.store.wasPaused = !!state.paused;
    state.store.open = true;
    if (document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock();
    if (state.running && !state.gameOver) state.paused = true;
    el.storeModal.classList.add("is-open");
    el.storeModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("micro-store-open");
    renderStore();
    syncPlayMode();
    resetVirtualControls();
    if (el.storeClose) el.storeClose.focus({ preventScroll: true });
  }

  function closeStore() {
    if (!state.store.open) return;
    state.store.open = false;
    if (el.storeModal) {
      el.storeModal.classList.remove("is-open");
      el.storeModal.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("micro-store-open");
    if (state.running && !state.gameOver && !state.store.wasPaused) {
      state.paused = false;
      state.lastTime = performance.now();
      anchorGameViewport();
      canvas.focus();
    }
    syncPlayMode();
  }

  function handleStoreAction(event) {
    const target = event.target && event.target.closest ? event.target : event.target && event.target.parentElement;
    const button = target && target.closest("[data-store-action]");
    if (!button) return;
    const item = STORE_ITEM_BY_ID.get(button.dataset.storeId);
    if (!item) return;
    if (button.dataset.storeAction === "buy") buyStoreItem(item);
    else equipStoreItem(item);
  }

  function buyStoreItem(item) {
    if (state.store.owned.has(item.id)) {
      equipStoreItem(item);
      return;
    }
    if (state.store.coins < item.cost) {
      const missing = item.cost - state.store.coins;
      showPrompt(`${missing.toLocaleString()} more GEL needed for ${item.name}.`);
      playTone("bonk", 0.75);
      renderStore();
      return;
    }
    state.store.coins -= item.cost;
    state.store.owned.add(item.id);
    equipStoreItem(item, false);
    showCallout("PURCHASED!", `${item.name} equipped`);
    playTone("level", 1.1);
  }

  function equipStoreItem(item, alreadySaved = true) {
    if (!state.store.owned.has(item.id)) return;
    const current = state.store.equipped[item.slot];
    if (current === item.id && item.slot !== "skin") {
      state.store.equipped[item.slot] = "";
      showPrompt(`${item.name} removed.`);
    } else {
      state.store.equipped[item.slot] = item.id;
      showPrompt(`${item.name} equipped.`);
    }
    if (item.slot === "skin" && !state.store.equipped.skin) state.store.equipped.skin = "skin-classic";
    saveStoreState();
    syncStoreUi();
    applyStoreCosmetics();
    if (alreadySaved) playTone("level", 0.82);
  }

  function applyStoreCosmetics() {
    applyStoreSkin();
    rebuildStoreAttachments();
    syncStoreUi();
  }

  function applyStoreSkin() {
    const skinId = state.store.equipped.skin || "skin-classic";
    const palette = STORE_SKINS[skinId] || STORE_SKINS["skin-classic"];
    world.bodySegments.forEach((segment, index) => {
      const materialName = palette[index] || palette[palette.length - 1];
      segment.material = world.materials[materialName] || segment.material;
    });
    world.legs.forEach((leg) => {
      leg.children.forEach((child, index) => {
        if (!child.isMesh) return;
        if (index === 0) child.material = world.materials[palette[4]] || child.material;
        if (index === 1) child.material = world.materials[palette[0]] || child.material;
      });
    });
  }

  function rebuildStoreAttachments() {
    if (!world.cosmeticRoot) return;
    while (world.cosmeticRoot.children.length) {
      const child = world.cosmeticRoot.children[0];
      world.cosmeticRoot.remove(child);
      disposeObject(child);
    }
    ["head", "face", "back"].forEach((slot) => {
      const item = STORE_ITEM_BY_ID.get(state.store.equipped[slot]);
      if (!item) return;
      const attachment = makeStoreAttachment(item.id);
      if (!attachment) return;
      attachment.userData.slot = slot;
      world.cosmeticRoot.add(attachment);
    });
  }

  function makeStoreAttachment(id) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    if (id === "hat-party") {
      const hat = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.92, 5), world.materials.storeHotPink);
      hat.position.set(0, 2.18, -2.92);
      hat.rotation.z = -0.12;
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), world.materials.storeGold);
      puff.position.set(0.04, 2.68, -2.96);
      group.add(hat, puff);
    } else if (id === "hat-crown") {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.045, 5, 18), world.materials.storeGold);
      band.position.set(0, 2.12, -2.93);
      band.scale.y = 0.52;
      for (let i = 0; i < 5; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.38, 5), world.materials.storeGold);
        const angle = (i / 5) * Math.PI * 2;
        spike.position.set(Math.cos(angle) * 0.29, 2.24, -2.93 + Math.sin(angle) * 0.17);
        group.add(spike);
      }
      group.add(band);
    } else if (id === "face-goggles") {
      [-0.42, 0.42].forEach((x) => {
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.035, 5, 16), world.materials.storeRocket);
        rim.position.set(x, 1.58, -3.34);
        const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.02, 10), world.materials.creatureGlass || world.materials.bubble);
        lens.position.set(x, 1.58, -3.35);
        lens.rotation.x = Math.PI / 2;
        group.add(rim, lens);
      });
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.04, 0.05), world.materials.storeRocket);
      bridge.position.set(0, 1.58, -3.34);
      group.add(bridge);
    } else if (id === "back-flag") {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.1, 6), world.materials.claw);
      pole.position.set(0.48, 2.0, -0.1);
      pole.rotation.z = -0.22;
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.36, 0.05), world.materials.storeFlag);
      flag.position.set(0.76, 2.3, -0.14);
      group.add(pole, flag);
    } else if (id === "back-pizza") {
      const slice = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 0.14, 3), world.materials.storePizza);
      slice.position.set(0, 2.08, 0.35);
      slice.rotation.set(Math.PI / 2, 0.58, 0);
      const pepperoniA = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.025, 8), world.materials.storeRed);
      const pepperoniB = pepperoniA.clone();
      pepperoniA.position.set(-0.16, 2.17, 0.24);
      pepperoniB.position.set(0.18, 2.16, 0.44);
      pepperoniA.rotation.x = Math.PI / 2;
      pepperoniB.rotation.x = Math.PI / 2;
      group.add(slice, pepperoniA, pepperoniB);
    } else if (id === "back-rocket") {
      [-0.34, 0.34].forEach((x) => {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.74, 8), world.materials.storeRocket);
        body.position.set(x, 1.88, 1.12);
        body.rotation.x = Math.PI / 2;
        const cap = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.28, 8), world.materials.storeRed);
        cap.position.set(x, 1.88, 0.69);
        cap.rotation.x = -Math.PI / 2;
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.42, 7), world.materials.storeGold);
        flame.position.set(x, 1.88, 1.58);
        flame.rotation.x = Math.PI / 2;
        flame.userData.kind = "rocketFlame";
        group.add(body, cap, flame);
      });
    }
    group.traverse((child) => {
      if (child.isMesh) child.castShadow = false;
    });
    return group;
  }

  function bindInputs() {
    window.addEventListener("keydown", (event) => {
      const key = event.key;
      if (state.store.open && (key === "Escape" || key === "Esc")) {
        closeStore();
        event.preventDefault();
        return;
      }
      if (state.store.open) return;
      if ((key === "Enter" || key === "Return") && state.stageAdvanceAvailable) {
        acceptStageAdvance();
        event.preventDefault();
      } else if (key === "ArrowUp" || key === "w" || key === "W") {
        state.input.forward = 1;
        event.preventDefault();
      } else if (key === "ArrowDown" || key === "s" || key === "S") {
        state.input.forward = -1;
        event.preventDefault();
      } else if (key === "ArrowLeft" || key === "a" || key === "A") {
        state.input.right = -1;
        event.preventDefault();
      } else if (key === "ArrowRight" || key === "d" || key === "D") {
        state.input.right = 1;
        event.preventDefault();
      } else if (key === " " && !event.repeat) {
        jump();
        event.preventDefault();
      } else if (key === "Shift" && !event.repeat) {
        dash();
        event.preventDefault();
      } else if (key === "e" || key === "E") {
        setCurlSource("keyboard", true);
        event.preventDefault();
      } else if (key === "q" || key === "Q") {
        state.camera.targetYaw -= 0.22;
      } else if (key === "r" || key === "R") {
        state.camera.targetYaw += 0.22;
      } else if (key === "p" || key === "P" || key === "Escape") {
        togglePause();
      } else if (isLocalQA() && key === "F9") {
        forceIncidentReport();
        event.preventDefault();
      } else if (isLocalQA() && key === "F10") {
        forceCurrentStageCompletion();
        event.preventDefault();
      } else if (isLocalQA() && key === "F5") {
        acceptStageAdvance();
        event.preventDefault();
      } else if (isLocalQA() && key === "F8") {
        forceFailureReport();
        event.preventDefault();
      } else if (isLocalQA() && key === "F7") {
        qaTeleportToLandmark();
        event.preventDefault();
      } else if (isLocalQA() && key === "F6") {
        qaTeleportToTraversalToy();
        event.preventDefault();
      } else if ((key === "Enter" || key === "Return") && !state.running) {
        startGame();
      }
    });

    window.addEventListener("keyup", (event) => {
      const key = event.key;
      if ((key === "ArrowUp" || key === "w" || key === "W") && state.input.forward > 0) state.input.forward = 0;
      if ((key === "ArrowDown" || key === "s" || key === "S") && state.input.forward < 0) state.input.forward = 0;
      if ((key === "ArrowLeft" || key === "a" || key === "A") && state.input.right < 0) state.input.right = 0;
      if ((key === "ArrowRight" || key === "d" || key === "D") && state.input.right > 0) state.input.right = 0;
      if (key === "e" || key === "E") setCurlSource("keyboard", false);
    });

    let pointer = null;
    document.addEventListener("mousemove", (event) => {
      if (document.pointerLockElement !== canvas) return;
      if (!state.running || state.paused || state.gameOver) return;
      applyCameraLook(event.movementX || 0, event.movementY || 0);
    });
    document.addEventListener("pointerlockchange", () => {
      state.camera.mouseLook = document.pointerLockElement === canvas;
      if (state.camera.mouseLook) showPrompt("Mouse look active. WASD moves, Space jumps, Shift bonks.");
    });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener("pointerdown", (event) => {
      canvas.focus();
      if (!state.running) {
        startGame();
        return;
      }
      if (event.pointerType === "mouse") {
        requestMouseLook();
      }
      pointer = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: false,
        type: event.pointerType,
      };
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (error) {
        // Some automated or synthesized pointer events cannot be captured.
      }
    });
    canvas.addEventListener("pointermove", (event) => {
      if (document.pointerLockElement === canvas) return;
      if (!pointer || pointer.id !== event.pointerId) {
        if (event.pointerType === "mouse" && state.running && !state.paused && !state.gameOver) {
          applyCameraLook(event.movementX || 0, event.movementY || 0);
        }
        return;
      }
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) pointer.moved = true;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      applyCameraLook(dx, dy);
    });
    canvas.addEventListener("pointerup", (event) => {
      if (pointer && pointer.id === event.pointerId && pointer.type !== "mouse" && !pointer.moved) jump();
      pointer = null;
    });
    canvas.addEventListener("pointercancel", () => { pointer = null; });

    el.primary.addEventListener("click", () => {
      if (state.paused) togglePause();
      else if (state.gameOver) startGame();
      else startGame();
    });
    el.pause.addEventListener("click", togglePause);
    el.restart.addEventListener("click", startGame);
    if (saveSlot) {
      saveMenu = saveSlot.attachButtons({
        primary: el.primary,
        scoreEl: el.overlayScore,
        continueLabel: "Continue specimen",
        newLabel: "New specimen",
        onContinue: restoreGame,
        summary: (saved) => {
          const data = saved.data || {};
          return `${window.RBGameSaves.formatSavedAt(saved.savedAt)} · Stage <strong>${Number(data.stage || 1)}</strong> · Chaos <strong>${format(Number(data.chaos || 0))}</strong>`;
        },
      });
      saveSlot.startAutosave(snapshot, () => state.ready && state.running && !state.gameOver);
    }
    if (el.sound) el.sound.addEventListener("click", toggleSound);
    if (el.store) el.store.addEventListener("click", openStore);
    if (el.advance) el.advance.addEventListener("click", acceptStageAdvance);
    if (el.storeClose) el.storeClose.addEventListener("click", closeStore);
    if (el.storeItems) el.storeItems.addEventListener("click", handleStoreAction);
    if (el.storeModal) {
      el.storeModal.addEventListener("pointerdown", (event) => {
        if (event.target === el.storeModal) closeStore();
      });
    }

    bindHold(el.forward, () => { state.input.virtualForward = 1; }, () => { if (state.input.virtualForward > 0) state.input.virtualForward = 0; });
    bindHold(el.back, () => { state.input.virtualForward = -1; }, () => { if (state.input.virtualForward < 0) state.input.virtualForward = 0; });
    bindHold(el.left, () => { state.input.virtualRight = -1; }, () => { if (state.input.virtualRight < 0) state.input.virtualRight = 0; });
    bindHold(el.right, () => { state.input.virtualRight = 1; }, () => { if (state.input.virtualRight > 0) state.input.virtualRight = 0; });
    bindTouchStick(el.touchStick, el.touchStickKnob);
    bindTap(el.jump, jump);
    bindTap(el.dash, dash);
    bindHold(el.curl, () => setCurlSource("touch", true), () => setCurlSource("touch", false));
  }

  function requestMouseLook() {
    if (!canvas.requestPointerLock || document.pointerLockElement === canvas) return;
    try {
      const request = canvas.requestPointerLock();
      if (request && request.catch) request.catch(() => {});
    } catch (_) {}
  }

  function applyCameraLook(dx, dy) {
    state.camera.targetYaw -= dx * CAMERA_YAW_SENSITIVITY;
    state.camera.targetPitch = clamp(state.camera.targetPitch + dy * CAMERA_PITCH_SENSITIVITY, 0.24, 0.82);
  }

  function setCurlSource(source, held) {
    if (source === "keyboard") state.input.keyboardCurl = held;
    else state.input.virtualCurl = held;
    state.curlHeld = !!(state.input.keyboardCurl || state.input.virtualCurl);
  }

  function resetVirtualControls() {
    state.input.virtualForward = 0;
    state.input.virtualRight = 0;
    state.input.virtualCurl = false;
    state.curlHeld = !!state.input.keyboardCurl;
    if (el.touchStick) el.touchStick.classList.remove("is-active");
    if (el.touchStickKnob) el.touchStickKnob.style.transform = "";
    [el.jump, el.dash, el.curl, el.forward, el.back, el.left, el.right].forEach((button) => {
      if (button) button.classList.remove("is-held");
    });
  }

  function bindTouchStick(stick, knob) {
    if (!stick || !knob) return;
    let pointerId = null;
    const deadZone = 0.13;
    const update = (event) => {
      const rect = stick.getBoundingClientRect();
      const max = Math.max(32, Math.min(rect.width, rect.height) * 0.34);
      let dx = event.clientX - (rect.left + rect.width / 2);
      let dy = event.clientY - (rect.top + rect.height / 2);
      const distance = Math.hypot(dx, dy);
      if (distance > max) {
        const scale = max / distance;
        dx *= scale;
        dy *= scale;
      }
      const inputX = Math.abs(dx / max) < deadZone ? 0 : dx / max;
      const inputY = Math.abs(dy / max) < deadZone ? 0 : dy / max;
      state.input.virtualRight = clamp(inputX, -1, 1);
      state.input.virtualForward = clamp(-inputY, -1, 1);
      knob.style.transform = `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px))`;
    };
    const release = () => {
      pointerId = null;
      state.input.virtualForward = 0;
      state.input.virtualRight = 0;
      stick.classList.remove("is-active");
      knob.style.transform = "";
    };
    stick.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (!state.running) startGame();
      pointerId = event.pointerId;
      stick.classList.add("is-active");
      try {
        stick.setPointerCapture(event.pointerId);
      } catch (_) {}
      update(event);
    });
    stick.addEventListener("pointermove", (event) => {
      if (event.pointerId !== pointerId) return;
      event.preventDefault();
      update(event);
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((eventName) => {
      stick.addEventListener(eventName, (event) => {
        if (event.pointerId !== pointerId && eventName !== "lostpointercapture") return;
        event.preventDefault();
        release();
      });
    });
    window.addEventListener("pointerup", (event) => {
      if (event.pointerId === pointerId) release();
    });
    window.addEventListener("pointercancel", (event) => {
      if (event.pointerId === pointerId) release();
    });
    window.addEventListener("mouseup", release);
    window.addEventListener("touchend", release, { passive: true });
    window.addEventListener("touchcancel", release, { passive: true });
    window.addEventListener("blur", release);
  }

  function bindTap(button, action) {
    if (!button) return;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.classList.add("is-held");
      action();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
      button.addEventListener(eventName, () => {
        button.classList.remove("is-held");
      });
    });
  }

  function bindHold(button, down, up) {
    if (!button) return;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.classList.add("is-held");
      down();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
      button.addEventListener(eventName, (event) => {
        event.preventDefault();
        button.classList.remove("is-held");
        up();
      });
    });
  }

  function ensureAudio() {
    if (!audio.enabled || audio.ctx) return audio.ctx;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    audio.ctx = new AudioContext();
    audio.unlocked = true;
    return audio.ctx;
  }

  function toggleSound() {
    audio.enabled = !audio.enabled;
    if (audio.enabled) {
      ensureAudio();
      playTone("level");
    }
    if (el.sound) el.sound.textContent = audio.enabled ? "Sound On" : "Muted";
  }

  function playTone(kind, intensity = 1) {
    if (!audio.enabled) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    const now = ctx.currentTime;
    const master = ctx.createGain();
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const settings = {
      jump: [220, 420, "triangle", 0.08],
      dash: [95, 180, "sawtooth", 0.1],
      munch: [520, 740, "square", 0.09],
      bonk: [140, 78, "triangle", 0.13],
      break: [260, 95, "sawtooth", 0.16],
      level: [460, 920, "triangle", 0.18],
      water: [180, 260, "sine", 0.16],
    }[kind] || [260, 340, "triangle", 0.1];
    const [startFrequency, endFrequency, type, duration] = settings;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1800 + intensity * 700, now);
    osc.type = type;
    osc.frequency.setValueAtTime(startFrequency, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(Math.min(0.18, 0.055 * intensity), now + 0.01);
    master.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(filter);
    filter.connect(master);
    master.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  function startGame() {
    if (!state.ready) return;
    if (saveSlot) saveSlot.clear();
    ensureAudio();
    resetGame(true);
    hideOverlay();
    syncPlayMode();
    anchorGameViewport();
    canvas.focus();
    announceGoal();
  }

  function snapshot() {
    return {
      clock: state.clock,
      sessionTime: state.sessionTime,
      chaos: state.chaos,
      snacks: state.snacks,
      bonks: state.bonks,
      ringFed: state.ringFed,
      bacteriaBashed: state.bacteriaBashed,
      waterMoved: state.waterMoved,
      propsBroken: state.propsBroken,
      combo: state.combo,
      comboTimer: state.comboTimer,
      lastComboAction: state.lastComboAction,
      hydrate: state.hydrate,
      stage: state.stage,
      level: state.level,
      xp: state.xp,
      goalIndex: state.goalIndex,
      promptTimer: state.promptTimer,
      dashCooldown: state.dashCooldown,
      maxCombo: state.maxCombo,
      goalsCleared: state.goalsCleared,
      stageChaos: state.stageChaos,
      stageBonks: state.stageBonks,
      stageHazards: state.stageHazards,
      stageCollects: state.stageCollects,
      stageResearchScans: state.stageResearchScans,
      stageAdvanceAvailable: state.stageAdvanceAvailable,
      pendingStage: state.pendingStage,
      researchCameraUnlocked: state.researchCameraUnlocked,
      zoneId: state.zoneId,
      zoneName: state.zoneName,
      zonesVisited: Array.from(state.zonesVisited),
      miniComplete: Array.from(state.miniComplete),
      toysUsed: Array.from(state.toysUsed),
      landmarksFound: Array.from(state.landmarksFound),
      desiccationActive: state.desiccationActive,
      player: { ...state.player },
      camera: { ...state.camera },
    };
  }

  function restoreGame(saved) {
    const data = saved && saved.data;
    if (!state.ready || !data) return;
    resetGame(false);
    const maxStage = Math.max(...Object.keys(LEVEL_CONFIGS).map((key) => Number(key) || 1));
    const stage = Math.max(1, Math.min(maxStage, Number(data.stage) || 1));
    if (stage !== state.stage) transitionToStage(stage);
    Object.assign(state, {
      running: true,
      paused: false,
      gameOver: false,
      clock: Number(data.clock) || 0,
      sessionTime: Math.max(0, Number(data.sessionTime) || 0),
      chaos: Number(data.chaos) || 0,
      snacks: Number(data.snacks) || 0,
      bonks: Number(data.bonks) || 0,
      ringFed: Number(data.ringFed) || 0,
      bacteriaBashed: Number(data.bacteriaBashed) || 0,
      waterMoved: Number(data.waterMoved) || 0,
      propsBroken: Number(data.propsBroken) || 0,
      combo: Number(data.combo) || 0,
      comboTimer: Number(data.comboTimer) || 0,
      lastComboAction: data.lastComboAction || "",
      hydrate: clamp(Number(data.hydrate) || 100, 0, 100),
      stage,
      level: Math.max(1, Number(data.level) || 1),
      xp: Math.max(0, Number(data.xp) || 0),
      goalIndex: Math.max(0, Number(data.goalIndex) || firstGoalIndexForStage(stage)),
      promptTimer: Number(data.promptTimer) || 2,
      dashCooldown: Math.max(0, Number(data.dashCooldown) || 0),
      maxCombo: Number(data.maxCombo) || 0,
      goalsCleared: Number(data.goalsCleared) || 0,
      stageChaos: Number(data.stageChaos) || 0,
      stageBonks: Number(data.stageBonks) || 0,
      stageHazards: Number(data.stageHazards) || 0,
      stageCollects: Number(data.stageCollects) || 0,
      stageResearchScans: Number(data.stageResearchScans) || 0,
      stageAdvanceAvailable: Boolean(data.stageAdvanceAvailable),
      pendingStage: Number(data.pendingStage) || 0,
      researchCameraUnlocked: Boolean(data.researchCameraUnlocked),
      zoneId: data.zoneId || "",
      zoneName: data.zoneName || levelConfig(stage).name,
      zonesVisited: new Set(Array.isArray(data.zonesVisited) ? data.zonesVisited : []),
      miniComplete: new Set(Array.isArray(data.miniComplete) ? data.miniComplete : []),
      toysUsed: new Set(Array.isArray(data.toysUsed) ? data.toysUsed : []),
      landmarksFound: new Set(Array.isArray(data.landmarksFound) ? data.landmarksFound : []),
      desiccationActive: Boolean(data.desiccationActive),
      lastTime: performance.now(),
    });
    Object.assign(state.player, data.player || {});
    Object.assign(state.camera, data.camera || {});
    world.landmarks.forEach((landmark) => {
      landmark.userData.found = state.landmarksFound.has(landmark.userData.id);
      landmark.scale.setScalar(landmark.userData.found ? 0.72 : 1);
    });
    updatePlayerTransform(0);
    updateGoalText();
    updateHUD();
    hideOverlay();
    syncPlayMode();
    canvas.focus();
  }

  function syncPlayMode() {
    const active = state.running && !state.gameOver;
    document.body.classList.toggle("micro-play-active", active);
    document.body.classList.toggle("micro-play-paused", active && state.paused);
    if (!active || state.paused) resetVirtualControls();
    requestAnimationFrame(resize);
  }

  function isLocalQA() {
    return location.hostname === "127.0.0.1" || location.hostname === "localhost";
  }

  function forceIncidentReport() {
    if (!state.ready) return;
    state.running = true;
    state.paused = false;
    state.gameOver = false;
    state.snacks = Math.max(state.snacks, GOAL_TARGETS.algae);
    state.bacteriaBashed = Math.max(state.bacteriaBashed, GOAL_TARGETS.bacteria);
    state.waterMoved = Math.max(state.waterMoved, GOAL_TARGETS.water);
    state.ringFed = Math.max(state.ringFed, targetValue(missionById("ring")));
    state.maxCombo = Math.max(state.maxCombo, targetValue(missionById("combo")));
    state.toysUsed = new Set(TRAVERSAL_TOYS.map((toy) => toy.id));
    state.landmarksFound = new Set(HIDDEN_LANDMARKS.map((landmark) => landmark.id));
    state.propsBroken = Math.max(state.propsBroken, 5);
    state.sessionTime = SANDBOX_SECONDS;
    state.zonesVisited = new Set(SANDBOX_ZONES.map((zone) => zone.id));
    state.miniComplete = new Set(MINI_MISSIONS.map((mission) => mission.id));
    state.goalsCleared = Math.max(state.goalsCleared, GOALS.length);
    state.goalIndex = GOALS.length - 1;
    state.chaos = Math.max(state.chaos, GOAL_TARGETS.chaos);
    updateHUD();
    winGame();
  }

  function forceCurrentStageCompletion() {
    if (!state.ready) return;
    if (!state.running) startGame();
    state.running = true;
    state.paused = false;
    state.gameOver = false;
    currentStageGoals().forEach((goal) => {
      const target = targetValue(goal);
      if (goal.id === "algae") state.snacks = Math.max(state.snacks, target);
      if (goal.id === "bacteria") state.bacteriaBashed = Math.max(state.bacteriaBashed, target);
      if (goal.id === "water") state.waterMoved = Math.max(state.waterMoved, target);
      if (goal.id === "ring") state.ringFed = Math.max(state.ringFed, target);
      if (goal.id === "zones") state.zonesVisited = new Set(SANDBOX_ZONES.slice(0, target).map((zone) => zone.id));
      if (goal.id === "landmarks") {
        state.landmarksFound = new Set(HIDDEN_LANDMARKS.slice(0, target).map((landmark) => landmark.id));
        world.landmarks.forEach((landmark) => {
          if (state.landmarksFound.has(landmark.userData.id)) landmark.userData.found = true;
        });
      }
      if (goal.id === "hazards") state.stageHazards = Math.max(state.stageHazards, target);
      if (goal.id === "toys") state.toysUsed = new Set(TRAVERSAL_TOYS.slice(0, target).map((toy) => toy.id));
      if (goal.id === "scans") state.stageResearchScans = Math.max(state.stageResearchScans, target);
      if (goal.id === "chaos") state.stageChaos = Math.max(state.stageChaos, target);
    });
    while (!state.stageAdvanceAvailable && !state.gameOver && GOALS[state.goalIndex] && GOALS[state.goalIndex].stage === state.stage) {
      updateGoals();
    }
    updateHUD();
  }

  function forceLevelOneCompletion() {
    forceCurrentStageCompletion();
  }

  function forceFailureReport() {
    if (!state.ready) return;
    state.running = true;
    state.paused = false;
    state.gameOver = false;
    state.sessionTime = Math.max(state.sessionTime, 42);
    state.hydrate = 0;
    updateHUD();
    endGame("ANHYDROBIOSIS MODE", "Forced QA dry-out. The report screen should stay readable.");
  }

  function qaTeleportToTraversalToy() {
    if (!isLocalQA() || !state.ready) return;
    if (!state.running) startGame();
    const toy = TRAVERSAL_TOYS[state.qaToyIndex % TRAVERSAL_TOYS.length];
    state.qaToyIndex += 1;
    teleportPlayerTo(toy.x, toy.z, `QA: ${toy.name}`);
  }

  function qaTeleportToLandmark() {
    if (!isLocalQA() || !state.ready) return;
    if (!state.running) startGame();
    const landmark = HIDDEN_LANDMARKS[state.qaLandmarkIndex % HIDDEN_LANDMARKS.length];
    state.qaLandmarkIndex += 1;
    teleportPlayerTo(landmark.x, landmark.z, `QA: ${landmark.name}`);
  }

  function teleportPlayerTo(x, z, label) {
    Object.assign(state.player, {
      x,
      y: groundYAt(x, z) + 0.1,
      z,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
      wobble: 0.2,
    });
    if (world.camera && world.camera.userData) world.camera.userData.ready = false;
    updatePlayerTransform(0);
    showPrompt(label);
  }

  function resetGame(run) {
    const needsLevelReset = state.stage !== 1 || !world.ring;
    state.stage = 1;
    applyLevelConfig(1);
    if (needsLevelReset && world.scene) rebuildInteractiveLevel();

    Object.assign(state, {
      running: run,
      paused: false,
      gameOver: false,
      lastTime: performance.now(),
      clock: 0,
      sessionTime: 0,
      chaos: 0,
      snacks: 0,
      bonks: 0,
      ringFed: 0,
      bacteriaBashed: 0,
      waterMoved: 0,
      propsBroken: 0,
      combo: 0,
      comboTimer: 0,
      lastComboAction: "",
      scoreDelta: 0,
      scoreDeltaTimer: 0,
      calloutTimer: 0,
      tipTimer: run ? 8 : 0,
      hydrate: 100,
      stage: 1,
      level: 1,
      xp: 0,
      goalIndex: 0,
      promptTimer: run ? 5 : 8,
      dashCooldown: 0,
      dashPulse: 0,
      maxCombo: 0,
      goalsCleared: 0,
      stageChaos: 0,
      stageBonks: 0,
      stageHazards: 0,
      stageCollects: 0,
      stageResearchScans: 0,
      stageAdvanceAvailable: false,
      pendingStage: 0,
      researchCameraUnlocked: false,
      zoneId: "",
      zoneName: "Petri Dish",
      zonesVisited: new Set(),
      miniComplete: new Set(),
      toysUsed: new Set(),
      landmarksFound: new Set(),
      qaToyIndex: 0,
      qaLandmarkIndex: 0,
      desiccationActive: false,
      curlHeld: false,
    });
    Object.assign(state.player, {
      x: 0,
      y: groundYAt(0, 8),
      z: 8,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: 0,
      targetYaw: 0,
      grounded: true,
      wobble: 0,
    });
    Object.assign(state.camera, {
      yaw: 0.35,
      pitch: 0.42,
      targetYaw: 0.35,
      targetPitch: 0.42,
    });
    Object.assign(state.input, {
      forward: 0,
      right: 0,
      virtualForward: 0,
      virtualRight: 0,
      keyboardCurl: false,
      virtualCurl: false,
    });
    applyLevelConfig(1);
    rebuildPhysicsBoundary();
    rebuildStageScenery();
    rebuildInteractiveLevel();
    world.traversalToys.forEach((toy) => {
      toy.userData.cooldown = 0;
      toy.userData.justTriggered = 0;
    });
    world.landmarks.forEach((landmark) => {
      landmark.userData.found = false;
      landmark.scale.setScalar(1);
    });
    state.store.trailTimer = 0;
    populateProps();
    updatePlayerTransform(0);
    updateGoalText();
    updateHUD();
    syncPlayMode();
    if (el.pause) el.pause.textContent = "Pause";
  }

  function transitionToStage(stageNumber) {
    if (state.stage === stageNumber || !LEVEL_CONFIGS[stageNumber]) return;
    state.stage = stageNumber;
    applyLevelConfig(stageNumber);
    clearProps();
    clearEffects();
    rebuildPhysicsBoundary();
    rebuildStageScenery();
    rebuildInteractiveLevel();
    populateProps();

    const stageConfig = levelConfig(stageNumber);
    const entry = stageConfig.entry || {
      x: 0,
      z: stageConfig.shape === "square" ? Math.min(LEVEL_ONE_RADIUS + 18, playableHalfSize(stageNumber) - 28) : Math.min(stageConfig.radius * 0.28, 44),
    };
    Object.assign(state.player, {
      x: entry.x,
      y: groundYAt(entry.x, entry.z) + 0.12,
      z: entry.z,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: 0,
      targetYaw: 0,
      grounded: true,
      wobble: 0.3,
    });
    Object.assign(state.camera, {
      yaw: 0.32,
      pitch: stageNumber === 2 || stageNumber === 5 ? 0.5 : 0.44,
      targetYaw: 0.32,
      targetPitch: stageNumber === 2 || stageNumber === 5 ? 0.5 : 0.44,
    });
    if (world.camera && world.camera.userData) world.camera.userData.ready = false;

    state.goalIndex = firstGoalIndexForStage(stageNumber);
    state.zoneId = "";
    state.zoneName = levelConfig(stageNumber).name;
    state.zonesVisited = new Set();
    state.miniComplete = new Set();
    state.toysUsed = new Set();
    state.landmarksFound = new Set();
    state.stageChaos = 0;
    state.stageBonks = 0;
    state.stageHazards = 0;
    state.stageCollects = 0;
    state.stageResearchScans = 0;
    state.stageAdvanceAvailable = false;
    state.pendingStage = 0;
    state.researchCameraUnlocked = state.researchCameraUnlocked || stageNumber >= 3;
    state.qaToyIndex = 0;
    state.qaLandmarkIndex = 0;
    state.desiccationActive = false;
    state.hydrate = Math.max(82, state.hydrate);
    state.dashCooldown = 0;
    state.dashPulse = 0;
    state.promptTimer = 4.2;

    updatePlayerTransform(0);
    updateGoalText();
    updateHUD();
    syncPlayMode();
    syncAdvancePrompt();
    showCallout(stageConfig.arrivalTitle || `LEVEL ${stageNumber}!`, stageConfig.arrivalSubtitle || `${stageConfig.name} loaded`);
    const scaleText = stageNumber === 2 ? ` Playable area is ${levelAreaRatio(2).toFixed(1)}x the petri dish.` : "";
    showPrompt(`${stageConfig.name} loaded.${scaleText} New research objectives online.`);
    playTone("level", 1.45);
  }

  function togglePause() {
    if (!state.running || state.gameOver) return;
    state.paused = !state.paused;
    el.pause.textContent = state.paused ? "Resume" : "Pause";
    syncPlayMode();
    if (state.paused) {
      showOverlay("SPECIMEN PAUSED", "The tardigrade is briefly no longer anyone's problem.", "Resume");
    } else {
      hideOverlay();
      anchorGameViewport();
      state.lastTime = performance.now();
    }
  }

  function anchorGameViewport() {
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
  }

  function jump() {
    if (!state.running || state.paused || state.gameOver) return;
    if (!state.player.grounded) return;
    state.player.vy = state.curlHeld ? 10.8 : 9.1;
    state.player.grounded = false;
    state.player.wobble = 0.4;
    playTone("jump");
  }

  function dash() {
    if (!state.running || state.paused || state.gameOver || state.dashCooldown > 0) return;
    const player = state.player;
    const yaw = state.camera.targetYaw;
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    player.targetYaw = yaw;
    player.vx += forwardX * 25;
    player.vz += forwardZ * 25;
    state.dashCooldown = 1.1;
    state.dashPulse = 0.44;
    addChaos(45, "Hydro bonk armed");
    showPrompt("Bonk velocity online.");
    playTone("dash");
  }

  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, Math.max(0, (now - (state.lastTime || now)) / 1000));
    state.lastTime = now;
    state.clock += dt;

    if (state.ready && state.running && !state.paused && !state.gameOver) {
      updateGame(dt);
    } else {
      updateIdle(dt);
    }
    renderWorld(dt);
  }

  function updateGame(dt) {
    state.sessionTime = Math.min(SANDBOX_SECONDS, state.sessionTime + dt);
    updateInputMovement(dt);
    updateTraversalToys(dt, true);
    updateHiddenLandmarks(dt, true);
    updateCreatures(dt, true);
    updateProps(dt);
    updateZoneAwareness(dt);
    updateGoals();
    updateMiniMissions();
    updateDirector(dt);
    updatePrompt(dt);
    updateCallout(dt);
    const stageDrain = levelConfig().id === "lava" ? 0.16 : levelConfig().id === "stomach" ? 0.06 : levelConfig().id === "station" ? -0.03 : 0;
    const drain = Math.max(0.04, (state.curlHeld ? 0.36 : 0.2) + state.goalIndex * 0.028 + stageDrain + (state.desiccationActive ? 0.34 : 0));
    state.hydrate = clamp(state.hydrate - dt * drain, 0, 100);
    state.comboTimer = Math.max(0, state.comboTimer - dt);
    if (state.comboTimer <= 0) {
      state.combo = 0;
      state.lastComboAction = "";
    }
    state.scoreDeltaTimer = Math.max(0, state.scoreDeltaTimer - dt);
    if (state.scoreDeltaTimer <= 0) state.scoreDelta = 0;
    state.dashCooldown = Math.max(0, state.dashCooldown - dt);
    state.dashPulse = Math.max(0, state.dashPulse - dt);
    updateHUD();

    if (state.hydrate <= 0) {
      endGame("ANHYDROBIOSIS MODE", "You dried out heroically. The lab labeled it a feature.");
    }
  }

  function updateIdle(dt) {
    const player = state.player;
    player.vx *= Math.pow(0.001, dt);
    player.vz *= Math.pow(0.001, dt);
    player.wobble = Math.max(0, player.wobble - dt);
    updatePlayerTransform(dt);
    updateTraversalToys(dt, false);
    updateHiddenLandmarks(dt, false);
    updateCreatures(dt, false);
    updateDrift(dt);
    updateEffects(dt);
    updateCallout(dt);
  }

  function updateInputMovement(dt) {
    const player = state.player;
    const forwardInput = clamp(state.input.forward + state.input.virtualForward, -1, 1);
    const rightInput = clamp(state.input.right + state.input.virtualRight, -1, 1);
    const yaw = state.camera.targetYaw;
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    let moveX = forwardX * forwardInput + rightX * rightInput;
    let moveZ = forwardZ * forwardInput + rightZ * rightInput;
    const length = Math.hypot(moveX, moveZ);
    if (length > 0.001) {
      moveX /= length;
      moveZ /= length;
      player.targetYaw = yaw;
    }

    const curl = state.curlHeld ? 0.76 : 1;
    const dashBoost = state.dashPulse > 0 ? 1.45 : 1;
    const stationFloat = levelConfig().id === "station" ? 0.82 : 1;
    const maxSpeed = (state.player.grounded ? 12.4 : 8.6) * curl * dashBoost * (levelConfig().id === "stomach" ? 0.94 : 1);
    const accel = (state.player.grounded ? 34 : 14) * (levelConfig().id === "station" ? 0.78 : 1);
    const targetVX = moveX * maxSpeed;
    const targetVZ = moveZ * maxSpeed;
    const control = Math.min(1, dt * accel);
    const stopControl = Math.min(1, dt * 10.5);
    player.vx = lerp(player.vx, targetVX, length > 0.001 ? control : stopControl);
    player.vz = lerp(player.vz, targetVZ, length > 0.001 ? control : stopControl);
    if (state.curlHeld) {
      player.vx += Math.sin(state.clock * 12) * dt * 2;
      player.vz += Math.cos(state.clock * 10) * dt * 2;
    }

    player.vy -= GRAVITY * stationFloat * dt;
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    player.z += player.vz * dt;
    const groundY = groundYAt(player.x, player.z);
    if (player.y <= groundY) {
      player.y = groundY;
      player.vy = 0;
      player.grounded = true;
    } else {
      player.grounded = false;
    }

    const constrained = constrainPointToPlayable(player.x, player.z, PLAYER_RADIUS + 0.8);
    if (constrained.clamped) {
      player.x = constrained.x;
      player.z = constrained.z;
      const dot = player.vx * constrained.nx + player.vz * constrained.nz;
      if (dot > 0) {
        player.vx -= dot * constrained.nx * 1.55;
        player.vz -= dot * constrained.nz * 1.55;
        addChaos(18, levelConfig().shape === "square" ? "Aquarium glass rebound" : "Petri wall rebound");
      }
    }

    player.yaw = lerpAngle(player.yaw, player.targetYaw, Math.min(1, dt * 8));
    player.wobble = Math.max(0, player.wobble - dt * 1.6);
    if (length > 0.001 && player.grounded) player.wobble = Math.max(player.wobble, 0.16);
    updatePlayerTransform(dt);
  }

  function updateProps(dt) {
    const player = state.player;
    const playerSpeed = Math.hypot(player.vx, player.vz);
    stepPhysics(dt);

    for (let i = world.props.length - 1; i >= 0; i--) {
      const prop = world.props[i];
      const data = prop.userData;
      data.hitCooldown = Math.max(0, data.hitCooldown - dt);
      if (world.physics.ready && data.body) {
        const translation = data.body.translation();
        const linvel = data.body.linvel();
        prop.position.x = translation.x;
        prop.position.z = translation.z;
        data.velocity.set(linvel.x, 0, linvel.z);
      } else {
        prop.position.x += data.velocity.x * dt;
        prop.position.z += data.velocity.z * dt;
        data.velocity.multiplyScalar(Math.pow(0.06, dt));
      }

      data.baseY = data.baseHeight + terrainOffsetAt(prop.position.x, prop.position.z);
      prop.position.y = data.baseY + Math.sin(state.clock * 2.3 + i) * (data.type === "algae" ? 0.16 : 0.05);
      prop.scale.setScalar(isCurrentTargetProp(prop) ? 1.1 + Math.sin(state.clock * 8) * 0.12 : 1);
      prop.rotation.x += data.spin.x * dt + data.velocity.z * dt * 0.18;
      prop.rotation.y += data.spin.y * dt;
      prop.rotation.z += data.spin.z * dt - data.velocity.x * dt * 0.18;
      clampPropToDish(prop);

      const dx = prop.position.x - player.x;
      const dz = prop.position.z - player.z;
      const hitDistance = data.radius + PLAYER_RADIUS;
      const separation = Math.hypot(dx, dz);
      if (separation < hitDistance) {
        if (data.collect) {
          collectProp(prop, i);
          continue;
        }
        const nx = separation > 0.001 ? dx / separation : Math.cos(state.clock);
        const nz = separation > 0.001 ? dz / separation : Math.sin(state.clock);
        const impact = Math.max(5, playerSpeed * (state.dashPulse > 0 ? 2.35 : 1.1));
        if (handleSolidHit(prop, i, nx, nz, impact, playerSpeed)) continue;
        player.vx -= nx * 1.8;
        player.vz -= nz * 1.8;
        player.wobble = 0.45;
      }

      if (data.type === "droplet" && !data.moved) {
        const moved = Math.hypot(prop.position.x - data.spawnX, prop.position.z - data.spawnZ);
        if (moved > 3.2) {
          data.moved = true;
          state.waterMoved += 1;
          const comboInfo = extendCombo("water", 2, 4);
          const score = scoreWithCombo(360);
          addChaos(score, "Water droplet moved");
          showCallout("PUSHIN!", `+${score.toLocaleString()} water droplet moved${comboTag(comboInfo)}`);
          playTone("water", 1.3);
        }
      }

      if (state.goalIndex >= 3 && data.type === "pollen" && !data.delivered && handleRingDelivery(prop, i)) continue;
    }

    updateDrift(dt);
    updateEffects(dt);
  }

  function updateTraversalToys(dt, active) {
    const player = state.player;
    world.traversalToys.forEach((toy) => {
      const data = toy.userData;
      data.cooldown = Math.max(0, (data.cooldown || 0) - dt);
      data.justTriggered = Math.max(0, (data.justTriggered || 0) - dt);
      animateTraversalToy(toy, dt);
      if (!active || state.paused || state.gameOver) return;

      const dx = player.x - data.x;
      const dz = player.z - data.z;
      const distance = Math.hypot(dx, dz);
      if (distance > data.radius) return;

      if (data.type === "ridge") {
        assistRidgeToy(toy, dt);
        return;
      }
      if (data.cooldown > 0) return;
      if (data.type === "ramp") triggerRampToy(toy);
      if (data.type === "jumpPad") triggerJumpPadToy(toy);
      if (data.type === "geyser") triggerGeyserToy(toy, dx, dz, distance);
    });
  }

  function animateTraversalToy(toy, dt) {
    const data = toy.userData;
    const pulse = 1 + Math.sin(state.clock * 4.2 + data.pulse) * 0.035 + (data.justTriggered || 0) * 0.12;
    if (data.type === "jumpPad") {
      if (data.ring) data.ring.rotation.z += dt * 2.6;
      if (data.spring) data.spring.scale.y = pulse;
    } else if (data.type === "geyser") {
      if (data.plume) {
        data.plume.scale.y = 0.86 + Math.sin(state.clock * 3.1 + data.pulse) * 0.18 + (data.justTriggered || 0) * 0.28;
        data.plume.rotation.y += dt * 0.4;
      }
    } else if (data.type === "ridge") {
      if (data.marker) data.marker.rotation.y += dt * 1.2;
    }
  }

  function triggerRampToy(toy) {
    const data = toy.userData;
    const player = state.player;
    const forward = toyForward(data);
    player.vx = player.vx * 0.45 + forward.x * data.boost;
    player.vz = player.vz * 0.45 + forward.z * data.boost;
    player.vy = Math.max(player.vy, data.lift);
    player.y = Math.max(player.y, groundYAt(player.x, player.z) + 0.28);
    player.grounded = false;
    player.targetYaw = data.yaw;
    data.cooldown = 1.45;
    data.justTriggered = 0.42;
    awardTraversalToy(data, "RAMP YEET!", `${data.name} launched`, 280);
    playTone("jump", 1.35);
  }

  function triggerJumpPadToy(toy) {
    const data = toy.userData;
    const player = state.player;
    const speed = Math.hypot(player.vx, player.vz);
    const forward = speed > 1.2
      ? { x: player.vx / speed, z: player.vz / speed }
      : { x: -Math.sin(state.camera.targetYaw), z: -Math.cos(state.camera.targetYaw) };
    player.vx += forward.x * data.boost;
    player.vz += forward.z * data.boost;
    player.vy = Math.max(player.vy, data.lift);
    player.y = Math.max(player.y, groundYAt(player.x, player.z) + 0.36);
    player.grounded = false;
    data.cooldown = 1.2;
    data.justTriggered = 0.5;
    awardTraversalToy(data, "SPRING!", `${data.name} popped`, 320);
    playTone("level", 1.08);
  }

  function triggerGeyserToy(toy, dx, dz, distance) {
    const data = toy.userData;
    const player = state.player;
    const nx = distance > 0.01 ? dx / distance : Math.cos(state.clock);
    const nz = distance > 0.01 ? dz / distance : Math.sin(state.clock);
    player.vx += nx * data.boost;
    player.vz += nz * data.boost;
    player.vy = Math.max(player.vy, data.lift);
    player.y = Math.max(player.y, groundYAt(player.x, player.z) + 0.42);
    player.grounded = false;
    data.cooldown = 1.65;
    data.justTriggered = 0.6;
    awardTraversalToy(data, "GEYSER!", `${data.name} launched`, 360);
    spawnShards({ x: data.x, y: groundYAt(data.x, data.z) + 1.2, z: data.z }, world.materials.geyser, 5);
    playTone("water", 1.45);
  }

  function assistRidgeToy(toy, dt) {
    const data = toy.userData;
    const player = state.player;
    const forward = toyForward(data);
    player.vx = lerp(player.vx, forward.x * data.boost, Math.min(1, dt * 2.3));
    player.vz = lerp(player.vz, forward.z * data.boost, Math.min(1, dt * 2.3));
    if (player.grounded) player.vy = Math.max(player.vy, data.lift);
    player.grounded = false;
    data.justTriggered = Math.max(data.justTriggered || 0, 0.14);
    if (data.cooldown <= 0) {
      data.cooldown = 1.2;
      awardTraversalToy(data, "RIDGE CLIMB!", `${data.name} climbed`, 260);
      playTone("bonk", 1.2);
    }
  }

  function awardTraversalToy(data, title, message, baseScore) {
    const firstUse = !state.toysUsed.has(data.id);
    if (firstUse) {
      state.toysUsed.add(data.id);
      const comboInfo = extendCombo("traversal", 1, 4);
      const score = scoreWithCombo(baseScore);
      addChaos(score, message);
      showCallout(title, `+${score.toLocaleString()} ${message.toLowerCase()}${comboTag(comboInfo)}`);
    } else {
      showPrompt(`${data.name}: launch reset.`);
    }
  }

  function updateHiddenLandmarks(dt, active) {
    const player = state.player;
    world.landmarks.forEach((landmark) => {
      const data = landmark.userData;
      if (data.halo) data.halo.rotation.z += dt * (data.found ? 2.1 : 0.72);
      if (data.core) data.core.position.y = 1.35 + Math.sin(state.clock * 2.6 + data.pulse) * 0.08;
      if (!active || data.found) return;
      const distance = Math.hypot(player.x - data.x, player.z - data.z);
      if (distance > data.radius) return;
      data.found = true;
      state.landmarksFound.add(data.id);
      if (levelConfig().id === "station") {
        state.stageResearchScans = Math.max(state.stageResearchScans, state.landmarksFound.size);
      }
      landmark.scale.setScalar(1.18);
      const comboInfo = extendCombo("landmark", 2, 4.5);
      const score = scoreWithCombo(480);
      addChaos(score, `${data.name} landmark found`);
      showCallout("LANDMARK FOUND!", `+${score.toLocaleString()} ${data.name}${comboTag(comboInfo)}`);
      showPrompt(`${data.name} discovered. ${state.landmarksFound.size}/${HIDDEN_LANDMARKS.length} hidden landmarks found.`);
      playTone("level", 1.2);
    });
  }

  function clampPropToDish(prop) {
    const data = prop.userData;
    const constrained = constrainPointToPlayable(prop.position.x, prop.position.z, data.radius + 0.9);
    if (!constrained.clamped) return;
    prop.position.x = constrained.x;
    prop.position.z = constrained.z;
    const dot = data.velocity.x * constrained.nx + data.velocity.z * constrained.nz;
    if (dot > 0) {
      data.velocity.x -= dot * constrained.nx * 1.65;
      data.velocity.z -= dot * constrained.nz * 1.65;
    }
    if (world.physics.ready && data.body) {
      data.body.setTranslation({ x: prop.position.x, y: 0, z: prop.position.z }, true);
      data.body.setLinvel({ x: data.velocity.x, y: 0, z: data.velocity.z }, true);
    }
  }

  function comboMultiplier() {
    return 1 + Math.min(2.4, Math.max(0, state.combo - 1) * 0.08);
  }

  function extendCombo(action, amount = 1, timer = 3.2) {
    const varied = !!state.lastComboAction && state.lastComboAction !== action;
    const gain = amount + (varied ? 1 : 0);
    state.combo += gain;
    state.lastComboAction = action;
    state.comboTimer = Math.max(state.comboTimer, timer + Math.min(1.3, state.combo * 0.045));
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    return { gain, varied, multiplier: comboMultiplier() };
  }

  function scoreWithCombo(base) {
    return Math.round(base * comboMultiplier());
  }

  function comboTag(comboInfo) {
    if (!comboInfo) return "";
    if (comboInfo.varied) return " variety chain";
    if (state.combo >= 8) return ` ${comboMultiplier().toFixed(1)}x chain`;
    return "";
  }

  function handleSolidHit(prop, index, nx, nz, impact, playerSpeed) {
    const data = prop.userData;
    const impulse = impact * Math.max(0.75, data.mass * 0.48);
    if (world.physics.ready && data.body) {
      data.body.applyImpulse({ x: nx * impulse, y: 0, z: nz * impulse }, true);
      data.body.applyTorqueImpulse({ x: nz * impulse * 0.09, y: impulse * 0.12, z: -nx * impulse * 0.09 }, true);
    } else {
      data.velocity.x += nx * impact / data.mass;
      data.velocity.z += nz * impact / data.mass;
    }

    if (data.hitCooldown > 0) return false;
    data.hitCooldown = 0.55;
    state.bonks += 1;
    state.stageBonks += 1;
    if (data.hazard && !data.hazardCleared) {
      data.hazardCleared = true;
      state.stageHazards += 1;
    }

    const smashy = state.dashPulse > 0 || playerSpeed > 10.5;
    const comboInfo = extendCombo(data.type, data.type === "droplet" ? 2 : 1, smashy ? 3.9 : 3.25);
    const title = data.type === "bacteria"
      ? "BACTERIA BASHED!"
      : data.type === "droplet"
        ? "PUSHIN!"
        : data.type === "capsule"
          ? "YEET!"
          : data.type === "enzyme"
            ? "ENZYME CRACK!"
            : data.type === "digestiveBubble"
              ? "BURP POP!"
              : data.type === "magmaBubble"
                ? "MAGMA POP!"
                : data.type === "toolpod"
                  ? "ORBIT BONK!"
          : "BONK!";
    const message = {
      bacteria: "Bacteria bashed",
      droplet: "Hydro shove",
      capsule: "Capsule launched",
      enzyme: "Enzyme cracked",
      platelet: "Platelet skidded",
      spore: "Spore bounced",
      pollen: "Pollen bonked",
      cell: "Cell bumped",
      bubble: "Bubble booped",
      crystal: "Crystal clattered",
      foodbit: "Food bit bullied",
      digestiveBubble: "Digestive bubble popped",
      magmaBubble: "Magma bubble burst",
      ashCrystal: "Ash crystal pinged",
      dataChip: "Data chip bumped",
      toolpod: "Tool pod bonked",
    }[data.type] || "Prop bonked";
    const score = scoreWithCombo(data.score + (smashy ? 90 : 0));
    if (data.type === "bacteria") state.bacteriaBashed += 1;
    addChaos(score, message);
    showCallout(title, `+${score.toLocaleString()} ${message.toLowerCase()}${comboTag(comboInfo)}`);
    spawnRewardBurst(prop.position, rewardMaterialForType(data.type), smashy ? 9 : 5, smashy ? 1.18 : 0.82);
    playTone(smashy ? "break" : "bonk", smashy ? 1.45 : 1);

    if (data.destructible && smashy) {
      data.health -= 1;
      if (data.health <= 0) {
        state.propsBroken += 1;
        spawnShards(prop.position, rewardMaterialForType(data.type), 7);
        removeProp(prop, index);
        return true;
      }
    }
    return false;
  }

  function handleRingDelivery(prop, index) {
    const ringDistance = Math.hypot(prop.position.x - RING_TARGET.x, prop.position.z - RING_TARGET.z);
    if (ringDistance >= RING_TARGET.radius * 0.94) return false;
    const data = prop.userData;
    data.delivered = true;
    state.ringFed += 1;
    const comboInfo = extendCombo("ring", 2, 4.4);
    const score = scoreWithCombo(520);
    addChaos(score, "Nutrient ring fed");
    showPrompt("Ring fed. Keep bullying the pollen.");
    showCallout("FED!", `+${score.toLocaleString()} nutrient ring fed${comboTag(comboInfo)}`);
    spawnRewardBurst(prop.position, world.materials.ring, 12, 1.15);
    spawnRewardBurst({ x: RING_TARGET.x, y: groundYAt(RING_TARGET.x, RING_TARGET.z) + 0.7, z: RING_TARGET.z }, world.materials.ringCore, 8, 0.9);
    playTone("level", 0.8);
    removeProp(prop, index);
    return true;
  }

  function removeProp(prop, index) {
    removePhysicsBody(prop);
    prop.visible = false;
    world.scene.remove(prop);
    disposeObject(prop);
    world.props.splice(index, 1);
  }

  function collectProp(prop, index) {
    const type = prop.userData.type;
    state.snacks += 1;
    state.stageCollects += 1;
    state.hydrate = clamp(state.hydrate + (type === "dataChip" ? 5 : 13), 0, 100);
    const comboInfo = extendCombo(type, 1, 3.7);
    const score = scoreWithCombo(type === "dataChip" ? 230 : type === "foodbit" ? 190 : 160);
    const logMessage = type === "dataChip" ? "Research data captured" : type === "foodbit" ? "Food bit sampled" : "Algae snack";
    addChaos(score, logMessage);
    const remaining = Math.max(0, GOAL_TARGETS.algae - state.snacks);
    const goal = activeGoal();
    const snackText = type === "dataChip"
      ? "Data chip scanned by the backpack camera."
      : type === "foodbit"
        ? "Food bit sampled. The rat review board is confused."
        : "Algae absorbed. Hydration restored.";
    showPrompt(goal && goal.id === "algae" && remaining > 0 ? `${remaining} algae snack left. Follow the next yellow target.` : snackText);
    showCallout(type === "dataChip" ? "SCAN!" : type === "foodbit" ? "SNACK?" : "MUNCH!", `+${score.toLocaleString()} ${logMessage.toLowerCase()}${comboTag(comboInfo)}`);
    spawnRewardBurst(prop.position, rewardMaterialForType(type), 10, 0.88);
    playTone("munch", 1.1);
    removeProp(prop, index);
    addProp(type === "dataChip" ? "dataChip" : type === "foodbit" ? "foodbit" : "algae", randomPlayablePoint(5));
  }

  function addChaos(amount, message) {
    const rounded = Math.round(amount);
    state.chaos += amount;
    state.stageChaos += amount;
    state.scoreDelta += rounded;
    state.scoreDeltaTimer = 1.15;
    addXp(Math.max(12, Math.round(rounded * 0.42)));
    addStoreCoins(Math.max(1, Math.round(rounded * 0.1)));
    if (message) el.labLog.textContent = `Lab log: ${message}. Chaos +${rounded}.`;
  }

  function xpTarget() {
    return 300 + (state.level - 1) * 220;
  }

  function addXp(amount) {
    state.xp += amount;
    let target = xpTarget();
    while (state.xp >= target) {
      state.xp -= target;
      state.level += 1;
      state.hydrate = clamp(state.hydrate + 15, 0, 100);
      target = xpTarget();
      showCallout("LEVEL UP!", `Tardigrade level ${state.level}`);
      playTone("level", 1.4);
    }
  }

  function showCallout(title, sub) {
    if (!el.callout || !el.calloutTitle || !el.calloutSub) return;
    el.calloutTitle.textContent = title;
    el.calloutSub.textContent = sub;
    el.callout.classList.add("micro-callout--show");
    state.calloutTimer = 1.35;
  }

  function updateCallout(dt) {
    state.calloutTimer = Math.max(0, state.calloutTimer - dt);
    if (state.calloutTimer <= 0 && el.callout) el.callout.classList.remove("micro-callout--show");
  }

  function spawnShards(position, material, count) {
    const THREE = window.THREE;
    for (let i = 0; i < count; i++) {
      const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(rand(0.16, 0.42), 0), material || world.materials.shard);
      shard.position.set(position.x + rand(-0.35, 0.35), position.y + rand(0.1, 0.8), position.z + rand(-0.35, 0.35));
      shard.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI));
      shard.castShadow = true;
      shard.userData.life = rand(0.75, 1.2);
      shard.userData.maxLife = shard.userData.life;
      shard.userData.velocity = new THREE.Vector3(rand(-4.4, 4.4), rand(3.8, 7.4), rand(-4.4, 4.4));
      shard.userData.spin = new THREE.Vector3(rand(-5, 5), rand(-7, 7), rand(-5, 5));
      world.scene.add(shard);
      world.effects.push(shard);
    }
  }

  function rewardMaterialForType(type) {
    return {
      algae: world.materials.algae,
      bacteria: world.materials.bacteria,
      droplet: world.materials.droplet,
      pollen: world.materials.pollen,
      capsule: world.materials.capsuleBlue,
      enzyme: world.materials.enzyme,
      platelet: world.materials.platelet,
      spore: world.materials.spore,
      crystal: world.materials.crystal,
      bubble: world.materials.bubble,
      cell: world.materials.cell,
      foodbit: world.materials.foodbit,
      digestiveBubble: world.materials.digestiveBubble,
      magmaBubble: world.materials.magmaBubble,
      ashCrystal: world.materials.ashCrystal,
      dataChip: world.materials.dataChip,
      toolpod: world.materials.toolpod,
    }[type] || world.materials.shard;
  }

  function spawnRewardBurst(position, material, count, power = 1) {
    const THREE = window.THREE;
    if (!position || !material) return;
    for (let i = 0; i < count; i++) {
      const mote = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.08, 0.24), 0), material);
      mote.position.set(
        position.x + rand(-0.4, 0.4),
        (position.y || 0.8) + rand(0.18, 0.84),
        position.z + rand(-0.4, 0.4)
      );
      mote.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI));
      mote.userData.life = rand(0.42, 0.82);
      mote.userData.maxLife = mote.userData.life;
      mote.userData.velocity = new THREE.Vector3(rand(-3.2, 3.2) * power, rand(2.8, 6.4) * power, rand(-3.2, 3.2) * power);
      mote.userData.spin = new THREE.Vector3(rand(-7, 7), rand(-8, 8), rand(-7, 7));
      world.scene.add(mote);
      world.effects.push(mote);
    }
  }

  function updateEffects(dt) {
    for (let i = world.effects.length - 1; i >= 0; i--) {
      const effect = world.effects[i];
      const data = effect.userData;
      data.life -= dt;
      data.velocity.y -= 9.5 * dt;
      effect.position.addScaledVector(data.velocity, dt);
      effect.rotation.x += data.spin.x * dt;
      effect.rotation.y += data.spin.y * dt;
      effect.rotation.z += data.spin.z * dt;
      const scale = clamp(data.life / data.maxLife, 0, 1);
      effect.scale.setScalar(scale);
      if (data.life <= 0 || effect.position.y < -0.1) {
        world.scene.remove(effect);
        disposeObject(effect);
        world.effects.splice(i, 1);
      }
    }
  }

  function getCurrentZone() {
    let active = null;
    let bestDistance = Infinity;
    SANDBOX_ZONES.forEach((zone) => {
      const distance = Math.hypot(state.player.x - zone.x, state.player.z - zone.z);
      if (distance < zone.radius && distance < bestDistance) {
        active = zone;
        bestDistance = distance;
      }
    });
    return active;
  }

  function updateZoneAwareness() {
    const zone = getCurrentZone();
    const nextId = zone ? zone.id : "";
    const nextName = zone ? zone.name : levelConfig().name;
    if (state.zoneId === nextId) return;

    state.zoneId = nextId;
    state.zoneName = nextName;
    if (!zone) return;

    const firstVisit = !state.zonesVisited.has(zone.id);
    state.zonesVisited.add(zone.id);
    showPrompt(`${zone.name}: ${zoneHint(zone.id)}`);
    if (firstVisit) {
      addChaos(180 + state.zonesVisited.size * 60, `${zone.name} discovered`);
      showCallout("ZONE FOUND!", zone.name);
      playTone("level", 0.72);
    }
  }

  function zoneHint(zoneId) {
    return {
      agar: "learn the agar slopes and keep the dish readable.",
      "algae-smear": "graze glowing algae through the soft agar smear.",
      "droplet-lane": "use the shallow lane to push water cleanly.",
      "bacteria-track": "line up the orange bacteria for a starter bonk.",
      forest: "chain algae snacks through the green thicket.",
      flats: "shove droplets and skid platelets across the blue flats.",
      reef: "dash into bacteria, enzymes, and capsules for big bonks.",
      ridge: "climb the spore ridge for crystals, spores, and pollen.",
      "cardia-cove": "folds, crumbs, and one deeply overconfident digestive bubble.",
      "mucus-rapids": "ride the current and pretend the texture is professional.",
      "food-raft": "sample crumbs for science and definitely not lunch.",
      "enzyme-sump": "bonk bubbles before the enzymes unionize.",
      "basalt-shelf": "use the dark ridges for cleaner lava jumps.",
      "ember-river": "magma bubbles count as hazards and terrible pool toys.",
      "steam-fissure": "vents launch hard; try not to become steam trivia.",
      "crystal-caldera": "smash, scan, and sparkle responsibly.",
      "airlock-grid": "mag rails and camera scans start here.",
      "lab-bench": "data chips, tool pods, and zero supervision.",
      "vent-maze": "air vents make microgravity look suspiciously bouncy.",
      "window-array": "scan the view and do not wave at Earth.",
    }[zoneId] || "free-roam the dish.";
  }

  function updateMiniMissions() {
    if (!state.running || state.paused || state.gameOver) return;
    MINI_MISSIONS.forEach((mission) => {
      if (state.miniComplete.has(mission.id)) return;
      if (mission.progress() < targetValue(mission)) return;
      state.miniComplete.add(mission.id);
      const bonus = 420 + state.miniComplete.size * 90;
      addChaos(bonus, `${mission.title} mini-mission`);
      showCallout("MISSION CLEAR!", `${mission.title} +${bonus.toLocaleString()}`);
      showPrompt(`${mission.title} complete. Keep the five-minute chaos run rolling.`);
      playTone("level", 1.05);
    });
  }

  function miniMissionsComplete() {
    return state.miniComplete.size >= MINI_MISSIONS.length;
  }

  function offerStageAdvance(nextStage) {
    if (!nextStage || !LEVEL_CONFIGS[nextStage] || state.stageAdvanceAvailable) return;
    const config = levelConfig();
    state.stageAdvanceAvailable = true;
    state.pendingStage = nextStage;
    state.researchCameraUnlocked = true;
    resetVirtualControls();
    updateGoalText();
    syncAdvancePrompt();
    updateHUD();
    showCallout("RESEARCH UNLOCKED!", LEVEL_CONFIGS[nextStage].name);
    showPrompt(config.advanceText || "The next research environment is ready when you are.");
    playTone("level", 1.25);
  }

  function acceptStageAdvance() {
    if (!state.stageAdvanceAvailable || !state.pendingStage) return;
    const target = state.pendingStage;
    state.stageAdvanceAvailable = false;
    state.pendingStage = 0;
    syncAdvancePrompt();
    transitionToStage(target);
  }

  function syncAdvancePrompt() {
    if (!el.advance) return;
    const visible = !!(state.running && !state.gameOver && state.stageAdvanceAvailable && state.pendingStage);
    el.advance.classList.toggle("is-visible", visible);
    el.advance.disabled = !visible;
    if (visible) {
      const next = LEVEL_CONFIGS[state.pendingStage];
      el.advance.textContent = levelConfig().advanceButton || `Continue to ${next ? next.name : "next level"}`;
    }
  }

  function updateGoals() {
    if (state.stageAdvanceAvailable) return;
    const goal = GOALS[state.goalIndex];
    if (!goal) return;
    if (goal.progress() >= targetValue(goal)) {
      const completed = goal;
      const stageGoals = currentStageGoals();
      const completedOrdinal = stageGoals.findIndex((stageGoal) => stageGoal === completed) + 1;
      state.goalIndex += 1;
      state.goalsCleared += 1;
      addChaos(250 + state.goalsCleared * 75, `${completed.title} complete`);
      const nextStage = nextStageNumber(completed.stage);
      if (completedOrdinal >= requiredStageGoalCount(completed.stage) && nextStage) {
        offerStageAdvance(nextStage);
        return;
      }
      if (state.goalIndex >= GOALS.length) {
        winGame();
        return;
      }
      updateGoalText();
      showCallout("GOAL CLEAR!", completed.title);
      announceGoal("Next specimen task:");
      if (!isTouchLayout()) api.toast("Goal complete", "good");
    }
  }

  function updateDirector(dt) {
    if (!state.running || state.paused || state.gameOver) return;
    state.tipTimer = Math.max(0, state.tipTimer - dt);
    if (!state.desiccationActive && state.clock > 52 && state.goalIndex >= 2) {
      state.desiccationActive = true;
      showCallout("DRY FRONT!", "hydrate drain rising");
      showPrompt("Desiccation front incoming. Munch algae or finish the incident.");
      playTone("break", 0.8);
    }
    if (state.tipTimer <= 0) {
      announceGoal();
      state.tipTimer = state.desiccationActive ? 7 : 9;
    }
  }

  function announceGoal(prefix = "") {
    const goal = activeGoal();
    const hint = getGoalHint(goal);
    const message = prefix ? `${prefix} ${hint}` : hint;
    showPrompt(message);
  }

  function getGoalHint(goal) {
    if (!goal) return "";
    return isTouchLayout() && goal.mobileHint ? goal.mobileHint : goal.hint;
  }

  function isTouchLayout() {
    return !!(window.matchMedia && (
      window.matchMedia("(hover: none) and (pointer: coarse)").matches ||
      window.matchMedia("(max-width: 900px)").matches
    ));
  }

  function updateGoalText() {
    const goal = activeGoal();
    el.objectiveTitle.textContent = goal.title;
    el.objectiveText.textContent = goal.text;
    el.goalCardTitle.textContent = goal.title;
    el.goalCardText.textContent = goal.text;
  }

  function formatGoalProgress(goal, value) {
    const target = targetValue(goal);
    if (goal && goal.kind === "time") return `${formatTime(value)} / ${formatTime(target)}`;
    return `${Math.floor(value).toLocaleString()} / ${target.toLocaleString()}`;
  }

  function missionById(id) {
    return MINI_MISSIONS.find((mission) => mission.id === id);
  }

  function updateMissionHUD() {
    el.missionElements.forEach((node) => {
      const mission = missionById(node.dataset.mission);
      if (!mission) return;
      const target = targetValue(mission);
      const progress = Math.min(mission.progress(), target);
      node.textContent = `${Math.floor(progress).toLocaleString()}/${target.toLocaleString()}`;
      node.classList.toggle("is-complete", progress >= target);
    });
  }

  function updatePrompt(dt) {
    state.promptTimer = Math.max(0, state.promptTimer - dt);
    if (state.promptTimer <= 0) el.prompt.classList.remove("micro-prompt--show");
  }

  function showPrompt(message) {
    el.prompt.textContent = message;
    el.prompt.classList.add("micro-prompt--show");
    state.promptTimer = 3.2;
  }

  function updatePlayerTransform(dt) {
    const p = state.player;
    if (!world.tardigrade) return;
    world.tardigrade.position.set(p.x, p.y, p.z);
    world.tardigrade.rotation.y = p.yaw;
    const speed = Math.hypot(p.vx, p.vz);
    const curl = state.curlHeld ? 0.55 : 0;
    world.tardigrade.rotation.x = lerp(world.tardigrade.rotation.x, curl + (p.grounded ? 0 : -0.26), Math.min(1, dt * 8));
    world.tardigrade.rotation.z = lerp(world.tardigrade.rotation.z, Math.sin(state.clock * 12) * p.wobble * 0.28, Math.min(1, dt * 8));

    const bob = state.reducedMotion ? 0 : Math.sin(state.clock * (speed * 0.5 + 5)) * Math.min(0.16, speed * 0.015);
    world.bodySegments.forEach((segment, index) => {
      const base = segment.userData.base;
      segment.position.y = base.y + bob + Math.sin(state.clock * 4.2 + segment.userData.phase) * 0.035;
      segment.scale.y = (index === 0 ? 0.9 : 1.02) + Math.sin(state.clock * 5 + index) * 0.015;
    });

    world.legs.forEach((leg) => {
      const phase = state.clock * (speed * 1.2 + 4.2) + leg.userData.phase;
      const swing = Math.sin(phase) * Math.min(0.45, 0.12 + speed * 0.025);
      leg.rotation.x = state.curlHeld ? 0.8 : swing;
      leg.rotation.z = leg.userData.side * (state.curlHeld ? 0.34 : 0.08);
    });

    world.feelers.forEach((feeler, index) => {
      feeler.rotation.z = (index ? 0.22 : -0.22) + Math.sin(state.clock * 4 + index) * 0.16;
    });

    if (world.researchCamera) {
      world.researchCamera.visible = state.researchCameraUnlocked || state.stage >= 3;
      world.researchCamera.rotation.z = -0.18 + Math.sin(state.clock * 3.2) * 0.035;
      if (world.researchCamera.userData.light) {
        world.researchCamera.userData.light.scale.setScalar(0.9 + Math.sin(state.clock * 6.8) * 0.16);
      }
    }

    updateStoreCosmeticMotion(dt, speed);
  }

  function updateStoreCosmeticMotion(dt, speed) {
    if (world.cosmeticRoot) {
      world.cosmeticRoot.children.forEach((attachment, index) => {
        attachment.rotation.z = Math.sin(state.clock * 2.4 + index) * 0.035;
        attachment.children.forEach((child) => {
          if (child.userData.kind === "rocketFlame") {
            const pulse = 0.82 + Math.sin(state.clock * 15) * 0.18 + Math.min(0.35, speed * 0.018);
            child.scale.setScalar(pulse);
          }
        });
      });
    }
    if (state.store.equipped.trail !== "trail-confetti" || !state.running || state.paused || state.gameOver || speed < 1.4) return;
    state.store.trailTimer = Math.max(0, state.store.trailTimer - dt);
    if (state.store.trailTimer > 0) return;
    state.store.trailTimer = state.reducedMotion ? 0.34 : 0.16;
    const p = state.player;
    const backX = p.x + Math.sin(p.yaw) * 1.7;
    const backZ = p.z + Math.cos(p.yaw) * 1.7;
    spawnRewardBurst({ x: backX, y: p.y + 1.05, z: backZ }, world.materials.storeTrail, state.reducedMotion ? 1 : 2, 0.34);
  }

  function updateDrift(dt) {
    world.drift.forEach((item, index) => {
      const phase = item.userData.phase || 0;
      if (item.children && item.children.length && !item.geometry) {
        if (typeof item.userData.baseY === "number") {
          item.position.y = item.userData.baseY + Math.sin(state.clock * (item.userData.speed || 0.6) + phase) * 0.56;
        }
        item.rotation.x = Math.sin(state.clock * 1.2 + phase) * 0.08;
        item.rotation.z = Math.cos(state.clock * 1.1 + phase) * 0.08;
      } else {
        item.position.y = item.userData.baseY + Math.sin(state.clock * item.userData.speed + phase) * 0.48;
        item.rotation.x += dt * 0.25;
        item.rotation.y += dt * (0.18 + index * 0.003);
      }
    });
  }

  function updateAtmosphere(dt) {
    world.atmosphere.forEach((item, index) => {
      const phase = item.userData.phase || 0;
      const pulse = 0.5 + Math.sin(state.clock * 0.85 + phase) * 0.5;
      if (item.material && item.material.transparent) {
        item.material.opacity = (item.userData.baseOpacity || 0.16) * (0.55 + pulse * 0.7);
      }
      if (item.userData.baseScale) {
        const scale = 1 + Math.sin(state.clock * 0.55 + phase) * 0.035;
        item.scale.set(
          item.userData.baseScale.x * scale,
          item.userData.baseScale.y * (1 + Math.sin(state.clock * 0.48 + phase + 1.2) * 0.025),
          item.userData.baseScale.z * scale
        );
      }
      if (item.geometry && item.geometry.type === "TorusGeometry") {
        item.rotation.z += dt * (0.02 + index * 0.0008);
      }
    });
  }

  function renderWorld(dt) {
    if (!world.renderer || !world.camera) return;
    updateCamera(dt);
    if (world.ring) {
      world.ring.rotation.y += dt * 0.6;
      world.ring.scale.setScalar(1 + Math.sin(state.clock * 3) * 0.025);
    }
    updateGuideBeacon(dt);
    updateTargetMarker();
    updateAtmosphere(dt);
    if (world.boundary && levelConfig().shape !== "square") world.boundary.rotation.z += dt * 0.035;
    world.renderer.render(world.scene, world.camera);
  }

  function isCurrentTargetProp(prop) {
    const type = prop && prop.userData && prop.userData.type;
    const goal = activeGoal();
    if (goal && goal.id === "algae") return type === "algae";
    if (goal && goal.id === "bacteria") return type === "bacteria";
    if (goal && goal.id === "water") return type === "droplet";
    if (goal && goal.id === "ring") return type === "pollen";
    if (goal && goal.id === "hazards") return goal.propTypes ? goal.propTypes.includes(type) : prop.userData.hazard;
    if (goal && (goal.id === "zones" || goal.id === "landmarks")) return false;
    return type === "bacteria" || type === "droplet" || type === "capsule" || type === "enzyme" || type === "platelet" || type === "spore" || type === "digestiveBubble" || type === "magmaBubble" || type === "dataChip" || type === "toolpod";
  }

  function updateGuideBeacon(dt) {
    if (!world.guide) return;
    const target = getGuideTarget();
    world.guide.visible = !!target && state.running && !state.paused && !state.gameOver;
    if (!target) return;
    world.guide.position.set(target.x, target.y || 0.12, target.z);
    world.guide.rotation.y += dt * 2.4;
    world.guide.scale.setScalar(1 + Math.sin(state.clock * 5.5) * 0.08);
    if (world.guide.userData.pointer) {
      world.guide.userData.pointer.position.y = 2.1 + Math.sin(state.clock * 5.2) * 0.22;
    }
  }

  function updateTargetMarker() {
    if (!el.targetMarker || !world.camera || !state.running || state.paused || state.gameOver) {
      hideTargetMarker();
      return;
    }

    const target = getGuideTarget();
    if (!target) {
      hideTargetMarker();
      return;
    }

    const THREE = window.THREE;
    const markerPoint = new THREE.Vector3(target.x, (target.y || 0) + 3.0, target.z);
    markerPoint.project(world.camera);
    const canvasRect = canvas.getBoundingClientRect();
    const parentRect = canvas.parentElement.getBoundingClientRect();
    const projectedX = (markerPoint.x * 0.5 + 0.5) * canvasRect.width + (canvasRect.left - parentRect.left);
    const projectedY = (-markerPoint.y * 0.5 + 0.5) * canvasRect.height + (canvasRect.top - parentRect.top);
    const marginX = isTouchLayout() ? 58 : 70;
    const marginTop = isTouchLayout() ? 84 : 74;
    const marginBottom = isTouchLayout() ? 178 : 92;
    const x = clamp(projectedX, marginX, parentRect.width - marginX);
    const y = clamp(projectedY, marginTop, parentRect.height - marginBottom);
    const distance = Math.hypot(target.x - state.player.x, target.z - state.player.z);

    el.targetMarker.style.left = `${x.toFixed(1)}px`;
    el.targetMarker.style.top = `${y.toFixed(1)}px`;
    if (el.targetMarkerTitle) el.targetMarkerTitle.textContent = targetMarkerTitle();
    if (el.targetMarkerDistance) el.targetMarkerDistance.textContent = `${Math.max(1, Math.round(distance))} um`;
    el.targetMarker.classList.add("is-visible");
  }

  function hideTargetMarker() {
    if (el.targetMarker) el.targetMarker.classList.remove("is-visible");
  }

  function targetMarkerTitle() {
    const goal = activeGoal();
    if (goal && goal.id === "algae") return "Eat algae";
    if (goal && goal.id === "bacteria") return "Bonk bacteria";
    if (goal && goal.id === "water") return "Push water";
    if (goal && goal.id === "ring") return "Feed ring";
    if (goal && goal.id === "zones") return "Tour zone";
    if (goal && goal.id === "landmarks") return "Find landmark";
    if (goal && goal.id === "hazards") return levelConfig().id === "lava" ? "Pop magma" : "Pop bubbles";
    if (goal && goal.id === "toys") return "Use gadget";
    if (goal && goal.id === "scans") return "Scan target";
    if (goal && goal.id === "advance") return "Continue";
    if (goal && goal.id === "chaos") return "Make chaos";
    return "Stay hydrated";
  }

  function getGuideTarget() {
    if (!state.running) return null;
    const goal = activeGoal();
    if (goal && goal.id === "ring") {
      const pollen = findProp("pollen", "ring");
      if (pollen) return { x: pollen.position.x, y: pollen.userData.baseY + 0.1, z: pollen.position.z };
      return { x: RING_TARGET.x, y: groundYAt(RING_TARGET.x, RING_TARGET.z) - 0.2, z: RING_TARGET.z };
    }
    if (goal && goal.id === "zones") {
      return nearestUnvisitedZone();
    }
    if (goal && goal.id === "landmarks") {
      return nearestUnfoundLandmark();
    }
    if (goal && goal.id === "scans") {
      return nearestUnfoundLandmark();
    }
    if (goal && goal.id === "toys") {
      return nearestUnusedToy();
    }
    if (goal && goal.id === "hazards") {
      return nearestHazardProp(goal.propTypes);
    }
    if (goal && goal.id === "advance") {
      return { x: state.player.x, y: state.player.y + 0.2, z: state.player.z };
    }
    const type = goal && goal.id === "algae"
      ? "algae"
      : goal && goal.id === "bacteria"
        ? "bacteria"
        : goal && goal.id === "water"
          ? "droplet"
          : null;
    const prop = type
      ? findProp(type, "player")
      : findProp("bacteria", "player") || findProp("droplet", "player") || findProp("capsule", "player") || findProp("enzyme", "player") || findProp("platelet", "player") || findProp("digestiveBubble", "player") || findProp("magmaBubble", "player") || findProp("dataChip", "player");
    if (!prop) return state.goalIndex >= 3 ? { x: RING_TARGET.x, y: groundYAt(RING_TARGET.x, RING_TARGET.z) - 0.2, z: RING_TARGET.z } : null;
    return { x: prop.position.x, y: prop.userData.baseY + 0.1, z: prop.position.z };
  }

  function nearestUnvisitedZone() {
    let best = null;
    let bestDistance = Infinity;
    SANDBOX_ZONES.forEach((zone) => {
      if (state.zonesVisited.has(zone.id)) return;
      const distance = Math.hypot(zone.x - state.player.x, zone.z - state.player.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x: zone.x, y: groundYAt(zone.x, zone.z) + 0.3, z: zone.z };
      }
    });
    return best || { x: RING_TARGET.x, y: groundYAt(RING_TARGET.x, RING_TARGET.z) + 0.3, z: RING_TARGET.z };
  }

  function nearestUnfoundLandmark() {
    let best = null;
    let bestDistance = Infinity;
    world.landmarks.forEach((landmark) => {
      if (!landmark.userData || landmark.userData.found) return;
      const distance = Math.hypot(landmark.position.x - state.player.x, landmark.position.z - state.player.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = {
          x: landmark.position.x,
          y: groundYAt(landmark.position.x, landmark.position.z) + 0.8,
          z: landmark.position.z,
        };
      }
    });
    return best || nearestUnvisitedZone();
  }

  function nearestUnusedToy() {
    let best = null;
    let bestDistance = Infinity;
    world.traversalToys.forEach((toy) => {
      if (!toy.userData || state.toysUsed.has(toy.userData.id)) return;
      const x = toy.userData.x ?? toy.position.x;
      const z = toy.userData.z ?? toy.position.z;
      const distance = Math.hypot(x - state.player.x, z - state.player.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x, y: groundYAt(x, z) + 0.4, z };
      }
    });
    return best || nearestUnvisitedZone();
  }

  function nearestHazardProp(types = []) {
    let best = null;
    let bestDistance = Infinity;
    world.props.forEach((prop) => {
      if (!prop.visible || !prop.userData) return;
      const matches = types.length ? types.includes(prop.userData.type) : prop.userData.hazard;
      if (!matches || prop.userData.hazardCleared) return;
      const distance = Math.hypot(prop.position.x - state.player.x, prop.position.z - state.player.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x: prop.position.x, y: prop.userData.baseY + 0.2, z: prop.position.z };
      }
    });
    return best || nearestUnvisitedZone();
  }

  function findProp(type, mode) {
    let best = null;
    let bestDistance = Infinity;
    world.props.forEach((prop) => {
      if (!prop.visible || prop.userData.type !== type) return;
      const dx = mode === "ring" ? prop.position.x - RING_TARGET.x : prop.position.x - state.player.x;
      const dz = mode === "ring" ? prop.position.z - RING_TARGET.z : prop.position.z - state.player.z;
      const distance = Math.hypot(dx, dz);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = prop;
      }
    });
    return best;
  }

  function updateCamera(dt) {
    const THREE = window.THREE;
    const p = state.player;
    state.camera.yaw = lerpAngle(state.camera.yaw, state.camera.targetYaw, Math.min(1, dt * 6));
    state.camera.pitch = lerp(state.camera.pitch, state.camera.targetPitch, Math.min(1, dt * 6));
    const distance = 20.8;
    const height = 6.8 + state.camera.pitch * 10.6;
    const yaw = state.camera.yaw;
    const desired = new THREE.Vector3(
      p.x + Math.sin(yaw) * distance,
      p.y + height,
      p.z + Math.cos(yaw) * distance
    );
    const lookAhead = new THREE.Vector3(-Math.sin(p.targetYaw || yaw) * 2.4, 0, -Math.cos(p.targetYaw || yaw) * 2.4);
    const lookAt = new THREE.Vector3(p.x + lookAhead.x, p.y + 1.48, p.z + lookAhead.z);
    if (!world.camera.userData.ready) {
      world.camera.position.copy(desired);
      world.camera.userData.ready = true;
    } else {
      world.camera.position.lerp(desired, Math.min(1, dt * 4.4));
    }
    world.camera.lookAt(lookAt);
  }

  function updateHUD() {
    const goal = activeGoal();
    const target = targetValue(goal);
    const progress = clamp(goal.progress(), 0, target);
    const goalPercent = target > 0 ? progress / target : 1;
    const dashPercent = state.dashCooldown <= 0 ? 100 : (1 - state.dashCooldown / 1.1) * 100;

    el.chaos.textContent = format(state.chaos);
    el.snacks.textContent = state.snacks.toLocaleString();
    el.hydrate.textContent = percent(state.hydrate);
    el.combo.textContent = `${state.combo}x`;
    if (el.time) el.time.textContent = formatTime(SANDBOX_SECONDS - state.sessionTime);
    el.goal.textContent = `${currentStageGoalOrdinal()}/${currentStageGoals().length}`;
    el.high.textContent = api.getHighScore(GAME_ID).toLocaleString();
    el.goalCardProgress.textContent = formatGoalProgress(goal, progress);
    el.dashStatus.textContent = state.dashCooldown <= 0 ? "Ready" : `${Math.ceil(state.dashCooldown * 10) / 10}s`;
    const ringMission = missionById("ring");
    const ringTarget = targetValue(ringMission);
    el.ringStatus.textContent = `${Math.min(state.ringFed, ringTarget)}/${ringTarget}`;
    if (el.zoneStatus) el.zoneStatus.textContent = state.zoneName;
    if (el.levelStatus) el.levelStatus.textContent = levelConfig().name;
    if (el.arcadeScore) el.arcadeScore.textContent = format(state.chaos);
    if (el.arcadeDelta) {
      el.arcadeDelta.textContent = state.scoreDeltaTimer > 0 && state.scoreDelta > 0 ? `+${state.scoreDelta.toLocaleString()}` : "";
    }
    if (el.arcadeLevel) el.arcadeLevel.textContent = state.level.toLocaleString();
    if (el.arcadeXp) el.arcadeXp.style.width = percent((state.xp / xpTarget()) * 100);
    if (el.arcadeXpText) el.arcadeXpText.textContent = `${Math.floor(state.xp).toLocaleString()} / ${xpTarget().toLocaleString()}`;
    syncStoreUi();
    updateMissionHUD();
    updatePhysicsStatus();

    el.meterHydrate.style.width = percent(state.hydrate);
    el.meterHydrate.style.background = state.hydrate < 28 ? "var(--bad)" : "#53ead1";
    el.meterHydrateText.textContent = percent(state.hydrate);
    el.meterDash.style.width = percent(dashPercent);
    el.meterDash.style.background = state.dashCooldown <= 0 ? "#ffd43b" : "#8c6bff";
    el.meterDashText.textContent = percent(dashPercent);
    el.meterGoal.style.width = percent(goalPercent * 100);
    el.meterGoal.style.background = "#6bff7d";
    el.meterGoalText.textContent = percent(goalPercent * 100);
    updatePlayMeters(dashPercent, goalPercent);
    updateRadar();
    syncAdvancePrompt();
  }

  function updatePlayMeters(dashPercent, goalPercent) {
    if (el.playMeterHydrate) {
      el.playMeterHydrate.style.width = percent(state.hydrate);
      el.playMeterHydrate.style.background = state.hydrate < 28 ? "var(--bad)" : "#53ead1";
    }
    if (el.playMeterHydrateText) el.playMeterHydrateText.textContent = percent(state.hydrate);
    if (el.playMeterDash) {
      el.playMeterDash.style.width = percent(dashPercent);
      el.playMeterDash.style.background = state.dashCooldown <= 0 ? "#ffd43b" : "#8c6bff";
    }
    if (el.playMeterDashText) el.playMeterDashText.textContent = percent(dashPercent);
    if (el.playMeterGoal) {
      el.playMeterGoal.style.width = percent(goalPercent * 100);
      el.playMeterGoal.style.background = "#6bff7d";
    }
    if (el.playMeterGoalText) el.playMeterGoalText.textContent = percent(goalPercent * 100);
  }

  function updateRadar() {
    if (!el.radar) return;
    const active = state.running && !state.gameOver;
    el.radar.classList.toggle("is-active", active);
    if (!active) {
      [el.radarRing, el.radarGoal, el.radarToy, el.radarLandmark].forEach((node) => {
        if (node) node.style.opacity = "0";
      });
      return;
    }

    const guideTarget = getGuideTarget();
    const nearestToy = nearestRadarTarget(world.traversalToys, (toy) => !state.toysUsed.has(toy.userData.id));
    const nearestLandmark = nearestRadarTarget(world.landmarks, (landmark) => !landmark.userData.found);
    const ringTarget = { x: RING_TARGET.x, z: RING_TARGET.z };

    placeRadarBlip(el.radarRing, ringTarget);
    placeRadarBlip(el.radarGoal, guideTarget);
    placeRadarBlip(el.radarToy, nearestToy);
    placeRadarBlip(el.radarLandmark, nearestLandmark);

    if (el.radarPlayer) {
      const turn = lerpAngle(state.camera.yaw, state.player.yaw, 1);
      el.radarPlayer.style.transform = `translate(-50%, -50%) rotate(${turn - state.camera.yaw}rad)`;
    }

    if (el.radarDistance) {
      const target = guideTarget || nearestToy || nearestLandmark || ringTarget;
      const distance = Math.hypot(target.x - state.player.x, target.z - state.player.z);
      el.radarDistance.textContent = `${Math.round(distance)} um`;
    }
  }

  function nearestRadarTarget(items, predicate) {
    let nearest = null;
    let best = Infinity;
    items.forEach((item) => {
      if (!item || !item.userData || (predicate && !predicate(item))) return;
      const x = item.userData.x ?? item.position.x;
      const z = item.userData.z ?? item.position.z;
      const distance = Math.hypot(x - state.player.x, z - state.player.z);
      if (distance < best) {
        best = distance;
        nearest = { x, z };
      }
    });
    return nearest;
  }

  function placeRadarBlip(node, target) {
    if (!node) return;
    if (!target) {
      node.style.opacity = "0";
      return;
    }
    const player = state.player;
    const dx = target.x - player.x;
    const dz = target.z - player.z;
    const yaw = state.camera.yaw;
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const localX = dx * rightX + dz * rightZ;
    const localY = dx * forwardX + dz * forwardZ;
    const radarRadius = 52;
    const visibleWorldRadius = (levelConfig().shape === "square" ? playableHalfSize() : playableRadius()) * 0.7;
    const rawX = localX * (radarRadius / visibleWorldRadius);
    const rawY = -localY * (radarRadius / visibleWorldRadius);
    const distance = Math.hypot(rawX, rawY);
    const clamped = distance > radarRadius;
    const scale = clamped ? radarRadius / distance : 1;
    const x = rawX * scale;
    const y = rawY * scale;
    node.style.opacity = "1";
    node.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${clamped ? 0.82 : 1})`;
  }

  function showOverlay(title, sub, buttonText, scoreHtml = "") {
    el.overlayTitle.textContent = title;
    el.overlaySub.innerHTML = sub;
    el.overlayScore.style.display = scoreHtml ? "block" : "none";
    el.overlayScore.innerHTML = scoreHtml;
    el.primary.textContent = buttonText;
    el.overlay.classList.toggle("overlay--report", !!scoreHtml);
    el.overlay.classList.add("overlay--show");
  }

  function hideOverlay() {
    el.overlay.classList.remove("overlay--show");
    el.overlay.classList.remove("overlay--report");
  }

  function endGame(title, reason) {
    state.gameOver = true;
    state.running = false;
    if (saveSlot) saveSlot.clear();
    syncPlayMode();
    const finalScore = Math.floor(state.chaos + state.snacks * 80 + state.ringFed * 500 + state.miniComplete.size * 300 + state.zonesVisited.size * 150 + state.toysUsed.size * 160 + state.landmarksFound.size * 420 + state.maxCombo * 35);
    const high = api.recordScore(GAME_ID, finalScore);
    showOverlay(
      title,
      reason,
      "Restart specimen",
      buildIncidentReport("Desiccated", finalScore, high)
    );
  }

  function winGame() {
    state.gameOver = true;
    state.running = false;
    if (saveSlot) saveSlot.clear();
    state.goalsCleared = Math.max(state.goalsCleared, GOALS.length);
    syncPlayMode();
    const finalScore = Math.floor(state.chaos + state.snacks * 120 + state.ringFed * 650 + state.hydrate * 8 + state.miniComplete.size * 420 + state.zonesVisited.size * 220 + state.toysUsed.size * 220 + state.landmarksFound.size * 520 + state.maxCombo * 45);
    const high = api.recordScore(GAME_ID, finalScore);
    showOverlay(
      "LAB INCIDENT REPORT",
      "The dish is ruined, the tardigrade is thriving, and the lab notebook has stopped making eye contact.",
      "Cause more mayhem",
      buildIncidentReport("Contained chaos", finalScore, high)
    );
  }

  function buildIncidentReport(outcome, finalScore, high) {
    const rows = [
      ["Outcome", outcome],
      ["Goals cleared", `${Math.min(state.goalsCleared, GOALS.length)} / ${GOALS.length}`],
      ["Run time", `${formatTime(state.sessionTime)} / ${formatTime(SANDBOX_SECONDS)}`],
      ["Mini-missions", `${state.miniComplete.size} / ${MINI_MISSIONS.length}`],
      ["Zones visited", `${state.zonesVisited.size} / ${SANDBOX_ZONES.length}`],
      ["Traversal toys", `${state.toysUsed.size} / ${TRAVERSAL_TOYS.length}`],
      ["Landmarks found", `${state.landmarksFound.size} / ${HIDDEN_LANDMARKS.length}`],
      ["Environment", levelConfig().name],
      ["Area scale", `${levelAreaRatio(state.stage).toFixed(1)}x`],
      ["Algae eaten", state.snacks.toLocaleString()],
      ["Bacteria bashed", state.bacteriaBashed.toLocaleString()],
      ["Droplets moved", state.waterMoved.toLocaleString()],
      ["Ring feeds", state.ringFed.toLocaleString()],
      ["Props broken", state.propsBroken.toLocaleString()],
      ["Peak combo", `${state.maxCombo}x`],
      ["Level", state.level.toLocaleString()],
    ];
    return `
      <div class="micro-report">
        <div class="micro-report__score">
          <span>Final score</span>
          <strong>${finalScore.toLocaleString()}</strong>
          <em>${high ? "New high score" : "High " + api.getHighScore(GAME_ID).toLocaleString()}</em>
        </div>
        <div class="micro-report__grid">
          ${rows.map(([label, value]) => `<span>${label}</span><b>${value}</b>`).join("")}
        </div>
      </div>
    `;
  }

  function resize() {
    if (!world.renderer || !world.camera) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, Math.round(rect.width || canvas.width));
    const height = Math.max(220, Math.round(rect.height || canvas.height));
    world.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    world.renderer.setSize(width, height, false);
    world.camera.aspect = width / height;
    world.camera.updateProjectionMatrix();
  }

  function lerpAngle(a, b, t) {
    const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    return a + delta * t;
  }

  window.__MICRO_MAYHEM_DEBUG = {
    state,
    world,
    levelConfig,
    playableRadius,
    levelAreaRatio,
    groundYAt,
    terrainOffsetAt,
    forceLevelOneCompletion,
    forceCurrentStageCompletion,
    acceptStageAdvance,
    transitionToStage,
  };
  loadThree();
})();
