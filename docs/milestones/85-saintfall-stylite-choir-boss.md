# 85 — SAINTFALL: the Stylite, and the Matriarch's new district

The Choir Spires had a placeholder guardian: the Precentor, an oversized
Thresher on the shared district-boss lifecycle. It is now **the Stylite**,
a leaping insect that fights from the needle crowns and never comes down
on its own. The **Matriarch** it displaced was not retired — she took the
Gilded Reach from the Cantor, which means every district boss in the game
is now either bespoke or a real animal rather than a scaled-up common one.

Roster after this change:

| District | Boss | Driver |
| --- | --- | --- |
| Glass Scar | Distaff | bespoke (`distaff.js`) |
| Censer Works | Winnower | bespoke (`winnower.js`) |
| Ossuary | Garner | bespoke (`garner.js`) |
| Bloom | Abbess | bespoke (`abbess.js`) |
| **Choir Spires** | **Stylite** | **bespoke (`stylite.js`)** |
| **Gilded Reach** | **Matriarch** | shared lifecycle |
| Fallen Saint | Coulter | shared lifecycle |

Two encounters are left on the shared simulation. The Reach is now the
example `saintfall-district-hunt-probe.mjs` measures the shared boundary
machinery on — it has been repointed twice for this reason, and the
comment there says so, because the next bespoke boss will move it again.

---

## The fight

The premise is verticality. The Stylite perches on the real crowns of the
world's Choir needles — `world.js` now publishes `choirNeedles`, and the
module picks the seven tallest within range, offsets each toward the
district centre onto the shoulder of the cone, and stands there. The
lowest crown it uses is 103m; the fight is typically read from about 82m
below.

- **The barrage.** It rakes the ground under it with travelling bolts —
  not hitscan, so you can see where they came from and move.
- **The leap.** A visible coil loads the hind springs, then it launches,
  arcs *above* both crowns (measured peaking at 168m between crowns at
  128m and 112m) and lands on a different needle, often 100m+ away.
- **The stoop.** It drops onto the player's ground, shockwaves, and goes
  straight back up. This is not the melee window.
- **The grip.** This is the fight. Shooting it does not only hurt it — it
  wears through a 900-point grip pool holding it on the rock. Break that
  and it **falls**, takes 420 self-inflicted damage, and lies stunned on
  the sand where a polearm does **2.8×**. A fresh crown restores the grip
  in full, so it has to be broken inside a single perch rather than
  chipped down across several.

Health is 5400 — the lowest of the district bosses — because the fall
does the work: three grip-breaks is the intended length, and each one
costs it the 420 plus whatever the downed window is worth.

---

## Four bugs worth writing down

**The fall landed inside the spire.** `beginPlummet` dropped the animal
straight down. The crowns are the narrow ends of cones fifteen metres
wide at the sand, so a plumb-line fall put it at *zero metres* from the
needle's axis — buried in rock, with the player shoved out by the
needle's collision before they could reach it. Every other promise about
the fall was still true: it fell, it hurt itself, it was stunned and
grounded. It was simply somewhere no player could stand. It now peels off
toward the player and clears `baseRad + 11m`. The harness asserts both
the clearance and that a player can close to melee range *through real
collision*.

**It was invisible.** The carapace deliberately echoes the needles — a
treehopper crest, warm shell on warm sandstone — and photographed from
the flats that worked far too well: four tan pixels on tan rock. The fix
is not repainting the animal, because a Stylite that is obvious while it
sleeps throws away its own reveal. The camouflage **breaks**: dormant it
is rock, roused the ventral plates light up. The seams went on the
**belly**, not the crest, because the crest is the one surface that hides
them from below and below is the only direction this fight is ever
watched from. They report the grip, running from a slow violet idle to a
fast white flicker as it slips, which makes the fall legible from the
ground to a player who cannot read a health bar at ninety metres.

**A dormant boss cost the whole game 1.3ms a frame.** `poseBody` damps
eighteen joints and recursively updates the rig's matrices, and it ran
every frame from level load — while the Stylite sat hidden on a needle
six hundred metres away, during every other district's fight. It never
showed up in this boss's own budget check, which only measures its own
fight. It surfaced as the *Abbess's* chamber going over budget in a
district that has nothing to do with it. The pose is now gated on
`group.visible`, and `saintfall-stylite-fight.mjs` measures the idle cost
directly.

**`snapshot()` wrote a phase the save schema rejects.** `restore()`
correctly refuses to rebuild a leap or a plummet — those are a position
on a curve plus a destination — but the snapshot recorded the live phase
name anyway, so saving mid-jump made `validSnapshot` reject the *entire
file*, with the player's position and mission in it and no indication
that a boss caught in the air was the reason. A snapshot may only ever
contain a state the restore path can actually take.

---

## Files

- `assets/js/saintfall/stylite.js` — new, the whole encounter.
- `assets/js/saintfall/world.js` — publishes `choirNeedles`.
- `assets/js/saintfall/enemies.js` — `stylite` bestiary entry, second
  user of the `procedural: true` capability (no `.glb`; the module
  builds and poses everything).
- `assets/js/saintfall/combat.js` — `HITBOX.stylite`, the `wearGrip`
  hook at the end of the one authoritative damage path, and a melee gate
  that now understands `perches` alongside `flies`.
- `assets/js/saintfall/district-bosses.js` — Choir → `stylite` domain,
  Reach → Matriarch.
- `main.js`, `boot.js`, `save.js`, `audio.js`, `hud.js`, `qa.js`,
  `games/saintfall.html` — the usual wiring.

## Harnesses

- `scripts/saintfall-stylite-fight.mjs` — 33 checks.
- `scripts/saintfall-stylite-shots.mjs` — nine stills. Its camera picks
  its own bearing by clearance against the crowns, and prints where the
  subject actually landed on screen, because a shot can be perfectly
  composed on paper and photograph an empty sky.
- `scripts/saintfall-boss-audit.mjs` — Stylite added.
- `scripts/saintfall-district-hunt-probe.mjs` — repointed to the Reach.
- `scripts/saintfall-matriarch-fight.mjs` — repointed to her district
  role. It had been crashing since encounter bosses left the wave
  roster, on a `waves.find(w => w.bossKey === "matriarch")` that came
  back undefined.

Measured against the others, one session, same axes:

```
boss        ms/frame  draws   triangles   maxHP
Distaff       4.44     147      507056    9000
Winnower      3.98     120      505952    6200
Garner        4.38     181      569736    7400
Abbess        5.31     212      717829   12000
Stylite       4.13     164      524037    5400
Coulter       7.33     172      558331    5200
```

## Known, pre-existing, not from this work

`scripts/saintfall-winnower-fight.mjs` fails 4 of 38 — its leash home and
its death-fall. Verified identical on a clean `HEAD` worktree.
