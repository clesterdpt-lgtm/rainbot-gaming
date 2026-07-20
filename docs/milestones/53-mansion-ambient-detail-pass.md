# Milestone 53: Mansion Ambient Detail Pass

## Status

In progress — implementation and automated acceptance complete; visual tone awaits user playtest.

## Objective

Raise ambient believability across the whole estate with small, room-specific prop vignettes: foundation plantings and driveway lining outside, a laid dinner service on the bare feast table, working clutter on the empty kitchen counters, personal bedside dressing in the four upper suites, and lived-in vignettes for the barest basement rooms — without altering any gameplay lane, patrol route, seat, or light budget.

## Scope

- `ESTATE_PLANTING_LAYOUT` constants table plus `buildFoundationPlantings()`: clipped boxwood beds with limestone curbs hugging the front facade on both sides of the portico, paired low shrubs lining the driveway lawn edge, and two solid stone planter urns flanking the entry steps.
- `addDiningTableService()`: a runner, ten place settings (plate, goblet, napkin) driven by a `DINING_SERVICE_SEATS` table, two brass candelabra with unlit candles, and a fruit centerpiece on the dining table.
- `addKitchenCounterDressing()`: cutting board and bread, copper pot cluster, utensil crock, fruit bowl, plate stack, folded towels, rolling pin, and a copper kettle on a rear burner — all behind the counter work edge and clear of the sink span.
- `addBedroomSuiteDressing()` for all four upper suites: paired nightstands with per-suite accents (candle, books, carafe, pocket watch), a leather travel trunk at each bed foot, and a bedside runner rug; nightstands and trunks are solid colliders.
- Basement vignettes: `addLaundryDetails()` (strung drying lines with hanging linens, enamel washtub with washboard, wicker baskets, folded stacks), `addWineCellarDetails()` (tasting-table bottles, goblets, candlestick, ledger, two hooped barrels), `addBulkStorageDetails()` (stacked crates, two barrels, tarp-covered pile), and `addBoilerRoomDetails()` (coal scuttle, lumps, shovel).
- Main-floor accents: `addMusicRoomDetails()` (sheet stand, metronome, violin case), `addLibraryWritingSet()` (open book, inkwell, letters, drinks-cabinet decanter), and `addRearLoungeTeaService()`.
- Static acceptance suite `scripts/test-mr-feast-ambient-details.mjs` and a synchronized cache-key/runtime-version bump.
- Second pass (user-directed): every below-grade ceiling fixture now shares the utility cage-and-bare-bulb look — basement corridor and service-stair-landing fixtures drop their chandelier rings while keeping their authored cone emitters untouched; mantel decor on all three fireplaces (clock, urn pair, leaning frame variants); vanity counter sets in both bathrooms; foyer console vases and card trays; an exposed service pipe with valve along the rear cross-corridor ceiling (overhead only — the chase lane stays clear); a drinks table and towels between the pool loungers; a portico entry mat; and a smaller planter-urn pair flanking the rear terrace doors.
- Third pass (user-directed textures/detail): procedural `makeGroceryTexture` canvas labels lift the stocked food out of flat-color placeholders (printed cartons and labeled tins on dedicated `groceryBox`/`groceryTin` materials so bread and baskets stay plain; mottled orchard skin on every produce sphere); the refrigerator now stocks a semantic cold larder (milk bottles, butter dish, jam, roast on a plate, cheese wedges, lettuce, egg tray with six eggs); the pool stair gains marble nosed treads, riser shadow reveals, deck curbs, and collider-free brass handrails with finials; and the pool water shader adds storm rain ripple rings, drifting value-noise grain, and sparkle over the authored wave base. All procedural — no downloaded assets.
- Doubled pool (user-directed): the basin's swimming area doubled (water 9.7 m → 19.4 m wide) by growing west across the former lawn; the entry stair, ramp, wall gap, and Mr. Feast's deck response spot stay authored at x=-9 via an explicit `stairX`, the east lounger deck is untouched, decks/coping/supports/lane inlays wrap the new footprint, the west grounds slab is re-cut around the cavity, one estate tree moved off the new southwest deck corner, the `POOL TERRACE` zone and `yardPoolB` view follow the west edge, and the water shader's uv is aspect-corrected so rain rings stay circular. Deterministic physics walks re-prove all four authored pool routes plus new west-deck and west-floor coverage (`tmp/mr-feast-pool-route-check.mjs` recipe recorded in the milestone).
- No empty cabinets (user-directed final sweep): nine new role-specific stock kinds — `barware`, `sideboard`, `cookware`, `prep`, `undersink`, `cellar-reserve`, `linens`, `tools`, `washroom` — fill every previously bare cupboard (library drinks cabinet, dining sideboard, five kitchen base cabinets, wine cabinet, linen cupboard, workroom tool cabinet, and both bathroom vanities). Short-headroom shelves only take flat stock, every newly stocked cabinet passes `interiorLight: false` so no door-operated spotlights join the fixed light budget, and a live-scene audit confirms all 25 storage pieces (cabinets, pantry, refrigerator, and the four dressed walk-ins) carry visible stock meshes.
- Pool stair-mouth fix (user-directed): the doubled basin's north terrace paver was a single solid slab that capped the entry stairwell from above. It is now split into `pool-terrace-pavers-north-west` (xRange −25.15..−10.30) and `pool-terrace-pavers-north-east` (−7.70..−1.75), leaving a 2.6 m opening over the 2.45 m-wide treads that mirrors the already-split deck supports and coping. The stairs read as an open recess from every angle; live mesh-bounds inspection confirms the gap, and all six deterministic pool walks (entry/exit/guards/west coverage) still pass because the colliders were untouched.
- Pool stair waterline fix (user-directed): the main water plane's north edge stops at z=−19.88, short of the entry stairs, so the lower treads (below the y=−0.39 waterline) sat dry with a visible gap. A short water tongue — `makeEstatePoolWater(2.5, 1.4, stairX, -19.18, -0.39, "estate-pool-water-stair-inlet")`, gaining an optional name param — butts the main plane's north edge and laps up the stair mouth to the step-1/step-2 riser, so the submerged steps read as underwater while the top tread stays dry. Decor-only (no collider); the main plane's pinned `19.4, 11.25` dimensions and all pool routes are unchanged.

## Out of scope

- Any new shader lights, interactions, tamper targets, or readable items; all candles are unlit wax and every prop is inert decor.
- Rear/side facade plantings and additional estate trees.
- Reading Room floor props (Juniper's hangout owns that floor space) and any ballroom floor decor (Feast Says marks stay clear).

## Dependencies

- **Depends on:** Milestone 29 kitchen remodel counters, Milestone 48 seating/routine routes (clearance constraints), Milestone 52 Feast Says ballroom set (kept clear)
- **Blocks:** none

## Acceptance criteria

- [x] Planting tuning lives in a named `ESTATE_PLANTING_LAYOUT` table; facade beds keep the portico aisle open (|x| ≥ 4.2), driveway shrubs stand beyond the limestone edging (|x| ≥ 3.5) and skip Mr. Feast's gate response spot (z ≈ 29.5), and only the stone urns add colliders. — test: `scripts/test-mr-feast-ambient-details.mjs::1–2`
- [x] The planting meshes carry `estate-`/`driveway-`/`portico-` names so exterior facade culling keeps them, and yard diagnostics count the new plantings. — test: `scripts/test-mr-feast-ambient-details.mjs::2`
- [x] The dining table serves all ten chairs with tabletop-only decor (no colliders), a candelabra pair, runner, and centerpiece. — test: `scripts/test-mr-feast-ambient-details.mjs::3`
- [x] Kitchen dressing is invoked from the remodel, adds no work-aisle furniture, keeps the sink span (x 8.7–10.6) clear, and puts the kettle on the range. — test: `scripts/test-mr-feast-ambient-details.mjs::4`
- [x] All four suites gain dressing anchored at the beds (|z| ≥ 8, off the z ≈ ±6 patrol lanes) with collidered nightstands and travel trunks. — test: `scripts/test-mr-feast-ambient-details.mjs::5`
- [x] Laundry, wine cellar, and bulk storage receive their vignettes with solid washtub/barrel/tarp colliders. — test: `scripts/test-mr-feast-ambient-details.mjs::6`
- [x] Music room, library, rear lounge, and boiler room accents exist; the library set stays tabletop-only so Mara's writing-chair approach is unchanged. — test: `scripts/test-mr-feast-ambient-details.mjs::7–8`
- [x] The page cache key and `MANSION_RUNTIME_VERSION` move together past the pre-ambient value. — test: `scripts/test-mr-feast-ambient-details.mjs::9`
- [x] Basement fixtures are visually uniform: corridor-style fixtures below grade use the cage-and-bare-bulb look via a geometry-only branch, while ring shadows and the pinned cone emitters stay authored (renovation checks 16/22/29 unchanged). — test: `scripts/test-mr-feast-ambient-details.mjs::10`
- [x] Second-pass vignettes exist: three mantels, two vanity sets, foyer consoles, rear-corridor overhead pipes with no chase-lane colliders, pool deck table, rear terrace urns, and the portico mat with culling-safe names. — test: `scripts/test-mr-feast-ambient-details.mjs::10`
- [x] All prior renovation invariants still pass. — test: `scripts/test-mr-feast-renovation.mjs`
- [ ] User playtest: overall tone (props feel period-correct and subtle, nothing gamey or overbright), suite navigation comfort around the new trunk/nightstand colliders, and laundry drying-line readability.

## Verification

- `node --check assets/js/mr-feast-mansion.js`
- `node scripts/test-mr-feast-ambient-details.mjs`
- `node scripts/test-mr-feast-renovation.mjs`
- `node scripts/test-mr-feast-contestant-13.mjs`
- Before/after visual QA for every room and yard view under `output/iterate/mr-feast-ambiance-pass/{before,after}/` (73 views each).
