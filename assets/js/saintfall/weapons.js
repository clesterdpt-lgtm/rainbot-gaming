/* ============================================================
   SAINTFALL - weapons

   Built procedurally from the same `structures.js` kit that built
   the Vault-Cathedral, rather than authored in Blender. The reasons
   are specific rather than doctrinal:

     - They are rigid hard-surface objects, which is exactly what a
       ring-solid kit is good at.
     - Weapon MOTION is code no matter where the mesh comes from -
       recoil impulse, sway, bob and the ADS transition are springs,
       not clips - so a modelling pipeline buys nothing on the half
       of the problem that actually moves.
     - Variants come free from `ctx.seed`: barrel lengths, sights,
       magazines, ornament.
     - Nothing to load, nothing to cache-bust, no draw call that is
       not already there.

   The Concord does not build a machine it does not also sanctify,
   so every pattern carries a skull boss, a brass plate and a purity
   seal. That ornament is not decoration in the budget sense: on a
   dark iron object held against a bright desert, the brass is most
   of what makes the silhouette readable.
   ============================================================ */

import { TAU, clamp, clamp01, lerp, damp, makeBus, makeRng, makeRamp } from "saintfall/core.js";
import {
  PALETTE, paintByHeight, paintFlat, patchMaterial, patchBasicMaterial,
} from "saintfall/art.js";
import { makeKit } from "saintfall/structures.js";

/* The reliquary lamp at rest, and how fast a shot's flash decays off
   it. 1/0.045s: long enough to be caught at 60fps from any frame the
   trigger falls on, short enough that sustained fire reads as a
   stutter of separate discharges rather than one continuous glow. */
const LAMP_REST_INTENSITY = 0.62;
const LAMP_REST_DISTANCE = 2.1;
/* 45ms, not 60. The bolt now clears the near field in a fifth of
   the time it used to, and a flash that outlives its own shot reads
   as the lance glowing rather than discharging. */
const MUZZLE_FLASH_RATE = 1 / 0.045;
const LAMP_REST_COLOR = 0xff9f3c;
/* The discharge light matches the BOLT. It used to ionise toward a
   cool ivory-cyan, which was left over from when the bolt itself was
   cyan - so the one frame the weapon lights the trooper, it lit them
   the colour of the thing shooting back. Gold going white-hot. */
const LAMP_FLASH_COLOR = 0xfff0c0;

/* WHERE THE LANCE ACTUALLY ENDS.

   Derived from the same three numbers `buildGlaive` builds the head
   from, so the emitter cannot drift off the needle when the head is
   re-proportioned. The socket sits at `haft * HEAD`, the needle is
   mounted `NEEDLE_BASE` beyond it and runs `NEEDLE_LEN` further, so
   the point of the thing is at all three added together - 1.598m on
   a 1.92m haft, which is 0.10m past the aim node and 0.32m past
   where the flare used to be drawn. */
const LANCE_HEAD = 0.59;
const LANCE_NEEDLE_BASE = 0.18;
const LANCE_NEEDLE_LEN = 0.285;
const lanceTipX = (haft) => haft * LANCE_HEAD + LANCE_NEEDLE_BASE + LANCE_NEEDLE_LEN;

const IRON = makeRamp([
  [0.00, "#191412"], [0.28, "#31261f"], [0.58, "#4f4033"],
  [0.82, "#725f4b"], [1.00, "#9a8468"],
]);

/* The crescent gets its own ramp. Sharing IRON meant sharing IRON's
   bbox - which spans the whole 2.06m glaive - so the blade root sat
   low in that range and painted out near-black. A blade is the
   brightest thing on a polearm; it was the darkest. */
/* Verdigris bronze into brass, not steel. The crescent was near-black
   (sharing IRON's whole-weapon bbox), and the fix over-shot to a
   near-white ramp biased 0.25 UP it - which made the blade the
   brightest object in the frame and pulled the eye off the figure.
   Neither end of that swing is the reference. */
/* Cool gunmetal into pale steel. The blade was black, then
   over-corrected to near-white (the brightest object in frame), then
   to verdigris - which fixed the brightness and cost the weapon all
   separation from the armour: haft, blade and ribcage all measured
   the same hue. A neutral cool blade separates from warm bone by HUE
   as well as value, which is the one axis none of the three previous
   ramps used. */
const BLADE = makeRamp([
  [0.00, "#2e3336"], [0.40, "#565e62"], [0.72, "#8d9599"], [1.00, "#c3c9cc"],
]);

const BRASS = makeRamp([
  [0.00, "#4a3410"], [0.35, "#8a6520"], [0.70, "#c2953c"], [1.00, "#f0cf7e"],
]);

const AMBER = makeRamp([
  [0.00, "#5b2108"], [0.36, "#b94d10"], [0.72, "#f29a28"], [1.00, "#ffd778"],
]);

/* Named WOOD, but Vesper's haft is metal - there is no wood anywhere
   on the reference. Dark chocolate made the glaive read as a farm
   scythe. */
/* Named WOOD, but Vesper's haft is metal - there is no wood on the
   reference. Kept darker than the blade so the two read as separate
   parts of one weapon. */
/* The haft is patinated bronze on the reference, tiled like masonry -
   the same family as the armour, separating by ornament and edge
   rather than by hue. Cool neutral grey solved a real legibility
   problem by moving away from the art; the blade stays steel, which
   is enough separation on its own. */
const WOOD = makeRamp([
  [0.00, "#3a3a33"], [0.45, "#5a584c"], [0.80, "#7d7a6b"], [1.00, "#a3a08e"],
]);

/* The muzzle flare's falloff, built once and shared.

   A flat quad of solid colour is a CARD: additive or not, it has a
   hard square edge and the eye reads the edge before the light. The
   first version of the parented flare was exactly that and looked
   like a gold sticky note taped to the lance. A radial ramp with a
   hot centre is what turns the same two triangles into a glow, and
   it costs one 64px texture for the whole game. */
let _flareTex = null;
export function flareTexture(THREE) {
  if (_flareTex) return _flareTex;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  // `willReadFrequently`, because three reads this canvas back when
  // it uploads the texture and Chrome logs a console warning for an
  // un-hinted readback - which the gameplay suite counts as an error.
  const g = canvas.getContext("2d", { willReadFrequently: true });
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Hot core, quick shoulder, long soft skirt - the skirt is what the
  // bloom pass finds, and the bloom is most of what sells it.
  grd.addColorStop(0.00, "rgba(255,255,255,1)");
  grd.addColorStop(0.16, "rgba(255,238,190,0.92)");
  grd.addColorStop(0.42, "rgba(255,170,60,0.38)");
  grd.addColorStop(1.00, "rgba(255,120,20,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  _flareTex = new THREE.CanvasTexture(canvas);
  _flareTex.colorSpace = THREE.SRGBColorSpace;
  return _flareTex;
}

/* ============================================================
   PATTERNS
   Each entry is a recipe, not a mesh. Numbers are metres.
   ============================================================ */

export const PATTERNS = {
  /* Ranged rite of the same physical censer-lance used in melee.
     The internal key remains `autogun` so saves, QA and combat hooks
     keep their established contract, but there is no conventional
     rifle in the player's hands: the reliquary cage is the muzzle
     and the long haft is the two-handed firing chassis. */
  autogun: {
    name: "Vesper Censer-Lance · Volley",
    polearm: true,
    mode: "ranged",
    haft: 1.92,
    blade: { span: 0.26, depth: 0.14 },
    rof: 9.0,
    recoil: { kick: 0.088, rise: 0.049, roll: 0.028, recover: 13 },
    spread: { hip: 0.055, ads: 0.008 },
    damage: 24,
    /* HEAT, NOT AMMUNITION.
       The reliquary does not run out; it runs hot. Ammunition on a
       two-kilometre map with no shops is a resource whose only real
       effect is to send the player back to a resupply beacon, and
       the beacon is a stratagem they have to spend anyway - so the
       old magazine mostly punished being far from one.

       The numbers are picked off the rate of fire so they mean
       something in seconds rather than in rounds. At 9 rounds a
       second, 0.0333 of heat per shot is 30 rounds and 3.3s of
       held trigger before it locks - two thirds of the old 45-round
       magazine's 5s, which is the point: the limiter has to bite
       often enough to be a mechanic. */
    heatPerShot: 0.0333,
    coolDelay: 0.55,       // grace after the last shot before it cools
    coolRate: 0.40,        // full to cold in 2.5s of not shooting
    /* An overheat costs 0.55 + 1.9 = 2.45s, near enough the 2.35s
       reload it replaces. A DELIBERATE vent costs 1.4s. Venting
       early is therefore always cheaper than cooking the weapon,
       which is the decision this mechanic exists to create. */
    overheatReset: 0.25,
    ventTime: 1.4,
    ornament: { skull: true, seal: true, plate: true },
  },

  /* The melee half of the loadout: a processional lance whose caged
     reliquary doubles as the close-combat head.  It is deliberately
     not another crescent; the broken arc already belongs to the
     hero's back silhouette and duplicating it on the weapon made the
     two shapes fight each other. */
  glaive: {
    name: "Vesper Censer-Lance · Rite",
    polearm: true,
    mode: "melee",
    melee: true,
    haft: 1.92,
    blade: { span: 0.26, depth: 0.14 },
    damage: 78,
    reach: 2.72,
    arc: 2.5,              // radians of swing that connects
    cadence: 0.52,
    recoil: { kick: 0.02, rise: 0.012, roll: 0.010, recover: 9 },
    spread: { hip: 0, ads: 0 },
    // A lance has no barrel to cook. Zero heat per swing, and the
    // heat carried by the ranged rite still cools while it is out.
    heatPerShot: 0, coolDelay: 0, coolRate: 0.40,
    overheatReset: 0.25, ventTime: 1.4,
  },
};

/* ============================================================
   BUILD
   ============================================================ */

export function buildWeapons(ctx) {
  const { THREE, scene, materials } = ctx;
  const kit = makeKit(THREE);
  const bus = makeBus();
  const group = new THREE.Group();
  group.name = "weapons";
  scene.add(group);

  const built = new Map();

  function buildAutogun(spec, rng) {
    const iron = [];
    const brass = [];
    const wood = [];
    const cloth = [];

    const R = spec.receiver;
    const halfL = R.l / 2;

    /* --- receiver: a bevelled box with a raised top rail --- */
    iron.push(kit.slab(R.l, R.h, R.w, 0.008)
      .translate(0, -R.h / 2, 0));
    iron.push(kit.slab(R.l * 0.62, 0.016, R.w * 0.66, 0.004)
      .translate(-R.l * 0.06, R.h * 0.5 - 0.012, 0));
    // Ejection port, as a recessed darker panel.
    iron.push(kit.slab(R.l * 0.22, R.h * 0.34, 0.006, 0.002)
      .translate(R.l * 0.10, -R.h * 0.52, R.w * 0.5));

    /* --- barrel and shroud --- */
    const B = spec.barrel;
    const barrel = kit.prism({
      h: B.l, rBottom: B.r, rTop: B.r * 0.86, sides: 8, segments: 2,
    });
    barrel.rotateZ(-Math.PI / 2);
    barrel.translate(halfL, -R.h * 0.5, 0);
    iron.push(barrel);

    if (B.shroud) {
      // A perforated shroud: rings with gaps between them. Gaps read
      // as holes at any distance where holes would be visible, and
      // cost nothing where they would not.
      for (let i = 0; i < B.vents; i += 1) {
        const t = i / B.vents;
        // 0.82 of the pitch, not 0.58. At 0.58 the gaps were wider
        // than the rings and the shroud read as a caterpillar rather
        // than as a slotted tube.
        const ring = kit.prism({
          h: (B.l / B.vents) * 0.82, rBottom: B.r * 1.62, rTop: B.r * 1.62, sides: 8,
        });
        ring.rotateZ(-Math.PI / 2);
        ring.translate(halfL + 0.02 + t * B.l * 0.78, -R.h * 0.5, 0);
        iron.push(ring);
      }
      // Gas block.
      iron.push(kit.slab(0.05, 0.055, 0.045, 0.004)
        .translate(halfL + B.l * 0.60, -R.h * 0.5 - 0.006, 0));
    }

    /* --- muzzle brake --- */
    const brake = kit.prism({ h: 0.075, rBottom: B.r * 2.1, rTop: B.r * 1.75, sides: 6 });
    brake.rotateZ(-Math.PI / 2);
    brake.translate(halfL + B.l, -R.h * 0.5, 0);
    iron.push(brake);
    for (let i = 0; i < 3; i += 1) {
      iron.push(kit.slab(0.008, B.r * 2.4, 0.05, 0)
        .translate(halfL + B.l + 0.018 + i * 0.020, -R.h * 0.5 - B.r * 1.2, 0));
    }

    /* --- magazine, raked forward --- */
    const M = spec.magazine;
    const mag = kit.slab(M.l, M.h, M.w, 0.005);
    mag.rotateZ(M.rake);
    mag.translate(-R.l * 0.02, -R.h - M.h * 0.94, 0);
    iron.push(mag);
    brass.push(kit.slab(M.l * 1.08, 0.012, M.w * 1.08, 0.003)
      .rotateZ(M.rake)
      .translate(-R.l * 0.02, -R.h - 0.006, 0));

    /* --- pistol grip and trigger guard --- */
    const grip = kit.prism({
      h: 0.135, rBottom: 0.030, rTop: 0.024, sides: 5, segments: 2,
    });
    grip.rotateZ(0.30);
    grip.rotateX(Math.PI);
    grip.translate(-R.l * 0.22, -R.h, 0);
    wood.push(grip);
    iron.push(kit.slab(0.075, 0.010, 0.030, 0.002)
      .translate(-R.l * 0.16, -R.h - 0.052, 0));

    /* --- stock --- */
    const S = spec.stock;
    const stock = kit.slab(S.l, R.h * 0.80, R.w * 0.86, 0.008);
    stock.rotateZ(-0.055);
    stock.translate(-halfL - S.l * 0.46, -R.h * 0.55 - S.drop, 0);
    wood.push(stock);
    iron.push(kit.slab(0.018, R.h * 1.05, R.w * 0.94, 0.004)
      .translate(-halfL - S.l * 0.95, -R.h * 0.58 - S.drop * 1.5, 0));

    /* --- sights --- */
    // Front post on the gas block, rear aperture on the rail. Iron
    // sights are what tell the player where the barrel is pointing
    // in a third-person over-the-shoulder frame.
    iron.push(kit.slab(0.010, 0.036, 0.008, 0)
      .translate(halfL + B.l * 0.66, -R.h * 0.5 + B.r * 1.9, 0));
    const rear = kit.ringSolid([
      { y: 0, r: 0.016, sides: 7 },
      { y: 0.010, r: 0.016, sides: 7 },
    ], { capTop: false, capBottom: false });
    rear.rotateZ(Math.PI / 2);
    rear.translate(-R.l * 0.24, R.h * 0.5 + 0.014, 0);
    iron.push(rear);
    iron.push(kit.slab(0.014, 0.020, 0.030, 0.002)
      .translate(-R.l * 0.24, R.h * 0.5, 0));

    /* --- ornament ---
       The Concord does not issue an unblessed weapon. On a dark iron
       object carried against a bright desert, the brass IS the
       silhouette: without it the whole thing reads as a black bar. */
    if (spec.ornament.plate) {
      brass.push(kit.slab(R.l * 0.30, R.h * 0.46, 0.006, 0.002)
        .translate(-R.l * 0.14, -R.h * 0.52, -R.w * 0.5 - 0.002));
      brass.push(kit.slab(R.l * 0.30, R.h * 0.46, 0.006, 0.002)
        .translate(-R.l * 0.14, -R.h * 0.52, R.w * 0.5 - 0.004));
    }
    if (spec.ornament.skull) {
      const boss = kit.skull({ size: 0.055, jaw: false });
      boss.rotateY(-Math.PI / 2);
      boss.translate(-R.l * 0.14, -R.h * 0.52, -R.w * 0.5 - 0.012);
      brass.push(boss);
    }
    if (spec.ornament.seal) {
      // A purity seal: a strip of parchment on a wax blob, hanging
      // off the receiver. It is the one thing on the weapon that
      // moves on its own, which is why it is worth the triangles.
      const seal = kit.banner({
        w: 0.030, h: 0.115, cols: 2, rows: 5,
        sag: 0.0, amp: 0.10, taper: 0.28,
      });
      seal.translate(-R.l * 0.30, -R.h * 0.34, R.w * 0.5 + 0.004);
      cloth.push(seal);
      brass.push(kit.prism({ h: 0.008, rBottom: 0.012, rTop: 0.010, sides: 6 })
        .rotateX(Math.PI / 2)
        .translate(-R.l * 0.30, -R.h * 0.30, R.w * 0.5 + 0.006));
    }

    return { iron, brass, wood, cloth };
  }

  /** The Vesper Censer-Lance, authored along +X like the autogun. */
  function buildGlaive(spec, rng) {
    const iron = [];
    const brass = [];
    const wood = [];
    const cloth = [];
    const blade = [];
    const amber = [];
    const censer = [];
    const L = spec.haft;

    // A readable but disciplined shaft: thinner than the old glaive,
    // whose pole and crescent together occupied more frame than the
    // character carrying it.
    wood.push(kit.prism({ h: L, rBottom: 0.036, rTop: 0.031, sides: 7 })
      .rotateZ(-Math.PI / 2).translate(-L * 0.34, 0, 0));
    for (let i = 0; i < 6; i += 1) {
      const x = -L * 0.31 + i * L * 0.155;
      brass.push(kit.prism({ h: 0.025, rBottom: 0.043, rTop: 0.043, sides: 7 })
        .rotateZ(-Math.PI / 2).translate(x, 0, 0));
    }

    /* A short under-haft fire-control grip gives the rear hand a real
       purchase when the lance is used as a gun.  It is deliberately
       compact enough to stay inside the melee silhouette, but it gives
       the trigger wrist somewhere physical to sit below the forward
       support hand instead of pretending to grip empty air. */
    wood.push(kit.prism({ h: 0.118, rBottom: 0.026, rTop: 0.032, sides: 7 })
      .rotateZ(Math.PI).translate(-L * 0.25, -0.002, 0));
    brass.push(kit.prism({ h: 0.024, rBottom: 0.041, rTop: 0.037, sides: 7 })
      .rotateZ(Math.PI).translate(-L * 0.25, 0.008, 0));

    const headX = L * LANCE_HEAD;
    // A short socket feeds an OPEN reliquary cage.  The previous
    // "hoops" were capped cylinders: three solid disks plus a cone
    // inevitably read as a missile/drill, even though the code called
    // them a cage.  Low-segment torus ribs leave real negative space
    // around the amber chamber from every gameplay angle.
    brass.push(kit.prism({ h: 0.15, rBottom: 0.052, rTop: 0.042, sides: 7 })
      .rotateZ(-Math.PI / 2).translate(headX - 0.13, 0, 0));
    for (const x of [headX - 0.02, headX + 0.085, headX + 0.19]) {
      brass.push(new THREE.TorusGeometry(0.067, 0.009, 4, 8)
        .rotateY(Math.PI / 2).translate(x, 0, 0));
    }
    for (const [y, z] of [[0.058, 0], [-0.058, 0], [0, 0.058], [0, -0.058]]) {
      iron.push(kit.slab(0.245, 0.018, 0.022, 0.004)
        .translate(headX + 0.075, y - 0.009, z));
    }
    // Exposed amber chamber, then the v3 concept's disciplined needle.
    // Neither fills the cage, so the head stays airy instead of
    // turning back into a solid rocket silhouette at distance.
    amber.push(kit.prism({
      h: 0.155, rBottom: 0.024, rTop: 0.019, sides: 6, twist: 0.35,
    }).rotateZ(-Math.PI / 2).translate(headX + 0.008, 0, 0));
    blade.push(kit.prism({
      h: LANCE_NEEDLE_LEN, rBottom: 0.022, rTop: 0.0025, sides: 6,
    }).rotateZ(-Math.PI / 2).translate(headX + LANCE_NEEDLE_BASE, 0, 0));

    // A clipped rear fork gives the head an asymmetric read without
    // borrowing the knight's signature crescent.
    iron.push(kit.slab(0.15, 0.038, 0.020, 0.004)
      .rotateZ(0.58).translate(headX - 0.10, 0.038, 0));
    iron.push(kit.slab(0.13, 0.034, 0.020, 0.004)
      .rotateZ(-0.52).translate(headX - 0.10, -0.065, 0));

    // Blunt pommel: the other end is visible, but no extra spear
    // length pokes out of every hero composition.
    brass.push(kit.prism({ h: 0.09, rBottom: 0.047, rTop: 0.028, sides: 7 })
      .rotateZ(Math.PI / 2).translate(-L * 0.35, 0, 0));

    /* Censer, hung under the socket on a short chain. Modelled at the
       origin: it lives on its own pivot so it can swing, and a part
       modelled where it hangs cannot be rotated about its hook. */
    censer.push(kit.prism({ h: 0.012, rBottom: 0.020, rTop: 0.020, sides: 6 })
      .rotateZ(Math.PI / 2).translate(0, 0.01, 0));
    /* One tapered stem, not five boxes. 14-30mm links do not resolve
       at any review distance, so the censer read as a lone cube
       floating in open sky with nothing joining it to the haft. */
    censer.push(kit.prism({ h: 0.14, rBottom: 0.014, rTop: 0.009, sides: 5 })
      .translate(0, -0.150, 0));
    censer.push(kit.ringSolid([
      { y: -0.165, r: 0.026, sides: 7 },
      { y: -0.200, r: 0.048, sides: 7, phase: 0.4 },
      { y: -0.242, r: 0.052, sides: 7 },
      { y: -0.278, r: 0.028, sides: 7, phase: 0.4 },
    ]));

    // Purity seal and ribbons off the socket.
    // No 6mm ribbon cards: at distance they are black hairs.

    void rng;
    void wood;
    return { iron, brass, wood, cloth, blade, amber, censer };
  }

  function build(key) {
    if (built.has(key)) return built.get(key);
    const spec = PATTERNS[key];
    if (!spec) return null;
    /* `autogun` and `glaive` are two gameplay modes, not two props.
       Both keys resolve to this one record so changing rites never
       removes, recreates, or reparents the visible censer-lance. */
    if (spec.polearm && built.has("vesper-censer-lance")) {
      const shared = built.get("vesper-censer-lance");
      built.set(key, shared);
      return shared;
    }
    const rng = makeRng(((ctx.seed ^ 0x77ea) + key.length * 977) >>> 0 || 7);
    const isPolearm = !!spec.polearm;
    const parts = isPolearm ? buildGlaive(spec, rng) : buildAutogun(spec, rng);

    const root = new THREE.Group();
    root.name = `weapon-${key}`;

    const add = (list, ramp, matName, opts = {}) => {
      if (!list.length) return null;
      const geo = kit.merge(list);
      paintByHeight(THREE, geo, ramp, {
        normalWeight: opts.normalWeight ?? 0.50,
        jitter: opts.jitter ?? 0.10,
        noise: opts.noise ?? 0.16,
        bias: opts.bias ?? 0,
      });
      const mesh = new THREE.Mesh(geo, materials[matName]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
      return mesh;
    };

    add(parts.iron, IRON, "iron");
    if (parts.blade) add(parts.blade, BLADE, "iron", { bias: 0.12, normalWeight: 0.44 });
    if (parts.amber) add(parts.amber, AMBER, "emissive", { bias: 0.18, normalWeight: 0.34 });
    // Brass biased UP its ramp: it is the read, and a dull brass is
    // no more legible than the iron it is meant to break up.
    add(parts.brass, BRASS, "gold", { bias: 0.22, normalWeight: 0.42 });
    add(parts.wood, WOOD, "verdigris", { normalWeight: 0.46, bias: 0.14 });

    let seal = null;
    if (parts.cloth.length) {
      const geo = kit.merge(parts.cloth);
      paintFlat(THREE, geo, PALETTE.ivory, 0.18);
      seal = new THREE.Mesh(geo, materials.cloth);
      seal.castShadow = true;
      root.add(seal);
    }

    /* Grip anchors, as real objects in weapon space, so the arms
       can be SOLVED onto them. Hard-coding hand positions on the
       body instead produces a figure standing near a weapon rather
       than holding one, and it breaks the moment the weapon moves
       for recoil or aiming. */
    const gripRear = new THREE.Object3D();
    const gripFront = new THREE.Object3D();
    gripRear.name = "grip-rear";
    gripFront.name = "grip-front";
    if (isPolearm) {
      /* The rear hand takes the dedicated under-haft fire-control grip.

         The separation was 0.255 of the haft - 54cm between the hands
         - chosen to open the right elbow. It opened it too far. With
         the shaft carried beside the breastplate the rear grip landed
         0.37m BEHIND the shoulder, so the trigger arm had to reach
         backwards past the ribs, and the elbow ended up above the
         wrist with the forearm swung out sideways. That is the
         "unnatural right arm": not a bad pole vector, a hand parked
         somewhere an arm does not want to go.

         0.19 puts the rear hand beside the hip instead of behind it -
         a 40cm span, which is a two-handed carry rather than a rowing
         stroke - and the elbow drops under the wrist on its own. */
      /* Front grip pulled back toward the body. Seating the support
         hand UNDERNEATH the haft drops its wrist 55mm below the grip,
         and that arm already crossed the chest at 92% of its reach -
         the extra put it at 100% and locked the elbow straight at
         178deg. The hold is what changed, so the span is what gives. */
      /* The rear grip was at -0.180, which put the trigger wrist 19cm
         BEHIND its own shoulder at rest. A hand behind the hip forces
         the elbow out and forward - hold your own hand behind your hip
         and watch it happen - so no elbow pole could make that arm
         read right; three rounds of pole tuning against it all failed
         the same way. At -0.135 the rear hand rides BESIDE the hip,
         the shoulder-wrist line runs nearly straight down, and the
         elbow can finally hang down and back like an arm.
         Hand spacing 0.40m -> 0.32m, still inside the two-hand gate. */
      gripRear.position.set(-spec.haft * 0.155, -0.048, 0);
      gripFront.position.set(spec.haft * 0.030, 0, 0);
    } else {
      const R = spec.receiver;
      gripRear.position.set(-R.l * 0.20, -R.h - 0.055, 0);
      gripFront.position.set(R.l * 0.5 + spec.barrel.l * 0.02, -R.h * 0.5 - 0.045, 0);
    }
    root.add(gripRear);
    root.add(gripFront);

    /* The muzzle. Shots leave from HERE, not from the camera: a ray
       cast from the eye starts behind the weapon and passes straight
       through whatever the barrel is poking around, so the player
       shoots through their own cover and cannot work out why.

       DO NOT MOVE THIS TO MAKE THE FLASH LOOK BETTER. It is not just
       an emitter position: the aim solve rotates the whole weapon to
       keep THIS node parallel to the camera ray, while main.js uses it
       as the near end of the converged reticle shot. Sliding it back
       23cm onto the censer cage - which does look
       better - swung `saintfall-weapon-gait-proof`'s reticle sweep
       from 0.000deg/0.00px to 29.2deg/137px of miss at 1080p. The
       cosmetic offset belongs on the flare below, which is drawn
       rather than aimed. */
    const muzzle = new THREE.Object3D();
    muzzle.name = "aim-muzzle";
    muzzle.position.set(isPolearm
      ? spec.haft * 0.78
      : spec.receiver.l * 0.5 + spec.barrel.l + 0.035, 0, 0);
    root.add(muzzle);

    /* WHERE THE SHOT IS SEEN TO LEAVE FROM.

       Separate from `muzzle` on purpose. `muzzle` is the node the aim
       solve is calibrated around and must not move (see the warning
       above); this one is the physical point of the needle, and it is
       what the bolt, the flare and the discharge light all use.

       They were 32cm apart: the flare was pulled back onto the
       reliquary cage on the theory that the spike in front of it is a
       bayonet rather than a bore. On a weapon whose whole silhouette
       converges on that spike, a discharge that happens behind it
       reads as the lance leaking rather than firing.

       It sits 10cm forward of the aim node along the same axis. The
       visible shaft stays close to the reticle line, while ballistics
       converges this physical tip onto the reticle-selected world
       point so the lower third-person origin cannot pass under it. */
    const emitter = new THREE.Object3D();
    emitter.name = "bolt-emitter";
    emitter.position.set(isPolearm
      ? lanceTipX(spec.haft)
      : spec.receiver.l * 0.5 + spec.barrel.l + 0.035, 0, 0);
    root.add(emitter);

    /* THE FLASH ITSELF, PARENTED TO THE EMITTER.
       This is the fix for "the shot does not come from the lance",
       and it is a fix to WHERE THE EFFECT LIVES rather than to a
       number. `shoot()` reads the muzzle's world position and hands
       it to the world-space particle pool - but it reads it BEFORE
       `weapons.update()` has applied this frame's recoil, sway and
       carry pose, so the flash is stamped into the world at last
       frame's muzzle position and then the weapon moves out from
       under it. During a burst the weapon is moving every frame and
       the flashes stay where they were put, which is why they read
       as lights hanging in the air beside the lance.

       A child of the muzzle cannot be in the wrong place. Two
       crossed billboards rather than one, so the flare has volume
       from any bearing instead of vanishing edge-on when the camera
       swings round the shoulder. */
    /* Small. Seen end-on from a chase camera - the common case -
       these crossed cards are a disc, and at 0.34 that disc covered
       the trooper's whole chest and read as the armour glowing rather
       than as the weapon firing. */
    const flashGeo = new THREE.PlaneGeometry(0.20, 0.20);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffc24a,
      map: flareTexture(THREE),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const flashRig = new THREE.Group();
    flashRig.name = "muzzle-flare";
    for (let i = 0; i < 3; i += 1) {
      const quad = new THREE.Mesh(flashGeo, flashMat);
      quad.rotation.set(0, Math.PI * 0.5, (i / 3) * Math.PI);
      quad.renderOrder = 900;
      flashRig.add(quad);
    }
    /* A LANCE of flare down the shot axis, in front of the star.
       Crossed billboards alone are a round puff, and a round puff on
       the end of a spike reads as a lamp switching on. The stretched
       card gives the discharge a DIRECTION, which is the difference
       between "it is glowing" and "it just fired". */
    const spikeGeo = new THREE.PlaneGeometry(1.05, 0.115);
    spikeGeo.translate(0.42, 0, 0);
    for (let i = 0; i < 2; i += 1) {
      const spike = new THREE.Mesh(spikeGeo, flashMat);
      spike.rotation.x = i * Math.PI * 0.5;
      spike.renderOrder = 901;
      flashRig.add(spike);
    }
    flashRig.visible = false;
    emitter.add(flashRig);

    /* The business end, for measuring a swing. A blow is judged on
       what the TIP does, not on what the grip does - the grip barely
       moves in a good swing, which is the whole point of leverage. */
    const tip = new THREE.Object3D();
    tip.name = "weapon-tip";
    /* A ranged weapon's tip sat at (0,0,0) - the weapon's own origin,
       which is the mount. Any probe that measured a rifle animation
       therefore measured a lever of zero length and reported that
       nothing moved, and the reload and swap clips were both flagged
       dead when the glaive puts the same reload through 0.487m in its
       first half second. The workaround on record was to probe melee
       with the glaive and everything else with the rifle, which kept
       the broken anchor and hid it for attacks only. The barrel end
       is where the business end of a rifle is. */
    tip.position.set(
      isPolearm ? spec.haft * 0.78 : spec.receiver.l * 0.5 + spec.barrel.l,
      0, 0);
    root.add(tip);

    // Rear end of the physical weapon.  QA uses this with `tip` to
    // prove that the complete haft stays beside the torso rather
    // than checking only the glowing head.
    const butt = new THREE.Object3D();
    butt.name = "weapon-butt";
    butt.position.set(isPolearm ? -spec.haft * 0.40 : -spec.receiver.l * 0.75, 0, 0);
    root.add(butt);

    // The chamber is a reliquary, not painted orange metal.  One
    // short-range, shadowless light gives the cage and the knight's
    // hands readable amber bounce during Vespers/night while adding
    // no shadow pass and virtually nothing beyond the hero radius.
    let reliquaryLight = null;
    if (isPolearm) {
      reliquaryLight = new THREE.PointLight(
        LAMP_REST_COLOR, LAMP_REST_INTENSITY, LAMP_REST_DISTANCE, 2
      );
      reliquaryLight.position.set(spec.haft * 0.74, 0, 0);
      reliquaryLight.castShadow = false;
      reliquaryLight.userData.restColour = new THREE.Color(LAMP_REST_COLOR);
      reliquaryLight.userData.flashColour = new THREE.Color(LAMP_FLASH_COLOR);
      root.add(reliquaryLight);
    }

    // The censer hangs under the blade and swings on its own pivot.
    let censer = null;
    if (isPolearm) {
      censer = new THREE.Object3D();
      censer.position.set(spec.haft * 0.59, -0.02, 0);
      root.add(censer);
      for (const g of parts.censer || []) {
        const geo = g.clone();
        paintByHeight(THREE, geo, BRASS, { bias: 0.34, normalWeight: 0.42 });
        const m = new THREE.Mesh(geo, materials.gold);
        m.castShadow = true;
        censer.add(m);
      }
    }

    const record = {
      key, spec, mode: spec.mode || key, root, seal, rng,
      gripRear, gripFront, muzzle, emitter, tip, butt, censer, reliquaryLight,
      flashRig, flashMat,
      /* Where the hands sit along the haft when nothing is sliding
         them. An authored THRUST runs the shaft forward through the
         grip, so the action code writes these positions absolutely
         off this bind rather than nudging them - a per-frame nudge
         would walk the hands off the end of the weapon inside a
         second. */
      gripBindX: { front: gripFront.position.x, rear: gripRear.position.x },
    };
    built.set(key, record);
    if (isPolearm) {
      built.set("vesper-censer-lance", record);
      built.set("autogun", record);
      built.set("glaive", record);
    }
    return record;
  }

  /* ============================================================
     CARRY

     One weapon is attached to the player's mount and driven by
     springs. Nothing here is a clip: a fired shot is an impulse,
     and everything after it is the weapon settling.
     ============================================================ */

  const carry = {
    key: null,
    record: null,
    mount: null,
    ads: 0,
    recoil: { back: 0, rise: 0, roll: 0 },
    // 0..1, set to 1 by a shot and decayed in update().
    flash: 0,
    /* HEAT. `heat` is 0..1. `overheated` is the lockout that latches
       at 1 and clears at `overheatReset` - without the latch the
       weapon would stutter back to life for one shot the instant it
       dipped below full and immediately re-lock, which reads as a
       broken trigger rather than as a cooked barrel. `sinceShot`
       drives the cooling grace, and `venting` is a deliberate purge.
       One barrel, so this state is on the CARRY rather than the
       record: swapping to the lance and back does not cool it. */
    heat: 0,
    overheated: false,
    venting: 0,
    sinceShot: 99,
    cooldown: 0,
    sway: new THREE.Vector2(),
    lastYaw: 0,
    lastPitch: 0,
    bob: 0,
    /* SHEATHING.
       `stowWant` is what the game asks for, 0 or 1; `stow` is where
       the animation has actually got to. Keeping them apart is what
       makes this an animation rather than a teleport, and it means
       the draw can be quicker than the sheathe - which is the whole
       character of the move. `handRelease` is the slice of that
       travel during which the hands are off the grips, read by the
       arm solver in player.js. */
    stowWant: 0,
    stow: 0,
    handRelease: 0,
  };

  function currentHeatSpec() {
    const spec = carry.record?.spec || PATTERNS.autogun;
    return spec.polearm ? PATTERNS.autogun : spec;
  }

  function weaponEvent(extra = {}) {
    return {
      weaponKey: carry.key,
      mode: carry.record?.mode || null,
      melee: !!carry.record?.spec?.melee,
      heat: carry.heat,
      overheated: carry.overheated,
      venting: carry.venting > 0,
      ...extra,
    };
  }

  /**
   * Authoritative heat mutation for progression and future weapon rites.
   * Invalid values are ignored, valid values are clamped to 0..1, and the
   * overheat latch follows the same threshold rules as natural cooling.
   */
  function setHeat(value, detail = {}) {
    if (!Number.isFinite(value)) return carry.heat;
    const before = carry.heat;
    const wasOverheated = carry.overheated;
    carry.heat = clamp01(value);
    const resetAt = currentHeatSpec().overheatReset ?? 0.25;
    if (detail.clearOverheat === true || detail.overheated === false) {
      carry.overheated = false;
    } else if (detail.overheated === true || carry.heat >= 1) {
      carry.overheated = true;
    } else if (carry.overheated && carry.heat <= resetAt) {
      carry.overheated = false;
    }

    if (carry.heat !== before || carry.overheated !== wasOverheated) {
      const payload = weaponEvent({
        reason: detail.reason || "external",
        before,
        after: carry.heat,
        delta: carry.heat - before,
        wasOverheated,
      });
      bus.emit("heat", payload);
      if (!wasOverheated && carry.overheated) bus.emit("overheat", payload);
      if (wasOverheated && !carry.overheated) bus.emit("heatReady", payload);
    }
    return carry.heat;
  }

  /** Add a non-negative amount of heat, returning the amount accepted. */
  function addHeat(amount, detail = {}) {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const before = carry.heat;
    setHeat(before + amount, detail);
    return carry.heat - before;
  }

  /** Remove a non-negative amount of heat, returning the amount removed. */
  function coolHeat(amount, detail = {}) {
    if (!Number.isFinite(amount) || amount < 0) return 0;
    const before = carry.heat;
    const wasOverheated = carry.overheated;
    setHeat(before - amount, detail);
    const removed = before - carry.heat;
    if (removed > 0 || wasOverheated !== carry.overheated) {
      bus.emit("cool", weaponEvent({
        reason: detail.reason || "external",
        amount: removed,
        before,
        after: carry.heat,
      }));
    }
    return removed;
  }

  function equip(key, mount) {
    const record = build(key);
    if (!record) return null;
    const spec = PATTERNS[key];
    const samePhysicalWeapon = carry.record === record;
    if (carry.record && !samePhysicalWeapon && carry.record.root.parent) {
      carry.record.root.parent.remove(carry.record.root);
    }
    carry.key = key;
    carry.record = record;
    record.key = key;
    record.spec = spec;
    record.mode = spec.mode || key;
    // Heat is NOT reset here. Switching to the lance and back was a
    // free magazine under the old model too, and it would be a free
    // vent under this one; the barrel does not care which rite the
    // trooper has selected.
    carry.venting = 0;
    carry.ads = 0;
    carry.mount = mount || carry.mount;
    if (!samePhysicalWeapon || !record.root.parent) {
      (carry.mount || group).add(record.root);
    }
    bus.emit("equip", weaponEvent({ key }));
    return record;
  }

  /** A presentation-only copy for a character that carries the same rite.
   *  Geometry remains shared; mutable materials, lights and transforms do not.
   *  Nothing in the returned record is connected to player heat/recoil state. */
  function cloneVisual(key = "autogun") {
    const source = build(key);
    if (!source) return null;
    const root = source.root.clone(true);
    root.name = `weapon-${key}-replica`;
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.set(1, 1, 1);
    root.traverse((node) => {
      if (node.material) {
        const cloneMaterial = (sourceMaterial) => {
          if (!sourceMaterial?.clone) return sourceMaterial;
          const material = sourceMaterial.clone();
          const sf = sourceMaterial.userData || {};
          if (sf.sfPatched) {
            material.userData = { ...material.userData };
            delete material.userData.sfPatched;
            delete material.userData.sfShader;
            delete material.onBeforeCompile;
            delete material.customProgramCacheKey;
            if (sf.sfBasic || sourceMaterial.isMeshBasicMaterial) {
              patchBasicMaterial(material, ctx.atmos,
                Number.isFinite(sf.sfFade) ? sf.sfFade : 0.7,
                sf.sfAdditive ?? sourceMaterial.blending === THREE.AdditiveBlending);
            } else {
              patchMaterial(material, ctx.atmos, {
                rim: sf.sfRim, glitter: sf.sfGlitter,
                bio: sf.sfBio, dunes: sf.sfDunes,
              });
            }
          }
          return material;
        };
        node.material = Array.isArray(node.material)
          ? node.material.map(cloneMaterial) : cloneMaterial(node.material);
      }
      if (node.isLight) {
        node.color = node.color.clone();
        node.intensity *= 0.78;
      }
    });
    return {
      root,
      gripRear: root.getObjectByName("grip-rear"),
      gripFront: root.getObjectByName("grip-front"),
      muzzle: root.getObjectByName("aim-muzzle"),
      emitter: root.getObjectByName("bolt-emitter"),
      tip: root.getObjectByName("weapon-tip"),
      butt: root.getObjectByName("weapon-butt"),
      flash: root.getObjectByName("muzzle-flare"),
    };
  }

  function setMode(mode) {
    const key = mode === "melee" || mode === "glaive" ? "glaive" : "autogun";
    return equip(key, carry.mount);
  }

  /** Light the reliquary lamp for one discharge. */
  function flashMuzzle() {
    carry.flash = 1;
  }

  function fire() {
    if (!carry.record || carry.cooldown > 0) return false;
    if (carry.venting > 0 || carry.overheated) return false;
    const spec = carry.record.spec;
    const heatBefore = carry.heat;
    const overheatBefore = carry.overheated;
    /* A gilded lance runs cool. The multiplier is read here rather than
       baked into the weapon spec because it is a property of the
       BEARER, not of the pattern - the same lance overheats normally
       thirty seconds later. */
    const boon = ctx.mission?.boon?.();
    /* ...and of the ROAD: the difficulty tier scales heat per shot too -
       Martyr's barrel locks after 24 rounds instead of 30, which is a
       ranged-only tax that costs no health (see difficulty.js). */
    const tierHeat = Number(ctx.difficulty?.current?.heat) || 1;
    const heatScale = (boon?.active ? Math.max(0, Number(boon.heat) || 1) : 1) * tierHeat;
    const heatAdded = addHeat((spec.heatPerShot || 0) * heatScale, { reason: "fire" });
    carry.sinceShot = 0;
    // Latches AFTER the shot, so the round that fills the gauge
    // still leaves the barrel. Stopping it a shot early makes the
    // readout and the weapon disagree at exactly the moment the
    // player is watching the readout.
    const r = carry.record.spec.recoil;
    carry.cooldown = 1 / carry.record.spec.rof;
    // Impulse, not a set: repeated shots accumulate, which is what
    // makes sustained fire climb.
    carry.recoil.back = Math.min(carry.recoil.back + r.kick, r.kick * 2.4);
    carry.recoil.rise = Math.min(carry.recoil.rise + r.rise, r.rise * 2.8);
    carry.recoil.roll += (Math.random() - 0.5) * r.roll * 2;
    const payload = weaponEvent({
      heatBefore,
      heatAfter: carry.heat,
      heatAdded,
      becameOverheated: !overheatBefore && carry.overheated,
      cooldown: carry.cooldown,
    });
    bus.emit("fire", payload);
    ctx.progression?.onWeaponFire?.(payload);
    return true;
  }

  /**
   * Purge the heat deliberately. What R does now.
   *
   * Refused when the weapon is already cold, so a mashed key cannot
   * be used as a free stutter-stop on the recoil, and allowed while
   * OVERHEATED - venting is how you cut a lockout short, and being
   * unable to touch the weapon you have just cooked would leave the
   * player with a key that stops working exactly when they reach
   * for it.
   */
  function vent() {
    if (!carry.record || carry.venting > 0) return false;
    if (carry.heat <= 0.001) return false;
    const spec = carry.record.spec.polearm ? PATTERNS.autogun : carry.record.spec;
    carry.venting = spec.ventTime || 1.4;
    const ps = ctx.player?.state;
    const payload = weaponEvent({
      source: "manual",
      startHeat: carry.heat,
      duration: carry.venting,
      x: ps?.x,
      y: ps?.y,
      z: ps?.z,
      yaw: ps?.yaw,
    });
    bus.emit("vent", payload);
    ctx.progression?.onVent?.(payload);
    return true;
  }

  /** A resupply drop cools the barrel and clears any lockout. */
  function resupply() {
    if (!carry.record) return;
    const before = carry.heat;
    setHeat(0, { reason: "resupply", clearOverheat: true });
    carry.venting = 0;
    bus.emit("resupply", weaponEvent({ before, amount: before }));
  }

  function snapshotState() {
    return {
      mode: carry.record?.spec?.melee ? "melee" : "ranged",
      heat: Number(carry.heat.toFixed(4)),
      overheated: carry.overheated,
      venting: Number(carry.venting.toFixed(4)),
      sinceShot: Number(carry.sinceShot.toFixed(4)),
      cooldown: Number(carry.cooldown.toFixed(4)),
    };
  }

  function restoreState(saved = {}) {
    /* A save can be taken during the borrowed melee rite. Restore the
       durable barrel state but normalize the physical lance to its
       ranged carry so main.js never inherits a half-finished combo. */
    setMode("ranged");
    carry.heat = clamp01(Number(saved.heat) || 0);
    carry.overheated = !!saved.overheated && carry.heat > 0;
    carry.venting = Math.max(0, Number(saved.venting) || 0);
    carry.sinceShot = Math.max(0, Number(saved.sinceShot) || 0);
    carry.cooldown = Math.max(0, Number(saved.cooldown) || 0);
    carry.ads = 0;
    carry.flash = 0;
    carry.recoil.back = 0;
    carry.recoil.rise = 0;
    carry.recoil.roll = 0;
    carry.sway.set(0, 0);
    carry.stowWant = 0;
    carry.stow = 0;
    carry.handRelease = 0;
    return snapshotState();
  }

  /**
   * Cone half-angle for this shot, in radians.
   *
   * Hip fire is a cone and aimed fire is nearly a line; that
   * difference is the entire reason to aim, so it lives in the
   * weapon rather than being applied by the caller.
   */
  function spread() {
    if (!carry.record) return 0;
    const sp = carry.record.spec.spread;
    return lerp(sp.hip, sp.ads, carry.ads);
  }

  const _e = new THREE.Euler();
  const _stowEuler = new THREE.Euler();
  const _stowQuaternion = new THREE.Quaternion();
  /* Chest-mount space is quarter-turned: local X is fore/aft, Y is
     up, and positive Z lands on the wearer's anatomical right. The
     lance itself is authored along local +X, so RotZ(+pi/2) makes it
     a true vertical rather than the former shoulder-to-hip diagonal. */
  /* Park the lance upright in the dedicated cradle on the wearer's
     right side. Mount +Z maps to anatomical right on the imported rig,
     while a quarter-turn about mount Z maps the authored shaft +X to
     world-up. The lower centre keeps the blunt butt above the ground
     and the head beside, rather than behind, the shoulder silhouette. */
  /* Stowed ON the pack, not beside the trooper.
   *
   * `x` is forward and `z` is lateral in mount space, and the two
   * cannot be chosen independently, because the wing this has to
   * clear moves in a different direction in each of its states:
   * folded it reaches OUTBOARD to x -0.359, deployed it sweeps
   * REARWARD and inboard. So pulling the lance in laterally tightens
   * the folded case, pushing it back tightens the deployed one, and
   * every hand-picked value fixed one at the other's expense - the
   * first three attempts landed 110mm, 7mm and 2mm.
   *
   * Swept as a grid instead, through `setStowPose`, measuring the
   * true closest approach between the haft segment and every jetpack
   * vertex in both states. This pair is the tightest position with
   * clearance in both: 23mm folded, 23mm deployed. Bounding boxes
   * are no use for this - they put the extremes on vertices that are
   * nowhere near the lance and reported 18mm for a real gap of 110.
   *
   * Vertical rather than slung diagonally, and that is not
   * negotiable while the wings exist: a diagonal across the back
   * sweeps x +0.5 to -0.5 straight through a feather envelope that
   * reaches +/-0.359 folded. Outboard and upright is the only
   * attitude with anywhere to be. */
  const STOW_POS = { x: -0.492, y: -0.450, z: 0.270 };
  const STOW_ROT = { x: 0.0, y: 0.0, z: Math.PI / 2 };
  // Scratch for the vent emitter's world position; a firefight is no
  // place to be allocating a Vector3 every frame.
  const _ventAt = new THREE.Vector3();
  const _aimPivotBefore = new THREE.Vector3();
  const _aimPivotAfter = new THREE.Vector3();
  const _aimButt = new THREE.Vector3();
  const _aimTip = new THREE.Vector3();
  const _aimShaft = new THREE.Vector3();
  const _aimDirection = new THREE.Vector3();
  const _censerParentWorldQuaternion = new THREE.Quaternion();
  const _censerGravityQuaternion = new THREE.Quaternion();
  /* Low ready: down the body's facing, tipped 6 degrees ABOVE level.

     This was -0.19 - muzzle 11 degrees below the horizon - and that
     nose-down rest is what kept the trigger elbow unfixable. The rest
     solve rotates the shaft about the FRONT grip, so a low muzzle
     means a HIGH butt: the rear grip sat at rib height, only 15cm
     under its own shoulder, and the elbow's circle around that
     shoulder-wrist line physically contained no down-and-back point.
     Every pole choice was a pick between wrong elbows - outboard at
     shoulder height, or kinked forward of the arm - which is why three
     rounds of pole tuning each read as "still inverted" in play.

     Tipping the rest 0.29 rad the other way drops the rear grip
     ~11cm to the hip, where a rear hand on a polearm actually rides.
     The support hand does not move at all - the rotation is about its
     own grip - so the crossing arm's hard-won windows hold. Committed
     aim is untouched: this is the REST direction only. */
  const _restDirection = new THREE.Vector3();
  const REST_PITCH = 0.26;
  const REST_COS = Math.cos(REST_PITCH);
  const REST_SIN = Math.sin(REST_PITCH);
  const _aimParentInverseMatrix = new THREE.Matrix4();
  const _aimDeltaQuaternion = new THREE.Quaternion();
  function update(dt, player, camera) {
    if (!carry.record) return;
    const root = carry.record.root;
    const spec = carry.record.spec;

    carry.cooldown = Math.max(0, carry.cooldown - dt);

    /* HEAT. A vent drains the whole gauge over `ventTime` regardless
       of how full it was, so an early vent is quick in practice and
       a vent from nearly boiling is the full price - the rate is
       what makes venting at 40% feel different from venting at 95%.
       Otherwise the barrel cools on its own once the grace has
       elapsed since the last shot. */
    carry.sinceShot += dt;
    const heatSpec = spec.polearm ? PATTERNS.autogun : spec;
    const ventingBefore = carry.venting;
    if (carry.venting > 0) {
      const ventTime = heatSpec.ventTime || 1.4;
      carry.venting = Math.max(0, carry.venting - dt);
      carry.heat = Math.max(0, carry.heat - dt / ventTime);
      if (carry.venting === 0) carry.heat = 0;
      /* Steam for as long as the purge actually lasts, from the
         weapon's own emitter socket, so the effect ends exactly when
         the lance becomes usable again. A one-shot puff at the key
         press would be over long before the vulnerability window is,
         which is the part the player needs to be able to see. The
         jet thins as the gauge falls, so the picture reports how far
         through the purge it is. */
      const port = carry.record?.emitter || carry.record?.muzzle;
      if (port && ctx.vfx?.weaponVent) {
        port.updateWorldMatrix(true, false);
        _ventAt.setFromMatrixPosition(port.matrixWorld);
        const remaining = carry.venting / ventTime;
        ctx.vfx.weaponVent(_ventAt.x, _ventAt.y, _ventAt.z,
          ctx.player?.state?.yaw || 0, 0.25 + remaining * 0.75);
      }
    } else if (carry.sinceShot >= (heatSpec.coolDelay || 0)) {
      carry.heat = Math.max(0, carry.heat - (heatSpec.coolRate || 0) * dt);
    }
    /* OVERHEAT is visible on the weapon, not only on the gauge: heat
       haze and a thin bleed of steam off the ports while the lockout
       holds, so a player looking at their hands knows why the trigger
       is dead. Sparse - a few motes a second, not a vent. */
    if (carry.overheated && carry.venting <= 0 && ctx.vfx?.weaponVent) {
      carry.overheatBleed = (carry.overheatBleed || 0) + dt;
      if (carry.overheatBleed >= 0.12) {
        carry.overheatBleed = 0;
        const port = carry.record.emitter || carry.record.muzzle;
        if (port) {
          port.updateWorldMatrix(true, false);
          _ventAt.setFromMatrixPosition(port.matrixWorld);
          ctx.vfx.weaponVent(_ventAt.x, _ventAt.y, _ventAt.z,
            ctx.player?.state?.yaw || 0, 0.26);
        }
      }
    }
    // The lockout clears on the way DOWN, at a threshold well below
    // full. See `carry.overheated`.
    if (carry.overheated && carry.heat <= (heatSpec.overheatReset ?? 0.25)) {
      carry.overheated = false;
      bus.emit("heatReady", weaponEvent({ reason: "natural-cooling" }));
    }
    if (ventingBefore > 0 && carry.venting === 0) {
      const payload = weaponEvent({ source: "manual" });
      bus.emit("ventComplete", payload);
      ctx.progression?.onVentComplete?.(payload);
    }
    const rec = spec.recoil.recover;
    carry.recoil.back = damp(carry.recoil.back, 0, rec, dt);
    carry.recoil.rise = damp(carry.recoil.rise, 0, rec * 0.85, dt);
    carry.recoil.roll = damp(carry.recoil.roll, 0, rec * 0.7, dt);

    /* MUZZLE LIGHT. The reliquary lamp was lit at a constant 0.62 over
       a 2.1m radius - a permanent night light on the end of the haft
       that did nothing at all when the weapon was fired. Driving it
       from the shot is most of what sells the discharge, because it
       is the only part that lights the trooper and the ground rather
       than just adding a bright sprite in front of them.

       Linear decay, not damped: a flash has an end. `damp` leaves a
       tail that reads as the barrel glowing between shots. */
    carry.flash = Math.max(0, carry.flash - dt * MUZZLE_FLASH_RATE);
    const lamp = carry.record.reliquaryLight;
    if (lamp) {
      const f = carry.flash * carry.flash;
      lamp.intensity = LAMP_REST_INTENSITY + f * 11.5;
      lamp.distance = LAMP_REST_DISTANCE + f * 7.0;
      // The chamber stays amber at rest, then ionises toward cool
      // ivory-cyan on discharge so the light on the trooper matches
      // the bolt instead of looking like a separate muzzle fire.
      lamp.color.copy(lamp.userData.restColour)
        .lerp(lamp.userData.flashColour, f);
    }

    /* The flare rides the same decay as the lamp. Scaled as well as
       faded: a flash that only fades reads as a decal being turned
       down, while one that punches out and shrinks reads as gas
       leaving under pressure. Hidden outright at zero so three
       transparent quads are not in the sort every frame between
       shots. */
    const flare = carry.record.flashRig;
    if (flare) {
      const f = carry.flash;
      const on = f > 0.02;
      if (flare.visible !== on) flare.visible = on;
      if (on) {
        carry.record.flashMat.opacity = Math.min(1, f * 1.15);
        flare.scale.setScalar(0.62 + (1 - f) * 0.55);
      }
    }

    /* Sway lags the look. The weapon is heavy and the soldier is
       not a camera gimbal - without this the gun is welded to the
       view and the whole thing reads as a HUD element. */
    const yaw = player.state.camYaw;
    const pitch = player.state.camPitch;
    let dy = yaw - carry.lastYaw;
    while (dy > Math.PI) dy -= TAU;
    while (dy < -Math.PI) dy += TAU;
    const dp = pitch - carry.lastPitch;
    carry.lastYaw = yaw;
    carry.lastPitch = pitch;
    carry.sway.x = damp(carry.sway.x, clamp(-dy * 6.5, -0.20, 0.20), 9, dt);
    carry.sway.y = damp(carry.sway.y, clamp(-dp * 6.0, -0.16, 0.16), 9, dt);

    // Walk bob, scaled by speed and killed by aiming.
    carry.bob += dt * player.state.speed * 1.7;
    const aim = carry.ads;
    const bobAmp = (1 - aim * 0.86) * clamp01(player.state.speed / 6) * 0.014;
    const bobX = Math.sin(carry.bob) * bobAmp;
    const bobY = Math.abs(Math.cos(carry.bob)) * bobAmp * 0.8;

    /* The censer-lance is carried BESIDE the breastplate, not
       through its centre.  `z` is lateral after the chest mount's
       quarter-turn, so 0.42m seats the haft outside the armour while
       leaving both authored grips inside real arm reach.  Aiming
       straightens the head without collapsing it back onto the
       centreline. */
    const sideCarry = !!spec.polearm;
    const lowX = sideCarry ? 0.050 : -0.05;
    /* Raised from -0.30. The support hand crosses the chest to a grip
       that sat at hip height, 0.39m below its own shoulder and 0.41m
       across - and seating it UNDER the haft dropped it another
       55mm, which put the arm at 100% of its reach and locked the
       elbow at 178deg. Height is what that arm was short of. */
    const lowY = sideCarry ? -0.242 : -0.05;
    /* 0.39 seated the haft clear of the armour but cost the support
       arm almost all its slack - 7.5% left, so the elbow was near
       locked straight on a reach across the whole chest. Pulling the
       shaft 4.5cm inboard buys that arm a real bend and still clears
       the breastplate, because the pauldron rather than the haft is
       what sets the width here. */
    const lowZ = sideCarry ? 0.185 : 0.10;
    const adsX = sideCarry ? 0.060 : 0.0;
    const adsY = sideCarry ? -0.170 : -0.020;
    const adsZ = sideCarry ? 0.205 : 0.175;

    root.position.set(
      lerp(lowX, adsX, aim) + bobX + carry.sway.x * 0.10,
      lerp(lowY, adsY, aim) + bobY + carry.sway.y * 0.08 + carry.recoil.rise * 0.25,
      lerp(lowZ, adsZ, aim) - carry.recoil.back
    );
    _e.set(
      lerp(sideCarry ? 0.02 : 0.10, sideCarry ? 0.015 : -0.02, aim)
        - carry.recoil.rise * 1.6 + carry.sway.y * 0.55,
      lerp(sideCarry ? -0.03 : -0.20, sideCarry ? -0.0225 : -0.02, aim)
        + carry.sway.x * 0.75,
      /* An upward cant keeps the forward/support grip at chest
         height while dropping the rear/trigger grip beside the
         right ribs.  A flat shaft forced both elbows into the same
         high shrug even when both hands touched their anchors. */
      lerp(sideCarry ? 0.22 : 0.12, sideCarry ? 0.195 : 0.0, aim)
        + carry.recoil.roll
    );
    root.rotation.copy(_e);

    /* Aim the physical shaft through the camera-centre reticle while
       keeping the FRONT grip fixed in world space.  The breastplate is
       intentionally turned toward the right-hand carry, so a fixed
       child Euler inherited that chest yaw and left the lance roughly
       twenty degrees across the body.  Solving in world space avoids
       baking in a body/camera convention and preserves the accepted
       left support-arm pose exactly: only the weapon rotates around its
       support-hand contact, then the right-arm IK follows the rear grip.

       The shaft stays parallel to the live camera ray as the stable
       two-hand visual solve. Ballistics independently converges the
       physical emitter onto the reticle-selected world point; at normal
       combat distances that correction is only a few degrees, while
       avoiding the much larger lie of a parallel low-origin shot passing
       under the reticle or entering the ground. */
    if (sideCarry && camera && root.parent) {
      root.updateWorldMatrix(true, true);
      carry.record.gripFront.getWorldPosition(_aimPivotBefore);
      carry.record.butt.getWorldPosition(_aimButt);
      carry.record.tip.getWorldPosition(_aimTip);

      /* Solve inside parent space.  The imported figure can have a
         non-uniform crouch scale; world quaternions alone discard that
         scale and leave a small but visible pitch error. */
      _aimParentInverseMatrix.copy(root.parent.matrixWorld).invert();
      _aimPivotBefore.applyMatrix4(_aimParentInverseMatrix);
      _aimButt.applyMatrix4(_aimParentInverseMatrix);
      _aimTip.applyMatrix4(_aimParentInverseMatrix);
      _aimShaft.copy(_aimTip).sub(_aimButt).normalize();
      if (player.state.free) {
        const cp = Math.cos(player.state.camPitch);
        _aimDirection.set(
          Math.sin(player.state.camYaw) * cp,
          -Math.sin(player.state.camPitch),
          Math.cos(player.state.camYaw) * cp
        );
      } else {
        camera.getWorldDirection(_aimDirection);
        /* THE LANCE ONLY CHASES THE RETICLE ONCE THE PLAYER MEANS IT.

           The chest no longer tracks the camera for free look, and
           this is the other half of that: left as an unconditional
           camera-ray solve, the weapon would swing to face behind the
           trooper while the shoulders stayed put, and the arms - which
           are IK'd onto the grips - would be dragged straight or
           folded inside the pauldron. That is the exact failure the
           1:1 chest follow was added to prevent, so removing the
           follow without this would simply reintroduce it.

           Below full commitment the shaft eases back to a low-ready
           carry along the BODY's own facing, tipped slightly down.
           Ballistics are unaffected: shots resolve the camera reticle
           target and converge from the emitter either way, and by the
           time a shot exists the commitment is 1 and the shaft is close
           to that ray. */
        /* A stowed lance does not chase the reticle. Without this the
           weapon would still swing to the camera ray while slung on
           the back, which is both nonsense and a clipping hazard. */
        const commit = clamp01(player.state.aimCommit ?? 1) * (1 - carry.stow);
        if (commit < 0.999) {
          const yaw = player.state.yaw;
          _restDirection.set(
            Math.sin(yaw) * REST_COS, REST_SIN, Math.cos(yaw) * REST_COS
          );
          _aimDirection.lerp(_restDirection, 1 - commit).normalize();
        }
      }
      _aimDirection.transformDirection(_aimParentInverseMatrix);

      _aimDeltaQuaternion.setFromUnitVectors(_aimShaft, _aimDirection);
      root.quaternion.premultiply(_aimDeltaQuaternion);
      root.updateWorldMatrix(true, true);

      carry.record.gripFront.getWorldPosition(_aimPivotAfter);
      _aimPivotAfter.applyMatrix4(_aimParentInverseMatrix);
      root.position.add(_aimPivotBefore).sub(_aimPivotAfter);
      root.updateWorldMatrix(true, true);
    }

    /* ---------------- SHEATHE / DRAW ----------------

       Applied LAST, after the aim solve, and that ordering is the
       whole of it. Run before the aim solve, this blend was faithfully
       laying the lance across the back and then the aim solve - which
       rotates the shaft onto the camera ray about the front grip -
       picked it straight back up and pointed it down the body's
       facing again. Zeroing the aim COMMIT while stowed was not
       enough, because zero commit still solves the shaft onto the
       low-ready direction. The stowed pose is not a kind of aiming,
       so it has to sit outside that solve entirely.

       Drawn in 0.42s, stowed in 0.85s. A weapon that comes out as
       slowly as it goes away feels like a menu; the asymmetry is the
       whole read of "putting it away" versus "needing it now".

       The bulge term keeps it off the body. A straight interpolation
       between "held at the hip" and "slung across the back" passes
       the haft through the ribcage, because that is the short way
       round. `sin(pi t)` peaks mid-travel and vanishes at both ends,
       so it swings the lance out and over the shoulder without
       disturbing either pose it is interpolating. */
    if (sideCarry) {
      const rate = carry.stowWant > carry.stow ? 1 / 0.85 : 1 / 0.42;
      carry.stow = clamp01(carry.stow + Math.sign(carry.stowWant - carry.stow)
        * Math.min(Math.abs(carry.stowWant - carry.stow), rate * dt));
    } else {
      carry.stow = 0;
    }
    if (carry.stow > 0.0001) {
      const t = carry.stow * carry.stow * (3 - 2 * carry.stow);
      const bulge = Math.sin(Math.PI * carry.stow);
      _stowEuler.set(STOW_ROT.x, STOW_ROT.y, STOW_ROT.z + bulge * 0.34);
      _stowQuaternion.setFromEuler(_stowEuler);
      root.quaternion.slerp(_stowQuaternion, t);
      root.position.set(
        lerp(root.position.x, STOW_POS.x, t) - bulge * 0.14,
        lerp(root.position.y, STOW_POS.y, t) + bulge * 0.18,
        lerp(root.position.z, STOW_POS.z, t) + bulge * 0.20
      );
      root.updateWorldMatrix(true, true);
      /* The hands let go LATE, across the second half of the travel.
         Releasing from 0.18 had them back at the hips by the time the
         lance was a third of the way over, so it spent most of the
         animation flying to the trooper's back on its own. Holding on
         until 0.34 means the arms visibly lift it over the shoulder
         and let go near the top of the arc, which is where a person
         lets go of something they are putting on their back. */
      carry.handRelease = clamp01((carry.stow - 0.34) / 0.40);
    } else {
      carry.handRelease = 0;
    }

    /* The chain is authored down weapon-local -Y. Once the shaft is
       vertical that axis would point sideways unless the censer gets
       its own gravity pivot. Counter the live weapon world rotation
       through the same smooth stow blend: drawn remains exactly as
       authored, fully sheathed hangs straight down, and reversals are
       continuous during jetpack ignition. */
    if (carry.record.censer) {
      const gravityBlend = carry.stow * carry.stow * (3 - 2 * carry.stow);
      if (gravityBlend > 0.0001) {
        root.updateWorldMatrix(true, false);
        root.getWorldQuaternion(_censerParentWorldQuaternion);
        _censerGravityQuaternion.copy(_censerParentWorldQuaternion).invert();
        carry.record.censer.quaternion.identity()
          .slerp(_censerGravityQuaternion, gravityBlend);
      } else {
        carry.record.censer.quaternion.identity();
      }
    }
  }

  return {
    group,
    bus,
    patterns: PATTERNS,
    build,
    cloneVisual,
    equip,
    setMode,
    fire,
    flashMuzzle,
    vent,
    resupply,
    setHeat,
    addHeat,
    coolHeat,
    // Short alias for doctrine code that reads as an action.
    cool: coolHeat,
    snapshot: snapshotState,
    restore: restoreState,
    spread,
    update,
    carry,
    /** The limiter, for the HUD and for tests. */
    heatState() {
      if (!carry.record) return null;
      return {
        heat: Number(carry.heat.toFixed(4)),
        overheated: carry.overheated,
        venting: carry.venting > 0,
        // A lance cannot cook, so the readout has nothing to say
        // about the rite that is actually in the trooper's hands.
        melee: !!carry.record.spec.melee,
      };
    },
    setAds(v) { carry.ads = clamp01(v); },
    /** Ask for the lance to be slung or drawn. The travel is animated
     *  from here; callers may set this every frame. */
    setStow(on) { carry.stowWant = on ? 1 : 0; },
    /** Move the slung pose without a rebuild. The lance has to clear a
     *  wing that sweeps outboard when folded and rearward when
     *  deployed, so the two states pull the position in different
     *  directions and finding a spot that satisfies both is a search,
     *  not a calculation. Tuning it one edit-and-relaunch at a time
     *  cost about two minutes per candidate. */
    setStowPose(pose) {
      if (!pose) return { ...STOW_POS };
      for (const k of ["x", "y", "z"]) {
        if (typeof pose[k] === "number") STOW_POS[k] = pose[k];
      }
      return { ...STOW_POS };
    },
    /** True once the lance is committed to the back rather than in
     *  transit - the point past which firing has to draw it first. */
    get stowed() { return carry.stow > 0.5; },
    get stowPhase() { return carry.stow; },
    get current() { return carry.record; },
    stats() {
      let tris = 0;
      if (carry.record) {
        carry.record.root.traverse((o) => {
          if (!o.isMesh) return;
          const g = o.geometry;
          tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
        });
      }
      return {
        patterns: Object.keys(PATTERNS).length,
        equipped: carry.key,
        mode: carry.record ? carry.record.mode : null,
        triangles: Math.round(tris),
        ads: Number(carry.ads.toFixed(2)),
      };
    },
  };
}
