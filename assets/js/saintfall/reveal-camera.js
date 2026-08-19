/* ============================================================
   SAINTFALL - boss reveal camera solver

   Every boss intro hands the camera to an AUTHORED vantage: a fixed
   offset from the animal, chosen on a flat map so the shot is the
   same from every approach. The map is not flat. The Choir's needles,
   the Censer stacks, the Glass Scar's lance and shards, the Bloom's
   leaning spires and the Reach's ridges all stand between some of
   those vantages and the thing they were meant to frame, and a
   reveal that opens on the back of a rock is a reveal of nothing.

   So the authored position is a PREFERENCE rather than an order. It is
   tested first, by casting rays through the collision grid - terrain
   and every rasterised structure - from the candidate lens to a
   handful of points on the animal's body. If enough of them arrive,
   the authored shot is used exactly as written. If not, the solver
   walks a fan of alternatives around the animal at the same range and
   height, then higher, then nearer and farther, and takes the first
   that sees the body; failing even that, the one that sees most of
   it. The author's intent survives wherever it was possible, and the
   boss is on screen wherever it was not.

   The grid is the right witness because it is the same thing the
   shots and the walking use: anything that would stop a bolt stops
   the view. Bosses are not in it (they move), so a ray to the animal
   never stops on the animal itself; light cards and runtime meshes
   are not in it either, and they are the things a camera may look
   through anyway.
   ============================================================ */

/* The fan: yaw offsets from the authored bearing, nearest first, so a
   small correction beats a large one. 180 last - it is a different
   shot, and only taken when every nearer one is blocked. */
const YAW_FAN = [0, 0.42, -0.42, 0.85, -0.85, 1.3, -1.3, 1.8, -1.8,
  2.3, -2.3, 2.75, -2.75, Math.PI];
/* Extra height, in metres, tried at each bearing. Raising the lens is
   the cheapest way past low scenery and it keeps the authored bearing. */
const LIFT_FAN = [0, 5, 11, 20];
/* Range scale, tried last: a longer shot clears a near occluder, and a
   shorter one ducks under an overhang. */
const RANGE_FAN = [1, 1.35, 0.72, 1.8];

/**
 * Fraction of body samples visible from `cam`.
 *
 * `samples` are world points on the animal. A ray from the lens to
 * each is stepped through the collision grid, stopping a metre short
 * of the sample so the animal's own ground (a pit floor, a spire
 * crown, a collar) is never mistaken for an occluder.
 */
export function revealClearFraction(ctx, cam, samples) {
  const collide = ctx.collide;
  if (!collide?.rayBlock || !samples.length) return 1;
  let clear = 0;
  for (const s of samples) {
    const dx = s[0] - cam[0];
    const dy = s[1] - cam[1];
    const dz = s[2] - cam[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1.5) { clear += 1; continue; }
    const reach = Math.max(0.5, len - 1.0);
    const hit = collide.rayBlock(cam[0], cam[1], cam[2],
      dx / len, dy / len, dz / len, reach, true);
    if (!(hit < reach)) clear += 1;
  }
  return clear / samples.length;
}

/** Is a point inside rasterised masonry, by either grid? */
function insideSolid(collide, x, y, z, margin = 0.6) {
  const c = collide.cellAt?.(x, z);
  if (c && c.lo - margin <= y && y <= c.hi + margin) return true;
  const spans = collide.flightCellAt?.(x, z);
  if (spans) {
    for (let i = 0; i < spans.length; i += 2) {
      if (spans[i] - margin <= y && y <= spans[i + 1] + margin) return true;
    }
  }
  return false;
}

function groundAt(ctx, x, z) {
  const g = ctx.collide?.groundHeight?.(x, z);
  if (Number.isFinite(g)) return g;
  const t = ctx.terrain?.heightAt?.(x, z);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Points on the animal worth seeing: the aim point, the top and the
 * base of the body, and the two flanks as seen from the lens. Five
 * rays is enough to tell "framed" from "a leg showing past a pillar"
 * without costing anything at a once-per-fight call site.
 */
export function bodySamples(target, cam, halfHeight = 3, halfWidth = 2.5, minY = -Infinity) {
  const [tx, ty, tz] = target;
  const vx = tx - cam[0];
  const vz = tz - cam[2];
  const vl = Math.hypot(vx, vz) || 1;
  // Screen-right in the ground plane: perpendicular to the view.
  const rx = vz / vl;
  const rz = -vx / vl;
  const low = Math.max(minY, ty - halfHeight * 0.8);
  return [
    [tx, ty, tz],
    [tx, ty + halfHeight, tz],
    [tx, low, tz],
    [tx + rx * halfWidth, ty + halfHeight * 0.15, tz + rz * halfWidth],
    [tx - rx * halfWidth, ty + halfHeight * 0.15, tz - rz * halfWidth],
  ];
}

/**
 * Choose a reveal camera position.
 *
 * @param ctx       the game context (collide, terrain, player)
 * @param options.target      [x,y,z] the point the lens looks at
 * @param options.preferred   [x,y,z] the authored lens position
 * @param options.halfHeight  half the body's height, metres (default 3)
 * @param options.halfWidth   half the body's width, metres (default 2.5)
 * @param options.minClear    fraction of samples that must be seen for
 *                            a candidate to be accepted outright (0.8:
 *                            four rays of five)
 * @param options.minHeight   lens height above ground, metres (1.6)
 * @param options.floorY      lowest body sample worth testing (the
 *                            animal's floor) - samples below are lifted
 *
 * @returns {{pos:number[], clear:number, authored:boolean, tried:number}}
 */
export function solveRevealCamera(ctx, options) {
  const target = options.target;
  const preferred = options.preferred;
  const halfHeight = Number.isFinite(options.halfHeight) ? options.halfHeight : 3;
  const halfWidth = Number.isFinite(options.halfWidth) ? options.halfWidth : 2.5;
  const minClear = Number.isFinite(options.minClear) ? options.minClear : 0.8;
  const minHeight = Number.isFinite(options.minHeight) ? options.minHeight : 1.6;
  const floorY = Number.isFinite(options.floorY) ? options.floorY : -Infinity;
  const collide = ctx.collide;

  const evaluate = (cam) => {
    if (!cam.every(Number.isFinite)) return -1;
    const ground = groundAt(ctx, cam[0], cam[2]);
    if (cam[1] < ground + minHeight) cam[1] = ground + minHeight;
    if (collide && insideSolid(collide, cam[0], cam[1], cam[2])) return -1;
    return revealClearFraction(ctx, cam, bodySamples(target, cam, halfHeight, halfWidth, floorY));
  };

  let tried = 0;
  const first = [preferred[0], preferred[1], preferred[2]];
  const firstClear = evaluate(first);
  tried += 1;
  if (firstClear >= minClear) {
    return { pos: first, clear: firstClear, authored: true, tried };
  }

  /* The authored shot's geometry, kept through the fan: its bearing
     from the animal, its range, and its height over the ground it
     stands on (not over the animal - a lens on a dune wants the same
     dune clearance wherever the dune is). */
  const ox = preferred[0] - target[0];
  const oz = preferred[2] - target[2];
  const range = Math.max(6, Math.hypot(ox, oz));
  const bearing = Math.atan2(ox, oz);
  const lift = preferred[1] - groundAt(ctx, preferred[0], preferred[2]);

  let best = { pos: first, clear: Math.max(0, firstClear), authored: false, tried };
  for (const rs of RANGE_FAN) {
    for (const dh of LIFT_FAN) {
      for (const dy of YAW_FAN) {
        if (rs === 1 && dh === 0 && dy === 0) continue;   // the authored shot
        const a = bearing + dy;
        const cx = target[0] + Math.sin(a) * range * rs;
        const cz = target[2] + Math.cos(a) * range * rs;
        const cam = [cx, groundAt(ctx, cx, cz) + Math.max(minHeight, lift) + dh, cz];
        const clear = evaluate(cam);
        tried += 1;
        if (clear > best.clear + 1e-6) best = { pos: cam, clear, authored: false, tried };
        if (clear >= minClear) {
          best.tried = tried;
          return best;
        }
      }
    }
  }
  best.tried = tried;
  return best;
}

/**
 * The one call every intro makes: solve, then hand the camera over.
 * Returns the solution so a caller (or a harness) can see whether the
 * authored shot survived.
 */
export function revealCamera(ctx, options) {
  const solved = solveRevealCamera(ctx, options);
  const fov = options.fov || 48;
  ctx.player?.setFree?.(true, solved.pos, options.target, fov);
  /* The last decision, kept where a harness can read it: which boss,
     whether the authored shot survived, and how much of the body the
     chosen lens could see. `saintfall-boss-intro-visibility.mjs`
     compares this against what the renderer actually drew. */
  revealCamera.last = {
    label: options.label || "boss",
    target: [...options.target],
    preferred: [...options.preferred],
    ...solved,
  };
  revealCamera.history.push(revealCamera.last);
  if (revealCamera.history.length > 32) revealCamera.history.shift();
  return solved;
}
revealCamera.last = null;
revealCamera.history = [];
