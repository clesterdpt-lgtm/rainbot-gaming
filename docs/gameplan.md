# Mr. Feast's Mansion

## Pitch

A first-person parody-horror game in which a contestant enters a million-dollar reality challenge inside a lavish mansion, discovers that losing contestants are being served to a secret elite audience, and turns the show's own house and production systems against its host.

## Core gameplay loop

Explore the mansion, inspect suspicious objects, connect clues left by previous contestants, recover tools and keys, unlock restricted evidence, sabotage production systems, and hide from or evade Mr. Feast as the show becomes openly hostile. The current vertical slice begins with one subtly misfiled book among the Library shelves, sends the player to the garden for a shovel and the hedge maze for a buried basement key, then continues through the locked basement to the Archive and keypad-gated Workroom.

## Game rules

- The player explores in first person and interacts with doors, switches, furniture, clues, tools, locks, hiding places, and sabotage targets.
- The player can trade stamina for sprint speed, or crouch for slower movement with a quieter, less-visible stealth profile.
- Brass-tagged public surveillance cameras visibly scan most major rooms and exterior approaches. Ordinary filming is permitted in show spaces, but observed sabotage raises an alarm; unlocked basement zones treat sightings as trespass, and any alarm or patron-feed sabotage starts a global lockdown in which all camera sightings are hostile.
- Camera exposure builds over a short readable grace period, slows while crouched, and stops behind solid cover or inside an active hiding place. An alarm sends Mr. Feast to investigate the last reliable camera sighting before he returns to patrol if the player escapes or hides.
- `Tab` opens and closes a combined inventory and clue dossier; `Escape` opens the mansion menu for resume, maximize, explicit save/load, and reversible testing utilities.
- The investigation HUD stays hidden until the player discovers Contestant 13's first clue, so initial exploration does not explicitly direct them to the Library.
- Discovery chains may be approached out of order, but rewards, journal entries, and progression flags must remain consistent and non-duplicating.
- The basement begins as a restricted threshold: its service-stair door requires the hedge-maze key before the Archive evidence and Workroom sabotage trail can advance.
- The former Workshop and Cold Room are one security Workroom with a single persistent PIN-locked entrance. Its eight-screen wall shows paged live views from the public camera network; discovery of the current combination is intentionally deferred.
- Mr. Feast is a physical host character whose presentation should remain controlled and camera-friendly until threat cues expose something inhuman beneath it.
- The current camera network can divert Mr. Feast into a bounded investigation/search response. Direct host vision/hearing, continuous pursuit, capture, combat, and a failure state require later milestones.
- Vertical-slice progress resets on reload unless the player explicitly restores a saved mansion state from the Escape menu.

## Win / lose conditions

- **Target win:** complete the investigation and sabotage chain, expose or disable the show, and reach the eventual escape/exposure ending.
- **Target loss:** Mr. Feast captures the contestant and the final scene reveals them on the banquet table before the elite audience.
- The current 20–30 minute vertical slice ends after disabling the patron camera feed; the final win/loss sequence is not implemented yet.

## Art style

First-person 3D gothic manor horror with a sleek reality-show veneer: storm-dark rooms, aged ivory and brass, oxblood accents, expensive tailoring, controlled compositions, and unsettling asymmetry. Mr. Feast should look polished rather than monstrous; his threat comes from restraint, eye contact, delayed reactions, and a smile that becomes subtly impossible.

AI-assisted concept art, textures, and source models are acceptable when they are refined, optimized, validated, and integrated locally through Blender. Runtime assets remain GLB-compatible with the existing Three.js browser renderer.

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
