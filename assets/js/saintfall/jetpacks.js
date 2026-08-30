/* ============================================================
   SAINTFALL - the reliquary packs

   Three designs, one articulation loop. `jetpack.js` owns charge,
   flight and the presentation update; this file owns what each pack
   IS. A figure names its pack with `figure.jetpack`; anything that
   does not name one wears the Seraph, which is what Vesper-IX has
   always worn.

   WHAT A PACK HAS TO SUPPLY, and why the shape is worth keeping even
   for a design with no wings and no feathers on it:

     root            the group seated on the Spine
     wings[]         two independently articulated assemblies, each
                     with `feathers[]` - any number of plates that
                     rotate about Z between a folded, a gliding and a
                     powered angle. A vane, a louvre and a feather are
                     all the same joint; only the plate differs, and
                     the wall-tuck that folds a wing beside masonry
                     works on all three for free.
     nozzles[]       thrust locators, in the order exhaust spawns from
     flames[]        one plume record per nozzle
     halo/haloLight  the two counter-turning rings, if the pack has
                     any; both may be null
     chargeWindow    the mesh whose material shows the tank
     pose            the articulation endpoints, so a heavy pack can
                     open slowly and wide where a scout's snaps
     onVisual        anything the shared loop cannot express - a
                     gimbal, a vent, a heat glow

   The two newer packs are deliberately NOT re-skins. A scout carries
   an instrument and a bulwark carries a furnace, and each has to be
   legible from dead astern at 30 m/s, because that is very nearly the
   only bearing the player ever sees their own back from.
   ============================================================ */

import {
  makeMaterial, makeCeramicMaterial, makeEnergyMaterial,
  chamferedRectGeometry, wingPlateGeometry, wingVeinGeometry, shieldGeometry,
  vaneGeometry, louvreGeometry, louvreCapGeometry, latheProfile, rivetRing,
  mergeGeometryList, mesh, plumeMaterials, flareMaterial, buildThruster, mountPack,
} from "saintfall/jetpack-kit.js";

/* The endpoints the shared loop interpolates between. A pack that
   omits any of these gets the Seraph's, which are the numbers that
   loop used to hold as literals. */
const DEFAULT_POSE = Object.freeze({
  /* Wing-root yaw: stowed, deployed-gliding, deployed-powered. */
  stowYaw: 0.46,
  glideYaw: 0.20,
  poweredYaw: 0.34,
  /* Wing-root pitch, same three states. */
  stowPitch: 0.035,
  glidePitch: -0.025,
  poweredPitch: -0.075,
  /* How far apart in the sweep consecutive plates start. */
  featherDelay: 0.038,
  /* Per-plate yaw, stowed then deployed (gliding, powered). */
  plateYawStow: 0.08,
  plateYawGlide: 0.055,
  plateYawPowered: 0.015,
  /* Flutter amplitude and rate, under power then at a glide. */
  flutterPowered: 0.012,
  flutterPoweredRate: 7.4,
  flutterGlide: 0.004,
  flutterGlideRate: 2.6,
  /* How open the wings must be before the plume may light. A plume
     that lights inside a closed pack is a fire in a box. */
  flameGate: 0.76,
  flameGateSpan: 0.14,
  /* Ion veil sheet: closed, gliding, powered. */
  veilOpacity: [0.035, 0.13, 0.24],
  veilOpenX: 1,
  veilOpenY: [0.35, 1, 0.92],
  /* Damp rates for the whole assembly opening and closing. */
  openRate: 12.5,
  closeRate: 5.5,
  /* Ring spin, radians per second of clock. */
  hingeSpin: 0.18,
  hingeLightSpin: -0.28,
});

/* ============================================================
   SERAPH - Vesper-IX

   The original: a mechanical angel. Ceramic feathers on a gold spine
   with one central vector cell between the shoulder blades. Moved
   here verbatim from jetpack.js when the pack became a per-figure
   choice; every number in it is load-bearing and tuned, including the
   ones whose comments explain what they are compensating for.
   ============================================================ */

function buildSeraphPack(ctx, player) {
  const { THREE } = ctx;
  const figure = player.figure;
  const root = new THREE.Group();
  root.name = "jetpack-root";
  root.userData.equipment = "jetpack";
  root.userData.pack = "seraph";

  const iron = makeMaterial(ctx, "jetpack-seraph-iron", 0x17130e, 0.30, 0.86);
  const ivory = makeCeramicMaterial(ctx, "jetpack-seraph-ceramic", 0xd9c9a6);
  const bronze = makeMaterial(ctx, "jetpack-seraph-alloy", 0xb18435, 0.24, 0.82);
  const amber = makeMaterial(ctx, "jetpack-seraph-ion", 0xffcf67, 0.15, 0.18, 0xb76b18);
  const chargeMaterial = amber.clone();
  chargeMaterial.name = "jetpack-seraph-charge";
  const energy = makeEnergyMaterial(ctx, "jetpack-seraph-energy", 0xffbd4a, 0.28);

  /* A narrow load-bearing gold spine is the only fixed solid between
     the hinges. A broad static box occupies the feather sweep and the
     landing-compressed torso no matter how carefully it is beveled;
     breadth instead comes from the articulated gold root fairings.
     This keeps the engine visibly close without hiding intersections. */
  mesh(THREE, chamferedRectGeometry(THREE, 0.080, 0.300, 0.045, 0.018), bronze,
    "jetpack-central-thruster-housing", root, [0, -0.005, -0.080]);
  const shieldInset = new THREE.Mesh(shieldGeometry(THREE), iron);
  shieldInset.name = "jetpack-reliquary-inset";
  shieldInset.position.set(0, 0.005, -0.082);
  shieldInset.scale.set(0.73, 0.74, 0.20);
  shieldInset.castShadow = false;
  root.add(shieldInset);

  mesh(THREE, new THREE.BoxGeometry(0.31, 0.038, 0.075), bronze,
    "jetpack-upper-yoke", root, [0, 0.145, -0.005]);
  const halo = mesh(THREE, new THREE.TorusGeometry(0.148, 0.009, 5, 28), bronze,
    "jetpack-seraph-halo", root, [0, 0.045, -0.095]);
  const haloLight = mesh(THREE, new THREE.TorusGeometry(0.132, 0.004, 4, 24), amber,
    "jetpack-seraph-halo-light", root, [0, 0.045, -0.105]);
  halo.castShadow = false;
  haloLight.castShadow = false;
  mesh(THREE, new THREE.BoxGeometry(0.018, 0.255, 0.014), amber,
    "jetpack-core-rail-l", root, [-0.039, -0.01, -0.088]);
  mesh(THREE, new THREE.BoxGeometry(0.018, 0.255, 0.014), amber,
    "jetpack-core-rail-r", root, [0.039, -0.01, -0.088]);
  const chargeWindow = mesh(THREE, new THREE.OctahedronGeometry(0.060, 1), chargeMaterial,
    "jetpack-charge-window", root, [0, -0.012, -0.115]);
  chargeWindow.scale.set(0.70, 1.28, 0.40);

  const wings = [];
  const featherLengths = [0.70, 0.67, 0.62, 0.56, 0.50];
  const featherWidths = [0.145, 0.140, 0.132, 0.122, 0.110];
  const featherDrops = [0.015, 0.035, 0.065, 0.095, 0.125];
  const foldedAngles = [-75, -79, -83, -87, -91];
  const poweredAngles = [32, 16, 0, -18, -24];
  /* The lowest glide feather stays slightly higher than its powered
     counterpart. Besides sharpening the trailing silhouette, this
     keeps the drawn lance clear through the full low-throttle flutter
     cycle instead of grazing the left tip plate. */
  const glideAngles = [12, 2, -8, -20, -18];

  for (let i = 0; i < 2; i += 1) {
    const side = i === 0 ? -1 : 1;
    const wing = new THREE.Group();
    wing.name = side < 0 ? "jetpack-wing-l" : "jetpack-wing-r";
    /* Hinges pulled forward from z -0.075. The saddle that used to
       bridge this gap is gone: the fix is the wings actually being
       closer, not a plate filling the space where they were not. */
    wing.position.set(side * 0.135, 0.105, -0.042);
    wing.rotation.y = side * 0.46;
    root.add(wing);

    const rootFairing = new THREE.Mesh(
      wingPlateGeometry(THREE, side, 0.255, 0.135, 0.015, 0.035), bronze
    );
    rootFairing.name = `${wing.name}-root-fairing`;
    rootFairing.position.z = -0.050;
    rootFairing.castShadow = true;
    rootFairing.receiveShadow = true;
    wing.add(rootFairing);

    const hinge = mesh(THREE, new THREE.TorusGeometry(0.050, 0.012, 5, 12), bronze,
      `${wing.name}-hinge`, wing, [0, 0, -0.038]);
    const hingeLight = mesh(THREE, new THREE.TorusGeometry(0.031, 0.005, 4, 12), amber,
      `${wing.name}-hinge-light`, wing, [0, 0, -0.052]);
    hinge.castShadow = false;
    hingeLight.castShadow = false;
    const feathers = [];

    for (let f = 0; f < featherLengths.length; f += 1) {
      const feather = new THREE.Group();
      feather.name = `${wing.name}-feather-${f}`;
      feather.position.set(side * (0.014 + f * 0.008), 0.055 - f * 0.030, -0.012 - f * 0.004);
      wing.add(feather);

      const plate = new THREE.Mesh(
        wingPlateGeometry(THREE, side, featherLengths[f], featherWidths[f], featherDrops[f]),
        ivory
      );
      plate.name = `${feather.name}-ceramic-blade`;
      plate.castShadow = true;
      plate.receiveShadow = true;
      feather.add(plate);

      const insetGeometry = wingPlateGeometry(
        THREE, side,
        featherLengths[f] * 0.72, featherWidths[f] * 0.48, featherDrops[f] * 0.58, 0.008
      );
      insetGeometry.translate(0, 0, -0.018);
      const frontInsetGeometry = wingPlateGeometry(
        THREE, side,
        featherLengths[f] * 0.72, featherWidths[f] * 0.48, featherDrops[f] * 0.58, 0.008
      );
      frontInsetGeometry.translate(0, 0, 0.018);
      const quillGeometry = new THREE.CylinderGeometry(
        0.012, 0.018, featherLengths[f] * 0.30, 6, 1
      );
      quillGeometry.rotateZ(-side * Math.PI / 2);
      quillGeometry.translate(
        side * featherLengths[f] * 0.15, -featherDrops[f] * 0.10, -0.006
      );
      const mechanism = new THREE.Mesh(
        mergeGeometryList(THREE, [insetGeometry, frontInsetGeometry, quillGeometry]), iron
      );
      mechanism.name = `${feather.name}-recessed-mechanism`;
      mechanism.castShadow = false;
      feather.add(mechanism);

      const veinGeometry = wingVeinGeometry(THREE, side, featherLengths[f], featherDrops[f]);
      const frontVeinGeometry = wingVeinGeometry(THREE, side, featherLengths[f], featherDrops[f]);
      frontVeinGeometry.translate(0, 0, 0.050);
      const tipGeometry = new THREE.OctahedronGeometry(0.015, 0);
      tipGeometry.scale(1.45, 0.62, 0.40);
      tipGeometry.translate(side * featherLengths[f] * 0.86, -featherDrops[f] * 0.74, -0.029);
      const frontTipGeometry = new THREE.OctahedronGeometry(0.015, 0);
      frontTipGeometry.scale(1.45, 0.62, 0.40);
      frontTipGeometry.translate(side * featherLengths[f] * 0.86, -featherDrops[f] * 0.74, 0.029);
      const ionDetails = new THREE.Mesh(
        mergeGeometryList(
          THREE, [veinGeometry, frontVeinGeometry, tipGeometry, frontTipGeometry]
        ),
        amber
      );
      ionDetails.name = `${feather.name}-ion-details`;
      ionDetails.castShadow = false;
      feather.add(ionDetails);

      feather.userData.foldAngle = side * foldedAngles[f] * Math.PI / 180;
      feather.userData.poweredAngle = side * poweredAngles[f] * Math.PI / 180;
      feather.userData.glideAngle = side * glideAngles[f] * Math.PI / 180;
      feather.userData.phase = f * 0.63 + (side < 0 ? 0.35 : 0);
      feather.rotation.z = feather.userData.foldAngle;
      feathers.push(feather);
    }

    /* A restrained ion veil supports the wing read without replacing
       the modeled feather silhouette with transparent glow. */
    const veilShape = new THREE.Shape([
      new THREE.Vector2(0, 0.035),
      new THREE.Vector2(side * 0.50, 0.20),
      new THREE.Vector2(side * 0.44, -0.18),
      new THREE.Vector2(side * 0.08, -0.20),
    ]);
    const veil = new THREE.Mesh(new THREE.ShapeGeometry(veilShape), energy);
    veil.name = `${wing.name}-ion-veil`;
    veil.position.z = -0.038;
    veil.scale.set(0.10, 0.35, 1);
    veil.renderOrder = 2;
    wing.add(veil);

    wings.push({
      side, root: wing, feathers, hinge, hingeLight, veil,
      wallTuck: 0, visualSpread: 0, deployCant: 0, plumeThrottle: 0,
    });
  }

  const plume = plumeMaterials(ctx);
  const flareMat = flareMaterial(ctx, 0xffd08a);

  /* ONE CENTRAL VECTOR CELL.

     The old pair sat almost thirty centimetres behind the armour and
     created the visible backpack void in profile. The fixed gold spine
     above is the housing; this group supplies its dark rear recess,
     reactor vanes and single rectangular thrust aperture. */
  const centralThruster = new THREE.Group();
  centralThruster.name = "jetpack-central-thruster";
  root.add(centralThruster);
  mesh(THREE, chamferedRectGeometry(THREE, 0.162, 0.215, 0.012, 0.022), iron,
    "jetpack-central-thruster-recess", centralThruster, [0, -0.005, -0.108]);
  const reactorBars = [];
  for (let i = -1; i <= 1; i += 1) {
    const bar = new THREE.BoxGeometry(0.018, i === 0 ? 0.154 : 0.126, 0.012);
    bar.translate(i * 0.050, i === 0 ? 0.004 : -0.010, 0);
    reactorBars.push(bar);
  }
  mesh(THREE, mergeGeometryList(THREE, reactorBars), amber,
    "jetpack-central-thruster-reactor-grid", centralThruster, [0, -0.005, -0.118]);
  mesh(THREE, new THREE.BoxGeometry(0.100, 0.018, 0.090), iron,
    "jetpack-central-thruster-aperture", centralThruster, [0, -0.245, -0.095]);

  const thruster = buildThruster(ctx, {
    parent: centralThruster,
    name: "jetpack-nozzle-center",
    position: [0, -0.258, -0.095],
    plume, flareMat,
  });

  /* Brought 0.10m forward. A finely-sampled per-node sweep put the
     CLOSEST part of the pack 122mm off the back and the farthest at
     212mm - it was not near the trooper at all. An earlier coarse
     probe reported 3mm and sent two rounds of work chasing a contact
     that did not exist. */
  mountPack(figure, root, [0, 1.40, -0.100]);

  return {
    id: "seraph",
    root, wings,
    nozzles: [thruster.locator],
    flames: [thruster.flame],
    centralThruster, halo, haloLight,
    chargeWindow,
    chargeColours: {
      full: 0xffcf67, fullEmissive: 0xb76b18, low: 0xa52b38, lowEmissive: 0xff2338,
    },
    pose: { ...DEFAULT_POSE },
    materials: [
      iron, ivory, bronze, amber, chargeMaterial, energy, plume.outer, plume.inner,
    ],
  };
}

/* ============================================================
   AUGUR - White Vigil, Reliquary Scout

   A SURVEYOR'S INSTRUMENT, NOT A WING. The scout's work on Kenosis is
   to get high, look, and get down again; the pack should read as the
   thing that measures the mountain rather than the thing that blesses
   it.

   The silhouette decision is where the engines are. Two outrigger
   booms carry them OUTBOARD, so the trooper hangs between a pair of
   gimballed pods instead of sitting on top of one central flame:
   from dead astern the Seraph is a single bright point between two
   wings, and this is two bright points with a dark instrument
   between them. Nothing else about a pack is as legible at speed.

   Between the shoulder blades, counter-turning armillary rings around
   a vertical sight-tube whose light column rises with the tank.
   Verdigris and pale ice-green throughout - deliberately the coldest
   palette of the three, and the one that survives being photographed
   against snow.
   ============================================================ */

/* How far the outrigger rolls between stowed and deployed. Stowed it
   lies down the back beside the spine; deployed it comes just above
   horizontal so the two pods sit level with the shoulder line. */
const BOOM_STOW = -74 * Math.PI / 180;
const BOOM_DEPLOYED = 4 * Math.PI / 180;

function buildAugurPack(ctx, player) {
  const { THREE } = ctx;
  const figure = player.figure;
  const root = new THREE.Group();
  root.name = "jetpack-root";
  root.userData.equipment = "jetpack";
  root.userData.pack = "augur";

  const iron = makeMaterial(ctx, "jetpack-augur-iron", 0x1b2320, 0.34, 0.84);
  const verdigris = makeMaterial(ctx, "jetpack-augur-verdigris", 0x63a08d, 0.44, 0.56);
  const brass = makeMaterial(ctx, "jetpack-augur-brass", 0xbba15e, 0.26, 0.86);
  const ivory = makeCeramicMaterial(ctx, "jetpack-augur-ceramic", 0xe6e0d2, {
    roughness: 0.20, clearcoat: 0.80,
  });
  /* Saturated cyan at any real emissive strength clips every channel
     and comes back WHITE, which is how a sight-tube ends up reading
     as a fluorescent strip light. Held at a paler base with a much
     darker emissive so the tube stays green when the tank is full. */
  const ion = makeMaterial(ctx, "jetpack-augur-ion", 0x8fd8c8, 0.16, 0.18, 0x1d6b5c);
  const chargeMaterial = ion.clone();
  chargeMaterial.name = "jetpack-augur-charge";
  const energy = makeEnergyMaterial(ctx, "jetpack-augur-energy", 0x8fe9d7, 0.22);

  /* ---- the instrument column ----
     Slim on purpose. This pack's mass is out on the booms, so the
     spine only has to carry the sight-tube and the rings; a broad
     housing here would put a box between two engines and lose the
     whole read. */
  mesh(THREE, chamferedRectGeometry(THREE, 0.086, 0.322, 0.048, 0.020), verdigris,
    "jetpack-augur-column", root, [0, 0.000, -0.074]);
  mesh(THREE, chamferedRectGeometry(THREE, 0.128, 0.052, 0.062, 0.016), iron,
    "jetpack-augur-column-shoe", root, [0, -0.148, -0.074]);
  mesh(THREE, new THREE.BoxGeometry(0.286, 0.034, 0.070), verdigris,
    "jetpack-augur-yoke", root, [0, 0.152, -0.012]);

  /* The sight-tube: a glass column read against a dark backing plate,
     so a half-empty tank is a half-lit bar rather than a dimmer lamp.
     `chargeWindow` scales in Y from the bottom, which is why its
     geometry is authored with its base at the origin. */
  mesh(THREE, chamferedRectGeometry(THREE, 0.052, 0.236, 0.010, 0.010), iron,
    "jetpack-augur-sight-backing", root, [0, -0.004, -0.104]);
  const tubeGeometry = new THREE.CylinderGeometry(0.019, 0.019, 1, 8, 1, true);
  tubeGeometry.translate(0, 0.5, 0);
  const chargeWindow = mesh(THREE, tubeGeometry, chargeMaterial,
    "jetpack-charge-window", root, [0, -0.112, -0.108]);
  chargeWindow.scale.set(1, 0.216, 1);
  chargeWindow.castShadow = false;
  const collarGeometry = latheProfile(THREE, [
    [0.019, 0], [0.031, 0.004], [0.033, 0.016], [0.019, 0.020],
  ], 10);
  const collars = collarGeometry.clone();
  collars.translate(0, 0.216, 0);
  mesh(THREE, mergeGeometryList(THREE, [collarGeometry, collars]), brass,
    "jetpack-augur-sight-collars", root, [0, -0.112, -0.108]);

  /* Armillary rings. Tilted off each other's plane and counter-turned
     by the shared loop; that opposition is the whole trick, because
     two rings turning the same way read as one thick ring. */
  const halo = mesh(THREE, new THREE.TorusGeometry(0.146, 0.0075, 4, 22), brass,
    "jetpack-augur-armillary-outer", root, [0, 0.034, -0.098], [0.30, 0, 0]);
  const haloLight = mesh(THREE, new THREE.TorusGeometry(0.118, 0.0045, 4, 18), ion,
    "jetpack-augur-armillary-inner", root, [0, 0.034, -0.104], [-0.42, 0.22, 0]);
  halo.castShadow = false;
  haloLight.castShadow = false;

  /* The theodolite head: the one piece of the pack that stands above
     the shoulder line, so the scout has a silhouette from the front
     as well as from behind. */
  mesh(THREE, chamferedRectGeometry(THREE, 0.092, 0.070, 0.060, 0.022), iron,
    "jetpack-augur-head", root, [0, 0.196, -0.070]);
  const lens = mesh(THREE, new THREE.OctahedronGeometry(0.028, 0), ion,
    "jetpack-augur-lens", root, [0, 0.196, -0.104]);
  lens.scale.set(0.92, 0.92, 0.55);
  lens.castShadow = false;

  const plume = plumeMaterials(ctx, {
    /* Cold-running ion, not a chemical rocket: the throat is pale
       green-white and the tail goes cyan rather than orange.

       AND IT MUST NOT CLIP. The plume is additive, so a saturated
       colour times a gain above one saturates every channel it is
       strong in and comes back WHITE - the first pass paired an
       0xffffff throat with a 1.30 gain and produced a pair of white
       blobs where two green engines should be, which is the same
       failure the Gleaner eggs hit at emissive x2.6. Held so the
       brightest channel reaches one at full throttle and the hue
       survives. */
    hotOuter: 0xd6f6ec, coldOuter: 0x35bda6,
    hotInner: 0xdcfff5, coldInner: 0x63d8bd,
    outer: { width: 0.096, depth: 0.096, length: 0.32, taper: 0.34, gain: 0.72 },
    inner: { width: 0.050, depth: 0.050, length: 0.21, taper: 0.28, gain: 1.10 },
  });
  const flareMat = flareMaterial(ctx, 0x9fe6d4);

  /* ---- the booms ---- */
  const wings = [];
  const nozzles = [];
  const flames = [];
  const pods = [];
  const booms = [];
  const vaneLengths = [0.330, 0.292, 0.250];
  const vaneRoots = [0.098, 0.088, 0.078];
  const vaneTips = [0.048, 0.043, 0.038];
  const vaneSweeps = [0.028, 0.054, 0.080];
  /* RELATIVE TO THE BOOM, which is itself folding. Stowed, the vanes
     nest along the spar rather than standing off it; the fan is what
     they do once the boom is up. */
  const foldedAngles = [-5, -10, -16];
  const poweredAngles = [34, 9, -17];
  const glideAngles = [17, -2, -22];

  for (let i = 0; i < 2; i += 1) {
    const side = i === 0 ? -1 : 1;
    const wing = new THREE.Group();
    wing.name = side < 0 ? "jetpack-wing-l" : "jetpack-wing-r";
    wing.position.set(side * 0.112, 0.086, -0.046);
    wing.rotation.y = side * 0.52;
    root.add(wing);

    /* THE BOOM ITSELF HAS TO FOLD.

       The shared loop rotates the wing in yaw and pitch and each
       PLATE in roll, which is everything a feather assembly needs
       because a feather's hinge is the wing root. A boom is not a
       feather: the first version left the spar rigid in the wing
       group, so a stowed scout walked around with a metre-wide steel
       crossbar through both shoulders and a thruster pod hanging off
       each end of it. The vanes folded neatly along a bar that never
       moved.

       So the spar, its pod and its vanes hang off a group of their
       own that rolls with the deployment - stowed it lies down the
       back beside the spine, deployed it comes up to horizontal.
       `onVisual` drives it, per side, off that side's own spread so a
       wall-tucked boom folds with its own wing. */
    const boom = new THREE.Group();
    boom.name = `${wing.name}-boom`;
    boom.rotation.z = side * BOOM_STOW;
    wing.add(boom);
    booms.push({ side, boom, wing });

    /* Authored from the hinge outward so the boom grows in +X on the
       right and -X on the left without a mirrored scale, which would
       flip every face on one side of the pack. */
    const sparGeometry = chamferedRectGeometry(THREE, 0.246, 0.044, 0.040, 0.012);
    sparGeometry.translate(side * 0.123, 0, 0);
    mesh(THREE, sparGeometry, verdigris, `${wing.name}-spar`, boom, [0, 0, -0.030]);
    const sparCap = chamferedRectGeometry(THREE, 0.038, 0.058, 0.054, 0.014);
    sparCap.translate(side * 0.246, -0.004, 0);
    mesh(THREE, sparCap, iron, `${wing.name}-spar-cap`, boom, [0, 0, -0.030]);
    /* Rivets down the spar: two short rows rather than a ring, since
       this is a beam and not a drum. */
    const studs = [];
    for (let st = 0; st < 4; st += 1) {
      const stud = new THREE.OctahedronGeometry(0.008, 0);
      stud.scale(1, 0.6, 1);
      stud.translate(side * (0.046 + st * 0.056), 0.023, -0.030);
      studs.push(stud);
    }
    mesh(THREE, mergeGeometryList(THREE, studs), brass,
      `${wing.name}-spar-studs`, boom, [0, 0, 0]);

    const hinge = mesh(THREE, new THREE.TorusGeometry(0.042, 0.011, 4, 12), brass,
      `${wing.name}-hinge`, wing, [0, 0, -0.038]);
    const hingeLight = mesh(THREE, new THREE.TorusGeometry(0.026, 0.005, 4, 12), ion,
      `${wing.name}-hinge-light`, wing, [0, 0, -0.052]);
    hinge.castShadow = false;
    hingeLight.castShadow = false;

    const feathers = [];
    for (let f = 0; f < vaneLengths.length; f += 1) {
      const vane = new THREE.Group();
      vane.name = `${wing.name}-vane-${f}`;
      vane.position.set(side * (0.024 + f * 0.010), 0.034 - f * 0.030, -0.014 - f * 0.006);
      boom.add(vane);

      const blade = new THREE.Mesh(
        vaneGeometry(THREE, side, vaneLengths[f], vaneRoots[f], vaneTips[f], vaneSweeps[f]),
        ivory
      );
      blade.name = `${vane.name}-blade`;
      blade.castShadow = true;
      blade.receiveShadow = true;
      vane.add(blade);

      /* A verdigris leading edge and a single ion filament down the
         spar line. Merged: three of these per boom, twice, is six
         draw calls for what is one silhouette. */
      const edge = vaneGeometry(
        THREE, side, vaneLengths[f] * 0.99, vaneRoots[f] * 0.20, vaneTips[f] * 0.24,
        vaneSweeps[f] * 0.30, 0.021
      );
      edge.translate(0, vaneRoots[f] * 0.38, 0);
      mesh(THREE, edge, verdigris, `${vane.name}-edge`, vane, [0, 0, 0]);

      const filament = new THREE.BoxGeometry(vaneLengths[f] * 0.66, 0.0075, 0.0075);
      filament.translate(side * vaneLengths[f] * 0.40, -vaneSweeps[f] * 0.42, -0.011);
      const tipLamp = new THREE.OctahedronGeometry(0.011, 0);
      tipLamp.scale(1.5, 0.55, 0.45);
      tipLamp.translate(side * vaneLengths[f] * 0.90, -vaneSweeps[f] * 0.86, -0.011);
      const lamps = mesh(THREE, mergeGeometryList(THREE, [filament, tipLamp]), ion,
        `${vane.name}-ion`, vane, [0, 0, 0]);
      lamps.castShadow = false;

      vane.userData.foldAngle = side * foldedAngles[f] * Math.PI / 180;
      vane.userData.poweredAngle = side * poweredAngles[f] * Math.PI / 180;
      vane.userData.glideAngle = side * glideAngles[f] * Math.PI / 180;
      vane.userData.phase = f * 0.81 + (side < 0 ? 0.4 : 0);
      vane.rotation.z = vane.userData.foldAngle;
      feathers.push(vane);
    }

    /* ---- the pod at the boom tip ----
       A gimbal, so it has somewhere to point. Two brass cheeks, a
       lathed bell hung between them, and the thrust locator at its
       throat; `onVisual` tips the inner group and the shared loop
       never has to know this pack's engines move. */
    const podYoke = new THREE.Group();
    podYoke.name = `${wing.name}-pod-yoke`;
    podYoke.position.set(side * 0.262, -0.016, -0.030);
    boom.add(podYoke);
    /* THE POD HAS TO BE THE OBJECT, NOT THE BRACKET. First pass hung
       the cheeks 92mm apart around a 86mm engine, so the tip of each
       boom read as an empty brass staple with a plume coming out of
       the gap behind it. The yoke is now barely wider than what it
       carries, and the pod itself is the largest thing at the tip. */
    const cheeks = [];
    for (const s of [-1, 1]) {
      const cheek = chamferedRectGeometry(THREE, 0.028, 0.078, 0.011, 0.010);
      cheek.rotateY(Math.PI / 2);
      cheek.translate(0, 0.004, s * 0.038);
      cheeks.push(cheek);
    }
    mesh(THREE, mergeGeometryList(THREE, cheeks), brass,
      `${wing.name}-pod-cheeks`, podYoke, [0, 0, 0]);

    const pod = new THREE.Group();
    pod.name = `${wing.name}-pod`;
    podYoke.add(pod);
    mesh(THREE, latheProfile(THREE, [
      [0, 0.070], [0.034, 0.066], [0.049, 0.026], [0.052, -0.032],
      [0.068, -0.100], [0.059, -0.112], [0.043, -0.042], [0.039, 0.024], [0, 0.030],
    ], 12), iron, `${wing.name}-pod-shell`, pod, [0, 0, 0]);
    /* A pale cowl over the engine's shoulder. Every other bright
       surface on this pack is a vane; without it the two pods are the
       only dark objects in the silhouette and read as holes. */
    mesh(THREE, latheProfile(THREE, [
      [0.036, 0.052], [0.053, 0.030], [0.056, 0.006], [0.043, 0.010], [0.040, 0.048],
    ], 12), ivory, `${wing.name}-pod-cowl`, pod, [0, 0, 0]);
    mesh(THREE, new THREE.TorusGeometry(0.054, 0.008, 4, 14), verdigris,
      `${wing.name}-pod-band`, pod, [0, -0.026, 0], [Math.PI / 2, 0, 0]);
    const intake = mesh(THREE, new THREE.TorusGeometry(0.034, 0.006, 4, 12), ion,
      `${wing.name}-pod-intake`, pod, [0, 0.058, 0], [Math.PI / 2, 0, 0]);
    intake.castShadow = false;

    const thruster = buildThruster(ctx, {
      parent: pod,
      name: `jetpack-nozzle-${side < 0 ? "port" : "starboard"}`,
      position: [0, -0.116, 0],
      plume, flareMat, flareSize: 0.125, flareGain: 0.52,
    });
    nozzles.push(thruster.locator);
    flames.push(thruster.flame);
    pods.push({
      side, pod, intake,
      wingSpread: () => (Number.isFinite(wing.userData.spread) ? wing.userData.spread : 0),
    });

    /* A thin condensation sheet under the boom - the scout's answer
       to the Seraph's ion veil, read as vapour off a cold vane rather
       than as a glowing wing.

       ON THE BOOM, AND INSIDE THE VANES. It was first parented to the
       wing at the Seraph's proportions, and both of those were wrong.
       The Seraph's veil reaches 0.50 under a 0.70m feather; the same
       sheet under a 0.33m vane reached 4.6cm PAST the outermost blade
       and read in play as a green polygon sticking out of the wing -
       a glow that ends outside its own hardware is not a glow. And
       left on the wing it stayed flat in the deployed plane while the
       outrigger folded away beneath it, so a stowed scout trailed a
       sheet attached to nothing. */
    const veilShape = new THREE.Shape([
      new THREE.Vector2(0, 0.022),
      new THREE.Vector2(side * 0.235, 0.072),
      new THREE.Vector2(side * 0.210, -0.098),
      new THREE.Vector2(side * 0.040, -0.112),
    ]);
    const veil = new THREE.Mesh(new THREE.ShapeGeometry(veilShape), energy);
    veil.name = `${wing.name}-vapour-veil`;
    veil.position.set(side * 0.030, -0.008, -0.034);
    veil.scale.set(0.10, 0.35, 1);
    veil.renderOrder = 2;
    boom.add(veil);

    wings.push({
      side, root: wing, feathers, hinge, hingeLight, veil,
      wallTuck: 0, visualSpread: 0, deployCant: 0, plumeThrottle: 0,
    });
  }

  mountPack(figure, root, [0, 1.40, -0.094]);

  const podRest = -0.06;
  return {
    id: "augur",
    root, wings, nozzles, flames,
    centralThruster: null,
    halo, haloLight,
    chargeWindow,
    chargeColours: {
      full: 0x8fd8c8, fullEmissive: 0x1d6b5c, low: 0xd8562f, lowEmissive: 0xa32a08,
    },
    pose: {
      ...DEFAULT_POSE,
      /* A scout's rig SNAPS. Wider open, faster, and with the booms
         swept a little further back under power so the two pods sit
         behind the shoulder line where the chase camera can see both
         of them at once. */
      stowYaw: 0.52, glideYaw: 0.12, poweredYaw: 0.26,
      stowPitch: 0.055, glidePitch: -0.045, poweredPitch: -0.095,
      featherDelay: 0.055,
      plateYawStow: 0.10, plateYawGlide: 0.070, plateYawPowered: 0.020,
      flutterPowered: 0.018, flutterPoweredRate: 9.2,
      flutterGlide: 0.007, flutterGlideRate: 3.1,
      /* The pods hang off the boom tips, so they clear the armour far
         earlier in the sweep than a central aperture clears its own
         feathers. Lighting at 0.76 held both engines dark through
         most of a deployment that was already visibly finished. */
      flameGate: 0.46, flameGateSpan: 0.16,
      veilOpacity: [0.030, 0.11, 0.19],
      veilOpenY: [0.35, 1, 0.86],
      openRate: 15.5, closeRate: 6.5,
      hingeSpin: 0.26, hingeLightSpin: -0.44,
    },
    /* The gimbal, the intake rings and the theodolite lens. None of
       these is a fold angle, so none of them belongs in the shared
       loop; all three are what makes the pack read as an instrument
       under power rather than a rack of plates. */
    onVisual(frame) {
      const { throttle, powered, clock, dt } = frame;
      /* PER SIDE, off that wing's own spread. A boom beside masonry
         is tucked by the shared loop and its spar has to come down
         with it; reading the global spread would leave one outrigger
         rigidly out through a wall while its vanes folded. */
      for (const entry of booms) {
        const open = Number.isFinite(entry.wing.userData.spread)
          ? entry.wing.userData.spread : 0;
        const eased = open * open * (3 - 2 * open);
        const want = entry.side * (BOOM_STOW + (BOOM_DEPLOYED - BOOM_STOW) * eased);
        entry.boom.rotation.z += (want - entry.boom.rotation.z)
          * (1 - Math.exp(-11 * dt));
      }
      /* THRUST POINTS BACKWARD, NOT FORWARD.
         The pod's plume runs down the locator's -Y, and a NEGATIVE
         rotation about X swings that toward +Z - the way the trooper
         is going. Measured under full thrust the plume came out
         (-0.14, -0.98, +0.16): down and slightly AHEAD of the
         operative, which reads as a rocket braking rather than one
         driving. Positive tips it astern, where exhaust belongs, and
         more of it the harder the throttle. */
      const tip = powered ? 0.34 + 0.16 * throttle : podRest;
      for (const entry of pods) {
        entry.pod.rotation.x += (tip - entry.pod.rotation.x)
          * (1 - Math.exp(-9 * dt));
        /* A trace of differential, so the two pods are never a mirror
           of each other and the rig looks like it is trimming. */
        entry.pod.rotation.z = Math.sin(clock * 2.1 + entry.side) * 0.05
          * entry.wingSpread();
        const glow = 0.45 + throttle * 1.05 + Math.sin(clock * 6.3) * 0.05 * throttle;
        entry.intake.material.emissiveIntensity = glow;
      }
      lens.material.emissiveIntensity = 0.55 + throttle * 0.55;
      lens.rotation.z = clock * 0.55;
    },
    materials: [
      iron, verdigris, brass, ivory, ion, chargeMaterial, energy,
      plume.outer, plume.inner,
    ],
  };
}

/* ============================================================
   CENSER - Bastion Penitent, Reliquary Bulwark

   A FURNACE ON A MAN'S BACK. The bulwark does not glide anywhere; it
   arrives. So this pack is a riveted boiler drum with a firebox
   grille, two pressure stacks over the shoulders and one enormous
   bell underneath, and its "wings" are not wings at all - they are
   two banks of heat-shield louvres that lie shut across the back on
   the ground and crack open in flight to dump what the drum is
   making. Same joint as a feather; opposite statement.

   Crimson lacquer over blackened iron with heat-blued brass, and an
   exhaust that runs deep orange rather than gold. Beside the Augur's
   two cold points this is one broad hot one, which is the whole
   reason the two designs can share a level.
   ============================================================ */

function buildCenserPack(ctx, player) {
  const { THREE } = ctx;
  const figure = player.figure;
  const root = new THREE.Group();
  root.name = "jetpack-root";
  root.userData.equipment = "jetpack";
  root.userData.pack = "censer";

  /* THE FIRST VERSION READ AS A BLACK LUMP. Blackened iron and a
     0x8e2226 lacquer are the right paints for a furnace and the wrong
     ones for THIS figure: the Bastion is ivory and brass, and a pack
     built out of the two darkest values on the model turns the whole
     back of the trooper into a hole with an orange window in it. The
     gallery plates showed twelve silhouettes and no hardware.

     So the values are inverted. Bone ceramic carries the large
     surfaces - the louvres and the drum's shoulders - crimson is trim
     and inner faces, brass is every edge, and the black is only what
     is genuinely recessed: the firebox throat and the bell. The pack
     is still unmistakably the hot one; it is now also legible against
     its own armour. */
  const iron = makeMaterial(ctx, "jetpack-censer-iron", 0x241c1a, 0.38, 0.86);
  const lacquer = makeCeramicMaterial(ctx, "jetpack-censer-lacquer", 0xa8323a, {
    roughness: 0.26, metalness: 0.22, clearcoat: 0.70, clearcoatRoughness: 0.22, rim: 1.10,
  });
  const brass = makeMaterial(ctx, "jetpack-censer-brass", 0xc0a052, 0.28, 0.88);
  const bone = makeCeramicMaterial(ctx, "jetpack-censer-bone", 0xdfd6c0, {
    roughness: 0.24, clearcoat: 0.70,
  });
  const ember = makeMaterial(ctx, "jetpack-censer-ember", 0xffa347, 0.18, 0.20, 0xc03c08);
  const chargeMaterial = ember.clone();
  chargeMaterial.name = "jetpack-censer-charge";
  const energy = makeEnergyMaterial(ctx, "jetpack-censer-heat", 0xff9a4a, 0.20);

  /* ---- the drum ----
     Lathed rather than boxed, because a boiler is the one shape on
     this figure that should not be a plate, and flat-shaded at 12
     sides so it still belongs beside the faceted armour. */
  const drum = mesh(THREE, latheProfile(THREE, [
    [0, 0.176], [0.062, 0.172], [0.098, 0.142], [0.114, 0.078],
    [0.117, -0.036], [0.106, -0.118], [0.074, -0.166], [0, -0.172],
  ], 12), bone, "jetpack-censer-drum", root, [0, -0.004, -0.092]);
  drum.receiveShadow = true;
  /* Crimson caps top and bottom, so the drum is a painted vessel and
     not a bare cylinder. Slightly proud of the bone so the join is a
     real edge rather than z-fighting. */
  for (const [y, flip] of [[0.150, 1], [-0.140, -1]]) {
    mesh(THREE, latheProfile(THREE, [
      [0, 0.030 * flip], [0.064, 0.028 * flip], [0.101, 0.002 * flip],
      [0.106, -0.030 * flip], [0, -0.032 * flip],
    ], 12), lacquer, `jetpack-censer-drum-cap-${flip > 0 ? "top" : "bottom"}`,
    root, [0, -0.004 + y, -0.092]);
  }

  /* Riveted bands. Two hoops and their rivets merged into one mesh
     each; a rivet is what separates plate from a painted cylinder and
     there are thirty-two of them. */
  for (const [y, radius] of [[0.108, 0.104], [-0.070, 0.113]]) {
    mesh(THREE, new THREE.TorusGeometry(radius, 0.0105, 4, 14), brass,
      `jetpack-censer-band-${y > 0 ? "upper" : "lower"}`, root,
      [0, -0.004 + y, -0.092], [Math.PI / 2, 0, 0]);
    mesh(THREE, rivetRing(THREE, radius + 0.004, 16, 0.0085), brass,
      `jetpack-censer-rivets-${y > 0 ? "upper" : "lower"}`, root,
      [0, -0.004 + y, -0.092]);
  }

  /* The firebox: a recessed charge window behind a heavy grille, so
     the tank reads as a fire seen through bars rather than as a lamp.
     The grille is in front, which is why the window is the smaller of
     the two and sits deeper. */
  const chargeWindow = mesh(THREE, chamferedRectGeometry(THREE, 0.112, 0.150, 0.014, 0.016),
    chargeMaterial, "jetpack-charge-window", root, [0, 0.006, -0.196]);
  chargeWindow.castShadow = false;
  const grilleBars = [];
  for (let i = 0; i < 4; i += 1) {
    const bar = new THREE.BoxGeometry(0.126, 0.014, 0.016);
    bar.translate(0, 0.058 - i * 0.038, 0);
    grilleBars.push(bar);
  }
  mesh(THREE, chamferedRectGeometry(THREE, 0.150, 0.186, 0.020, 0.018), brass,
    "jetpack-censer-firebox-frame", root, [0, 0.006, -0.186]);
  mesh(THREE, mergeGeometryList(THREE, grilleBars), iron,
    "jetpack-censer-firebox-grille", root, [0, 0.006, -0.202]);
  mesh(THREE, rivetRing(THREE, 0.082, 12, 0.008, 0.006, -0.176, "z"), brass,
    "jetpack-censer-firebox-rivets", root, [0, 0, 0]);

  /* Shoulder yoke and the harness plates that put the load on the
     figure rather than leaving the drum floating behind it. */
  mesh(THREE, chamferedRectGeometry(THREE, 0.336, 0.048, 0.086, 0.018), brass,
    "jetpack-censer-yoke", root, [0, 0.158, -0.020]);
  for (const s of [-1, 1]) {
    mesh(THREE, chamferedRectGeometry(THREE, 0.070, 0.128, 0.052, 0.016), bone,
      `jetpack-censer-harness-${s < 0 ? "l" : "r"}`, root, [s * 0.132, 0.070, -0.030]);
  }

  /* ---- the stacks ----
     Two short chimneys over the shoulders, raked outboard and back.
     They are the pack's only vertical, and the reason it has a
     silhouette above the pauldrons. */
  const stacks = [];
  for (const s of [-1, 1]) {
    const stack = new THREE.Group();
    stack.name = `jetpack-censer-stack-${s < 0 ? "l" : "r"}`;
    /* TALL ENOUGH TO CLEAR THE PAULDRON. At 0.13m of pipe the stacks
       finished below the Bastion's shoulder plates and the only part
       of them anyone ever saw was the vent ring peering over the top
       of each one - two small red rings on a dark back, which read
       as a pair of eyes. They are the pack's only vertical; they have
       to actually stand up. */
    stack.position.set(s * 0.126, 0.150, -0.092);
    stack.rotation.set(-0.20, 0, s * 0.17);
    root.add(stack);
    mesh(THREE, latheProfile(THREE, [
      [0, 0], [0.032, 0], [0.035, 0.070], [0.031, 0.148],
      [0.048, 0.182], [0.040, 0.194], [0.025, 0.158], [0.027, 0.070], [0.022, 0], [0, 0],
    ], 10), brass, `${stack.name}-pipe`, stack, [0, 0, 0]);
    mesh(THREE, new THREE.TorusGeometry(0.037, 0.0065, 4, 12), brass,
      `${stack.name}-band`, stack, [0, 0.086, 0], [Math.PI / 2, 0, 0]);
    mesh(THREE, latheProfile(THREE, [
      [0.033, 0], [0.046, 0.006], [0.048, 0.024], [0.034, 0.030],
    ], 10), bone, `${stack.name}-collar`, stack, [0, 0.126, 0]);
    const glow = mesh(THREE, new THREE.TorusGeometry(0.029, 0.008, 4, 12), ember,
      `${stack.name}-vent`, stack, [0, 0.172, 0], [Math.PI / 2, 0, 0]);
    glow.castShadow = false;
    stacks.push(glow);
  }

  /* Heat-blued feed pipes from the drum's shoulders down to the bell.
     Two curves rather than four: the pack already has a great deal of
     hardware on it and the pipes are there to tie the drum to the
     engine, not to add another silhouette. */
  for (const s of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(s * 0.088, 0.090, -0.150),
      new THREE.Vector3(s * 0.128, 0.010, -0.176),
      new THREE.Vector3(s * 0.106, -0.104, -0.168),
      new THREE.Vector3(s * 0.050, -0.186, -0.126),
    ]);
    mesh(THREE, new THREE.TubeGeometry(curve, 10, 0.0135, 6, false), brass,
      `jetpack-censer-feed-${s < 0 ? "l" : "r"}`, root, [0, 0, 0]);
  }

  const plume = plumeMaterials(ctx, {
    /* A furnace, not an ion drive: white throat straight into deep
       orange, and a heavier sheet than either other pack carries. */
    hotOuter: 0xffd9a0, coldOuter: 0xd8480f,
    hotInner: 0xfff4e2, coldInner: 0xff8b2c,
    outer: { width: 0.208, depth: 0.128, length: 0.58, taper: 0.44, gain: 0.92 },
    inner: { width: 0.108, depth: 0.062, length: 0.38, taper: 0.32, gain: 1.45 },
  });
  const flareMat = flareMaterial(ctx, 0xffb066);

  /* ---- the bell ----
     One aperture, and it is enormous. The Seraph's rectangular slot
     is a vector cell; this is a furnace throat, and it is the reason
     a Bastion landing has weight. */
  const centralThruster = new THREE.Group();
  centralThruster.name = "jetpack-central-thruster";
  root.add(centralThruster);
  mesh(THREE, chamferedRectGeometry(THREE, 0.186, 0.070, 0.150, 0.024), iron,
    "jetpack-censer-plenum", centralThruster, [0, -0.192, -0.112]);
  mesh(THREE, latheProfile(THREE, [
    [0.062, 0.010], [0.074, -0.042], [0.108, -0.108], [0.142, -0.166],
    [0.133, -0.178], [0.100, -0.120], [0.066, -0.052], [0.054, 0.010],
  ], 14), iron, "jetpack-censer-bell", centralThruster, [0, -0.214, -0.112]);
  mesh(THREE, new THREE.TorusGeometry(0.138, 0.0095, 4, 16), brass,
    "jetpack-censer-bell-lip", centralThruster, [0, -0.382, -0.112], [Math.PI / 2, 0, 0]);
  /* Thrust vanes across the throat. Visible only from below and from
     directly astern at a climb, which on this level is most of a
     jetpack's screen time. */
  const vanes = [];
  for (let i = 0; i < 4; i += 1) {
    const vane = new THREE.BoxGeometry(0.118, 0.010, 0.016);
    vane.rotateY((i / 4) * Math.PI);
    vanes.push(vane);
  }
  const throatVanes = mesh(THREE, mergeGeometryList(THREE, vanes), ember,
    "jetpack-censer-throat-vanes", centralThruster, [0, -0.256, -0.112]);
  throatVanes.castShadow = false;

  const thruster = buildThruster(ctx, {
    parent: centralThruster,
    name: "jetpack-nozzle-center",
    position: [0, -0.372, -0.112],
    plume, flareMat, flareSize: 0.42,
  });

  /* ---- the louvre banks ---- */
  const wings = [];
  const louvreGlows = [];
  const louvreLengths = [0.335, 0.310, 0.278, 0.240];
  const louvreWidths = [0.118, 0.112, 0.104, 0.094];
  /* SHUT IS NOT FLUSH. Folded dead vertical, the bank presented four
     slat EDGES between two enormous pauldrons and the whole stowed
     pack came back as a black void with an orange window in it. A
     shutter stack at rest still steps: the top slat rides up and out
     where it catches sky, the bottom tucks under the drum. */
  const foldedAngles = [-62, -78, -94, -110];
  const poweredAngles = [42, 18, -6, -30];
  const glideAngles = [18, 0, -18, -36];

  for (let i = 0; i < 2; i += 1) {
    const side = i === 0 ? -1 : 1;
    const wing = new THREE.Group();
    wing.name = side < 0 ? "jetpack-wing-l" : "jetpack-wing-r";
    wing.position.set(side * 0.116, 0.058, -0.052);
    wing.rotation.y = side * 0.40;
    root.add(wing);

    /* The bank's own casing, so the louvres come out of something. */
    const casing = chamferedRectGeometry(THREE, 0.076, 0.240, 0.070, 0.018);
    casing.translate(side * 0.030, -0.010, 0);
    mesh(THREE, casing, lacquer, `${wing.name}-bank`, wing, [0, 0, -0.026]);
    mesh(THREE, rivetRing(THREE, 0.030, 8, 0.0075, -0.010, -0.026, "z"), brass,
      `${wing.name}-bank-rivets`, wing, [side * 0.030, 0, 0]);

    const hinge = mesh(THREE, new THREE.TorusGeometry(0.046, 0.013, 4, 12), brass,
      `${wing.name}-hinge`, wing, [0, 0, -0.040]);
    const hingeLight = mesh(THREE, new THREE.TorusGeometry(0.027, 0.006, 4, 12), ember,
      `${wing.name}-hinge-light`, wing, [0, 0, -0.056]);
    hinge.castShadow = false;
    hingeLight.castShadow = false;

    const feathers = [];
    for (let f = 0; f < louvreLengths.length; f += 1) {
      const louvre = new THREE.Group();
      louvre.name = `${wing.name}-louvre-${f}`;
      louvre.position.set(side * (0.020 + f * 0.009), 0.062 - f * 0.040, -0.014 - f * 0.005);
      wing.add(louvre);

      const slat = new THREE.Mesh(
        louvreGeometry(THREE, side, louvreLengths[f], louvreWidths[f], 0.030), bone
      );
      slat.name = `${louvre.name}-slat`;
      slat.castShadow = true;
      slat.receiveShadow = true;
      louvre.add(slat);

      /* A crimson rib along the slat and a brass shoe on its point:
         the two things that stop four stacked plates reading as one
         paddle. The rib is the same chisel at 88% of the length, so
         it sits inside the point rather than crossing it. */
      const rib = louvreGeometry(
        THREE, side, louvreLengths[f] * 0.88, louvreWidths[f] * 0.44, 0.016
      );
      rib.translate(0, 0, -0.014);
      mesh(THREE, rib, lacquer, `${louvre.name}-rib`, louvre, [0, 0, 0]);
      mesh(THREE, louvreCapGeometry(THREE, side, louvreLengths[f], louvreWidths[f]),
        brass, `${louvre.name}-cap`, louvre, [0, 0, 0]);

      /* THE HEAT STRIP GOES ON THE FACE THE CAMERA IS ON.
         It was authored at +Z, which in pack-root space is the side
         facing the trooper's back - so the one part of this pack that
         was supposed to light up as the bank opened was radiating
         into a breastplate, and the gallery's twelve plates showed
         four black paddles per side and no glow at all. -Z is
         rearward, which is both where the viewer is and, on a heat
         shield, the side actually facing the exhaust. */
      const strip = new THREE.BoxGeometry(louvreLengths[f] * 0.68, 0.013, 0.010);
      strip.translate(side * louvreLengths[f] * 0.41, 0, -0.023);
      /* Inboard of the shoe now. Left at 0.90 it sat on top of the
         brass cap and put a soft glowing bead exactly where the point
         is supposed to be sharpest. */
      const vent = new THREE.OctahedronGeometry(0.013, 0);
      vent.scale(1.5, 0.62, 0.5);
      vent.translate(side * louvreLengths[f] * 0.78, -louvreWidths[f] * 0.03, -0.020);
      const glow = mesh(THREE, mergeGeometryList(THREE, [strip, vent]), ember,
        `${louvre.name}-heat`, louvre, [0, 0, 0]);
      glow.castShadow = false;
      louvreGlows.push(glow);

      louvre.userData.foldAngle = side * foldedAngles[f] * Math.PI / 180;
      louvre.userData.poweredAngle = side * poweredAngles[f] * Math.PI / 180;
      louvre.userData.glideAngle = side * glideAngles[f] * Math.PI / 180;
      louvre.userData.phase = f * 0.47 + (side < 0 ? 0.5 : 0);
      louvre.rotation.z = louvre.userData.foldAngle;
      feathers.push(louvre);
    }

    /* Heat shimmer INSIDE the bank. Carried over at the Seraph's
       proportions it reached 3.3cm past the outermost louvre cap and
       showed in play as an orange sheet hanging off the wing tips. A
       veil is the air between the plates; it has no business being
       the furthest thing from the mount. */
    const veilShape = new THREE.Shape([
      new THREE.Vector2(0, 0.030),
      new THREE.Vector2(side * 0.236, 0.112),
      new THREE.Vector2(side * 0.208, -0.114),
      new THREE.Vector2(side * 0.042, -0.128),
    ]);
    const veil = new THREE.Mesh(new THREE.ShapeGeometry(veilShape), energy);
    veil.name = `${wing.name}-heat-veil`;
    veil.position.set(side * 0.022, -0.006, -0.030);
    veil.scale.set(0.10, 0.35, 1);
    veil.renderOrder = 2;
    wing.add(veil);

    wings.push({
      side, root: wing, feathers, hinge, hingeLight, veil,
      wallTuck: 0, visualSpread: 0, deployCant: 0, plumeThrottle: 0,
    });
  }

  mountPack(figure, root, [0, 1.40, -0.104]);

  return {
    id: "censer",
    root, wings,
    nozzles: [thruster.locator],
    flames: [thruster.flame],
    centralThruster,
    halo: null,
    haloLight: null,
    chargeWindow,
    chargeColours: {
      full: 0xffa347, fullEmissive: 0xc03c08, low: 0x8f1c22, lowEmissive: 0xff1f0c,
    },
    pose: {
      ...DEFAULT_POSE,
      /* HEAVY MACHINERY OPENS SLOWLY AND STOPS HARD. The louvres
         swing wider than any feather and lag further apart, so the
         bank cracks open one slat at a time instead of fanning. */
      stowYaw: 0.40, glideYaw: 0.24, poweredYaw: 0.30,
      stowPitch: 0.045, glidePitch: -0.020, poweredPitch: -0.060,
      featherDelay: 0.085,
      plateYawStow: 0.06, plateYawGlide: 0.040, plateYawPowered: 0.010,
      /* Almost no flutter: this is not a wing feeling the air, it is
         a shutter being held open by a jack. What movement there is
         is slow and heavy. */
      flutterPowered: 0.007, flutterPoweredRate: 4.1,
      flutterGlide: 0.002, flutterGlideRate: 1.5,
      /* The bell hangs well below and behind the louvre sweep, so it
         is clear long before the bank is. */
      flameGate: 0.40, flameGateSpan: 0.18,
      veilOpacity: [0.040, 0.14, 0.26],
      veilOpenY: [0.35, 1, 0.94],
      openRate: 8.5, closeRate: 4.2,
      hingeSpin: 0.10, hingeLightSpin: -0.16,
    },
    /* The furnace itself. None of this is articulation - it is the
       pack getting hot, which is the whole character of the design
       and cannot be said with a fold angle. */
    onVisual(frame) {
      const { throttle, powered, spread, clock } = frame;
      const heat = powered ? 0.35 + throttle * 1.75 : 0.16 + spread * 0.30;
      const breathe = 1 + Math.sin(clock * 5.1) * 0.10 * throttle;
      for (const glow of louvreGlows) {
        glow.material.emissiveIntensity = heat * breathe;
      }
      /* The stacks vent on the beat, out of phase with the louvres,
         so the pack has two rhythms rather than one pulse. */
      for (let i = 0; i < stacks.length; i += 1) {
        const puff = 0.5 + Math.sin(clock * 3.4 + i * Math.PI) * 0.5;
        stacks[i].material.emissiveIntensity = 0.30 + heat * (0.45 + puff * 0.75);
        stacks[i].scale.setScalar(1 + puff * 0.10 * throttle);
      }
      throatVanes.material.emissiveIntensity = 0.30 + throttle * 2.10;
    },
    materials: [
      iron, lacquer, brass, bone, ember, chargeMaterial, energy,
      plume.outer, plume.inner,
    ],
  };
}

/* ============================================================
   THE REGISTRY
   ============================================================ */

const PACKS = {
  seraph: buildSeraphPack,
  augur: buildAugurPack,
  censer: buildCenserPack,
};

export const PACK_IDS = Object.keys(PACKS);

/**
 * Build the pack a figure asks for.
 *
 * Unknown names fall back to the Seraph rather than throwing: a pack
 * is decoration, and a figure that names one this build does not have
 * should still be playable. The name it actually got comes back on
 * `visual.id`, so a harness can tell a fallback from a choice.
 */
export function buildPackFor(ctx, player) {
  const requested = String(player.figure?.jetpack || "seraph").toLowerCase();
  const build = PACKS[requested] || PACKS.seraph;
  const visual = build(ctx, player);
  visual.requested = requested;
  visual.pose = { ...DEFAULT_POSE, ...(visual.pose || {}) };
  return visual;
}

export { buildSeraphPack, buildAugurPack, buildCenserPack, DEFAULT_POSE };
