# Milestone 74 - Finale boiler and gate sabotage

## Status

Implemented locally on 2026-08-01. Not published by this milestone.

## Player route

1. Open the Wine Cellar cabinet and take the physical crowbar.
2. Unlock the Workroom, open its tool cabinet, and take the physical boiler crank.
3. Complete all three competitions and begin the Victory Feast escape so the Feast Father is actively chasing.
4. Fit the crank to the Boiler Room's main cutoff. This kills every house and exterior light circuit, disables the cameras, and removes power from the front-gate motor.
5. Reach the driveway gate and use the crowbar to tear the jammed latch free. Both gate leaves swing open, their collision barrier is disabled, and the escape is completed.

The tools may be discovered before the finale, but the Boiler Room cutoff is not interactive until the Feast Father chase begins. The gate likewise withholds all solution language before that chase.

## Gate language contract

- Before the Feast Father chase: `Locked. I guess we're stuck here.`
- Chase active, power still on: `The gate is locked. Cut off the power source.`
- Chase active, power cut, crowbar missing: `The power is cut, but the gate is jammed. Find something to pry it open.`
- Chase active, power cut, crowbar owned: `Pry the jammed gate open with the crowbar.`

## Persistence and failure rules

- Crowbar and crank ownership use the existing Contestant 13 Bag inventory and save whitelist.
- A save made during the transient Victory Feast chase keeps both collected tools but returns the finale to its safe Dining Room report checkpoint, matching the existing replay-safe policy.
- A catch or restored checkpoint resets the cutoff, exterior lighting, gate leaves, and gate collider. It does not duplicate or remove owned tools.

## Acceptance criteria

- The crowbar is visible and interactable only while the Wine Cellar cabinet is open and disappears after collection.
- The crank follows the same rule in the Workroom tool cabinet.
- The Boiler Room cutoff exposes no interaction before the Feast Father chase.
- During the chase, the cutoff requires the crank and supplies a missing-crank clue when needed.
- Cutting power switches off all circuits, disables camera operation, changes the gate clue, and leaves the gate physically blocked.
- The gate cannot be opened before the chase, while powered, or without the crowbar.
- With power cut and crowbar owned, a timed pry interaction opens both physical leaves, disables collision, stops finale threats, and marks escape complete.
- Keyboard E and touch Interact share the existing interaction system for every step.
- Focused browser QA covers the complete conditional route and the existing Victory Feast regression remains green.
