# 114 — Saintfall canon and mission presentation

## Status

implemented; awaits user playtest

## Objective

Give the campaign one clean, understandable frame: select a named Saint, receive
a short operation briefing, fall from orbit, reclaim Vesper-IX, then see a
cinematic mission wrap before opening the existing score and high-score record.

## Scope

- Rename the three playable Saints in player-facing surfaces while preserving
  their durable save and URL IDs.
- Record the concise canon in `docs/saintfall-lore-bible.md` and remove the claim
  that the central statue fell from orbit.
- Add a selected-Saint mission briefing between roster confirmation and descent.
- Add a full-screen, AI-generated mission-complete tableau before the existing
  campaign score debrief and shared high-score panel.

## Out of scope

- Renaming internal modules, IDs, save fields, model files, or legacy asset paths.
- Explaining the Saints' full origin, command structure, or the Bloom's biology.
- Changing combat, difficulty, score calculation, boss order, or save schema.

## Dependencies

- **Depends on:** Milestone 112 operative campaign carryover and the existing campaign score/debrief system.
- **Blocks:** none

## Acceptance criteria

- [x] The roster displays Saint Aurel, Saint Veyra, and Saint Torren while keeping `vesper-reliquary`, `white-vigil`, and `bastion-penitent`. — test: `scripts/saintfall-mission-presentation-probe.mjs::canon and durable IDs`
- [x] Confirming a Saint opens a readable mission briefing and does not begin descent until the player activates Begin Saintfall. — test: `scripts/saintfall-mission-presentation-probe.mjs::briefing gates descent`
- [x] The briefing says the Saints descend from orbit, the Bloom destroyed an ancient statue, and the mission is to reclaim Vesper-IX. — test: `scripts/saintfall-mission-presentation-probe.mjs::briefing canon`
- [x] Victory opens a cinematic mission-complete screen using a project-local generated image before the score record is presented. — test: `scripts/saintfall-mission-presentation-probe.mjs::victory wrap gates record`
- [x] View Mission Record reveals final score, high score, and the existing shared high-score action without changing score calculation. — test: `scripts/saintfall-mission-presentation-probe.mjs::record handoff`
- [x] Briefing and victory wrap contain cleanly at desktop, phone portrait, and short phone landscape sizes with hard-edged controls. — test: `scripts/saintfall-mission-presentation-probe.mjs::responsive presentation`
- [ ] The new screens match Saintfall's solemn hard-edged visual language. — verified by user playtest

## Exit condition

User starts New Game, selects any Saint, reads the operation briefing, starts the
drop, completes the operation, sees the reclaimed-basin tableau, and then opens
their score/high-score record.

## Test plan

Run `node scripts/saintfall-mission-presentation-probe.mjs` red before
implementation and green after it. Then run the campaign debrief, character
selector/carryover, save-integrity, and entry-point smoke probes. Capture desktop,
portrait, and landscape screenshots for the briefing and mission wrap.

## Notes

- Display-name changes are intentionally decoupled from durable IDs.
- The generated image contains no text; accessible HTML owns all mission copy.
- Focused gates: mission presentation 26/26, campaign debrief 18/18,
  character selector 12/12, entry handoff 10/10, operative carryover 20/20,
  and save integrity 62/62. Every Saintfall entry point boots clean.
- The broad UI regression remains 97/99 on its two pre-existing assertions:
  complete controls/settings enumeration and the 844x390 Doctrine scan row.
