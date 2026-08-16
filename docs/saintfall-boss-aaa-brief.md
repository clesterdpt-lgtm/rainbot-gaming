# SAINTFALL — boss AAA brief

Read this before touching a boss. It is the contract every agent in this
programme works against.

## The goal, stated so it can be failed

Every boss in SAINTFALL must survive a **blind side-by-side against a real
original-Xbox Halo frame** — Halo: Combat Evolved (2001) and Halo 2 (2004),
running on the hardware they shipped on. Not "looks nice for a browser game".
A harsh critic is shown two panels, told nothing about which is which, and
asked which one they would rather ship. Ours has to win, or at minimum tie,
and the critic has to say why in terms of surface, light, silhouette and
weight.

The reference pool lives in `output/reference/halo/` (gitignored, local review
only — fetched by `scripts/saintfall-fetch-refs.mjs`).

## The measured gap, as of the baseline

Look at `output/reference/halo/halo-08.jpg` (a Halo CE Hunter, mid-fight) next
to any boss shot we had before this programme started. The 2001 frame beats us
on five axes, and every one of them is fixable:

| axis | Halo CE, 2001 | SAINTFALL baseline |
| --- | --- | --- |
| **surface** | painted plate: mottling, grime, wear along edges, visible pores | nothing. Untextured. Flat vertex colour, one value per facet |
| **specular** | wet sheen rolling across the Hunter's armour, hue-shifted toward violet | none. Every boss is uniform matte |
| **value range** | near-black creases to blown highlights in one frame | a narrow mid band. Ours never gets dark and never gets bright |
| **colour separation** | blue creature, grey-green architecture, orange fire — three families | one hue. Boss, sand and sky are all the same orange |
| **grounding** | contact shadow, occlusion where plate meets plate | a shadow blob, no cavity, no contact |

Every boss `.glb` in `assets/models/saintfall/` carries
`POSITION, NORMAL, COLOR_0, JOINTS_0, WEIGHTS_0` — **no UVs, no textures, zero
images**. That is the single biggest reason we read as a prototype and Halo
reads as a game. Triangle counts (9k–13k for a boss) are already in the
Xbox-era band and are **not** the problem. Do not solve this by adding
geometry.

## What is NOT up for change

- **Faceting is art direction.** "Everything in SAINTFALL above the sand is
  faceted, and a smooth-shaded enemy reads as belonging to another game"
  (`enemies.js`). Surface detail goes UNDER the facets — sub-facet grain,
  cavity, gloss breakup. If your change smooths the silhouette shading into
  a soft blob, it is wrong even if it looks detailed.
- **No new asset downloads, no new external hosts.** Everything procedural,
  generated at load, seeded from `ctx.seed`. Same rule as the rest of the site.
- **No UV unwrap, no re-export.** The models are fine. Work in object space
  (triplanar) so nothing needs re-authoring in Blender.
- **`patchMaterial` is the only door into a material.** A material that skips
  it has no aerial perspective and reads as a sticker at range (see the
  `enemies.js` header). Extend the patch path; do not go around it.
- **Budget.** The baseline cost of a live boss fight, measured by
  `scripts/saintfall-boss-audit.mjs`:

  | boss | ms/frame | draws | triangles |
  | --- | --- | --- | --- |
  | Distaff | 3.83 | 146 | 499,704 |
  | Winnower | 3.62 | 120 | 505,952 |
  | Garner | 4.02 | 181 | 569,736 |
  | Abbess | 4.88 | 212 | 717,829 |
  | Stylite | 4.00 | 164 | 524,037 |
  | Coulter | 4.50 | 172 | 558,331 |

  **No boss may exceed 5.6 ms/frame or +24 draw calls over its baseline.** The
  frame is GPU fill-bound already (see `saintfall-performance` notes); a
  shader that samples noise twelve times per pixel will not survive contact
  with a real device even if it looks incredible in a screenshot.
- **A dormant boss costs nothing.** The Stylite's dormant pose solve once cost
  the whole game 1.3 ms/frame and surfaced as the *Abbess's* budget failing.
  Gate expensive work on the fight actually being live.

## The shared surface kit

`assets/js/saintfall/boss-surface.js` is the one place creature surface is
defined. Every boss draws from it; **no boss invents its own**. If you need a
behaviour it does not have, extend the kit and say so in your report — do not
fork it into your own module, or seven bosses end up with seven different
ideas of what chitin is.

## Ownership map — do not edit another agent's files

| agent | owns |
| --- | --- |
| surface | `assets/js/saintfall/boss-surface.js`, the material block in `enemies.js`, `art.js` patch path |
| winnower | `assets/js/saintfall/winnower.js` |
| distaff | `assets/js/saintfall/distaff.js` |
| garner | `assets/js/saintfall/garner.js` |
| abbess | `assets/js/saintfall/abbess.js` |
| stylite | `assets/js/saintfall/stylite.js` |
| coulter | `assets/js/saintfall/coulter.js` |
| apostate | `assets/js/saintfall/apostate.js` |
| harness | `scripts/saintfall-boss-gallery.mjs`, `scripts/saintfall-blind-compare.mjs`, `scripts/saintfall-metric-compare.mjs` |

Shared files (`vfx.js`, `combat.js`, `hud.js`, `audio.js`, `qa.js`) are
**request-only**: if your boss needs a change there, put the exact patch in
your report and the orchestrator applies it. Two agents editing `vfx.js` at
once loses work.

**New module file? Add its name to `MODULES` in `boot.js`**, or browsers serve
a stale cached copy and your fix will look like it did not work. Bump `?v=`
on anything you change (see the cache-busting convention).

## The seven axes a boss is scored on

A boss is not "done" because it has a new shader. Each of these is a separate
question and each has to be answered:

1. **Surface** — does the skin read as a material (chitin, bone, membrane,
   corroded bronze) rather than as painted plastic? Different parts must read
   as *different* materials.
2. **Light response** — specular that moves as the camera moves, cavity that
   darkens creases, edges that catch the sun, a rim that separates it from the
   haze without looking like a sticker outline.
3. **Silhouette** — readable at 120 m as one shape, and readable as *which
   boss it is* from the outline alone. Test with `silhouetteMode`.
4. **Motion and weight** — does mass read? Secondary motion (plates settling,
   antennae lag, flesh jiggle), anticipation before an attack, recovery after,
   footfalls that shake ground and camera in proportion to size.
5. **Physical response** — flinches on hit that respect where it was hit,
   plates that break and stay broken, blood/ichor/dust that lands and stains,
   a death that is a physical event and not a fade.
6. **Encounter drama** — telegraphs a player can read and answer, phase
   transitions you can see from the outside, an entrance and a death worth
   watching twice.
7. **Frame composition** — the boss holds a value and hue separate from
   Vesper-IX's sand. A frame where boss and background are the same orange is
   a failed frame no matter how good the model is.

## The harnesses

```bash
# All bosses, same six framings each, before/after comparable. Writes PNGs.
node scripts/saintfall-boss-gallery.mjs --boss stylite --out output/saintfall/gallery/<name>

# Blind A/B against the Halo pool. Writes A.png / B.png per pair; the key is
# withheld in _key.json, which the critic must not read.
node scripts/saintfall-blind-compare.mjs --ours <dir> --out output/saintfall/blind/<round> --seed 7
node scripts/saintfall-blind-compare.mjs --reveal output/saintfall/blind/<round> --answers A,B,A,...

# Objective: are we inside Halo's measured distribution for contrast, value
# range, chroma spread and edge density?
node scripts/saintfall-metric-compare.mjs --ours <dir>

# Cost. Gates the budget table above.
node scripts/saintfall-boss-audit.mjs

# Everything still works.
node scripts/saintfall-gameplay.mjs
```

## The loop

1. Change one thing that answers a named axis above.
2. Re-shoot the gallery.
3. Run the critic blind. The critic is **hostile by default**: their job is to
   find the tell that says "browser game", and they are told that a tie is a
   loss.
4. If the critic picks the reference, you are not done. Take their stated
   reason, fix that, go to 1.
5. Stop only when the critic, blind, picks ours — and says so for a reason
   about craft, not about taste.
