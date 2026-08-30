# 98 — SAINTFALL: three roads, and the numbers a tier may not touch

Milestone 93 made the lance viable; the game then read as easy overall, and
the obvious fix — a difficulty setting that "makes it harder" — carried the
obvious risk of undoing 93, because a hard mode that scales *damage* is a
melee tax. This milestone adds three tiers built on a rule about which
numbers a tier is allowed to move, and gates the rule with the same probe
that measured the gap in the first place.

> "Enemy damage is a melee tax. Enemy health is a ranged tax."

---

## The rule, from the probe

`scripts/saintfall-melee-duel-probe.mjs` runs a Volley bot and a lance bot
against the same rosters. Where each build's health goes is not symmetric:
the rifle loses health only to Gleaner bolts (the swarm dies at twenty-five
metres and 8.6 m/s outruns 7.4), the lance loses it to Gleaner fire while
pinned and to the one armoured Harrow bite per kill. So, per axis:

| axis | who pays | tier use |
|---|---|---|
| enemy damage | almost only melee — at range nothing touches you | moves least |
| enemy health | mostly ranged — the lance one-shots the light caste at any health (`Math.max(dmg, health)`); the Volley loses its frontal one-shot above 62 | the melee-neutral axis |
| roster size, wave pace, Thresher speed | ranged — the slot cap bounds the lance's incoming bites at two a second whatever the crowd; a Thresher past 8.6 m/s cannot be kited | the pressure axis |
| Gleaner accuracy | both, evenly | moderate |
| Gleaner *count* | melee more — it is fired on while pinned | **not** a Martyr lever (measured: +1 killed the naive lance in Breaker Brood while the rifle cleared) |
| Volley heat | ranged only, and costs no health — a vent mid-wave is a 2.4 s lockout with the pack arriving | clean |
| melee sustain | scales with damage so bites paid per kill hold | tracks `incoming` |

Three things a tier never moves, because they are the lance's *skill floor*
rather than its difficulty: the tell durations (a Thresher wind-up under the
opener's 0.31 s makes the pounce un-pre-emptable), the first-contact hold,
and the post-hit grace. Hard is more to read, not less time to read it.

## The table

`assets/js/saintfall/difficulty.js` — module scope, like render.js's
`QUALITY`; `ctx.difficulty` is a tiny live-state holder every consumer reads
at the point of use, so a change in either menu takes effect next frame.

| | Pilgrim | Penitent | Martyr |
|---|---|---|---|
| incoming damage (all sources, once, in `hurtPlayer`) | 0.82 | 1.0 | 1.35 |
| light-caste health (Thresher, Gleaner) | 0.85 | 1.0 | 1.6 (Thresher 96: two rounds even on the head; one lance sweep) |
| heavy / boss health (heavy moves less — every extra sweep is an armoured bite) | 0.85 | 1.0 | 1.2 / 1.4 |
| **garrison** size per site (the field) | 0.85 | 1.0 | 1.6 |
| **alert radius** (one waking creature wakes neighbours) / sight | 42 m / 1.0 | 42 m / 1.0 | 67 m / 1.2 |
| breach roster × (never the ranged caste), cycle pace | 0.8, ×1.25 slower | 1.0 | 1.7, ×0.55 (first warning 99 s, intermission 33 s) |
| Gleaners: roster factor / delta / direct-aim / burst | 1.0 / −1 / 0.32 / 3 | 1.0 / 0 / 0.42 / 3 | 1.0 / 0 / 0.46 / 3 |
| Thresher charge / pounce commitment | 0.9 / 1.0 | 1.0 / 1.0 | 1.35 (10.0 m/s) / 1.2 (9.0 m/s — a straight backpedal no longer works) |
| Volley heat per shot | 0.88 (34 rounds) | 1.0 (30) | 1.5 (20) |
| melee slot cap | 2 | 2 | 3 |
| kill-heal / regen rebate | ×1.0 | ×1.0 | ×1.8 |
| regen delay / rate | 4.5 s / 10 | 5.5 s / 10 | 8.0 s / 7 |

Penitent is the tier the game is tuned at, with one nudge: the ordinary
castes' base damage multiplier goes 0.82 → 0.85 (`SURVIVAL_CONFIG`), because
the discount that softened unreadable bites is mostly unneeded now that
every bite is a tell.

## Where it lands

- **combat.js** — `hurtPlayer` multiplies once by `incoming` before the plate
  sees the number; `regenAt` uses the tier's delay; `beginStrike` reads the
  slot cap; `launchEnemyProjectile` reads the direct-aim chance; Thresher
  charge and pounce go through `chargeSpeed()`; kill-heal and rebate scale by
  `sustain`.
- **enemies.js** — `spawnHealth()` scales at spawn (breach `healthScale`
  multiplies through); `restore()` passes `exactHealth`, because a saved pool
  was scaled when it was first spawned; `rescaleForDifficulty()` re-fits every
  live pool proportionally on a tier change, so the garrison spawned at boot
  is never left on the old numbers and a wounded creature stays wounded by
  the same fraction.
- **breaches.js** — `tieredCount()` for rosters, `paced()` for the timers.
- **weapons.js** — heat per shot × tier, alongside the Gilding boon.
- **save.js** — the snapshot records `difficulty`; the validator accepts it
  as *optional* (a pre-tier save keeps the live tier — see the notes on
  fields every restore treats as optional); `restoreSnapshot` sets the tier
  **before** the roster is rebuilt, so the rescale runs against the old
  roster and the restored pools stay exact.
- **ui.js / intro.js** — settings key `difficulty`, a segment row above
  GRAPHICS QUALITY in both menus that highlights the LIVE tier (a
  `?difficulty=` URL is a session override; a loaded save sets the tier from
  the file and stores it as the preference, so a new road starts where the
  last was walked); `readStoredSettings()` exists so main.js can know the
  tier before the garrison spawns.
- **qa.js** — `difficultyState()`, `setDifficultyForQA(tier)`.

## What it measures

`--tiers all` runs the duel three times in one session, applying each tier's
roster arithmetic to the breach rosters, and gates per tier: a lance play
survives every roster the Volley clears with a margin (≥ 20 HP left — a
rifle that scrapes through has met a wall too); the lance-to-Volley HP-lost ratio over
W3+W4 stays within 1.6× of Penitent's (denominator floored at 60 HP —
below that the Volley is untouched and a ratio says nothing); Martyr is
measurably harder and Pilgrim measurably gentler for both builds together,
and gentler for each.

Bot results — and the bots are the *floor*, not the player: they stand
still under fire (the lance) or retreat with perfect aim (the rifle), and
neither uses boost, cover, Aegis or a stratagem. A tier that only just kills
them is a nudge for a person, which is exactly what the first Martyr turned
out to be ("still very easy on the hardest mode"). The second Martyr is a
step (W3+W4 pressure roughly doubles); the tables are filled in from the
final `--tiers all` pass in the report JSON.

On Martyr the rifle bot becomes nearly untouchable: it kills each 96-HP
Thresher in 0.44 s — inside the 0.35 s first-contact hold — and never stops
moving, so bolts miss. Zero tells begin against it. That is a bot artefact
(nobody lands four rounds on every arriving Thresher), so the parity claim
on a hard tier is carried two ways, either sufficient: the lance-to-Volley
ratio within 1.6× of Penitent's where the rifle is meaningfully engaged, or
the lance's **cost per kill** growing no faster than the tier's damage
multiplier ×1.3 (count, health and speed must not have multiplied the
lance's price). The survival gate binds only where the rifle never dropped
below 40 HP. Human playtest is the arbiter of Martyr's absolute level; the
table is one column of edits either way, and if the rifle reads as too safe
on Martyr in play, `pounce` (retreat tax) and `heat` are the rifle-only
levers.

## Traps

- **Calibrating a tier to what the bots survive under-tunes it for a
  person.** The first shipped Martyr (incoming 1.20, roster 1.2, aim 0.46,
  Thresher 78) was tuned so the probe's bots cleared Breaker Brood; it
  played as a ~15 % nudge and was reported as "very easy on the hardest
  mode". Bots stand still under fire and never boost, guard, take cover or
  call a stratagem - a person is far above them. Use the bots for the
  *parity* claim (the ratio) and for regression, not for the absolute
  level; and give a hard tier the field (garrison ×1.6, alert radius 67 m,
  sight ×1.2), because the field is most of the road and no wave knob
  touches it.
- **Three of the knobs I first raised on Martyr were melee-only taxes.** A
  slot cap of 4 only ever binds on the trooper the pack has reached (the
  lance); Gleaner burst 4 / aim 0.55 / an extra Gleaner shredded the pinned
  lance in 4.6 s while the rifle cleared from 65 HP; heavy health ×1.35 is
  an armoured bite per extra sweep. All three moved back. Martyr's step
  comes from the swarm's size and health, its speed, the field, heat and
  regen — the ranged taxes — with the lance's sustain raised to 1.8.
- **+1 Gleaner reopened the gap.** With it, the naive lance died in Martyr
  W3 (155 of 187 HP to bolts) while the rifle cleared. Gleaner *count* is
  the one axis the lance pays more for; it stays a Pilgrim relief and not a
  Martyr tax — and the roster multiplier must not touch it either: ×1.2 had
  quietly turned Crowned Surge's three Gleaners into four (168 HP of bolts
  on the pinned lance). `tieredCount()` scales every caste but the ranged
  one; `gleanerDelta` is that caste's only knob.
- **A ratio against an untouched rifle is noise.** Pilgrim's Volley lost 15
  HP over two waves; melee/15 read as 6× and failed a gate that had nothing
  to say. Floor the denominator (60) and gate Pilgrim on absolute "gentler
  for each build" as well.
- **The tier must be known before the garrison spawns**, which is before
  the menu that owns the settings store exists — hence `readStoredSettings()`
  read at boot; and a tier change must rescale LIVE pools or the boot
  garrison keeps the old numbers.
- **Restore re-spawns through `spawn()`.** Without `exactHealth` a Martyr
  save would double-scale on load.
- The Gleaner fall-back check must measure horizontal centre distance, not
  the bolt event's muzzle-to-eye distance — the spinneret is 0.92 m forward
  and a legitimate shot from 10.0 m read as 9.4.
- Bosses whose modules own their own pools (Abbess, Distaff legs, the
  Winnower's lift) do not scale with `bossHealth` yet; the ones that use
  `inst.health` do. Documented, not hidden.
