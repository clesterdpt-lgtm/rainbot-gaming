# Milestone 67: Breath Stealth

## Status

Implementation and automated acceptance complete; user balance playtest remains.

## Objective

Make sprinting create an audible stealth consequence. A winded player breathes heavily enough for a nearby Mr. Feast or the Saint to investigate even when the player is hidden, while a deliberate hold-breath action can suppress that sound for a stamina-scaled period.

## Scope

- Build respiratory strain from actual sprinting and let it recover while the player is not sprinting.
- Keep a fully rested walking player silent.
- Add light scared breathing during active pursuit/search and for a four-second fear tail after danger breaks.
- Add a hold-breath meter with a linear five-second capacity at zero energy and forty-five-second capacity at full energy.
- Bind hold breath to desktop Space and a contextual hold-to-use touch control.
- Stop energy recovery while breath is held.
- Cancel a held breath with a gasp if the player begins sprinting.
- Force a gasp and one-second hold lockout when the hold meter empties.
- Let Mr. Feast hear a maximum of six metres and the Saint hear a maximum of seven metres, subject to the same acoustic room and wall/closed-door occlusion.
- Give curtains almost no sound reduction and the coat closet a thirty-five-percent hearing-range reduction; neither hiding place grants silence.
- Route a first breath sound into investigation. Continued breathing or a forced gasp after the listener reaches the hiding place can expose and catch the player.
- Use the existing Web Audio mix and procedural player-breath grammar without adding an autoplay path or downloaded sound asset.
- Preserve deterministic QA, save/load normalization, desktop/mobile layout, and the captured-at-dinner breathing scene.

## Out of scope

- Voice acting or recorded breathing samples.
- A whole-house propagation graph, sound reflections, vents, floor-to-floor leakage, or sound through open exterior space.
- Rebalancing footsteps, camera vision, crouch visibility, Mr. Feast movement speed, or Saint flashlight stun tuning.
- Workroom sabotage, gate escape, or the completed finale ending.

## Dependencies

- **Depends on:** Milestone 35 player stamina; Milestone 46 Mr. Feast pursuit; Milestone 62 curtain hiding; Milestone 64 captured-at-dinner breathing; Milestone 66 Victory Feast Saint.
- **Blocks:** Final escape pressure/balance playtest.

## Acceptance criteria

- [x] A named `BREATH_STEALTH` table and focused `BreathStealthSystem` own strain, fear, hold state, sound cadence, hearing, and diagnostics in centralized mansion state.
- [x] Full-energy walking and stillness remain silent. Actual sprint time drains the existing energy reserve, raises respiratory strain, and progresses through light, heavy, and panicked breath tiers.
- [x] Hold capacity is a linear `5s` at zero energy through `45s` at full energy. Space and the contextual touch button share one hold state and accessible meter.
- [x] Holding suppresses breath audio and AI hearing and pauses energy recovery. Sprinting cancels the hold with a gasp; exhausting it forces a gasp and a `1s` lockout.
- [x] Active Mr. Feast pursuit/investigation or an active finale Saint creates light scared breathing at rest. Mere camera observation does not. The fear floor lasts exactly four seconds after aggro ends.
- [x] Heavy breath reaches Mr. Feast only inside `6m` and the Saint only inside `7m`, only within the same authored room and with no wall or closed door between listener and player.
- [x] Curtain hiding retains at least `95%` of the hearing range. The coat closet applies a `0.65` range multiplier. Both still allow a nearby listener to hear.
- [x] Mr. Feast treats the first audible breath as a bounded sound investigation rather than instant knowledge/capture. Continued breathing or a forced gasp at the reached hiding place exposes the player and resolves through the existing pursuit/catch rules.
- [x] During the Victory Feast escape, the Saint can investigate a hidden player's last audible position without reading later silent movement; continued close breathing or a forced gasp can expose the player.
- [x] Save/load preserves respiratory strain but clears transient holding, lockout, emitted sound, and active hearing events. Game-over and scene cleanup cannot leak hold state or gameplay breath sources into the banquet tableau.
- [x] `render_game_to_text()` and `window.MrFeastFresh` expose hold capacity/remaining time, strain/tier, fear tail, emitted breaths/gasps, current hiding attenuation, and listener results.
- [x] Desktop and `390×844` touch presentation remain readable, every contextual touch target is at least `44px`, and the captured-at-dinner breathing regression remains green.
- [ ] User playtest confirms breathing is readable without becoming constant noise, holding breath feels tense rather than tedious, and same-room hearing feels fair in curtains and the coat closet.

## Exit condition

The player can sprint away, hear their breathing become dangerous, enter a hiding place, and hold Space or the contextual touch control to stay silent. The available hold time clearly reflects the existing energy reserve from five to forty-five seconds. Releasing too soon lets a same-room threat investigate; running or running out of air creates a gasp; and continued noise at the hiding place can expose the player without granting either enemy impossible through-wall hearing.

## Test plan

1. Add `scripts/test-mr-feast-breath-stealth.mjs` first and confirm its source contract fails on the missing named system.
2. Implement the centralized system, Web Audio cues, hiding attenuation, listener handoffs, HUD, input, persistence, and QA controls.
3. Use deterministic browser probes for all capacity endpoints, energy recovery, gasp paths, fear tail, hearing ranges, room/occlusion gates, and first-hear investigation.
4. Capture desktop and `390×844` hidden/hold states after inspecting `render_game_to_text()`.
5. Run runtime/test syntax, the focused suite, player systems, audio, pursuit, curtains, Victory Feast, banquet loss, full Contestant 13, renovation, and `git diff --check`.

## Automated verification results

- The red-first focused contract stopped on `missing named BREATH_STEALTH tuning table`. The completed browser suite proves calm silence, actual sprint strain, light/heavy/panicked tiers, exact `5s`/`45s` capacity endpoints, Space and touch hold/release, paused recovery, sprint/empty gasps, one-second lockout, four-second fear tail, camera-only non-aggro, both hearing maxima, room/occlusion gates, hiding attenuation, bounded Mr. Feast investigation, close hidden exposure, persistence normalization, and desktop/phone presentation.
- The Victory Feast suite additionally stages a real hidden coat-closet event: the Saint hears the partially muffled breath, switches to the last audible position, and physically advances toward it without receiving later silent live tracking.
- Inspected visual proof is `output/playwright/mr-feast-breath-stealth/breath-stealth-desktop.png` and `breath-hold-mobile.png`. The phone layout keeps every contextual action at least `44px`; the persistent baseline controls occupy `22.93%` of the `390×844` stage after the adjacent touch-row correction.
- Runtime and changed-test syntax, focused Breath Stealth, Player Systems, Victory Feast, mansion audio, caught pursuit, all-window curtains, banquet loss, Feast Hunt, full desktop/mobile Contestant 13, and the relevant static contract pass. The renovation audit retains only its unrelated current-origin `28 stairwell continuity` failure. User approval of breathing cadence, hold tension, and hiding fairness remains open.
