# Milestone 67: Breath Stealth

## Status

Implementation and automated acceptance complete; user balance playtest remains.

## Objective

Make low energy intensify breathing during pursuit. A winded player breathes faster and louder when Mr. Feast or the Saint is hunting nearby, while calm exploration remains silent and a deliberate hold-breath action can suppress pursuit sound for an energy-scaled period.

## Scope

- Keep sprinting tied to the existing energy reserve without playing breathing during calm exploration.
- Play breathing only during active Mr. Feast pursuit/search or the active finale Saint hunt, with no post-threat fear tail.
- Drive pursuit-breath playback rate and gain continuously from the current energy ratio: slower/quieter when full, faster/louder when empty.
- Add a hold-breath meter with a linear five-second capacity at zero energy and forty-five-second capacity at full energy.
- Bind hold breath to desktop Space and a contextual hold-to-use touch control.
- Stop energy recovery while breath is held.
- Cancel a held breath with a gasp if the player begins sprinting.
- Force a gasp and one-second hold lockout when the hold meter empties.
- Let Mr. Feast hear a maximum of six metres and the Saint hear a maximum of seven metres, subject to the same acoustic room and wall/closed-door occlusion.
- Give curtains almost no sound reduction and the coat closet a thirty-five-percent hearing-range reduction; neither hiding place grants silence.
- Let a first heard breath start or reacquire Mr. Feast pursuit at the last-heard position regardless of his facing. Continued breathing or a forced gasp after he reaches the hiding place can expose and catch the player.
- Use local recorded breathing through the existing trusted-gesture Web Audio mix: one inhale/exhale section of `breathloop02` for pursuit and `breathloop01` for pursued hold-release/forced gasp, with the procedural grammar only as a decode/load fallback.
- Keep that single inhale/exhale section continuous for the full pursuit state and change its rate/gain without restarting; preserve discrete AI-hearing events.
- Preserve deterministic QA, save/load normalization, desktop/mobile layout, and the captured-at-dinner breathing scene.

## Out of scope

- Voice acting beyond the two approved local breathing recordings.
- A whole-house propagation graph, sound reflections, vents, floor-to-floor leakage, or sound through open exterior space.
- Rebalancing footsteps, camera vision, crouch visibility, Mr. Feast movement speed, or Saint flashlight stun tuning.
- Workroom sabotage, gate escape, or the completed finale ending.

## Dependencies

- **Depends on:** Milestone 35 player stamina; Milestone 46 Mr. Feast pursuit; Milestone 62 curtain hiding; Milestone 64 captured-at-dinner breathing; Milestone 66 Victory Feast Saint.
- **Blocks:** Final escape pressure/balance playtest.

## Acceptance criteria

- [x] A named `BREATH_STEALTH` table and focused `BreathStealthSystem` own strain, fear, hold state, sound cadence, hearing, and diagnostics in centralized mansion state.
- [x] Walking, stillness, sprinting, and post-sprint recovery remain silent outside pursuit. Actual sprint time still drains the existing reserve used by breath intensity and hold capacity.
- [x] Hold capacity is a linear `5s` at zero energy through `45s` at full energy. Space and the contextual touch button share one hold state and accessible meter.
- [x] Holding suppresses breath audio and AI hearing and pauses energy recovery. During pursuit, sprinting cancels the hold with a gasp; exhausting it forces a gasp and a `1s` lockout. Calm hold/release does not play breathing.
- [x] Active Mr. Feast pursuit/post-chase search or an active finale Saint creates light scared breathing at full energy. Camera observation and camera-alarm last-seen response alone remain silent, and the loop stops immediately when pursuit ends.
- [x] Pursuit uses one continuous local `breathloop02` source limited to the first complete inhale/exhale (`0.04s`–`0.82s`). It repeats without a restart gap, changes rate and gain without replacing the source, and stops with a short fade when pursuit ends or the player holds.
- [x] The pursuit loop interpolates continuously from `0.72×` playback/`0.16` gain at full energy to `1.18×`/`0.70` at empty energy. Pursued hold release and forced gasp use local `breathloop01` once at `0.96×`/`0.68`; recorded sources never stack, and both retain the prior procedural fallback.
- [x] Heavy breath reaches Mr. Feast only inside `6m` and the Saint only inside `7m`, only within the same authored room and with no wall or closed door between listener and player. Listener facing is irrelevant.
- [x] Curtain hiding retains at least `95%` of the hearing range. The coat closet applies a `0.65` range multiplier. Both still allow a nearby listener to hear.
- [x] Mr. Feast treats the first audible breath as a bounded position clue that starts or reacquires real pursuit. A breath behind him makes him turn and route to the last-heard point without granting visual tracking; continued breathing or a forced gasp at the reached hiding place exposes the player through the existing catch rules.
- [x] During the Victory Feast escape, the Saint can investigate a hidden player's last audible position without reading later silent movement; continued close breathing or a forced gasp can expose the player.
- [x] Save/load preserves respiratory strain but clears transient holding, lockout, emitted sound, and active hearing events. Game-over and scene cleanup cannot leak hold state or gameplay breath sources into the banquet tableau.
- [x] `render_game_to_text()` and `window.MrFeastFresh` expose hold capacity/remaining time, strain/tier, pursuit state, current energy-driven rate/gain, loop bounds, emitted breaths/gasps, hiding attenuation, and listener results.
- [x] Desktop and `390×844` touch presentation remain readable, every contextual touch target is at least `44px`, and the captured-at-dinner breathing regression remains green.
- [ ] User playtest confirms breathing is readable without becoming constant noise, holding breath feels tense rather than tedious, and same-room hearing feels fair in curtains and the coat closet.

## Exit condition

The player can sprint away in silence until a real hunt begins, then hear the same inhale/exhale cycle become faster and louder as energy falls, enter a hiding place, and hold Space or the contextual touch control to stay silent. The available hold time clearly reflects the existing reserve from five to forty-five seconds. Pursuit breathing can redirect a same-room threat; running or running out of air while pursued creates a gasp; and continued noise at the hiding place can expose the player without granting either enemy impossible through-wall hearing.

## Test plan

1. Add `scripts/test-mr-feast-breath-stealth.mjs` first and confirm its source contract fails on the missing named system.
2. Implement the centralized system, recorded Web Audio cues with procedural fallback, hiding attenuation, listener handoffs, HUD, input, persistence, and QA controls.
3. Use deterministic browser probes for all capacity endpoints, calm sprint silence, full/half/empty pursuit playback, immediate pursuit cleanup, gasp paths, hearing ranges, room/occlusion gates, and direction-independent first-hear pursuit.
4. Let real AudioContext time cross the authored inhale/exhale section and prove the same single source remains active with at least one completed cycle and no restart/stack; then capture desktop and `390×844` hidden/hold states after inspecting `render_game_to_text()`.
5. Run runtime/test syntax, the focused suite, player systems, audio, pursuit, curtains, Victory Feast, banquet loss, full Contestant 13, renovation, and `git diff --check`.

## Automated verification results

- The red-first focused contract stopped on `missing named BREATH_STEALTH tuning table`. The completed browser suite proves calm silence, actual sprint strain, light/heavy/panicked tiers, exact `5s`/`45s` capacity endpoints, Space and touch hold/release, paused recovery, sprint/empty gasps, one-second lockout, four-second fear tail, camera-only non-aggro, both hearing maxima, room/occlusion gates, hiding attenuation, bounded Mr. Feast investigation, close hidden exposure, persistence normalization, and desktop/phone presentation.
- The recorded-audio refinement then failed red on `breathloop02 must be the recorded sprint/recovery breath asset`. Green browser diagnostics prove both local OGG files decode after audio unlock, loop02 owns sprint recovery, loop01 owns held-breath release, and the fully rested fear profile is both slower and quieter than the exercised heavy sprint profile without changing AI-hearing authority.
- The continuity refinement failed red on `audible breathing needs a lifecycle-owned continuous loop`. The original 3.5-second source skipped cadence events while playing, ended after roughly four breaths, and waited for the next event before restarting. Green browser diagnostics now hold one looping source past `5s` and at least one completed cycle with no restart or overlap, then prove it fades out when the fear tail ends. An FFmpeg seam probe over four loop cycles found no silence of `0.25s` or longer.
- The pursuit-energy refinement failed red on `the recorded loop must begin at the authored inhale-exhale section`. Green real-AudioContext proof now starts at `0.04s`, loops at `0.82s`, keeps one source through full/half/empty energy transitions, raises rate/gain monotonically as the reserve falls, keeps calm sprinting and hold/release silent, and fades immediately when pursuit ends.
- The pursuit-gate refinement failed red on `empty-energy pursuit breathing peak gain must be lowered to 0.70`. Green browser probes now cap the empty-energy loop at `0.70`, stage a camera alarm that remains non-aggro for breathing, and separately stage a real Mr. Feast pursuit that still activates the loop.
- The direction-independent hearing refinement failed red on `a heard breath needs a bounded direction-independent pursuit clue`. Green browser proof places Mr. Feast `3m` away and facing directly away from a player concealed behind a real curtain. The event is heard with no facing requirement, starts pursuit with `reason: breathing`, keeps direct sight false, turns him toward the last-heard point, and creates a physical response route while the existing room, range, wall, and closed-door gates remain authoritative.
- The Victory Feast suite additionally stages a real hidden coat-closet event: the Saint hears the partially muffled breath, switches to the last audible position, and physically advances toward it without receiving later silent live tracking.
- Inspected visual proof is `output/playwright/mr-feast-breath-stealth/breath-stealth-desktop.png` and `breath-hold-mobile.png`. The phone layout keeps every contextual action at least `44px`; the persistent baseline controls occupy `22.93%` of the `390×844` stage after the adjacent touch-row correction.
- Runtime and changed-test syntax, focused Breath Stealth, Player Systems, Victory Feast, mansion audio, caught pursuit, all-window curtains, banquet loss, Feast Hunt, full desktop/mobile Contestant 13, and the relevant static contract pass. The renovation audit retains only its unrelated current-origin `28 stairwell continuity` failure. User approval of breathing cadence, hold tension, and hiding fairness remains open.
