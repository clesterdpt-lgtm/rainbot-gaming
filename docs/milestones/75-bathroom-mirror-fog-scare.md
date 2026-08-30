# Milestone 75: Bathroom Mirror Fog Scare

## Goal

Turn the existing working bathroom plumbing into a quiet optional scare: leave a sink or shower running long enough, watch condensation cover the vanity mirrors, then discover the house's polite threat.

## Player contract

- Either sink or the shower in the Main Hall Bathroom or Upper Grand Bathroom qualifies; bathtub taps and the Kitchen sink do not.
- Fog begins after 12 continuous seconds and reaches full coverage by 22 seconds.
- At 25 seconds the left mirror slowly reveals `GET CLEAN.`
- After the first line and a short pause, the right mirror slowly reveals `DINNER IS SOON.`
- The completed message remains readable while qualifying water continues to run, then clears over seven seconds after shutoff.
- An interrupted attempt recedes instead of snapping away and can be retried.
- Completion is one-shot across the estate and persists through manual/checkpoint saves; transient fog never resumes on load.
- The scare remains an optional physical discovery with no HUD objective or dossier entry.

## Implementation boundary

- Reuse the existing `WaterFixture` lifecycle and bathroom vanity mirror geometry.
- Add one `BathroomMirrorScareSystem`, one named tuning table, four lightweight canvas-textured overlays, save/restore state, and QA diagnostics.
- Add no shader lights, external art, clue progression, competition gates, camera offenses, or Mr. Feast response.

## Acceptance

- Static contracts pin the message, timings, qualifying fixture kinds, runtime/page cache identity, save snapshot, and dedicated diagnostics.
- A real Chromium run proves both bathrooms expose two fog surfaces, a sink produces fog before lettering, the two messages reveal in order, shutoff clears the overlays, completion prevents a second bathroom replay, and save/load preserves completion without restoring transient steam.
- Focused screenshots show the clean paired mirrors, partial first-line reveal, and completed two-mirror message with zero browser-console errors.

## Manual playtest

Run a sink or shower naturally in each full bathroom. Judge whether twelve seconds feels long enough to reward deliberate lingering without being accidental, whether the fog reads as condensation rather than a flat white card, and whether the two-mirror reveal remains legible from the ordinary vanity approach on desktop and phone. Confirm the line lands as a production instruction first and a cannibalistic threat second, then shut off the water and watch for a natural seven-second clear.
