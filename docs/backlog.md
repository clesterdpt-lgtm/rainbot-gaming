# Backlog

> Deferred ideas remain here until promoted into a milestone. Entries are append-only; completed or rejected items are marked rather than deleted.

## Gameplay & features

- [ ] Mr. Feast detection and pursuit — turn the visual patrol into a fair search/chase system with hiding, capture, and recovery states.
  - Source: 2026-07-15 facial-performance planning
  - Rough size: L · Rough value: L
  - Notes: Camera-driven detection and a bounded investigate/search response were promoted into `docs/milestones/36-camera-surveillance-and-alarm-investigation.md`. Infraction-triggered pursuit with the walk-speed cap, floor warnings, and the basement capture fail state were promoted into `docs/milestones/46-caught-in-the-act.md`. Continuous sight/hearing perception and free-roaming chase outside infractions remain deferred here.

- [ ] Final sabotage and banquet endings — implement the complete escape/exposure win and captured-at-dinner loss sequences.
  - Source: 2026-07-15 gameplan confirmation
  - Rough size: L · Rough value: L

- [ ] Stealth meter refinements — spike sampled light exposure during storm lightning flashes so outdoor sneaking has a rhythm, and surface the meter on phones once the deferred mobile crouch control exists.
  - Source: 2026-07-18 crouch stealth meter build (Milestone 51)
  - Rough size: S · Rough value: M
  - Notes: The Milestone 51 sampler reads live circuit/auxiliary emitters only; `stormSystem` flash intensity and the Milestone 35 mobile crouch button are the two missing inputs.

- [ ] Expand the basement puzzle and sabotage network — add more documents, puzzle/clue chains, house sabotage targets, and a keypad-locked Workshop whose code is learned from in-world evidence.
  - Source: 2026-07-15 basement-key sequence request
  - Rough size: L · Rough value: L
  - Notes: Deliberately deferred from Milestone 34; the current Workshop remains accessible so the existing patron-feed vertical slice can still be completed until the keypad clue chain is designed. The keypad-code-from-in-world-evidence portion landed in `docs/milestones/49-workroom-keycode-scratches.md` (the Painting Room scratch hunt); the broader document/sabotage network remains deferred here.

## Polish & juice

- [ ] Dialogue visemes and lip synchronization — add a restrained 8–12-viseme speech set after voiced dialogue is authored.
  - Source: 2026-07-15 facial-animation discussion
  - Rough size: L · Rough value: M
  - Notes: Depends on approved dialogue audio and the face-retopology item below; deliberately outside milestone 32.

- [x] Retopologize Mr. Feast's face — rebuild animation-ready eyelids, separate eyes/eye controls, clean mouth loops, and an oral cavity before full blinks or dialogue animation. → `docs/milestones/33-mr-feast-face-retopology.md`
  - Source: 2026-07-15 facial-animation discussion
  - Rough size: L · Rough value: L
  - Notes: The Meshy source has thousands of disconnected components. Milestone 32 safely supports micro-expressions, but full closure/opening tears the current surface.

## Tech & refactors

- [ ] Evaluate modularizing the mansion runtime — consider splitting the single static JS file only after core gameplay stabilizes.
  - Source: 2026-07-15 tech backfill
  - Rough size: L · Rough value: M

## Tooling & QA

## Open questions

- [ ] Final sabotage count — decide how many independent house/show systems the full ending requires.
  - Source: 2026-07-15 gameplan confirmation
  - Rough size: S · Rough value: L
