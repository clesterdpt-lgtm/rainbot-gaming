/* ============================================================
   SAINTFALL - Kenosis field commands

   Three call actions per operative: the Concord's own GILDING RITE,
   which every bearer of a reliquary can ask for, and two that belong
   to the operative alone. The White Vigil calls things that CONTROL
   a piece of ground; the Bastion calls things that OCCUPY it.

   WHY NOT `mission.js`. The campaign's command layer is 900 lines of
   relays, sanctuaries, mines, sirens, live fuses and doctrine
   fusions, all of it welded to Operation Saintfall's phase machine -
   `call()` alone consults `ctx.progression.modifyCommandCall`, four
   optional sub-directives and a relocation protocol. A trials ground
   needs none of it. What it does need is the EXTERNAL contract, and
   that is small enough to state exactly:

     ui.js's wheel        `wheelOrder` (<= 3), `stratagems[key]`
                          ({name, short, role, colour}), `cooldowns[key]`,
                          and `call(key)` returning truthy on accept.
     combat.js            `boon()` (damage multiplier on every hit) and
                          `blocksEnemyProjectile(detail)`.
     jetpack.js           `boon().active` (free flight).
     summit-hud.js        `pending()` for the fuse readout.

   So this module answers that contract and nothing else, and
   `summit-main.js` merges it onto the level's mission stub.

   THE WHEEL HOLDS EXACTLY THREE. `ui.js`'s `WHEEL_POINTS` is a
   frozen three-entry table and `commandMarkup` falls back to
   `WHEEL_POINTS[0]` for anything past it - a fourth command would
   silently stack on top of the first. Three per operative is not a
   coincidence, it is the sector count.

   THE DOCTRINE SEAM. Same two verbs the kits use. `kit(key, fallback,
   detail)` is asked for every number a command was going to use
   anyway (cooldown, delay, radius, damage, charges) plus two
   structured answers - `callEcho` and `callInstant` - that let a Vow
   change the SHAPE of a call without this module learning a talent
   id. `verb(name, detail)` reports what happened.
   ============================================================ */

import { patchBasicMaterial, paintGeometry } from "saintfall/art.js";
import { makeKit, mergeGeometries, cleanGeometry } from "saintfall/structures.js";
import { makeRamp } from "saintfall/core.js";

/* ------------------------------------------------------------
   THE CATALOG

   `resupply` keeps its campaign key on purpose: it is the same rite,
   it reads the same boon record, and a save or a harness that knows
   the campaign's name for the gilded call finds it here too.
   ------------------------------------------------------------ */

const GILDING = Object.freeze({
  name: "Gilding Rite",
  short: "Gilding",
  role: "Consecrate the bearer",
  code: ["down", "down", "up", "right"],
  cooldown: 74,
  delay: 3.0,
  radius: 0,
  damage: 0,
  colour: "#ffd27a",
  heals: true,
  atSelf: true,
  boon: Object.freeze({ seconds: 20, damage: 1.4, heat: 0, infiniteCharge: true }),
});

export const KENOSIS_STRATAGEMS = Object.freeze({
  "white-vigil": Object.freeze({
    order: Object.freeze(["mirrorchoir", "crescentrain", "resupply"]),
    stratagems: Object.freeze({
      /* THREE OF YOU, HOLDING. The Vigil's whole kit is about not
         being where the swarm last looked; the Choir is that idea
         called in as ordnance. It does little damage on purpose -
         what it buys is eight seconds in which nothing is shooting
         at the real one. */
      mirrorchoir: Object.freeze({
        name: "Mirror Choir",
        short: "Choir",
        role: "Three of you, holding",
        code: ["up", "left", "up", "right"],
        cooldown: 58,
        delay: 1.6,
        radius: 12,
        damage: 60,
        colour: "#9df3e0",
        order: "quicksilver",
        effigies: 3,
        hold: 8,
        stun: 1.6,
        shatterDamage: 60,
      }),
      /* EDGES FROM ABOVE. The crescent emitters answer from the
         cloud deck. Wide, quick, and weighted against anything in
         the air, which is the one thing a mid-range dual-wield
         operative genuinely struggles to reach. */
      crescentrain: Object.freeze({
        name: "Crescent Rain",
        short: "Rain",
        role: "Edges from above",
        code: ["up", "up", "right", "down"],
        cooldown: 68,
        delay: 2.2,
        radius: 15,
        damage: 46,
        colour: "#ffe6a2",
        order: "crescent",
        blades: 9,
        spread: 0.55,
        flyerBonus: 1.7,
        stun: 0.5,
      }),
      resupply: GILDING,
    }),
  }),
  "bastion-penitent": Object.freeze({
    order: Object.freeze(["standinggate", "fallinganvil", "resupply"]),
    stratagems: Object.freeze({
      /* A WALL THAT ANSWERS. The Bastion already carries a shield he
         never has to pay for; the Gate is that shield made STATIC and
         left somewhere, which is the trade - cover you do not have to
         stand behind, in exchange for cover that cannot follow you.
         It really does stop gleaner fire: see `blocksEnemyProjectile`. */
      standinggate: Object.freeze({
        name: "The Standing Gate",
        short: "Gate",
        role: "A wall that answers",
        code: ["down", "left", "down", "right"],
        cooldown: 62,
        delay: 2.0,
        radius: 9,
        damage: 90,
        colour: "#ff9540",
        order: "bulwark",
        seconds: 18,
        width: 8.5,
        height: 3.2,
        stun: 1.4,
      }),
      /* TWO TONNES, DROPPED. Small radius, enormous number, long
         cooldown - the answer to one large thing rather than to a
         crowd, which is precisely what the Salvo is not. Everything
         flying inside the wider ring is put on the ground. */
      fallinganvil: Object.freeze({
        name: "The Falling Anvil",
        short: "Anvil",
        role: "Two tonnes, dropped",
        code: ["up", "down", "down", "down"],
        cooldown: 88,
        delay: 3.4,
        radius: 11,
        damage: 460,
        colour: "#e8503a",
        order: "anvil",
        groundRadius: 20,
        groundStun: 2.6,
        stun: 2.4,
      }),
      resupply: GILDING,
    }),
  }),
});

/** The three keys an operative can call, or the campaign's own three
 *  for anyone this pack does not know. */
export function kenosisCallsFor(characterId) {
  return KENOSIS_STRATAGEMS[characterId] || null;
}

const finite = (v, d = 0) => (Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ============================================================
   THE MODULE
   ============================================================ */
export function buildSummitCommand(ctx, player, options = {}) {
  const { THREE } = ctx;
  const characterId = options.characterId || "white-vigil";
  const catalog = kenosisCallsFor(characterId);
  if (!catalog) return null;

  const wheelOrder = Array.from(catalog.order);
  const STRATAGEMS = catalog.stratagems;

  const group = new THREE.Group();
  group.name = "kenosis-commands";
  ctx.scene.add(group);

  /* Listeners, in the same tiny shape every other module on this
     level publishes: `on` returns its own unsubscribe. */
  const listeners = new Map();
  const bus = {
    on(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, new Set());
      listeners.get(evt).add(fn);
      return () => listeners.get(evt)?.delete(fn);
    },
    emit(evt, payload) {
      for (const fn of listeners.get(evt) || []) {
        try { fn(payload); } catch (_) { /* a listener must not break a call */ }
      }
    },
  };

  const cooldowns = {};
  /* Charges are how a doctrine grants a SECOND use before the
     cooldown starts. Held at the maximum until spent; the maximum is
     asked for fresh on every call, because a rite bought mid-fight
     must not have to wait for a reset to matter. */
  const charges = {};
  for (const key of wheelOrder) { cooldowns[key] = 0; charges[key] = 0; }

  const boonState = {
    remaining: 0, seconds: 0, damage: 1, heat: 1, infiniteCharge: false, source: null,
  };

  const pending = [];
  const gates = [];
  const effigies = [];
  const fields = [];
  let nextId = 1;
  let announceText = "";
  let announceFor = 0;

  /* SIMULATED TIME, NOT WALL TIME. Every staged beat of a command -
     the Rain walking outward, an echo following its parent - is
     scheduled here and drained by `update(dt)`.

     `window.setTimeout` was the obvious thing to reach for and it is
     wrong twice over: a paused game would keep landing blades, and a
     harness that advances 6 simulated seconds inside one real frame
     never sees a single timer fire - which is how the echo Vow read
     as completely dead while being perfectly implemented. */
  const timers = [];
  const schedule = (seconds, fn) => {
    timers.push({ t: Math.max(0, Number(seconds) || 0), fn });
  };

  const tune = (key, fallback, detail) =>
    ctx.doctrine?.kit?.(key, fallback, detail) ?? fallback;
  const rite = (name, detail) => ctx.doctrine?.verb?.(name, detail);

  const groundAt = (x, z) => {
    const g = ctx.collide?.groundHeight?.(x, z);
    if (Number.isFinite(g)) return g;
    const t = ctx.terrain?.groundHeightAt?.(x, z) ?? ctx.terrain?.heightAt?.(x, z);
    return Number.isFinite(t) ? t : 0;
  };

  const say = (text, seconds = 1.8) => {
    announceText = String(text || "");
    announceFor = Math.max(announceFor, seconds);
  };

  /* ------------------------------------------------------------
     THE BEACON. One group per live command: a wide additive column
     so it is findable from across the yard, a hard core so the exact
     metre is unambiguous, and a ring on the ground at the blast
     radius so the player can SEE whether they are standing in it.

     Materials are built once and shared. A per-beacon material is a
     shader compile at the worst possible moment - the frame the
     player asked for help.
     ------------------------------------------------------------ */
  const beaconMats = new Map();
  const beaconTime = { value: 0 };

  /* THE COLUMN IS ADDITIVE GEOMETRY, AND ADDITIVE GEOMETRY HAS TWO
     WAYS OF LOOKING WRONG that the campaign's own beacon documents
     and that neither shows up in a close-range still:

     it ends. A cylinder of constant alpha stops at its top with a
     hard horizontal edge, which reads as a mistake rather than as a
     column of light - so alpha is tapered at both ends, brightened
     where the surface turns away from the eye (a shell of light is
     brightest at its silhouette), and scrolled slowly so it is alive.

     and it gets BRIGHTER with distance. An additive surface seen
     through haze ADDS the sky, so an unpatched beacon two hundred
     metres out is more visible than one at fifty. `patchBasicMaterial`
     with `additive` fades it to black instead. */
  function patchColumn(material, height) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uSFTime = beaconTime;
      shader.uniforms.uSFHeight = { value: height };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>",
          "#include <common>\nvarying vec3 vSFN; varying vec3 vSFV; varying float vSFH; uniform float uSFHeight;")
        .replace("#include <begin_vertex>",
          "#include <begin_vertex>\nvSFN = normalMatrix * normal; vSFV = -(modelViewMatrix * vec4(position, 1.0)).xyz; vSFH = position.y / uSFHeight + 0.5;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>",
          "#include <common>\nvarying vec3 vSFN; varying vec3 vSFV; varying float vSFH; uniform float uSFTime;")
        .replace("#include <alphamap_fragment>", [
          "#include <alphamap_fragment>",
          "{",
          "  float nv = abs(dot(normalize(vSFN), normalize(vSFV)));",
          "  float body = nv * nv * 0.7 + nv * 0.3 + pow(nv, 12.0) * 1.1;",
          "  float ends = smoothstep(0.0, 0.04, vSFH) * (1.0 - smoothstep(0.5, 1.0, vSFH));",
          "  float flow = 0.86 + 0.14 * sin(vSFH * 30.0 - uSFTime * 2.6);",
          "  diffuseColor.a *= body * ends * flow * 2.4;",
          "}",
        ].join("\n"));
    };
    /* Its own cache key: the atmosphere patch keys on fade and blend
       alone, and this fragment is not the one those keys name. */
    material.customProgramCacheKey = () => "sf-kenosis-beacon-column";
  }

  function beaconMaterials(hex) {
    let set = beaconMats.get(hex);
    if (set) return set;
    const colour = new THREE.Color(hex);
    set = {
      column: new THREE.MeshBasicMaterial({
        color: colour, transparent: true, opacity: 0.22, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      }),
      core: new THREE.MeshBasicMaterial({ color: colour }),
      ring: new THREE.MeshBasicMaterial({
        color: colour, transparent: true, opacity: 0.30, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      }),
    };
    set.column.forceSinglePass = true;
    set.ring.forceSinglePass = true;
    patchColumn(set.column, COLUMN_HEIGHT);
    if (ctx.atmos) {
      patchBasicMaterial(set.column, ctx.atmos, 0.55, true);
      patchBasicMaterial(set.ring, ctx.atmos, 0.55, true);
    }
    beaconMats.set(hex, set);
    return set;
  }

  const COLUMN_HEIGHT = 26;
  const COLUMN_GEO = new THREE.CylinderGeometry(0.5, 1.7, COLUMN_HEIGHT, 18, 1, true);
  const CORE_GEO = new THREE.CylinderGeometry(0.14, 0.14, 1.9, 5);

  function makeBeacon(x, z, hex, radius) {
    const mats = beaconMaterials(hex);
    const g = new THREE.Group();
    const y = groundAt(x, z);
    const column = new THREE.Mesh(COLUMN_GEO, mats.column);
    column.position.set(0, COLUMN_HEIGHT * 0.5, 0);
    g.add(column);
    const core = new THREE.Mesh(CORE_GEO, mats.core);
    core.position.set(0, 0.95, 0);
    g.add(core);
    if (radius > 0.5) {
      /* Flat on the ground and therefore nearly edge-on from a chase
         camera - which is exactly why it is a RING and not a disc.
         An outline survives foreshortening; a filled area does not. */
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius * 0.94, radius, 48), mats.ring);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.08;
      g.add(ring);
    }
    g.position.set(x, y, z);
    group.add(g);
    return { group: g, core, x, y, z };
  }

  function dropBeacon(shot) {
    if (!shot.marker) return;
    group.remove(shot.marker.group);
    shot.marker.group.traverse((o) => {
      if (o.geometry && o.geometry.type === "RingGeometry") o.geometry.dispose();
    });
    shot.marker = null;
  }

  /* ------------------------------------------------------------
     THE STANDING GATE. A real slab in the world with a real
     segment across it, because "does this shot cross the wall" is a
     question a radius cannot answer honestly - a radius blocks fire
     from behind you as readily as from in front.
     ------------------------------------------------------------ */
  /* WHY THIS IS NOT A `MeshStandardMaterial` WITH A COLOUR ON IT.
     That is what it was, and the first contact sheet showed a
     featureless black slab standing on the snow. Nothing on this
     level carries its colour in `material.color`: every surface is
     WHITE, vertex-painted, and rim-lit through `patchMaterial`, and
     the summit runs almost no ambient fill on purpose (an ambient
     term flattens form on snow). So an unpainted face that is not
     catching the sun receives nothing and renders black - correctly,
     for a material this world was never going to use.

     Borrowing `ctx.materials.iron` and `.bronze` also means the Gate
     costs no shader compile: it draws with programs the level has
     already built and warmed. */
  const kit = makeKit(THREE);
  /* THE DARK END OF A RAMP IS DARKER THAN IT LOOKS. `paintGeometry`
     converts these out of sRGB, and a hex that reads as "weathered
     grey" on a colour picker - #2c2a2b - is an albedo of 0.026 in
     linear light. Measured on the first build: the Gate's vertices
     came out at 0.05 and the whole wall rendered as a black
     rectangle standing on snow. The floor here is deliberately high;
     the shading is carried by the sun and the rim term, not by the
     paint being dark. */
  const IRON_RAMP = makeRamp([
    [0.00, "#5f5b57"], [0.32, "#7d766e"], [0.60, "#9c9287"],
    [0.84, "#bcb0a1"], [1.00, "#d8ccba"],
  ]);
  const BRONZE_RAMP = makeRamp([
    [0.00, "#8a5f27"], [0.38, "#bd8c35"], [0.72, "#e3b755"], [1.00, "#f8dd95"],
  ]);

  /* One geometry pair per (width, height) actually used - which in
     practice is one, since the spec is fixed. Built on demand so a
     level that never calls a Gate never pays for it. */
  const gateLampMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xff9540), transparent: true, opacity: 0.85,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  gateLampMat.forceSinglePass = true;
  if (ctx.atmos) patchBasicMaterial(gateLampMat, ctx.atmos, 0.55, true);

  const gateGeo = new Map();
  function gateGeometry(width, height) {
    const key = `${width.toFixed(2)}x${height.toFixed(2)}`;
    let made = gateGeo.get(key);
    if (made) return made;
    const half = width * 0.5;
    const iron = [];
    const bronze = [];

    /* THE FACE IS A COLONNADE, NOT A PLATE - and that is a lighting
       decision before it is a styling one. A flat vertical surface in
       this world receives almost nothing: the sun is low, the level
       runs next to no ambient fill on purpose (an ambient term
       flattens form on snow), and the first two builds rendered a
       correctly-painted wall as a black rectangle for exactly that
       reason. Measured: the vertex colours were fine at 0.28-0.54
       and the face was still black.

       A row of round staves has facets pointing in every direction
       across its width, so some of it catches the sun from wherever
       the sun happens to be - which is also how every piece of the
       level's own architecture reads. */
    const staves = 11;
    for (let i = 0; i < staves; i += 1) {
      const t = i / (staves - 1) - 0.5;
      const stave = kit.prism({
        h: height - 0.42, rBottom: width / (staves * 1.7),
        rTop: width / (staves * 1.9), sides: 7, segments: 2, twist: 0.12,
      });
      stave.translate(t * (width - 0.55), 0.2, 0.14);
      iron.push(stave);
    }
    /* A backing leaf behind them, so the Gate is solid rather than a
       fence - it is cover, and it has to look like cover. */
    const backing = kit.slab(width - 0.3, height - 0.5, 0.34, 0.08);
    backing.translate(0, 0.2, -0.22);
    iron.push(backing);
    /* The frame: two uprights and a sill. */
    for (const side of [-1, 1]) {
      const post = kit.slab(0.42, height, 0.78, 0.1);
      post.translate(side * half, 0, 0.02);
      iron.push(post);
    }
    const sill = kit.slab(width + 0.5, 0.44, 1.0, 0.12);
    iron.push(sill);
    /* The buttresses, which is what stops it reading as propped. */
    for (const side of [-1, 1]) {
      const stay = kit.slab(0.34, height * 0.62, 2.2, 0.08);
      stay.translate(side * half * 0.78, 0.0, -1.1);
      iron.push(stay);
    }
    /* Bronze: the lintel, a boss, and a stud row along the sill. */
    const lintel = kit.slab(width + 0.7, 0.34, 1.06, 0.1);
    lintel.translate(0, height - 0.34, 0);
    bronze.push(lintel);
    const boss = kit.prism({ h: 0.42, rBottom: 0.72, rTop: 0.5, sides: 8 });
    boss.rotateX(-Math.PI / 2);
    boss.translate(0, height * 0.46, 0.42);
    bronze.push(boss);
    for (let i = 0; i < 7; i += 1) {
      const stud = kit.prism({ h: 0.22, rBottom: 0.15, rTop: 0.11, sides: 6 });
      stud.rotateX(-Math.PI / 2);
      stud.translate((i / 6 - 0.5) * (width - 0.6), 0.62, 0.44);
      bronze.push(stud);
    }

    const paint = (list, ramp, fn) => {
      const geo = cleanGeometry(THREE, kit.facet(mergeGeometries(THREE, list)));
      return paintGeometry(THREE, geo, ramp, fn, { jitter: 0.05 });
    };
    /* Iron darkens at the FOOT, where a wall dropped into snow takes
       its weathering - the opposite of a height ramp, and the reason
       the shape reads as planted rather than floating. */
    made = {
      iron: paint(iron, IRON_RAMP, (x, y) =>
        0.30 + clamp(y / Math.max(0.5, height), 0, 1) * 0.52
        + Math.abs(Math.sin(x * 2.7)) * 0.18),
      bronze: paint(bronze, BRONZE_RAMP, (x, y) =>
        clamp(0.45 + y / Math.max(0.5, height) * 0.55, 0, 1)),
    };
    gateGeo.set(key, made);
    return made;
  }

  function raiseGate(x, z, yaw, spec, radius) {
    const width = finite(spec.width, 8.5);
    const height = finite(spec.height, 3.2);
    const half = width * 0.5;
    const geo = gateGeometry(width, height);
    const g = new THREE.Group();
    const y = groundAt(x, z);
    const ironMesh = new THREE.Mesh(geo.iron,
      ctx.materials?.iron || ctx.materials?.get?.("iron"));
    ironMesh.castShadow = true;
    /* NOT `receiveShadow`. The level's shadow map covers a 2km world,
       so its texel is metres across and a slab this size shadow-acnes
       against ITSELF - measured as a face that renders pure black at
       every hour including night, with correct normals and vertex
       colours between 0.28 and 0.54. A structure that stands for
       eighteen seconds does not need to receive shadows; it needs to
       be visible enough to hide behind. */
    ironMesh.receiveShadow = false;
    g.add(ironMesh);
    const bronzeMesh = new THREE.Mesh(geo.bronze,
      ctx.materials?.bronze || ctx.materials?.get?.("bronze"));
    bronzeMesh.castShadow = true;
    bronzeMesh.receiveShadow = false;
    g.add(bronzeMesh);
    /* The one lit-looking element, and it is not a light: an additive
       band on the lintel. A light entering the scene recompiles every
       lit material on this level, which is a measured 198ms freeze -
       and a wall the player called for help is the worst frame in the
       game to spend it on. */
    const lampParts = [];
    const strip = (w, h, x, y, z) => {
      const q = new THREE.PlaneGeometry(w, h);
      q.translate(x, y, z);
      lampParts.push(q);
    };
    strip(width + 0.7, 0.42, 0, height - 0.3, 0.58);      // the lintel
    strip(width + 0.5, 0.24, 0, 0.24, 0.54);              // the sill
    for (const side of [-1, 1]) {
      strip(0.24, height - 0.7, side * half, height * 0.5, 0.42);
    }
    const lamp = new THREE.Mesh(
      mergeGeometries(THREE, lampParts), gateLampMat);
    g.add(lamp);
    g.position.set(x, y, z);
    /* The slab's local X is its span, so the wall FACES the caller's
       bearing when the group is yawed by that bearing. */
    g.rotation.y = yaw;
    group.add(g);
    const record = {
      group: g, lamp, x, y, z, yaw, width, height,
      remaining: finite(spec.seconds, 18),
      seconds: finite(spec.seconds, 18),
      radius,
      /* The wall as a segment, cached: the block test runs on every
         enemy projectile that reaches the player. */
      ax: x - Math.cos(yaw) * width * 0.5,
      az: z + Math.sin(yaw) * width * 0.5,
      bx: x + Math.cos(yaw) * width * 0.5,
      bz: z - Math.sin(yaw) * width * 0.5,
      blocked: 0,
    };
    gates.push(record);
    return record;
  }

  /* ============================================================
     THE GATE IS A WALL, AND A WALL IS COLLISION

     `blocksEnemyProjectile` alone was never going to be enough. It
     is a DAMAGE-PATH test: it fires at the moment a bolt has already
     reached the player and asks whether it should have. Everything
     upstream of that - the enemy deciding it has line of sight, the
     bolt's own flight span, the player and the swarm walking around
     - never heard of the Gate at all, so the wall was scenery with
     an opinion about damage.

     `collide.js` bakes its grid at load and has no runtime insert or
     removal, which is right for a world of static masonry and no use
     to a wall that stands for eighteen seconds. So the Gate goes in
     as an OVERRIDE LAYER over the two collision queries that matter -
     the same shape the Undercroft uses for its cavern floor. Wrapped
     once, here, and inert the moment no gate is standing:

       rayBlock  every line-of-sight and cover query in the game.
                 `spawnProjectile` sets a bolt's whole span from it
                 (`span = min(pathRange, blocked)`), so a bolt now
                 DIES at the wall instead of arriving and being
                 refused - which is also what makes it look blocked.
       blocked   the walk solve, `findOpen` and `slide`, for the
                 player and for every creature.
     ============================================================ */

  /** World point -> gate-local. Local +X is the span (the group is
   *  yawed by the caller's bearing, and a Y rotation maps local +X to
   *  (cos, -sin)); local +Z is the facing normal. */
  function gateLocal(gate, x, z, out) {
    const dx = x - gate.x;
    const dz = z - gate.z;
    const c = Math.cos(gate.yaw);
    const sn = Math.sin(gate.yaw);
    out.x = dx * c - dz * sn;
    out.z = dx * sn + dz * c;
    return out;
  }

  /* Half-thickness of the solid: the staves stand proud at +0.14 with
     a 0.45 radius and the backing leaf sits at -0.22, so the assembly
     occupies roughly -0.45..+0.60 about the group origin. */
  const GATE_HALF_T = 0.55;
  const _gl = { x: 0, z: 0 };

  function gateBlocks(x, z, feetY = null, radius = 0.42) {
    for (const gate of gates) {
      if (gate.remaining <= 0) continue;
      const gy = Number.isFinite(feetY) ? feetY : groundAt(x, z);
      /* Under the sill or over the lintel is not blocked - a jetborne
         Vigil can clear it, which is the counterplay the Bastion's
         own wall should have. */
      if (gy > gate.y + gate.height - 0.2) continue;
      if (gy < gate.y - 2.5) continue;
      gateLocal(gate, x, z, _gl);
      const r = Math.max(0, radius);
      if (Math.abs(_gl.x) > gate.width * 0.5 + r) continue;
      if (Math.abs(_gl.z) > GATE_HALF_T + r) continue;
      return true;
    }
    return false;
  }

  function gateFlightBlocks(x, z, feetY = null, radius = 0.42, height = 2.35) {
    for (const gate of gates) {
      if (gate.remaining <= 0) continue;
      const bottom = Number.isFinite(feetY) ? feetY : groundAt(x, z);
      const top = bottom + (Number.isFinite(height) ? height : 2.35);
      if (bottom > gate.y + gate.height - 0.2) continue;
      if (top < gate.y) continue;
      gateLocal(gate, x, z, _gl);
      const r = Math.max(0, radius);
      if (Math.abs(_gl.x) > gate.width * 0.5 + r) continue;
      if (Math.abs(_gl.z) > GATE_HALF_T + r) continue;
      return true;
    }
    return false;
  }

  /** Nearest hit along a ray, or Infinity. Slab test in gate-local
   *  space; the vertical slab is the wall's own height band. */
  function gateRayHit(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = Infinity;
    for (const gate of gates) {
      if (gate.remaining <= 0) continue;
      const c = Math.cos(gate.yaw);
      const sn = Math.sin(gate.yaw);
      const px = (ox - gate.x) * c - (oz - gate.z) * sn;
      const pz = (ox - gate.x) * sn + (oz - gate.z) * c;
      const py = oy - gate.y;
      const vx = dx * c - dz * sn;
      const vz = dx * sn + dz * c;
      const vy = dy;
      let t0 = 0;
      let t1 = maxDist;
      const slab = (p, v, lo, hi) => {
        if (Math.abs(v) < 1e-9) return p >= lo && p <= hi;
        let a = (lo - p) / v;
        let b = (hi - p) / v;
        if (a > b) { const tmp = a; a = b; b = tmp; }
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        return t1 >= t0;
      };
      if (!slab(px, vx, -gate.width * 0.5, gate.width * 0.5)) continue;
      if (!slab(pz, vz, -GATE_HALF_T, GATE_HALF_T)) continue;
      if (!slab(py, vy, 0, gate.height)) continue;
      if (t0 >= 0 && t0 < best) best = t0;
    }
    return best;
  }

  const gateObstacleProvider = {
    blocked: (x, z, feetY, radius) => (gates.length ? gateBlocks(x, z, feetY, radius) : false),
    flightBlocked: (x, z, feetY, radius, height, ignoreTerrain) =>
      (gates.length ? gateFlightBlocks(x, z, feetY, radius, height) : false),
    rayBlock: (ox, oy, oz, dx, dy, dz, maxDist, allowOriginExit) =>
      (gates.length ? gateRayHit(ox, oy, oz, dx, dy, dz, maxDist) : Infinity),
  };
  ctx.collide?.addObstacleProvider?.(gateObstacleProvider);

  /* Wrapped ONCE, at build. Both wrappers short-circuit on an empty
     gate list, so a level with no wall standing pays one array-length
     check per query. */
  const baseBlocked = ctx.collide?.blocked;
  const baseRayBlock = ctx.collide?.rayBlock;
  if (ctx.collide && baseBlocked && baseRayBlock) {
    ctx.collide.blocked = (x, z, feetY, radius) => {
      if (gates.length && gateBlocks(x, z, feetY, radius)) return true;
      return baseBlocked.call(ctx.collide, x, z, feetY, radius);
    };
    ctx.collide.rayBlock = (ox, oy, oz, dx, dy, dz, maxDist, allowOriginExit) => {
      const world = baseRayBlock.call(ctx.collide, ox, oy, oz, dx, dy, dz,
        maxDist, allowOriginExit);
      if (!gates.length) return world;
      const mine = gateRayHit(ox, oy, oz, dx, dy, dz, maxDist);
      return Math.min(world, mine);
    };
  }

  /** Do segments AB and CD cross? Standard orientation test - the
   *  only honest way to ask "did that shot pass through the wall". */
  function segmentsCross(ax, az, bx, bz, cx, cz, dx, dz) {
    const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    const d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
    const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
    const d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }

  /* THE BACKSTOP, not the mechanism. With the collision above in
     place a bolt normally dies at the wall and never reaches here;
     this still catches the case the ray cannot - a shot already in
     flight when the Gate lands, whose span was measured against a
     world that did not yet contain it. */
  function blocksEnemyProjectile(detail = {}) {
    if (!gates.length) return false;
    if (detail.source && detail.source !== "enemy-fire") return false;
    const ps = ctx.player?.state;
    if (!ps) return false;
    /* Without an origin there is no segment to test and the wall
       cannot claim the hit. A gate that blocks what it cannot see
       is a gate the player will never trust. */
    if (!Number.isFinite(detail.x) || !Number.isFinite(detail.z)) return false;
    for (const gate of gates) {
      if (gate.remaining <= 0) continue;
      if (!segmentsCross(gate.ax, gate.az, gate.bx, gate.bz,
        detail.x, detail.z, ps.x, ps.z)) continue;
      gate.blocked += 1;
      ctx.vfx?.shieldBlock?.(
        (detail.x + ps.x) * 0.5, gate.y + 1.5, (detail.z + ps.z) * 0.5, 0.8);
      ctx.audio?.blockImpact?.(gate.x, gate.z, 0.7);
      bus.emit("gateBlock", { x: gate.x, z: gate.z, blocked: gate.blocked });
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------
     THE MIRROR CHOIR. Three standing Vigils. They are not enemies
     and they are not colliders - they are a LURE, so the only thing
     they change about the world is where a swarm is looking.
     ------------------------------------------------------------ */
  const effigyMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0x9df3e0), transparent: true, opacity: 0.42,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  effigyMat.forceSinglePass = true;
  if (ctx.atmos) patchBasicMaterial(effigyMat, ctx.atmos, 0.55, true);

  /* A FIGURE, NOT A CAPSULE. The effigy has one job - to be mistaken
     for the operative, by the swarm in code and by the player at a
     glance - and the first contact sheet showed three glowing pills
     standing in the snow, which is not a thing anyone shoots at by
     mistake. It does not need to be a MODEL: a silhouette at the
     right proportions reads as a person from ten metres, and an
     afterimage is supposed to be less than a person anyway.

     Merged into one geometry, drawn with one shared additive
     material: three effigies are three draw calls, not twenty-four. */
  const EFFIGY_GEO = (() => {
    const parts = [];
    const put = (geo, x, y, z, rz = 0) => {
      if (rz) geo.rotateZ(rz);
      geo.translate(x, y, z);
      parts.push(geo);
    };
    /* Head, neck, chest tapering to a waist, hips. */
    put(new THREE.IcosahedronGeometry(0.145, 0), 0, 1.66, 0.02);
    put(new THREE.CylinderGeometry(0.07, 0.09, 0.1, 6), 0, 1.52, 0);
    put(new THREE.CylinderGeometry(0.20, 0.26, 0.52, 7), 0, 1.20, 0);
    put(new THREE.CylinderGeometry(0.21, 0.19, 0.20, 7), 0, 0.88, 0);
    /* Arms held low and slightly out, the Vigil's ready stance. */
    for (const side of [-1, 1]) {
      put(new THREE.CylinderGeometry(0.062, 0.055, 0.42, 5),
        side * 0.30, 1.24, 0, side * 0.20);
      put(new THREE.CylinderGeometry(0.055, 0.048, 0.40, 5),
        side * 0.39, 0.88, 0.05, side * 0.10);
      /* The sidearms - the one silhouette detail that says which
         operative this is meant to be. */
      put(new THREE.BoxGeometry(0.07, 0.055, 0.26),
        side * 0.42, 0.70, 0.10);
    }
    /* Legs, feet apart. */
    for (const side of [-1, 1]) {
      put(new THREE.CylinderGeometry(0.085, 0.07, 0.46, 5),
        side * 0.115, 0.55, 0);
      put(new THREE.CylinderGeometry(0.07, 0.058, 0.44, 5),
        side * 0.125, 0.16, 0.01);
    }
    return cleanGeometry(THREE, mergeGeometries(THREE, parts));
  })();

  function raiseEffigy(x, z, yaw, spec) {
    const g = new THREE.Group();
    const y = groundAt(x, z);
    const body = new THREE.Mesh(EFFIGY_GEO, effigyMat);
    g.add(body);
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    group.add(g);
    const record = {
      group: g, body, x, y, z,
      remaining: finite(spec.hold, 8),
      seconds: finite(spec.hold, 8),
      stun: finite(spec.stun, 1.6),
      damage: finite(spec.shatterDamage, 60),
      pulse: 0,
    };
    effigies.push(record);
    return record;
  }

  function shatterEffigy(record) {
    const y = record.y;
    ctx.vfx?.blinkFx?.(record.x, y, record.z, 1);
    ctx.combat?.shockwave?.(record.x, y, record.z, {
      radius: 5.5, innerRadius: 1.2, damage: record.damage,
      edgeFalloff: 0.5, stun: record.stun, knockSpeed: 7, source: "command",
    });
    ctx.audio?.blinkArrive?.(record.x, record.z);
    group.remove(record.group);
  }

  /* ------------------------------------------------------------
     LINGERING FIELDS. Whatever a doctrine leaves behind on the
     marked point. Enemies inside are slowed; the field draws itself
     with a slow ring so it is not an invisible rule.
     ------------------------------------------------------------ */
  function addField(x, z, opts) {
    fields.push({
      x, z,
      y: groundAt(x, z),
      radius: Math.max(1, finite(opts.radius, 8)),
      slow: clamp(finite(opts.slow, 0.6), 0.05, 1),
      remaining: Math.max(0, finite(opts.seconds, 5)),
      order: opts.order || "antiphon",
      tick: 0,
    });
  }

  /* ============================================================
     CALLING
     ============================================================ */

  const THROW_DIST = 22;

  function targetAhead() {
    const ps = ctx.player.state;
    /* Ahead of the LOOK, not the body - the same rule the campaign
       uses, so aiming down really does drop it at your own feet. */
    const yaw = Number.isFinite(ps.camYaw) ? ps.camYaw : ps.yaw;
    const pitch = Number.isFinite(ps.camPitch) ? ps.camPitch : 0;
    const reach = THROW_DIST * clamp(Math.cos(clamp(pitch, -1.2, 1.2)), 0.12, 1);
    let x = ps.x + Math.sin(yaw) * reach;
    let z = ps.z + Math.cos(yaw) * reach;
    /* Never inside a wall: a beacon the player cannot walk to is a
       cooldown spent on nothing. `findOpen`'s third argument is the
       GROUND HEIGHT to test at, not a radius - passing a radius there
       tests the whole search at y=1.2 and silently returns nonsense. */
    const open = ctx.collide?.findOpen?.(x, z, groundAt(x, z));
    if (Array.isArray(open) && Number.isFinite(open[0])) { x = open[0]; z = open[1]; }
    return { x, z, yaw };
  }

  function call(key, opts = {}) {
    if (ctx.combat?.player?.dead) return null;
    const spec = STRATAGEMS[key];
    if (!spec) return null;

    /* A doctrine may hand back a spare use. Charges are checked
       before the cooldown so the second bell rings immediately. */
    const maxCharges = Math.max(1, Math.round(tune("callCharges", 1, { key })));
    charges[key] = clamp(charges[key], 0, maxCharges - 1);
    const onCooldown = cooldowns[key] > 0;
    if (onCooldown && charges[key] <= 0) {
      say(`${spec.name.toUpperCase()} ON COOLDOWN`, 1.6);
      return null;
    }

    const ps = ctx.player.state;
    /* `ctx.shield.state` is the live record OBJECT, not a getter -
       `state()` throws nothing and yields undefined, which would make
       The Great Bell silently never fire. `status()` is the public
       read and `.active` is the field that means the shield is UP
       (`.requested` only means the button is down). */
    const guarding = ctx.shield?.status?.()?.active === true
      || ctx.shield?.state?.active === true;
    /* A Vow may change the SHAPE of the call: land it now, land it
       here. The doctrine answers with data; this module performs it,
       so no talent id crosses the seam. */
    const instant = tune("callInstant", null, { key, guarding, spec });

    const aim = targetAhead();
    let x = aim.x;
    let z = aim.z;
    if (spec.atSelf || instant?.atSelf) { x = ps.x; z = ps.z; }

    const cooldown = Math.max(0, tune("callCooldown", spec.cooldown, { key }));
    const delay = Math.max(0, instant?.delay === 0
      ? 0 : tune("callDelay", spec.delay, { key }));
    const radius = Math.max(0, tune("callRadius", spec.radius, { key }));
    const damage = Math.max(0, tune("callDamage", spec.damage, { key }));

    if (charges[key] > 0 && onCooldown) charges[key] -= 1;
    else {
      cooldowns[key] = cooldown;
      charges[key] = maxCharges - 1;
    }

    const shot = {
      id: nextId += 1,
      key,
      spec,
      x, z,
      y: groundAt(x, z),
      yaw: aim.yaw,
      t: delay,
      delay,
      radius,
      damage,
      groundFlyers: instant?.groundFlyers === true,
      echo: opts.echo === true,
      marker: null,
    };
    if (!shot.echo) shot.marker = makeBeacon(x, z, spec.colour, radius);
    pending.push(shot);

    ctx.audio?.commandCast?.(ps.x, ps.z);
    if (delay > 0.15) ctx.audio?.inbound?.(x, z, Math.min(delay, 6));
    ctx.vfx?.tracer?.(
      ps.x + Math.sin(ps.yaw) * 0.5, ps.y + 1.35, ps.z + Math.cos(ps.yaw) * 0.5,
      x, shot.y + 1.2, z, spec.colour, 0.9);
    say(`${spec.name.toUpperCase()} INBOUND`, 1.8);

    if (!shot.echo) {
      rite("callCast", {
        key, x, z, radius, damage, delay, guarding,
        order: spec.order || "antiphon",
      });
      /* THE ECHO. A Vow that answers one command with the others
         asks for a list; this module throws them, so a capstone is
         data here rather than a special case. */
      const echo = tune("callEcho", null, { key, spec });
      if (echo && Array.isArray(echo.keys) && echo.keys.length) {
        const rScale = clamp(finite(echo.radiusScale, 0.45), 0.1, 1);
        const dScale = clamp(finite(echo.damageScale, 0.4), 0.05, 1);
        echo.keys.forEach((otherKey, i) => {
          const other = STRATAGEMS[otherKey];
          if (!other || otherKey === key) return;
          schedule(Math.max(0, finite(echo.stagger, 0.6)) * (i + 1), () => {
            const ex = x + (i - 0.5) * 3.2;
            const ez = z + (i === 0 ? 3.2 : -3.2);
            pending.push({
              id: nextId += 1,
              key: otherKey,
              spec: other,
              x: ex, z: ez,
              y: groundAt(ex, ez),
              yaw: aim.yaw,
              t: 0.05,
              delay: 0.05,
              radius: Math.max(0, other.radius * rScale),
              damage: Math.max(0, other.damage * dScale),
              groundFlyers: false,
              echo: true,
              marker: null,
            });
          });
        });
      }
    }

    bus.emit("inbound", {
      id: shot.id, key, x, z, delay, radius, damage, echo: shot.echo,
    });
    return key;
  }

  /* ------------------------------------------------------------
     THE ARROW CODE.

     The wheel is the primary input, but the campaign also drives
     commands by direction code (`main.js` turns a held stratagem key
     and arrow presses into `beginEntry` / `pushDirection`). That path
     resolves against `mission.js`'s OWN catalog, so an operative
     whose wheel this module supplies would find the code entry
     silently dead - it can only ever produce Vesper's three keys, and
     this module answers to none of them.

     Same state machine, same contract, over this operative's own
     specs. Every Kenosis spec already carries a `code`.
     ------------------------------------------------------------ */
  const entry = { active: false, keys: [], since: 0 };

  function beginEntry() {
    if (ctx.combat?.player?.dead) return false;
    entry.active = true;
    entry.keys = [];
    entry.since = 0;
    return true;
  }

  function cancelEntry() {
    entry.active = false;
    entry.keys = [];
    entry.since = 0;
    return true;
  }

  function pushDirection(dir) {
    if (!entry.active || ctx.combat?.player?.dead) return null;
    entry.keys.push(dir);
    entry.since = 0;
    /* Any command still matching this prefix keeps the entry alive. */
    let alive = 0;
    for (const key of wheelOrder) {
      const code = STRATAGEMS[key]?.code;
      if (!Array.isArray(code) || entry.keys.length > code.length) continue;
      let ok = true;
      for (let i = 0; i < entry.keys.length; i += 1) {
        if (entry.keys[i] !== code[i]) { ok = false; break; }
      }
      if (!ok) continue;
      alive += 1;
      if (entry.keys.length === code.length) {
        cancelEntry();
        return call(key);
      }
    }
    if (alive === 0) {
      cancelEntry();
      say("CODE REJECTED", 1.4);
      bus.emit("code", { ok: false });
    } else {
      bus.emit("code", { ok: true });
    }
    return null;
  }

  /* ============================================================
     RESOLVING
     ============================================================ */

  function resolve(shot) {
    const { spec, key } = shot;
    const x = shot.x;
    const z = shot.z;
    const y = groundAt(x, z);
    const radius = shot.radius;
    const damage = shot.damage;
    let hits = 0;
    let kills = 0;

    if (key === "resupply") {
      grantBoon(spec.boon, "gilding");
      /* The rite is a RESET of everything the trooper spends, which is
          what makes it worth calling before a fight goes wrong as well
          as after. `combat` publishes no heal function - the campaign's
          own Gilding Rite writes the pool, and so does this one. */
      if (ctx.combat?.player) {
        ctx.combat.player.hp = ctx.combat.player.maxHp;
      }
      ctx.jetpack?.restoreCharge?.(ctx.jetpack?.config?.maxFuel || 100, "gilding-rite");
      ctx.vfx?.consecration?.(x, y, z, 7, finite(spec.boon.seconds, 20));
      ctx.audio?.gildingRite?.(x, z);
    } else if (key === "mirrorchoir") {
      const count = Math.max(1, Math.round(spec.effigies));
      ctx.vfx?.mirrorChoir?.(x, y, z, radius, count);
      ctx.audio?.mirrorChoir?.(x, z);
      for (let i = 0; i < count; i += 1) {
        const a = (i / count) * Math.PI * 2 + shot.yaw;
        const r = Math.min(radius * 0.45, 4.5);
        raiseEffigy(x + Math.sin(a) * r, z + Math.cos(a) * r, a + Math.PI, spec);
      }
      /* The arrival itself staggers - the swarm turns, and the turn
         is the effect. Damage is small and deliberately so. */
      const blast = ctx.combat?.shockwave?.(x, y, z, {
        radius, innerRadius: radius * 0.2, damage,
        edgeFalloff: 0.55, stun: finite(spec.stun, 1.6), knockSpeed: 5,
        source: "command",
      });
      hits = blast?.hits || 0;
      kills = blast?.kills || 0;
      /* Pull the crowd's attention onto the ground the Choir holds. */
      for (const inst of ctx.enemies?.live || []) {
        if (!inst || inst.health <= 0 || inst.state === "death") continue;
        if (Math.hypot(inst.x - x, inst.z - z) > radius * 1.4) continue;
        inst.alerted = true;
        inst.suspicion = 1;
      }
    } else if (key === "crescentrain") {
      const blades = Math.max(3, Math.round(spec.blades));
      ctx.vfx?.crescentRain?.(x, y, z, radius, blades);
      ctx.audio?.crescentRain?.(x, z);
      /* Blades land one at a time across about a second, so the
         effect reads as an area being COVERED and the player can see
         where it is going next. Each is its own small blast. */
      for (let i = 0; i < blades; i += 1) {
        const angle = i * 2.3999632297;
        const dist = Math.sqrt((i + 0.4) / blades) * radius * 0.92;
        const bx = x + Math.cos(angle) * dist;
        const bz = z + Math.sin(angle) * dist;
        schedule(0.09 + (dist / Math.max(1, radius)) * 0.62 + i * 0.024, () => {
          const by = groundAt(bx, bz);
          const blast = ctx.combat?.shockwave?.(bx, by, bz, {
            radius: 4.2, innerRadius: 1.0, damage,
            edgeFalloff: 0.45, stun: finite(spec.stun, 0.5), knockSpeed: 4,
            source: "command",
          });
          hits += blast?.hits || 0;
          kills += blast?.kills || 0;
          /* Weighted against the air: a crescent falling from above
             meets a flyer square-on and a ground target obliquely. */
          const bonus = finite(spec.flyerBonus, 1.7);
          if (bonus > 1) {
            for (const inst of ctx.enemies?.live || []) {
              if (!inst || !inst.spec?.flies || inst.grounded) continue;
              if (inst.health <= 0 || inst.state === "death") continue;
              if (Math.hypot(inst.x - bx, inst.z - bz) > 5.5) continue;
              ctx.combat?.damageEnemy?.(inst, damage * (bonus - 1), {
                source: "command", x: inst.x, y: inst.y, z: inst.z,
              });
            }
          }
        });
      }
    } else if (key === "standinggate") {
      /* The wall faces the caller, so a Gate thrown at a firing line
         stands ACROSS it rather than end-on to it. */
      const gate = raiseGate(x, z, shot.yaw, spec, radius);
      ctx.vfx?.standingGate?.(x, y, z, shot.yaw, gate.width, gate.height);
      ctx.audio?.gateRaise?.(x, z);
      const blast = ctx.combat?.shockwave?.(x, y, z, {
        radius, innerRadius: radius * 0.3, damage,
        edgeFalloff: 0.5, stun: finite(spec.stun, 1.4), knockSpeed: 11,
        source: "command",
      });
      hits = blast?.hits || 0;
      kills = blast?.kills || 0;
    } else if (key === "fallinganvil") {
      ctx.vfx?.fallingAnvil?.(x, y, z, radius);
      ctx.audio?.anvilFall?.(x, z);
      ctx.audio?.explosion?.(x, z, radius);
      const blast = ctx.combat?.shockwave?.(x, y, z, {
        radius, innerRadius: radius * 0.42, damage,
        edgeFalloff: 0.35, stun: finite(spec.stun, 2.4), knockSpeed: 16,
        source: "command",
      });
      hits = blast?.hits || 0;
      kills = blast?.kills || 0;
      /* The ring beyond the crater does no damage at all - it takes
         the SKY away, which for a Bastion who cannot fly is worth
         more than the damage would be. */
      const gr = Math.max(radius, finite(spec.groundRadius, 20));
      for (const inst of ctx.enemies?.live || []) {
        if (!inst || !inst.spec?.flies || inst.grounded) continue;
        if (Math.hypot(inst.x - x, inst.z - z) > gr) continue;
        /* The Anvil bites deeper than a cast: an 88-second call action
           should be worth more per use than a weapon cooldown, so two
           of them bring a boss down where the hammer needs three. */
        ctx.combat?.groundFlyer?.(inst, {
          stun: finite(spec.groundStun, 2.6), lift: 2.0, source: "falling-anvil",
        });
      }
    }

    /* A Vow that grounds flyers on any call, regardless of which. */
    if (shot.groundFlyers) {
      for (const inst of ctx.enemies?.live || []) {
        if (!inst || !inst.spec?.flies || inst.grounded) continue;
        if (Math.hypot(inst.x - x, inst.z - z) > Math.max(radius, 12)) continue;
        ctx.combat?.groundFlyer?.(inst, { stun: 2.2 });
      }
    }

    const impact = {
      id: shot.id, key, x, y, z, radius, damage, hits, kills, echo: shot.echo,
      order: spec.order || "antiphon",
    };
    if (!shot.echo) rite("callImpact", impact);
    bus.emit("impact", impact);
    return impact;
  }

  /* ============================================================
     THE BOON
     ============================================================ */
  function grantBoon(boon, source = "rite") {
    if (!boon) return null;
    const seconds = Math.max(0, finite(boon.seconds, 0));
    if (seconds <= 0) return null;
    boonState.seconds = seconds;
    boonState.remaining = seconds;
    boonState.damage = Math.max(0.1, finite(boon.damage, 1));
    boonState.heat = clamp(finite(boon.heat, 0), 0, 4);
    boonState.infiniteCharge = boon.infiniteCharge !== false;
    boonState.source = String(source || "rite");
    bus.emit("boon", boonRecord());
    return boonRecord();
  }

  function boonRecord() {
    const live = boonState.remaining > 0;
    return {
      active: live,
      remaining: Number(Math.max(0, boonState.remaining).toFixed(3)),
      seconds: boonState.seconds,
      damage: live ? boonState.damage : 1,
      heat: live ? boonState.heat : 1,
      infiniteCharge: live ? boonState.infiniteCharge : false,
      source: live ? boonState.source : null,
    };
  }

  /* ============================================================
     FRAME
     ============================================================ */
  const _tmpColour = new THREE.Color();

  function update(dt) {
    const step = Math.min(0.1, Math.max(0, dt));
    beaconTime.value += step;
    if (announceFor > 0) announceFor = Math.max(0, announceFor - step);
    if (entry.active) entry.since += step;

    for (const key of wheelOrder) {
      if (cooldowns[key] > 0) cooldowns[key] = Math.max(0, cooldowns[key] - step);
    }

    if (boonState.remaining > 0) {
      boonState.remaining = Math.max(0, boonState.remaining - step);
      const ps = ctx.player?.state;
      if (ps) ctx.vfx?.gild?.(ps.x, ps.y, ps.z, 1);
      if (boonState.remaining <= 0) {
        boonState.source = null;
        bus.emit("boon", boonRecord());
      }
    }

    /* Staged beats, before the fuses: an echo scheduled at 0 must
       become a pending shot in the same frame it was asked for. */
    for (let i = timers.length - 1; i >= 0; i -= 1) {
      timers[i].t -= step;
      if (timers[i].t > 0) continue;
      const fn = timers[i].fn;
      timers.splice(i, 1);
      try { fn(); } catch (_) { /* a staged beat must not stop the frame */ }
    }

    /* Fuses. Counted down back-to-front so a resolve can splice. */
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const shot = pending[i];
      shot.t -= step;
      if (shot.marker) {
        /* The core beats faster as the fuse runs out - the one piece
           of information the player needs from across the yard. */
        const frac = shot.delay > 0 ? clamp(shot.t / shot.delay, 0, 1) : 0;
        const beat = 0.5 + 0.5 * Math.sin((1 - frac) * 34 + (1 - frac) * (1 - frac) * 40);
        shot.marker.core.scale.setScalar(0.85 + beat * 0.7);
        _tmpColour.set(shot.spec.colour);
        shot.marker.core.material.color.copy(_tmpColour).multiplyScalar(0.6 + beat * 0.8);
      }
      if (shot.t <= 0) {
        dropBeacon(shot);
        pending.splice(i, 1);
        resolve(shot);
      }
    }

    /* Gates. */
    for (let i = gates.length - 1; i >= 0; i -= 1) {
      const gate = gates[i];
      gate.remaining -= step;
      if (gate.remaining <= 0) {
        ctx.vfx?.blast?.(gate.x, gate.y + 1.2, gate.z, 5);
        group.remove(gate.group);
        /* The slab geometry is CACHED and shared between gates -
           disposing it here blanks every wall the player raises
           afterwards. Only the lamp's plane is this gate's own. */
        gate.lamp.geometry.dispose();
        gates.splice(i, 1);
        continue;
      }
      /* The last two seconds are visibly the last two seconds: it
         sinks back into the ground and its lamp beats out. */
      if (gate.remaining < 2) {
        const f = gate.remaining / 2;
        gate.group.scale.y = 0.25 + f * 0.75;
        gate.lamp.material.opacity = 0.3
          + Math.abs(Math.sin(gate.remaining * 12)) * 0.55;
      }
    }

    /* Effigies: they hold, they pull, and then they shatter. */
    for (let i = effigies.length - 1; i >= 0; i -= 1) {
      const e = effigies[i];
      e.remaining -= step;
      e.pulse += step;
      /* Uniform, and small: a figure squashed on one axis stops
         being a figure. The shimmer is carried by the opacity. */
      e.body.scale.setScalar(1 + Math.sin(e.pulse * 3.1) * 0.02);
      e.body.rotation.y = Math.sin(e.pulse * 0.9) * 0.10;
      effigyMat.opacity = 0.34 + Math.abs(Math.sin(e.pulse * 1.7)) * 0.26;
      /* The lure, applied every frame it stands. `inst.commandLure` is
         combat.js's own attention override and it is checked BEFORE
         ordinary player sensing, which is the only reason the Choir
         works at all - anything else is overwritten by a player
         standing ten metres away on the very next frame. The
         `owner: "mission"` tag is not decoration: combat.js refuses a
         lure it does not recognise. */
      const clock = player?.state?.clock || 0;
      for (const inst of ctx.enemies?.live || []) {
        if (!inst || inst.health <= 0 || inst.state === "death") continue;
        if (Math.hypot(inst.x - e.x, inst.z - e.z) > 16) continue;
        inst.commandLure = {
          owner: "mission", x: e.x, z: e.z,
          until: clock + 0.35, mode: "pull", speedScale: 0.85,
        };
      }
      if (e.remaining <= 0) {
        effigies.splice(i, 1);
        shatterEffigy(e);
      }
    }

    /* Lingering fields. */
    for (let i = fields.length - 1; i >= 0; i -= 1) {
      const f = fields[i];
      f.remaining -= step;
      f.tick -= step;
      if (f.tick <= 0) {
        f.tick = 0.5;
        ctx.vfx?.doctrineCue?.({
          order: f.order, kind: "verse", x: f.x, y: f.y, z: f.z,
          radius: f.radius, intensity: 0.5, rank: 1,
        });
      }
      /* `slowUntil` is an ABSOLUTE clock stamp, matching the Shearwater
         rite's own convention and the term combat.js's `speedScale`
         reads. Refreshed every frame the creature stands in the field
         so leaving it restores full speed within 0.35s. */
      const fclock = player?.state?.clock || 0;
      for (const inst of ctx.enemies?.live || []) {
        if (!inst || inst.health <= 0 || inst.state === "death") continue;
        if (Math.hypot(inst.x - f.x, inst.z - f.z) > f.radius) continue;
        inst.slowUntil = fclock + 0.35;
        inst.slowFactor = f.slow;
      }
      if (f.remaining <= 0) fields.splice(i, 1);
    }
  }

  function releaseCollision() {
    ctx.collide?.removeObstacleProvider?.(gateObstacleProvider);
    if (ctx.collide && baseBlocked) ctx.collide.blocked = baseBlocked;
    if (ctx.collide && baseRayBlock) ctx.collide.rayBlock = baseRayBlock;
  }

  function reset() {
    for (let i = pending.length - 1; i >= 0; i -= 1) dropBeacon(pending[i]);
    pending.length = 0;
    timers.length = 0;
    for (const gate of gates) group.remove(gate.group);
    gates.length = 0;
    for (const e of effigies) group.remove(e.group);
    effigies.length = 0;
    fields.length = 0;
    for (const key of wheelOrder) { cooldowns[key] = 0; charges[key] = 0; }
    boonState.remaining = 0;
    boonState.source = null;
  }

  /* The readout the HUD row wants: the call closest to ready, and
     whatever is currently in the air. */
  function dockState() {
    let best = null;
    for (const key of wheelOrder) {
      const remaining = cooldowns[key] || 0;
      const spare = charges[key] || 0;
      const ready = remaining <= 0.001 || spare > 0;
      if (!best || (ready && !best.ready)
        || (ready === best.ready && remaining < best.remaining)) {
        best = {
          key, remaining, ready, spare,
          name: STRATAGEMS[key].short || STRATAGEMS[key].name,
        };
      }
    }
    const live = pending.find((s) => !s.echo) || pending[0] || null;
    return {
      best,
      inbound: live ? { key: live.key, remaining: Math.max(0, live.t) } : null,
      boon: boonRecord(),
      announce: announceFor > 0 ? announceText : "",
    };
  }

  return {
    group,
    bus,
    wheelOrder,
    stratagems: STRATAGEMS,
    cooldowns,
    call,
    boon: boonRecord,
    grantBoon,
    blocksEnemyProjectile,
    /* Save round-trip. The campaign's snapshot validator walks
       `ctx.mission.stratagems` and requires a finite cooldown for
       every key it finds, so an operative whose wheel this module
       supplies must get its cooldowns INTO the mission snapshot -
       otherwise every save is rejected the moment the wheel changes
       hands. See `main.js`, where the two are stitched together. */
    captureCooldowns: () => ({ ...cooldowns }),
    restoreCooldowns(saved) {
      if (!saved || typeof saved !== "object") return false;
      for (const key of wheelOrder) {
        const spec = STRATAGEMS[key];
        const v = Number(saved[key]);
        cooldowns[key] = Number.isFinite(v)
          ? clamp(v, 0, Math.max(0, spec?.cooldown || 0)) : 0;
      }
      return true;
    },
    entry,
    beginEntry,
    cancelEntry,
    pushDirection,
    update,
    reset,
    releaseCollision,
    dockState,
    /** For the probe: is this point inside a standing Gate? */
    gateBlocks: (x, z, y = 0, r = 0.42) => gateBlocks(x, z, y, r),
    gateRayHit: (ox, oy, oz, dx, dy, dz, d) => gateRayHit(ox, oy, oz, dx, dy, dz, d),
    announce: say,
    pending: () => pending.map((s) => ({
      id: s.id, key: s.key, x: s.x, y: s.y, z: s.z,
      remaining: Math.max(0, s.t), radius: s.radius, echo: s.echo,
    })),
    activeFields: () => ({
      gates: gates.map((g) => ({
        x: g.x, y: g.y, z: g.z, yaw: g.yaw, width: g.width,
        remaining: g.remaining, blocked: g.blocked,
      })),
      effigies: effigies.map((e) => ({ x: e.x, z: e.z, remaining: e.remaining })),
      fields: fields.map((f) => ({
        x: f.x, z: f.z, radius: f.radius, slow: f.slow, remaining: f.remaining,
      })),
    }),
    /** The doctrine's door for a field it wants left on the ground. */
    addField,
    charges: () => ({ ...charges }),
  };
}
