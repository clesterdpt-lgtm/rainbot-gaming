# 108 — Two doctrines for Kenosis: The Kenotic Rite and The Iron Liturgy

**Build:** `20260829-kenosis-doctrines-2` · **Scope:** the summit level gains a complete doctrine system with a distinct tree per operative — 8 Orders, 40 rites, their own VFX vocabulary and their own two voices. Every shared-engine edit is additive and defaulted; Vesper's 25-talent tree is untouched and verified so.

The Kenosis operatives had kits but no progression. This gives each a doctrine at parity with the campaign's — a board, an XP economy, Vow capstones, per-Order visual identity — without forking the campaign's runtime.

## The two trees

**THE KENOTIC RITE — White Vigil.** Displacement, edges, and the line of a dive.

| Order | The idea | Vow |
|---|---|---|
| **Quicksilver** `#9df3e0` | The Step: afterimages that hold the swarm, charge returned for arriving, an empowered strike on landing, a third charge | **The Unbroken Vigil** — stepping *through* an enemy leaves an echo that implodes for 190 |
| **Crescent** `#ffe6a2` | The paired emitters: alternating hands build a Verdict, longer reach, killing pulses split, held fire ramps | **Choir of Edges** — a completed Verdict throws a 7-crescent fan |
| **Stoop** `#8fd6e6` | The dive: damage by the metre flown, cooldown refunded on a kill, a slowing wake, and a launch from standing | **The Long Dive** — the stoop detonates on landing, wider the further it flew |
| **Vigil** `#cfe0f4` | Staying alive: speed on a kill, charge at low vitality, a window after being hit, one death deferred | **The White Vigil** — stand still to be unseen; the volley out of the veil hits for 160% more |

**THE IRON LITURGY — Bastion Penitent.** Weight taken, weight returned, weight thrown.

| Order | The idea | Vow |
|---|---|---|
| **Bulwark** `#ff9540` | The guard as arithmetic: stacking armour, a ringing perfect block, damage banked into the next hammer, a wall that walks | **The Shut Gate** — a perfect guard slams a 9m shockwave |
| **Cast** `#ffc453` | The thrown reliquary: a real return pass, a stagger on contact, a faster return, flyers dragged home | **The Thrown Choir** — three arcs, each returning on its own line |
| **Forge** `#ff6a2a` | The boiler: leaping vents fire, landing cracks the ground, being hit stokes it, and it lands running | **The Open Firebox** — the leap becomes a comet |
| **Anvil** `#e8503a` | The hammer: everything struck loses its footing, the third blow is the aimed one, kills are a breath, and the fallen are crushed | **The Last Nail** — the finisher plants a 7.5m shockwave |

## Architecture — a parallel pack, not an extension

`progression.js` imports `DOCTRINE_ORDERS` at module scope, builds its TALENTS/CAPSTONES/ORDERS maps and its `IMPLEMENTED_TALENTS` allowlist once, and `buildProgression(ctx)` takes no tree argument — **it cannot return a different tree** without reshaping 2,300 lines the whole campaign depends on. Kenosis is a parallel content pack everywhere else, so the doctrine follows suit:

- **`summit-doctrine-config.js`** — both trees as pure data, plus a `TUNING` table the runtime reads so the number a rite applies and the number its card promises cannot drift. (The campaign carries an `MVP_COPY` override that silently rewrites 19 of its 25 nodes, and its text *has* drifted from the config it overrides. There is no override layer here.)
- **`summit-doctrine.js`** — a leaner runtime answering the same contract the board and audio read: `state()`, `definitions()`, `rank()`, `spend/refund/respec`, `equipCapstone`, `canEdit()`, `onChange()`, `grantXp()`, and a `bus` that emits `"doctrine"`. No career/field split, no 12,000-entry receipt ledger, no cloud merge — a trials ground has no use for them; it persists to `localStorage` per operative.

**Two seams, and the kits know no talent ids.** `doctrine.kit(key, fallback, detail)` is the modifier oracle — the kit asks for a number it was going to use anyway. `doctrine.verb(name, detail)` is the authority — the kit reports what happened and the doctrine decides what to add to the world. Melee damage is a **getter** on `loadout.meleeSpec`, so `combat.meleeStrike` picks up window effects at the moment of the strike without combat.js learning anything.

## Making the engine hold two worlds' Orders

| What | Why it had to change |
|---|---|
| `DOCTRINE_STYLES` unfrozen + `registerDoctrineOrders()` | The table was frozen; a world's Orders had nowhere to go. Entries stay frozen individually. |
| **Mote colours repointed, not extended** | The style `id` is a **GPU channel** — three shaders read the doctrine band as `step(5.5,aTint)*(1-step(10.5,aTint))` and pick from five named uniforms, so ids 6–10 are the entire supply and widening the band means editing three shaders and shifting steam/ichor/sand/grain up behind it. But those five colours are *uniforms*: a world that never shows Vesper's Orders points them at its own palette. Four Orders, four channels, zero shader edits, zero recompiles. |
| `doctrineStats[order] = (… \|\| 0) + 1` | Was unqualified — an Order with no counter yielded `undefined + 1`, a NaN that never heals. |
| `doctrineState().byOrder` built from the registry | Hard-listed five keys, so a new Order was invisible to every probe. |
| A `family: "kenosis"` dispatch branch | Nine new cue kinds with their own vocabulary (below). |
| `audio.DOCTRINE_ORDERS` + two new voices | An Order missing from that Set is **silent with no error**; an Order in the Set but not the routing chain speaks with the *Edict cipher*, which is worse. |
| `player.doctrineColours` + 8 muted hues | `pulseDoctrine` returns false for an unknown Order, so the trooper's lamps never key. |
| `ui.talentIconUrl(id, definition)` | Icons resolve from the id to a `.jpg` with **no fallback** — a node without a plate renders as an empty black square. |
| `.sf-doctrine__orders` → `grid-auto-flow:column` | Was `repeat(5, …)` in four places; a four-Order rail had a dead fifth column at every breakpoint. |
| Board header reads `definitions.title` | Otherwise a Kenosis board is titled "FIELD DOCTRINE" and quotes Vesper's own capstone threshold. |

## The visual identity

Two things separate these from anything the campaign draws. **`slashFx` — the melee crescent — had never been used by a doctrine cue**; a tree whose weapons are blades draws actual blades. And the Vigil's rites **contract** where every campaign rite expands: a Step's echo falls inward to the point the body left, which is the opposite gesture to a shockwave and reads as one at a glance.

Nine kinds: `afterimage` (a collapsing column, rings running big-to-small, a hard collapse flash), `verdict`/`sunder` (staggered crescent blades), `wake` (a low line laid back along the flight), `bell` (one hard ring and a wall), `chain` (a tether to a dragged flyer), `stoke` (a furnace column), `landing` (two tonnes arriving), `lantern` (quiet, vertical, hanging), `mercy`. No new lights — brightness is `uGain` and flashes, per the project-wide rule.

**40 procedural SVG sigils** replace 40 AI plates this build cannot author: the Order's colour, its fold count as radial symmetry, and a per-rite glyph, ~700 bytes each against ~900KB for a plate.

## Proof

- **`scripts/saintfall-kenosis-doctrine-probe.mjs` — 24/24.** Buys all 40 rites through the production `spend()` path one Order at a time, drives each verb, and diffs the proc counter. **Actives are proved by proc; passives are proved by measured number movement** — a rite that only changes a number has nothing to fire, and demanding a proc would only push a decorative cue into the frame loop. Measured: step charges 2→3, crescent range 42→62, volley ramp 67.6→90.6, falling star 92→184, guard speed 2.0→3.1, cast return 130→221, cast cooldown 8→5.5, chain stun 3→5.5, third blow 132→251. Also gates: board renders 4 tabs/4 cards, every card uses its generated sigil, zero cues rejected, every Order drew something, zero page errors.
- **`scripts/saintfall-kenosis-doctrine-sheet.mjs`** — 16 contact plates, **zero rejections and zero fallbacks**: every cue drew its own bespoke shape rather than the generic ring.
- **Kenosis regression:** kit 40/40, arcs 12/12, mobility 18/18.
- **Campaign regression:** import audit clean; the campaign's own doctrine VFX sheet renders all 5 Orders / 29 rites; talent audit **12/25 — and a clean-HEAD worktree scores exactly 12/25 on its second run too**. The one talent that differed between first runs, `censer_gold_nail`, requires a *headshot* and weapon spread is randomised per shot; it is run-to-run noise in the harness, present on both sides.

## Bugs the audit found (all fixed)

1. **A negative `String.repeat` crashed the HUD.** Refunding *Three Places at Once* shrinks the step's magazine below the charges already held, and the pip row did `"◇".repeat(max - held)`. The kit now clamps held charges to the maximum; the HUD clamps both ways.
2. **`cast_true_return` was a downgrade.** It multiplied the *already-halved* return damage (130 × 0.6 = 78). It now takes a share of the **outbound** blow — caught only because the passive assertion demanded the number move the *right way*.
3. **`cast_second_reliquary` promised a charge the kit never implements.** Re-authored as the cooldown reduction it actually does. A rite whose copy promises what the code does not do is exactly the drift this config exists to avoid.
4. **The Order cap made tier-3 rites unbuyable.** An Order *is* eight ranks; a cap of 6 refused `three_places`, `reaping_volley`, `immovable`, `hooked_chain` and `last_lantern` no matter how points were spent. The cap that matters is the 11 points a career earns against 32 ranks of capacity.
5. Two probe-side faults worth recording: a synthetic kill without coordinates sets a **non-finite AudioParam** (audio's own kill subscriber positions from the event), and driving Shatterpoint *after* The Last Nail tests a corpse — the capstone's 240-damage shockwave kills the 60-hp target the test just placed.
