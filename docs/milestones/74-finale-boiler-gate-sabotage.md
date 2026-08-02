# Milestone 74 - Finale boiler and gate sabotage

## Status

The boiler-and-gate route and Victory Feast key-theft expansion were published on 2026-08-01. The instant keyring-pickup follow-up is implemented locally and awaiting its next requested publish.

## Player route

1. Open the Wine Cellar cabinet and take the physical crowbar.
2. Unlock the Workroom, open its tool cabinet, and take the physical boiler crank.
3. Complete all three competitions and report to the Victory Feast. A small physical keychain is visible hanging from Mr. Feast's right waist throughout the ceremony.
4. When the Feast Father appears, the escape opens with `Find a way to escape. Don't get caught.` Every front and terrace door is locked. Trying one reveals: `You need a key. You noticed one hanging from Mr. Feast's waist.`
5. Throw a portable object or activate the piano, laundry wringer, or service bell so Mr. Feast leaves to investigate the sound. While he is distracted, sneak behind him and press E/touch Interact once to take the moving physical keyring instantly. Approaching from the front is refused, but a valid interaction has no hold or timed-action window.
6. Use the stolen keyring to unlock and open a front or terrace door. Unopened exterior doors remain locked, while the opened route remains usable.
7. Fit the crank to the Boiler Room's main cutoff. This kills every house and exterior light circuit, disables the cameras, and removes power from the front-gate motor.
8. Reach the driveway gate and use the crowbar to tear the jammed latch free. Both gate leaves swing open, their collision barrier is disabled, and the escape is completed.

The crowbar and crank may be discovered before the finale, but the Boiler Room cutoff is not interactive until the Feast Father chase begins. The gate likewise withholds all solution language before that chase. Mr. Feast's keychain appears only once the Victory Feast is called; it is visible but cannot be taken during the ceremony, then becomes interactive when the chase starts.

## House-exit language contract

- Chase begins: `Find a way to escape. Don't get caught.`
- Exterior door, key missing: `You need a key. You noticed one hanging from Mr. Feast's waist.`
- Key interaction without a sound distraction: `Mr. Feast is guarding the keys. Throw something or use an object that makes sound to draw him away.`
- Sound active, player not behind him: `He followed the sound. Sneak behind him and take the keyring.`
- Successful theft: `You slip the keyring from his waist. The front and terrace doors can now be unlocked.`

## Gate language contract

- Before the Feast Father chase: `Locked. I guess we're stuck here.`
- Chase active, power still on: `The gate is locked. Cut off the power source.`
- Chase active, power cut, crowbar missing: `The power is cut, but the gate is jammed. Find something to pry it open.`
- Chase active, power cut, crowbar owned: `Pry the jammed gate open with the crowbar.`

## Persistence and failure rules

- Crowbar, crank, and estate-keyring ownership use the existing Contestant 13 Bag inventory and save whitelist.
- A save made during the transient Victory Feast chase keeps collected tools and keys but returns the finale to its safe Dining Room report checkpoint, matching the existing replay-safe policy.
- A catch or restored checkpoint resets the house-exit locks, cutoff, exterior lighting, gate leaves, and gate collider. It does not duplicate or remove owned tools or keys.

## Acceptance criteria

- The crowbar is visible and interactable only while the Wine Cellar cabinet is open and disappears after collection.
- The crank follows the same rule in the Workroom tool cabinet.
- A modeled brass keychain hangs at Mr. Feast's right waist during every Victory Feast phase until it is stolen; its three keys use a restrained `0.84×` visual scale while the forgiving interaction hitbox remains unchanged.
- The keychain is visual foreshadowing during the ceremony and only becomes interactable during the escape chase.
- All front and terrace doors close and lock at chase start, and a locked-door interaction points back to the waist key.
- Neither an undistracted approach nor an approach from in front of Mr. Feast can take the keys.
- Both a thrown-object impact and an active mansion sound prop can create the distraction window; one rear, close-range E/touch interaction during that window immediately adds the keyring to the Bag and removes it from his waist in the same input turn.
- The stolen keyring unlocks one selected exterior door without silently unlocking every other door.
- The Boiler Room cutoff exposes no interaction before the Feast Father chase.
- During the chase, the cutoff requires the crank and supplies a missing-crank clue when needed.
- Cutting power switches off all circuits, disables camera operation, changes the gate clue, and leaves the gate physically blocked.
- The gate cannot be opened before the chase, while powered, or without the crowbar.
- With power cut and crowbar owned, a timed pry interaction opens both physical leaves, disables collision, stops finale threats, and marks escape complete.
- Keyboard E and touch Interact share the existing interaction system for every step.
- Focused browser QA covers the feast key visual, escape tip, locked-door clue, both sound-distraction categories, rear-position requirement, door unlock, and the complete conditional boiler/gate route. The existing Victory Feast and distraction regressions remain green.
