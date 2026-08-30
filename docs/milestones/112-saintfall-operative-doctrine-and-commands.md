# 112 — The operatives' doctrines and call actions reach the campaign

**Build:** `20260830-operative-doctrine-1`

m111 carried the Kenosis kits into `games/saintfall.html`. This carries the other two thirds: a White Vigil holding blink, the stoop and paired crescents was still being handed Vesper's Censer/Procession/Wing/Halo/Edict rites — which improve a furnace lance and a polearm she does not carry — and calling Orbital Lance and Cluster Salvo while her own Mirror Choir and Crescent Rain existed only on a level nobody can reach.

Both new levels stay unlisted. Neither is in the catalog, `games.html`, the sitemap or the campaign page; they remain reachable only by direct URL.

## What changed

**The doctrine.** `progression.js` cannot serve both trees — it imports `DOCTRINE_ORDERS` at module scope and `buildProgression(ctx)` takes no tree argument (m108) — so the operative now picks the runtime, and both answer the same contract `save.js`, `ui.js`'s board and `audio.js` read. Vesper takes the same path she always did, object for object.

**The call actions.** `summit-command.js` is built for Kenosis operatives and its command surface is *merged onto* the mission rather than replacing it: `mission.js` remains the campaign's phase machine — relays, bosses, extraction, the boon, the save schema — and only the fields the wheel, the code entry, the pack and combat actually read change hands. The arrow-code entry came too; without it that input path resolves against a catalog the operative does not carry and silently does nothing.

**The Kenosis Orders are registered with the VFX** in the campaign, or every rite the tree fires is dropped by `doctrineCue` and draws nothing — silently, because an unknown Order is rejected rather than thrown.

## Two things that had to be got right

**The career envelope is shared, and this runtime declines it.** The campaign keeps one career record per account. Three operatives with three trees would fight over it: a Vigil's `captureCareer` would overwrite Vesper's 25-talent career, and Vesper's would then be handed back to the Vigil full of node ids its tree has never heard of. So `captureCareer` returns null and the envelope is left alone — nothing is lost, because this runtime has owned its own per-tree `localStorage` store since m108 and still does. `validateCareer` is deliberately *not* provided either: `save.js`'s `normalizeCareer` falls back to cloning when there is no validator, so an existing Vesper career passes through untouched instead of being rejected as `INVALID_CAREER`.

**Swapping the wheel broke every campaign save, and the existing probe caught it.** `save.js`'s snapshot validator walks `ctx.mission.stratagems` and demands a finite cooldown for every key it finds. Change the catalog without changing the snapshot and the wheel offers `mirrorchoir` while the mission's own snapshot has never heard of it — `isFiniteNumber(undefined)` is false, and the save is refused. `saintfall-operative-kit-carryover-probe.mjs` went 11/11 → 9/11 on exactly the two field-restore checks. `mission.snapshot`/`restore` are now wrapped so the operative's cooldowns round-trip with the mission's own record.

That regression is the argument for the probe existing. It was not visible at boot, not visible in play until you saved, and every call on the path is optional-chained.

## Also

- `saintfall-entrypoint-smoke.mjs` (new) boots all six live combinations and fails on any page error, console error or same-origin 4xx. It prints which doctrine tree and which command wheel each one ends up with — the one place that states in a single screen what is live where.
- The White Vigil page's `boot.js?v=` had drifted out of lockstep with `boot.js`'s own `BUILD` after the m111 carryover. Both pages now pin the same string.
- The kits reported `doctrine: "Doctrine of the Wing"` / `"of the Censer"` — Vesper's Order names, left over from when they borrowed her tree. They now name the operative's actual doctrine, which is what the probe beside them already asserts.

## Proof

**`saintfall-operative-kit-carryover-probe.mjs` — 20/20.** Booting is not the proof, so for each operative it buys a whole Order through the production `spend()` path, equips the Vow, drives a rite and diffs the proc counter; calls a command through `ctx.mission.call` and watches for a real impact; and resolves the arrow code against its own catalog. Then it checks Vesper has no command module, an intact career envelope, her five Orders and her three stratagems.

Regression: entry-point smoke clean on all six, commands 32/32, doctrine 24/24, swing 18/18, kit 40/40, import audit clean.
