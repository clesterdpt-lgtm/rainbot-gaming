# 96 — SAINTFALL: the pale Winnower, the looping Winnower intro, and what the Distaff actually looks like

Three reports from one play session — "the Winnower is bugged", "the
player gets stuck in the intro screen on the Winnower", "the Distaff is
not rendering the full model" — plus a fourth, a grid of dark lines over
the whole map, which is diagnosed but not fixed. Every one of them was
photographed by the reporter, and every one of them turned out to be a
thing a harness had been passing on.

## The Winnower was a pale, leopard-spotted insect. It is a burnt one.

`assets/js/saintfall/winnower.js`. Since the boss AAA pass the shell has
rendered pale tan with dark blotches — measured, the abdomen sat at a
centre-box brightness of 99 against a *no-emissive* floor of 8.5, and the
Aug‑16 approval render of the same animal is near-black char with ember
vents. Not intermittent: the reporter's "it loaded properly this time" is
the **stoke** phase, when the furnace banks and `wnH` drops.

Found by bisecting the compiled fragment shader in the page rather than
by reading it — patching one term at a time through `onBeforeCompile`
and re-shooting the same pose:

| ablation | abdomen |
|---|---|
| albedo forced to `vec3(0.02)` | 99 (unchanged — **not albedo**) |
| diffuse lighting removed | 99 (unchanged) |
| all emissive removed | 8.5 |
| the one line `wnC * wnGlow * uWnHeat.y` removed | 10 |
| `wnCore` gated on `wnHot` instead of the vent bleed | **9.9** |

`wnCore` had been moved late in the AAA pass from the crisp painted mask
`wnHot` onto `wnVent`, the bake's *distance-to-nearest-vent* field, to
soften a hard polygon boundary at the vents. The trouble is a fact about
this model no shader term can argue with: COLOR_0 paints a vent between
nearly every pair of plates. **4019 of 16 992 vertices** pass the furnace
test, spanning x −12..12 of a 13 m half-span, and **80% of the body's
vertices sit within `VENT_REACH` (1.1 m) of one.** The bleed is ~1
everywhere, so the whole shell emitted furnace orange at 40–76% of vent
strength and the coarse mottle carved the only variation — the spots.

Fix: the emissive core gets its own bleed field, `wnVentGlow`, two
powers narrower and a tenth the weight, on the previously unused
`uWnOccl.w` (0.12) so it stays a shoot-time knob; the wide `wnVent`
keeps its albedo/roughness/rim jobs untouched. Abdomen 99 → **19**,
sacs still the brightest thing on the animal, wings dark. Also fixed:
`bakeShellFields` read the colour attribute's raw `Uint16Array` — 0..65535
against a 0.5 threshold — and seeded 604 faintly warm shell vertices as
vents the shader itself never lights. It reads through the accessors now.

`saintfall-winnower-fight` is 33/38 before and after — the five failures
are identical at clean HEAD (the abandon leash and the airborne kill,
both pre-existing).

## The intro loop: a boss that wakes from outside its own arena

Reproduced exactly: stand 6 m outside the Censer Works' 98 m arena ring
but inside the Winnower's 78 m aggro (its perch is 32 m off the site
centre, so its wake radius reaches 12 m past the ring). In 40 s: **8
aggros, 8 arena resets, 9 camera takes, camera held for 39.9 s**, still
held at the end. The alert takes the free camera and the player's hands;
the moment it hands back, the fight is "active with the player outside
the ring", which is precisely the reset condition; the reset re-arms the
reveal; the player is still inside aggro; it wakes again. There is no
way to walk out of it because the camera is holding you.

The Stylite has the same geometry (78 m wake, 96 m ring, off-centre
needles). So does the generic controller's Coulter (spawned 163 m from
its site with a 215 m wake against a 285 m ring). One rule, in one place,
fixes all of them: **a district boss may only wake for a player inside
its arena ring** — `districtBosses.insideArena(key)`, called from the
Winnower's, the Stylite's and the generic dormant checks. Re-run: 10 s
outside → 0 wakes; step in → exactly 1 wake, camera handed back after
the 4.8 s alert, 0 resets, full fight cycle.

`saintfall-encounter-intro.mjs` had encoded the opposite contract — an
alert from 106 m, checked at 4.82 s, the exact second the alert ends and
one frame before the first reset. It now waits outside for three
seconds and asserts nothing wakes, steps in, and counts camera takes over
the following thirty. **10/10.** And `saintfall-district-hunt-probe`,
which had two Coulter arena failures at clean HEAD, is **33/33** — the
same geometry.

## The Distaff renders completely

Reproduced the reporter's exact framing (41 m out on the crater floor,
standing phase): legs in an "M", a small disc at the apex, a huge black
slab behind. Then raycast every one of those black pixels: **none of
them hit the Distaff.** The disc is the abdomen seen down its own axis
behind the head — the animal always faces you, so from the floor it is
end-on — and the slab is the crater's buried lance (`scar-iron`, world.js
"what made the crater"), 34 m of iron whose shadow side renders at sRGB
**8,7,10**, standing 17 m behind the lair on the natural approach. Legs,
a disc, and a void: it reads as a missing body, and it is not one.

Nothing changed here. Two design levers, either of which is the
reporter's call, not mine: lift the lance's darkest ramp stop (`#120d10`;
the same "a rock nobody lit reads as a hole cut in the desert" reasoning
art.js already applied to `rockShade`), or site the lair so the boss is
not silhouetted against the lance from the west. Two red herrings ruled
out with numbers on the way: raising the occlusion bake floor 0.28 → 0.5
and lifting the belly paint half a stop each changed the "slab" by 0.1 —
because it was never the boss.

## The grid over the ground — diagnosed, not fixed

Reproduced hard on a cliff face: a plaid of dark horizontal and vertical
lines at fixed screen positions, sliding with the camera, absent from the
sky. `render.setAo(0,0)` removes it completely — **9.32 code values mean,
75 peak** — so it is the screen-space occlusion pass, whose own comment
already recorded "faint bands" twice and dismissed them at 0.78 code
values measured on distant sand. Two real defects found in it: the pass
runs at half resolution over a full-resolution depth texture, so `dFdx`
/`dFdy` step an inconsistent number of depth texels and the reconstructed
normal is garbage on a fixed grid; and its sample UVs land exactly on
depth-texel boundaries. Fixing both (explicit one-texel differencing,
texel-centre snapping) measured **1.131 → 0.973** column-ripple sd on
the cliff against an AO-off floor of 0.293 — real, small, not the
dominant term. Also excluded, each by direct trial: the jitter hash
(interleaved gradient noise: 0.968), MSAA on the scene target (0.960),
dynamic resolution (clean at 0.62), and shadow bias (a `normalBias` sweep
0.35 → 1.8 moved nothing). The render.js change is **not shipped** — a
map-wide AO change that does not fix the symptom is worse than a note.
Whoever picks this up: the dominant fixed-grid term is still in the AO
pass, and it is not any of those four.

## Verification

| harness | before | after |
|---|---|---|
| `saintfall-encounter-intro` | 8/8 (window too short) | **10/10** |
| `saintfall-district-hunt-probe` | 31/33 | **33/33** |
| `saintfall-winnower-fight` | 33/38 | 33/38 (identical, pre-existing) |
| `saintfall-stylite-fight` | 32/33 | 32/33 (identical, pre-existing) |
| the reveal-loop probe (40 s at the ring edge) | 8 reveals, camera 39.9 s | 0 wakes outside; 1 inside; 0 resets |

Build pin `20260817-boss-render-intro-1`.
