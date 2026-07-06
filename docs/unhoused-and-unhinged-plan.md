# Unhoused and Unhinged

Working plan for Rainbot Gaming's next large browser game.

## Current Decision

- Format: top-down low-poly 3D browser sandbox, similar in camera language to the original GTA era while keeping the art and systems original.
- Runtime: plain Three.js inside the existing static site.
- Physics: lightweight player, prop, vehicle, and actor collision through simple top-down radius/box checks. Avoid rebuilding the cluttered physics stack until the board is fun.
- Page shape: one HTML page under `games/`, one clean top-down JS runtime under `assets/js/`, shared site CSS and `RB` helpers.
- Tone: absurd city survival comedy. The joke should be the systems, the city, clout culture, bureaucracy, bad ads, and cartoon chaos, not real homelessness or addiction.

## High Concept

You are a street-survival oddball trying to make it through a tiny, overreactive city where every system is ridiculous. By day you earn cash and reputation through slapstick street performances, odd jobs, scavenging, and crowd reactions. If you cause too much trouble, the city heat rises and cops give chase. At night, the city mutates into a survival wave where glowing Tweeker Zombies shamble out of alleys and you fight them with improvised comedy weapons.

Working title: **Unhoused and Unhinged**

Current in-world enemy wording: **Tweeker Zombies**. Keep the presentation exaggerated and fictional so the joke lands on cartoon survival-game chaos and overreactive city systems, not real addiction or homelessness.

## Player Fantasy

The player is not powerless. They are scrappy, funny, fast, weirdly charismatic, and able to turn junk into tools. The game should feel like a cartoon sandbox where dignity and absurdity coexist.

Primary verbs:

- Move through a compact open city block.
- Perform street antics to earn money and crowd attention.
- Scavenge objects and turn them into tools or weapons.
- Dodge, hide from, or outrun cops when heat rises.
- Buy or unlock improvised gear.
- Survive night waves with slapstick melee and thrown props.
- Upgrade camp, outfit, cart, or inventory between cycles.

## Core Loop

1. Day starts with low heat and a small cash goal.
2. Player chooses ways to earn: dance, statue pose, cardboard sign routine, pratfall stunt, trash-can percussion, odd jobs, or scavenging.
3. NPC crowd reactions create money, reputation, trouble, or heat.
4. Too much chaos triggers cop suspicion and then chase.
5. Player spends cash on improvised weapons, food, outfit pieces, cart upgrades, and safe-zone improvements.
6. Night falls. Tweeker Zombies spawn from alleys and subway vents.
7. Player survives the wave using funny weapons and environmental traps.
8. The next day unlocks denser city sections, tougher night waves, and stranger interactions.

Target session:

- First playable: 3 to 5 minutes.
- Full version: 12 to 18 minute run with 3 day/night cycles.

## First Playable Slice

The first playable should prove the sandbox promise without trying to build the whole city.

Map:

- One low-poly city block.
- Street, sidewalk, park strip, alley, pawn kiosk, bus stop, trash area, and small camp zone.
- Invisible boundary or cartoon roadwork barriers.

Playable systems:

- Top-down character movement.
- Orthographic follow camera with no mouse-look requirement.
- Cash, heat, energy, health, time-of-day HUD.
- Four daytime actions:
  - Dance for tips.
  - Cardboard sign joke.
  - Trash-can drum solo.
  - Slapstick stunt.
- Simple NPC pedestrians that wander, stop, react, tip, laugh, ignore, or call security.
- Heat meter that triggers a cop chase.
- One cop NPC with pursuit, cooldown, and reset.
- Night transition.
- Tweeker Zombie wave with 8 to 14 enemies.
- Two weapons:
  - Plunger melee.
  - Traffic cone throw.
- One environmental gag:
  - Trash can lid shield or banana-peel slip zone.
- Win state: survive until morning.
- Loss state: health reaches zero or arrest timer fills.

Current implementation status:

- A first playable prototype page exists at `games/unhoused-and-unhinged.html`.
- The current top-down runtime exists at `assets/js/unhoused-and-unhinged-topdown.js`.
- The older third-person runtime remains at `assets/js/unhoused-and-unhinged.js` as a legacy prototype, but the page no longer loads it.
- A real rendered gameplay card exists at `assets/img/mockup/card-unhoused-and-unhinged.png`.
- Implemented in the fresh top-down baseline: compact board-style city grid, readable districts, orthographic follow camera, top-down WASD/arrows movement, daytime antics, cash/heat/energy/health/needs HUD, pickups for food/water/cash/scrap, district prompts, camp recovery, pawn supply buys, moving cars, civilians, cops with chase/arrest pressure, night Tweeker Zombie waves, plunger melee, cone throws, banana-peel traps, stunt burst, objective arrow, minimap player marker, score/high score, pause/restart, mobile movement buttons, and `?debug=1` fast timer mode.
- Controls + presentation pass (2026-06-14): mouse aim with left/right-click combat, left-hand keyboard cluster (F/Q/C, legacy J/K/L kept), a max-screen button, on-canvas touch action buttons, and a container-query HUD that scales to the play area without overlap at any size.
- Night variety + shop pass (2026-07-06): added the Goo Spitter — a ranged night enemy that kites to a preferred distance and lobs slowing goo arcs (goo hits deal damage and cut player move speed to ~55% for ~2s); it joins waves from cycle 2 onward via `rollZombieKind`. Wired up a working Pawn Cart shop at the kiosk (`points.kiosk`): ACT near the visible cart buys the first unowned weapon then restocks consumables — Mop Spear ($14, long-reach stun-poke melee), Rubber Chicken ($9, now actually confuses zombies so they stagger away instead of attacking), then Cones/Peels restocks up to cap. A floating `[E] item — $price` prompt shows in range by day; a "need $X" nudge fires when short on cash; sold-out falls through to normal performing. Debug helpers `zombieCounts`/`spawnSpitterNear` added to `window.__UNHINGED`.
- Still rough: AI balance, building variety, better pedestrian reactions, richer sound/feedback, more interesting cop escape routes, remaining night enemy types (Big Wobble tank, Alley Boss), the other buyable weapons (Mop upgrades, Fire Extinguisher, Shopping Cart), and deeper long-run progression.

## Systems

### Simulation

Keep game state separate from Three.js meshes.

- `player`: position, velocity, health, energy, cash, heat, weapon, action state.
- `clock`: phase, day timer, night timer, cycle count.
- `npc`: pedestrians, cops, zombies, vendors.
- `economy`: tips, rewards, item costs, upgrades.
- `gig`: rotating daytime objectives, hype payout, chained antics, and getaway bonuses.
- `oddJobs`: cache scavenging, Scrap inventory, visible pickup/dropoff routes, camp/kiosk turn-ins, and short route objectives.
- `routeJobs`: pickup/dropoff routes with visible carried props, including heavy carried items and performance finales.
- `districts`: Busking Strip, Camp Row, Pawn Alley, Crosswalk Circus, Tweeker Alley, and Open Block modifiers for tips, scrap, heat, chase speed, and night pressure.
- `director`: run pressure meter that triggers crowd, scrap, security, quiet, and night-pressure beats based on phase, heat, hype, chase state, and district.
- `favors`: district-specific short objectives that reward local play, such as Busking hype, Camp Row help, Pawn Alley scrap, Crosswalk stunts, Tweeker Zombie defense, and Open Block assists.
- `wanted`: heat gain, chase rules, cooldown, arrest pressure.
- `combat`: hitboxes, damage, knockback, cooldowns, enemy archetype behavior, Goo Spitter projectile hazards, and Tweeker Brute boss charge behavior.
- `progression`: unlocked weapons, map zones, camp upgrades that convert scrap into max-health, recovery, trap-capacity, and safer-night perks.
- `cycles`: three escalating day/night cycles, with dawn recovery-choice cards, one-cycle perks, replenishment, a final-night mini-boss, and tougher Tweeker Zombie waves before final victory.

### Rendering

- Low-poly geometry for the prototype, with GLB-ready asset boundaries for later polish.
- Bright arcade lighting by day, saturated neon horror lighting by night.
- Camera: orthographic top-down follow camera, readable at a glance, with only a slight tilt for low-poly depth.
- DOM HUD for meters and prompts.
- Objective arrow and minimap player marker for current priorities.
- Compact Block Mood readout for district name, district trait, and pressure.
- Keep visible side UI limited to controls, district status, action buttons, and city log until the core board is fun.
- In-world district signposts for spatial readability.
- Canvas-only world and gameplay.

### Physics

Prototype:

- Capsule-ish player collision through simple radius checks.
- Static obstacle collision through boxes/circles.
- Basic knockback on combat and stunts.
- Banana-peel traps that can be found while scavenging, dropped by the player, and triggered by cops, zombies, or careless player movement.

Later physics phase:

- Optional dynamic props: cones, trash cans, boxes, shopping carts.
- Stunt impacts and launch pads.
- Ragdoll-style fall mode or puppet body for comedic crashes.
- Physics hit reactions for zombies and cops.

### Input

Mouse + keyboard (current scheme, reworked 2026-06-14):

- Mouse: move to aim (the player faces the cursor via a ground-plane raycast; no mouse-look). Left-click bonks, right-click throws a cone — both toward the cursor.
- `WASD` or arrows: move in screen/world top-down directions.
- `Shift`: sprint.
- `E`: interact/perform/pick up.
- `Space`: dodge/stunt.
- `F` (or legacy `J`): attack/bonk.
- `Q` (or legacy `K`): throw cone.
- `C` (or legacy `L`): drop peel.
- `1-4`: pick daytime antic.
- `P` or `Escape`: pause (`Escape` exits max screen first when maximized).
- `⛶` button (top-right of the stage): max screen — pseudo-fullscreen paired with the native Fullscreen API; the canvas fills the viewport and the orthographic camera adapts to any aspect.

Mobile / touch (current):

- Invisible left-half floating joystick for movement.
- On-canvas action buttons (Bonk / Throw / Stunt / Act) bottom-right.
- Decluttered HUD: tasks, prompts, and the hotbar hide; survival, heat, and minimap stay. The whole in-canvas HUD scales against the play area via CSS container queries, so it never overlaps at any size (sidebar layout, narrow window, max screen, or phone).

## Content Plan

### Day Actions

- Dance Battle: timed button prompts, higher tips when rhythm streak is clean.
- Cardboard Sign Roulette: randomized jokes with crowd taste modifiers.
- Human Statue: hold still near pedestrians, bonus if cops walk by.
- Trash-Can Drumline: area-of-effect crowd pull, raises heat if spammed.
- Pratfall Stunt: high money, high injury/heat risk.
- Odd Job Popups: carry boxes, clean graffiti, return a lost phone.
- Multi-step Route Jobs: haul a bulky prop across districts, drop it at a target, then perform or interact to finish the job.

### Weapons

- Plunger: default melee, short range, high slapstick value.
- Traffic Cone: thrown stun.
- Mop Spear: buyable longer reach with a brief stun poke. Implemented — buy at the Pawn Cart for $14 (range 6.6, 0.55s stun).
- Rubber Chicken: buyable low-damage tool that confuses enemies and earns small hype. Implemented — buy at the Pawn Cart for $9; a hit now confuses zombies for ~3s so they stagger away.
- Trash Can Lid: block and bash.
- Sock Full of Quarters: charge swing.
- Shopping Cart: charge vehicle and storage upgrade.
- Fire Extinguisher: cone pushback, limited charges.

### Enemies

- Tweeker Shambler: slow basic night enemy. Implemented.
- Tweeker Runner: fast, low health, short dash threat. Implemented.
- Goo Spitter: ranged goo arc that slows the player on hit. Implemented — kites to ~15 units, spits every ~2.2–3.2s, joins waves from cycle 2.
- Big Wobble: tank enemy with slow knockdown attack.
- Alley Boss: mini-boss after later cycles.

### City Actors

- Pedestrians: tip, film, ignore, panic, or complain.
- Influencer: boosts attention but raises heat.
- Hot Dog Vendor: sells food and gossip.
- Pawn Kiosk: sells weapons/upgrades. Implemented as the Pawn Cart at `points.kiosk` — ACT nearby by day to buy the Mop Spear, Rubber Chicken, and cone/peel restocks.
- Outreach Worker: safe-zone upgrades and wholesome recovery items.
- Cop: pursuit, warning, chase, arrest pressure.
- Security Guard: smaller local heat response near stores.

## Tone Guardrails

- Do not make real poverty, addiction, or disability the punchline.
- Put the satire on absurd systems: clout, policing overreaction, hostile architecture, city bureaucracy, algorithmic attention, and fake gurus.
- Give helpful NPCs and player upgrades real warmth.
- Use fictional enemy lore for the night mutation.
- Keep violence slapstick: bonks, knockback, stars, squash/stretch, exaggerated sound cues.
- Avoid racialized, dehumanizing, or real-location targeting.

## Visual Direction

- Low-poly, readable silhouettes, chunky props, exaggerated colors.
- Day palette: warm concrete, cyan signage, hot pink ad boards, yellow UI accents.
- Night palette: dark asphalt, violet shadows, toxic green fog, neon orange warning lights.
- World detail through density: posters, cones, trash bags, benches, scooters, tents, newspaper boxes, vending machines, caution tape, goofy shop signs.
- Character design: expressive but simple, with clear outfit upgrades and readable weapon poses.
- Current reference standard: a simpler top-down low-poly sandbox board with readable districts, clear player movement, compact arcade HUD, top-right map/time cluster, survival meters, and direct action prompts. The earlier cinematic street target is now a visual reference for tone only, not the camera direction.
- Current visual baseline: `visual=target` now acts as the fresh top-down prototype direction. It uses an orthographic camera, low district footprints instead of tall facade corridors, clear labeled zones for Camp/Park/Kiosk/Alley/Busk, simple actors, corrected lane-aligned moving cars, pickups, cones, peels, and a readable top-down board. The June 14 simplification pass moved mid-block buildings out of roads, narrowed road strips, reduced loose props, softened the overbright lighting, shifted the palette away from monotone gray/tan, and slimmed the target-mode HUD so the playfield reads first. The second visual pass added continuous sidewalk bands, dashed center road lines that break at intersections, quieter crosswalks/stop bars, unified the road surface, removed the oversized colored district floor plates, moved trees/tents/trash/cones/pickups out of road rectangles, removed the remaining green/yellow landmark pads and pastel lot blocks, and neutralized the sidewalk/curb fills. District readability should come from landmarks, signs, props, and labels rather than giant colored squares. Remaining visual work should focus on stronger silhouettes and readable enemy/civ/cop icons.
- Big-map baseline: the top-down board is now roughly five times the old playable area (`260x196` versus `118x86`) with five uneven north/south roads, five uneven east/west roads, generated traffic lanes, clamped camera framing, relocated districts, more edge blocks, small service alleys, and landmark clusters instead of a symmetrical 3-by-3 grid.
- Environmental detail pass: the larger map now has a curated street-furniture layer with extra trees, trash cans, newspaper boxes, planters, street lights, cardboard piles, pallet stacks, and denser district accents. Detail placement is guarded against roads and building blockers so the scene feels busier without reintroducing road clutter.
- Environmental detail pass 2: sparse blocks now get additional trees, hydrants, bus stops, vending machines, bike racks, ground posters, and small clutter clusters. Store names moved from floating sidewalk labels onto roof plaques, while the minimap now shows the current neighborhood name and trait below the map circle.
- Traffic baseline: vehicles now spawn as mixed compacts, sedans, taxis, pickups, vans, and box trucks. Each vehicle keeps size/speed/braking state, checks forward footprints for people and other cars, yields at intersections using simple priority, and contributes a dynamic collision footprint so actors cannot walk through vehicles.
- Traffic deadlock pass: same-lane cars and pedestrians remain hard stops, while perpendicular traffic alternates on a lightweight signal timer so cars queue before intersections, then clear without overlap or permanent freezes.
- Traffic collision polish: after vehicle updates, actors get nudged out of any vehicle footprint edge case so a pedestrian cannot become wedged inside a car blocker and freeze the lane.
- Traffic overlap safety net: if two vehicles still touch during a signal flip, one backs up along its lane and waits, preventing long-lived car/car overlaps or gridlock.
- Traffic density tuning: target-mode now uses one mixed vehicle per lane, and non-player actors blocking traffic for too long are nudged back to the nearest sidewalk so vehicle queues recover.
- Pedestrian baseline: civilians now spawn on sidewalk strips, usually walk within the same sidewalk segment, and occasionally choose a cross-road target so traffic has believable people to stop for without NPCs wandering through lanes constantly.

## File Plan

First playable files:

- `games/unhoused-and-unhinged.html`
- `assets/js/unhoused-and-unhinged-topdown.js`
- `assets/img/mockup/card-unhoused-and-unhinged.png`

Later asset folders:

- `assets/models/unhoused/characters/`
- `assets/models/unhoused/props/`
- `assets/models/unhoused/city/`
- `assets/textures/unhoused/`

Site integration:

- Add a card to `index.html`.
- Add a catalog card to `games.html`.
- Update `README.md` game list and parody disclaimer.

## Prototype Architecture

Use one JS file at first to match the current site, but keep clear sections:

- constants and content tables
- DOM handles and HUD helpers
- simulation state
- input mapping
- Three.js setup
- world-building factories
- actor spawning
- day action logic
- chase logic
- night combat logic
- render bridge
- game loop
- reset/pause/end states

If the file grows too large, split later into `assets/js/unhoused/` modules only after the static-site loading plan is clear.

## Milestones

### Milestone 1: Prototype Block

- Low-poly city block renders.
- Player moves with top-down camera.
- HUD updates.
- Day/night timer works.
- No win/loss polish required yet.

### Milestone 2: Day Antics

- Pedestrians wander and react.
- Four actions generate cash/heat/energy changes.
- Basic crowd feedback appears above actors or in HUD prompts.

### Milestone 3: Cop Chase

- Heat threshold spawns or activates cop.
- Cop pursues with simple steering.
- Player can break line/range long enough to cool down.
- Arrest loss state exists.

### Milestone 4: Night Survival

- Night lighting transition.
- Tweeker Zombie spawner.
- Plunger and cone weapon loops.
- Survive-until-morning win state.

### Milestone 5: Complexity Pass

- Add optional prop physics only after the top-down board is stable.
- Add shop/upgrades.
- Add more weapons and enemy types.
- Add saved high score or best cycle.

### Milestone 6: Site Release

- Poster/card art.
- Home/catalog integration.
- README update.
- Browser playtest desktop and mobile viewport.
- Static deploy verification when pushed live.

## Open Questions

- Should the player be a named character, a character creator, or a rotating cast?
- Do we keep the title `Unhoused and Unhinged`, or use it as an internal working title while testing alternatives?
- Should the main score be cash earned, nights survived, chaos rating, or dignity/reputation balance?
- Should cop interactions be purely cartoon chase mechanics, or include warning/dialogue states?
- Should mobile support ship in first playable or second pass?
- Do we want generated poster art before prototype, or after the world has a stronger look?
