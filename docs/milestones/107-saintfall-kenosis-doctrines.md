# 107 — Kenosis doctrines: the White Vigil and the Bastion Penitent become heroes

**Build:** `20260829-kenosis-doctrines-1` · **Scope:** the summit level (`games/saintfall-white-vigil.html`) gains full operative kits and a combat layer; every engine edit is additive and defaulted so Vesper-IX resolves to its old behaviour (proved below).

The two Kenosis operatives carried their weapons and could not use them: no fire for the Bastion, no melee for anyone, no block, no abilities, no enemies (`summit-main.js`'s own header said "melee swings still play, they just deal no damage" — and even that was stale: nothing on the level called `meleeSwing`). This milestone gives each operative a complete doctrine of verbs at parity with Vesper's campaign kit — input, refusal reasons, animation, VFX, SFX, HUD, `status()` — and a trials ground to use them on.

## The Doctrine of the Wing — White Vigil, reliquary scout

| verb | input | what shipped |
|---|---|---|
| Crescent volley | LMB (hold) | `summit-discharge` is now a real weapon: 26 dmg/pulse, 46 m/s, 42 m range with falloff past 26 m (floor 0.55), spread 0.030 hip / 0.007 focused, swept per-frame against enemies (`combat.raycastEnemies`), trials targets, masonry and ground; muzzle flash (`vfx.muzzle`), impact sparks, and a per-hand detuned report (`audio.crescentShot`). Headshots and weak points pay through the campaign's own multiplier stack. |
| Focus | RMB (hold) | Raises/converges the guns exactly as firing does (`aimBlend` now follows `ads`) and narrows the cone. |
| Quick blades | F / buffered combo | The shared melee procession (combo, turn slash, lunge, buffering) opened on a weaponless level: `ctx.loadout.meleeSpec` (46 dmg, 1.85 m) is the second door in `player.meleeSwing` and `combat.meleeStrike`, gated on `!ctx.weapons` so a ranged-mode campaign lance still refuses. Runs at **1.30×** tempo (`figure.meleeProfile.timeScale` → `MELEE_TIME_SCALE` scales only `melee*` clip clocks, so hit windows, drive profiles and turn windows keep their authored relationships). Striking-arm swings are kit-authored overlay tracks over the carry, through wrapped loadout `armPose`/`armSwing` hooks. |
| **Vigil Step** | E (tap) | 12 m combat translation on 2 charges, 5.5 s recharge each. Walked through the collision field with `player.drag` — it slides, refuses walls and illegal grades, and a step the world refuses (<1 m) is not paid for. Exit speed floor 9 m/s so arrival keeps momentum. Refusals named: airborne / busy / flight / boost / slam / no-charge / blocked. VFX `vfx.blinkFx` (verdigris implosion → path line → arrival ring + ground seal — deliberately NOT gold, so it reads against every censer in frame); SFX `blinkCast`/`blinkArrive`. |
| Augur pack | Shift+Space | `figure.jetpackProfile` scales the shared config: **maxFuel ×1.30 (130), recharge ×1.25** — the scout's pack is tankage, and the meter is the kit's economy. |
| Movement | — | `locomotionProfile`: walk 4.8, sprint 9.6, accel 4.4, turn ×1.12. (This ends the Vigil/Vesper gait bit-parity noted in the walk-shape work — deliberate.) |

## The Doctrine of the Censer — Bastion Penitent, reliquary bulwark

| verb | input | what shipped |
|---|---|---|
| Reliquary hammer | LMB or F | The same procession at **0.78×** tempo and bulwark numbers (132 dmg, 2.60 m): every blow a bell. Hammer-hand overlay tracks (sweep / rise / crown / turn / lunge); the shield hand holds its wall. |
| **Tower shield** | E (hold) | Installed as the level's `ctx.shield`, so the player controller's shield-walk (2.0 m/s, camera-faced) and `combat.hurtPlayer`'s tryBlock intercept engage without knowing it is not an Aegis. **Unlimited — zero charge drain, no cooldown**; the economics are frontal-only (dot ≥ 0.30, wider than the Aegis' 0.42), no attacking while raised, and slow feet. Perfect window 0.25 s kept (brighter clang, `perfect` on the bus event). Guard raise is a blended arm overlay; impacts pay `vfx.shieldBlock` + `audio.blockImpact` + a doctrine kick. |
| **Hammer Cast** | RMB (tap) | Thor's verb: wind-up clip (`ACTIONS.hammerThrow`, body channels only, release at `throwAt: 0.40`), then the hammer visual (recentred clone of the Meshy prop, hidden from the fist) flies flat at 34 m/s to 46 m, **through** everything on the line — 260 dmg per body (130 on the return pass), pierce, knockback — then homes back at 40 m/s to the live fist and is caught (`hammerCatch` clip, catch slap). Walls and ground end the outbound leg (`collide.rayBlock` in metres — Infinity is CLEAR, a truthy check is a bug). Cooldown 8 s from the cast. While it is away: no melee ("hammer-away"), but the shield still guards — that is the fantasy. Spin is end-over-end about the lateral axis; wake embers at 20 Hz (`vfx.hammerWake`), impacts pay `vfx.hammerImpactFx` + `audio.hammerImpact`. |
| **Anti-air knockdown** | (property of the cast) | `combat.groundFlyer(inst, {stun})` — new export: a `flies` creature in the air is forced down and stunned. The Winnower keeps its own physics (delegates to `forcePhase("stoke")`, which already grounds, sprawls and pays the crash stun — only while soaring); any ordinary flyer gets grounded + dropped + the saturating stun. Demonstrated live on the trials' censer-kites. |
| **Censer leap** | Shift+Space | `jetpackProfile.mode: "leap"` — the pack **cannot fly**: the chord buys one boosted leap (vy 12.6, speed floor 11, cost 22 charge, cooldown 1.9 s), then ballistics; `inFlight` is never set so hover/glide/cruise never exist. Plume fires through the boost-visual path; landing pays a thump. F in the air is the Penitent's Fall (slam.js, now built here). |

## The level around them

- **Combat stack on the summit** (`summit-main.js`): `audio` (first-gesture unlock — no intro exists to do it), `enemies` filtered by the new **`ctx.enemyRoster`** allowlist (thresher/gleaner/harrow — no boss GLBs downloaded), `combat` (+ `playerDied → player.die()`), `boost`, `slam`, the kit, and the trials, in the campaign's own frame order (`kit → discharge → combat → trials → resolveCrowding → enemies`). The mission stub gained `spawn` — `combat.respawn()` reads it unguarded.
- **The Vigil Trials** (`summit-trials.js`): a yard sited at boot 70 m from basecamp on the flattest of eight bearings — outside its own 40 m wake radius, so walking to it is the consent. A cohort (4 threshers, 2 gleaners, 1 harrow) spawns pre-alerted on approach and resets 18 s after being broken. Three **censer-kites** orbit at 8–15 m: lantern drones carrying the `flies` contract (140 hp, crash + floor stun + relaunch) as live anti-air targets. Measured: an idle operative standing in the yard is dead in ~7 s — which is what the **revive flow** is for: this level has no field records, so at `respawnIn ≤ 1.0` (before the death screen's 0.8 s threshold) the trooper is stood back up at basecamp, yard cleared, cohort held.
- **Kit dock** (`summit-hud.js`): vitality, reliquary charge (leap-aware labels), and one row per doctrine verb (step pips ◆◆ / tower shield state / hammer cast cooldown), bottom-left where the campaign keeps vitals; `kitDockState()` for QA. Reticle now shown for the Bastion too — the cast flies at the crosshair.
- **QA** (`summit-qa.js`): `kitState / blink / throwHammer / blockState / trialsState / trialsHandle / spawnTrials / clearTrials / combatStats / kitDockState`.

## Engine edits (all defaulted; Vesper resolves unchanged)

`player.js` — loadout melee door; `MELEE_TIME_SCALE`; `hammerThrow`/`hammerCatch` clips; **`get actionState()`** (the live action record — `player.action` answers only the NAME, and reading `.t` off that string was this milestone's first shipped bug: the release timing and every arm overlay silently no-opped, exactly the optional-chained fail-silent trap).
`combat.js` — melee spec second door; `groundFlyer`.
`jetpack.js` — `figure.jetpackProfile` (effective config built once, so player.js's flight solve and the HUD read the same tank), leap mode + status fields.
`enemies.js` — `ctx.enemyRoster`.
`vfx.js` — `blinkFx`, `hammerWake`, `hammerImpactFx` (no new lights — light count is sacred).
`audio.js` — 8 kit cues in the house 2–3 layer style + silent-API noops.
`summit-player.js` — per-figure `meleeProfile`/`jetpackProfile`/Vigil `locomotionProfile` pass-through.
`boot.js` — new modules in MODULES; also `guard-rules`/`guard-readability`/`campaign-score` added (pre-existing "served with no cache key" audit findings).

## Proof

- **`scripts/saintfall-kenosis-kit-probe.mjs` — 40/40** across both operative boots, zero page errors: leap impulse/no-flight/cost/cooldown/landing; free unlimited frontal block (front blocked for 0, rear lands, 6 s hold with no drain) and its dock state; 0.78×/1.30× melee tempos; cast wind-up → flight → one-blow gleaner kill → return → catch → cooldown refusal; kite felled by the hammer sweep (grounded + stunned + damaged); volley kills a gleaner (6 hits) with the mid-range numbers; blink displacement/charges/refusals/recharge; Augur 130 tank; the yard engages (7 live) and presses a real attack (hp 150→63 in ~3 s); death revives at basecamp.
- **`scripts/saintfall-kenosis-sheet.mjs`** — chase + free plates of every verb (`output/saintfall/kenosis-sheet/`): swings trail their measured crescents, the wind-up coils over the hammer shoulder, the guard reads as a wall from the front, the leap plumes, the blink arrival rings.
- **Campaign regression:** `saintfall-shots --shots hero --page saintfall.html` boots and shoots clean; `saintfall-melee-reticle-probe` **31/31**; import audit clean. (`saintfall-keybind-check` has one failure in the doctrine-cue HUD legend — that element belongs to the concurrent Escape-menu/doctrine-cue work in the uncommitted tree, not this milestone.)
- **Perf:** summit frame with the cohort live + abilities firing measures no worse than idle (5.75 → 4.87 ms CPU, headless, high tier); no lights added, no per-frame material churn.

## The animation pass (same day, from play)

Three faults reported from play, all fixed and re-proved (probe still 40/40):

1. **Swing arcs too small.** The overlay targets were bigger than the arm — a lateral target thrown past the reachable sphere is CLAMPED by the rest-arm solve, and a measured 0.64 m authored sweep arrived as 0.41 m. The tracks are now authored **on the arm's own sphere**: wind-up out-back-low behind the shoulder line, an apex high over it, the carve across the midline at near-full extension (~140° of shoulder travel), with the chest channels carrying the shoulder further. Measured after: Vigil blade −0.62 → **+0.01** lateral (0.63 m) with a 0.52 m rise; Bastion hammer −0.74 → **+0.09** (0.83 m) rising to **1.62 m** at the apex. Measure arcs with a body-frame palm-trajectory probe, not stills — a single instant of a bigger arc can photograph smaller.
2. **The guard tilted the shield skyward.** The shield is welded into the palm, so raising the hand let the wrist's rest solve pitch the plate with the forearm. The guard now HOLDS the palm's basis: captured every un-guarded frame in yaw-local space (so it tracks the live carry), played back rotated to the current body yaw through a kit wrap of `ctx.loadout.handBasis`, blended by the guard's own weight. The offset also moved to the midline (out −0.145 vs −0.045) with a smaller lift (0.16 vs 0.27) — height never buys attitude now.
3. **The thrown hammer was giant.** The mounted prop's local scale carries a ~100× compensation for the centimetre armature (0.01 world scale) it hangs under; cloning it into a bare scene group kept the local number and flew a ten-metre monument. `getWorldScale` of the mounted asset is the truth — the clone copies that.

## The swing pass (round 2, from play)

"Neither swings with a big enough arc; the hammer should out-swing the blades; the VFX should follow the animation" — plus a rebind. All measured by a new instrument, `scripts/saintfall-kenosis-arc-probe.mjs` (**12/12**), which walks each clip at 24 samples and tracks the **weapon tip** in the body frame, because that is the thing a player watches:

| clip | Vigil tip path | Bastion tip path | lateral (V / B) | top height (V / B) |
|---|---|---|---|---|
| melee1 | 5.12 m | **7.73 m** | 1.60 / 2.40 | 1.95 / 2.57 |
| melee2 | 4.66 m | **8.18 m** | 1.38 / 1.70 | 1.82 / 2.58 |
| melee3 | 6.04 m | **9.19 m** | 1.52 / 0.87 (a cleave, not a carve) | 2.03 / 2.55 |

1. **The arc lives in the WRIST, not the shoulder.** A hand travels a metre at most; the hammer's head sits 0.83 m beyond the fist, so turning the palm through the swing carries that head more than twice as far — for free, without asking the shoulder for reach it does not have. New `WRIST_TRACKS` rotate the palm basis through the clip (`yaw` about world up for a carve, `pitch` about the body's right vector for the overhead), signed by the swinging hand. The props are welded into the palm, so this can never break a grip. Arm tracks were widened alongside, and the Bastion's are the larger everywhere.
2. **Each blow now has its own move.** `VIGIL_MOVES` / `BASTION_MOVES` name, per clip: which fist swings, the arm track, the wrist track, an off-hand track, and the crescent id. The Vigil alternates fists (opener right, backhand left, melee3 both); the Bastion is always the hammer hand.
3. **The VFX follows the swing.** Two faults: the crescent shapes are measured off Vesper's lance and ignored the gameplay reach entirely (`sweepReach = S.reach`), so a two-handed reliquary drew the same mark as a wrist blade; and `melee2` throws the Vigil's **left** fist while sweep 2 draws right-to-left. Fixed with two defaulted additions — `vfx.meleeArc(..., scale)` (reach ×scale, span ×half that; `sweepScale` 1.55 Bastion / 0.92 Vigil, passed through `combat.meleeStrike` from the melee spec) and `ctx.loadout.meleeSweep(name)`, read by player.js at the hit frame, which returns a **signed** id (the backhand asks for −2 and draws mirrored).
4. **The shield had to clear the lane.** A swing that crosses the body finishes where the shield hand lives, and that shield is a 1.5 m plate. The off hand now tucks outboard and back through the blow. Gated: the hammer head's closest approach to the shield centre is 0.99 m against the plate's own 0.82 m radius, on all three clips.
5. **Right click is the Vigil's melee**, matching the Bastion's cast on the same button. The guns therefore no longer "focus" on it (`aimBlend` is firing-only again, and the discharge dropped its second cone) — aiming down a wrist blade was never the fantasy, and the button is worth more as a second attack. F still swings.

## The mobility pass (round 3, from play)

"Make the leap larger and faster; make the Vigil's airborne slam aimable and longer — a fully horizontal thrust should be possible." Measured by `scripts/saintfall-kenosis-mobility-probe.mjs` (**10/10**), because distance is the one claim a screenshot cannot settle.

**The Censer leap: 4m → 18.6m across, 4.7m up, 1.22s aloft.** The first version set a one-frame speed floor and handed it straight back to the movement solver — and that solver drives `wanted` to **zero whenever the stick is centred** *and* closes the travel gate entirely (`if ((mag > 0.01 || boostMode || lungeDrive > 0) && !slamMode)`), so a leap with no input barely moved while looking fine in every plate. The horizontal is now a sustained **drive**: `jetpack.driveState()` publishes `{speed, yaw}` for `driveSeconds` with a fade, and player.js consumes it exactly as it already consumes the melee lunge — a speed **floor** (not a target, so releasing the stick cannot abort a leap in the air), an extra term in the travel gate, and a bearing for a centred stick. The bearing is captured camera-relative at launch; steering with the stick overrides it, because air control is what makes a jump a verb. Bastion numbers: vertical 13.8, drive 24 m/s over 0.85s (fade 0.30), cost 22, cooldown 1.7.

**The Vigil's stoop replaces its Penitent's Fall** — the bulwark keeps the Fall, which only ever goes down; a skirmisher gets a line. It flies the reticle: `aimViewPitch` clamped to (−1.35, +0.42) so it cannot be flown upward as a second pack, 34 m/s for 0.62s = **21.5m of line at every angle**, redistributed by the aim:

| aim | horizontal | drop |
|---|---|---|
| flat | **21.53 m** | 0.00 m (netY 0.00 — a true horizontal lance) |
| shallow (−0.35) | 20.23 m | 7.38 m |
| steep (−1.10) | 9.77 m | 19.19 m |

It pierces (92 per creature, one each, knockback 12), sweeps the trials targets with knockdown, and pays a shockwave + slam VFX only if it ends on the ground. The kit owns the body for the length of the line — the established pattern here (bosses displace through `player.drag`, the Undercroft writes position outright) — integrating **after** the controller's solve and overwriting it so the two never compound, moving through `collide.sweepFlightCapsule`, and carrying `figure.root` by the same delta because that root is placed *during* the solve and would otherwise render a frame behind the collision being tested.

**The bug that cost the round:** the integration advanced a scratch target but never committed it back to the thrust's own authoritative position, so every frame re-launched from the launch point. The trooper moved 0.57 m while the odometer counted the full 21.5 m — a discrepancy invisible to any still, and the reason this pass got a distance probe rather than a plate.

**Vesper is untouched, verified not assumed:** all leap code sits inside `if (leapMode)` and `driveState()` returns null for every other pack, so the three player.js terms are inert. `saintfall-jetpack-probe` scores **43/48** — and a clean-HEAD run in a throwaway worktree fails the *identical* five checks (sheathed lance cradle, seraph span, Fosse hill clearance, diagonal roof sweep, landing assist). Pre-existing, not ours.

## Round 4, from play: two faults the probe was blind to

1. **The stoop did nothing while flying — on either button.** `tryAerialThrust` listed `inFlight` as a refusal, and the Augur is a pack that *flies*, so the verb refused itself in precisely the situation it exists for; the press then died on `pressMelee`'s flight guard without even a swing. The refusal is gone (launching cuts the pack for free — `beginAction` makes `player.action` truthy, which is already in the jetpack's own `blockedByAction` list, and the lunge clip outlasts the line), and the flight guard now applies only to the Bastion, so a Vigil press with the stoop on cooldown falls through to an ordinary air swing instead of being eaten.

   **Why it shipped green:** the probe called `T.summit.aerialThrust()` directly and got airborne by writing `vy` — which never sets `inFlight`. Both halves of the blind spot mattered. The probe now flies **on the real pack** and presses the **real buttons** (an `ads` edge for right click, a real `KeyF` keydown), and both fire at 21.3m.

2. **The stoop drew the Fall's overhead column.** Reported as "the VFX comes from overhead even if she is thrusting straight forward" — and it was literal: the trail call was `vfx.slamTrail`, which drives the Penitent's Fall's `impulse` rig, and that rig is authored straight up (a `CylinderGeometry` built along +Y, plus "a halo tightening over the head"). On a vertical plunge it *is* the effect; on a horizontal lance it is a beam standing over a trooper who has already left. Three new axis-expressed primitives replace it — `stoopLaunch` (a ring stood square **across** the line via `setFromUnitVectors`, cinders thrown back down it), `stoopWake` (a shaft lying along the axis plus embers shedding astern), and `stoopSpend` (the lance letting go in open air; a stoop that *lands* still pays `slamImpact`, which is the right effect for hitting the floor). Nothing in any of them has an up.

   Gated with a **control**, because asserting a mesh stays dark is worthless if the mesh has been renamed: the Bastion's Fall is driven through the real melee key and must light `slam-column` (`lit: true`), while the Vigil's flat stoop must leave both column and halo dark across every thrust frame (37 frames, both `false`).

   **And then it drew nothing at all** — reported as "no VFX until ground impact". Two causes, both invisible to the checks above, which only proved the *wrong* effect was dark. First, the shaft went through `tracers.emit` directly with a travel speed of **0**; the public `tracer()` treats a non-positive speed as "use the default", and a bolt that never crosses its own span renders nothing. Second, the wake shed two motes and a 0.065m hairline per frame — at 34 m/s with the chase camera riding along, world-space emissions are behind the trooper by the next frame, so density is the whole game. The wake now goes through the public `tracer()` (a 6m shaft refreshed every frame, so it reads as one continuous blade), a bloom at the lance point, an 8-ember exhaust held 0.55s, and glints strung along the axis. The probe gained the **positive** half it was missing: the tracer pool stamps a birth time per bolt, so it counts recently-born ones — **0 before the stoop, 22 during**.

3. **The Vigil Step ignored the reticle whenever the stick was held.** It stepped along the movement input and only fell back to the lens with a centred stick, so one key sent the trooper three different places depending on which way they were walking. It is now always `aimViewYaw` — the real camera ray — and the body lands facing the way it went. Gated at three aims with a hard stick held *against* each: 0.0° of error, 12m every time.

## Traps recorded

- `player.action` is the clip NAME. The record is `player.actionState` (new). Reading `.t`/`.spec` off the name is a silent no-op.
- `collide.rayBlock` and `collide.findOpen` answer a **distance in metres (Infinity = clear)** and an **`[x, z]` array** respectively — both were mis-typed on first use here.
- A trials ground inside its own wake radius of the spawn ambushes every boot and every probe; the fix is geometry (70 m yard, 40 m wake), not probe hygiene.
- A probe that stands still in the yard for 6 s is testing the revive flow, not the cohort. The cohort kills an idle operative in ~7 s, by design.
- Aim-line targets for projectile probes must be tall (gleaner, 3.5 m): a level ray passes clean over a thresher.
