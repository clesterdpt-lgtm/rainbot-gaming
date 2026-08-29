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

## Traps recorded

- `player.action` is the clip NAME. The record is `player.actionState` (new). Reading `.t`/`.spec` off the name is a silent no-op.
- `collide.rayBlock` and `collide.findOpen` answer a **distance in metres (Infinity = clear)** and an **`[x, z]` array** respectively — both were mis-typed on first use here.
- A trials ground inside its own wake radius of the spawn ambushes every boot and every probe; the fix is geometry (70 m yard, 40 m wake), not probe hygiene.
- A probe that stands still in the yard for 6 s is testing the revive flow, not the cohort. The cohort kills an idle operative in ~7 s, by design.
- Aim-line targets for projectile probes must be tall (gleaner, 3.5 m): a level ray passes clean over a thresher.
