# Mr. Feast's Mansion

## Pitch

A first-person parody-horror game in which a contestant enters a million-dollar reality challenge inside a lavish mansion, discovers that losing contestants are being served to a secret elite audience, and turns the show's own house and production systems against its host.

## Core gameplay loop

Alternate between sanctioned reality-show competitions and separate free-roam investigation periods. During investigation, inspect suspicious objects, connect clues left by previous contestants, recover tools and keys, unlock restricted evidence, sabotage production systems, and hide from or evade Mr. Feast as the show becomes openly hostile. The current clue spine begins with one subtly misfiled book among the Library shelves, sends the player to the garden for a shovel and the hedge maze for a buried basement key, then continues through the locked basement to the Archive and keypad-gated Workroom.

## Game rules

- A fresh run opens with Mr. Feast waiting just inside the front door to deliver a slow, suspicious reality-show briefing: the player is competing for one million dollars, selected public rooms and grounds are introduced, cameras are normalized, and the basement is explicitly forbidden. Player movement and ordinary interactions remain locked until the complete welcome ends, after which Mr. Feast resumes his foyer patrol and exploration begins without exposing the hidden Contestant 13 objective.
- The first sanctioned competition is `Feast Says`. Mr. Feast calls it after ten active minutes of post-welcome exploration or immediately after the player's first major clue discovery. The triggering clue remains earned, but new clue progression pauses until the player reports to the Ballroom and completes the competition.
- Feast Says opens by teaching the actual rule: obey an instruction only when it begins with `Feast says`; the lowest score is eliminated. It then uses a fixed sequence of six calls: genuine step left, a plain `Step right` fake-out, genuine step back, a plain `Crouch` fake-out, point to the contestant you distrust most, then step toward the contestant you would sacrifice. The correct response to either fake-out is to hold still. The genuine physical calls use ordinary movement input; the distrust choice uses the player's look plus E or touch Interact, and the sacrifice choice reads actual world-direction movement toward a staged contestant. Each command lasts 7.5 seconds and each result lasts 6 seconds, giving an authored anxious or funny contestant line time to land before Mr. Feast cuts in with a warning. Mara, Kip, and Juniper make distinct psychological choices, including choices that target the player. Their crouch and sidestep responses use an isolated planted procedural pose layer that resets from a captured base and cannot accumulate, while backpedal and target-facing point gestures remain readable. Authored scoring makes Kip the first NPC elimination when the player survives. He remains on his mark in a visibly upset pose for a pathetic plea and an ominous answer from Mr. Feast while Mara and Juniper walk back to their Library and Reading Room routines. Their first conversation afterward reflects the game, then their normal dialogue resumes. Once the player gets significantly out of sight upstairs, in the basement, outdoors, or far across the main floor, Kip disappears offscreen and Mr. Feast resumes his patrol. A player loss is an `ELIMINATED` game-over state with load/restart recovery.
- The second sanctioned competition is `Storm Run`. It becomes eligible when Feast Says ends, then triggers after ten active exploration minutes or immediately after the next newly earned major clue. That clue remains earned and later clue progress pauses until the race resolves.
- Storm Run sends the player, Mara, and Juniper through twelve ordered breadcrumb checkpoints spread across the existing grounds, including one inside the hedge maze. After the first marker, the route continues north through the formal garden's clear east lane, crosses its front edge around the fountain and beds, and reaches the front drive through a dedicated carriage-turn marker instead of doubling back toward the start. It then loops along the east grounds, through one maze pass, and around the rear lawn to the pool finish. Each active checkpoint has a tall blue beacon and raised guide that is visible from the previous marker, so the route can be followed without relying on the contestants. Mara runs at `2.4 m/s` and Juniper at `2.5 m/s`, leaving recovery room beneath the player's stamina-limited `3.75 m/s` sprint; the player must reach checkpoint twelve before Mara to survive and eliminate her.
- Lightning in Storm Run is a scare cue, never a gameplay hazard. Mr. Feast appears exactly twice: once up the front drive and once in a straight hedge-maze corridor. Both reveals place him `4.5–5m` dead ahead in a measured deep-shadow position with clear line of sight. A dedicated close-bolt profile fires a nearly immediate sharp crack over a `1.7x` recorded thunder roll and illuminates the surrounding grounds more strongly than ordinary lightning. Mr. Feast is visible only while that brighter multi-pulse flash is active and vanishes as soon as darkness returns, always within `1.2s`, without damage, slowdown, knockback, or a time penalty. Ordinary ambient lightning keeps its existing timing, brightness, and volume.
- Competition timers and scoring are separate from clue hunting. Later competitions will establish later investigation ceilings rather than placing clue objectives inside their minigames.
- The player explores in first person and interacts with doors, switches, furniture, clues, tools, locks, hiding places, and sabotage targets.
- The player can sit on available chairs and sofas with the normal E/touch interaction. Sitting is an observable, non-hidden state: movement, sprinting, and crouching stop until the player stands, while looking, menus, cameras, and danger continue to work.
- Mansion seats have exclusive occupancy. Mara, Kip, and Juniper spend most of their ambient time seated, then occasionally stand, walk a compact room-scale route, and settle at another hangout without blocking Mr. Feast's authored patrol or the player's core circulation. A 240-second hard ceiling prevents any contestant from occupying one spot for five minutes, and every stand-up must end at a distinct non-seat hangout before reseating. Standing idle contestants use relaxed arms-down poses rather than shrugging or holding their hands up; seated idles keep hips and feet planted while the torso breathes, shifts, and glances; and sit/stand movement blends smoothly instead of snapping.
- The player can trade stamina for sprint speed, or crouch for slower movement with a quieter, less-visible stealth profile.
- Brass-tagged public surveillance cameras visibly scan most major rooms and exterior approaches. Ordinary filming is permitted in show spaces, but observed sabotage raises an alarm; unlocked basement zones treat sightings as trespass, and any alarm or patron-feed sabotage starts a global lockdown in which all camera sightings are hostile.
- Camera exposure builds over a short readable grace period, slows while crouched, and stops behind solid cover or inside an active hiding place. Camera HUD feedback stays transient and text-first: `Spotted` during blinking acquisition and `Being recorded` after tracking locks. An alarm sends Mr. Feast to investigate the last reliable camera sighting before he returns to patrol if the player escapes or hides.
- Getting caught has real consequences: tampering while Mr. Feast personally watches or while `Being recorded`, and any seen or hostile-recorded presence in the basement, starts a run-toward-the-player pursuit that is always hard-capped below walking speed. A catch on the main or second floor is a spoken warning; a catch anywhere in the basement is game over with load/restart options. Hiding is uncatchable, and the chase only expires after he loses sight of the player.
- `Tab` opens and closes a combined inventory and clue dossier; `Escape` opens the mansion menu for resume, maximize, explicit save/load, and reversible testing utilities.
- The investigation HUD stays hidden until the player discovers Contestant 13's first clue, so initial exploration does not explicitly direct them to the Library.
- Discovery chains may be approached out of order, but rewards, journal entries, and progression flags must remain consistent and non-duplicating.
- The basement begins as a restricted threshold: its service-stair door requires the hedge-maze key before the Archive evidence and Workroom sabotage trail can advance.
- The former Workshop and Cold Room are one security Workroom with a single persistent PIN-locked entrance. Its eight-screen wall shows paged live views from the public camera network; discovery of the current combination is intentionally deferred.
- Mr. Feast is a physical host character whose presentation should remain controlled and camera-friendly until threat cues expose something inhuman beneath it; his locomotion should pivot before travel and read as planted, restrained, and propulsive rather than skating.
- The current camera network can divert Mr. Feast into a bounded investigation/search response. Direct host vision/hearing, continuous pursuit, capture, combat, and a failure state require later milestones.
- Vertical-slice progress resets on reload unless the player explicitly restores a saved mansion state from the Escape menu.

## Win / lose conditions

- **Target win:** complete the investigation and sabotage chain, expose or disable the show, and reach the eventual escape/exposure ending.
- **Target loss:** Mr. Feast captures the contestant and the final scene reveals them on the banquet table before the elite audience.
- The current 20–30 minute vertical slice ends after disabling the patron camera feed; the final win/loss sequence is not implemented yet.

## Art style

First-person 3D gothic manor horror with a sleek reality-show veneer: storm-dark rooms, aged ivory and brass, oxblood accents, expensive tailoring, controlled compositions, and unsettling asymmetry. Mr. Feast should look polished rather than monstrous; his threat comes from restraint, eye contact, delayed reactions, and a smile that becomes subtly impossible.

AI-assisted concept art, textures, and source models are acceptable when they are refined, optimized, validated, and integrated locally through Blender. Runtime assets remain GLB-compatible with the existing Three.js browser renderer.

The estate's authored sculpture language is creepy elegance rather than gore: a faceless Weeping Crown courtier above the formal-garden fountain and the Listening Host and Veiled Waltz flanking the Grand Foyer. Their physically impossible poses should first read as expensive neoclassical commissions, then become unsettling at closer range.

## Audio direction

Sparse, oppressive sound design: storm ambience, distant mansion mechanisms, footsteps, restrained musical drones, and brief stingers tied to discoveries or threat escalation. Full dialogue performance and lip synchronization are deferred; silence and controlled breathing should carry close encounters first.

## Player goals

- **Short term:** understand each clue, find the required object, and reach the next restricted space without losing orientation.
- **Vertical slice:** complete Contestant 13's evidence trail and disable the patron feed.
- **Long term:** sabotage enough of the show to expose or escape it while surviving Mr. Feast.

## Anti-goals

- No combat-heavy power fantasy.
- No open world outside the mansion estate.
- No multiplayer for the initial game.
- No broad collection grind or procedural roguelike structure.
- No direct likeness, branding, or claim of affiliation with a real person or company.

## References

- Social-survival horror and elite-spectator stories inform the hidden-show premise.
- Slow-burn first-person mansion horror informs exploration, spatial memory, and tension.
- Reality-challenge video language informs the polished host persona and production sabotage.

## Open questions

- How many independent sabotage systems the final game requires before the escape/exposure ending unlocks.
- Whether Mr. Feast's eventual search behavior is systemic, authored, or a hybrid.
- How much voiced dialogue the full game needs after the silent facial-performance milestone.
