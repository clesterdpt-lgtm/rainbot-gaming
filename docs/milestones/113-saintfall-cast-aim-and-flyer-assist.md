# 113 — One missing line, two broken weapons, and a flyer assist for the cast

**Build:** `20260830-cast-aim-1`

Three reports from play. Two of them turned out to be the same bug.

## `ctx.render` was never published on the campaign

`summit-loadout.aimPoint()` finds the reticle's world point by reading `ctx.render?.camera`. The summit publishes `ctx.render`; so does the atoll; **`main.js` never did.** That was harmless until m111 carried the Kenosis loadout into the campaign, at which point `aimPoint` quietly returned null and every consumer fell back to its own worst case:

| | fallback | measured |
|---|---|---|
| White Vigil crescents | the emitter's rest axis | **56–88° off camera**, firing into the ground |
| Bastion hammer cast | `set(sin(yaw), 0, cos(yaw))` | **exactly 0.0° climb at every camera angle**, including a full 60° look up |

That second fallback is literally a hard-coded horizontal vector, which is precisely the report: the cast would not throw upward at all, so flyers and anything uphill were unreachable. Both symptoms, one line.

After: the crescents land 3.9–6.7° off camera on the campaign against 4–7.6° on the summit (the residual is emitter offset plus the convergence cone, which is the design), and the cast tracks the camera to **62° at the rig's own 60° look limit**.

`hud.js` reaches for `ctx.render?.renderer?.domElement` when it places the reticle, and gets it now too.

## The flyer assist

The cast is the Bastion's entire answer to anything airborne — he cannot fly, the hammer is the only thing he owns that leaves the ground, and a small fast target at thirty metres against open sky is close to unhittable with a chase camera and a thrown weapon. So the throw now **snaps onto a flyer within ~22° of the reticle**, inside the cast's own 46m range, and leads it.

Three deliberate limits:

- **Flyers only.** Ground targets are already reachable, and a magnetised hammer against a Thresher pack would take the aim out of the player's hands.
- **Closest to the reticle axis, not the nearest body.** With two kites in frame the player has already said which they meant by pointing at it; picking by distance would overrule them.
- **Not through cover.** A snap onto something behind masonry spends the cast on a wall and reads as the assist stealing the throw.

`enemies.js` publishes no velocity — a creature is a position that changes — so leading a target means measuring it. The kit keeps one smoothed entry per airborne body, refreshed from the frame delta and dropped when it lands or dies; the throw is then put part of the way toward where the target is going, since the hammer takes about 1.35 seconds to cross its full range.

## Proof

**`scripts/saintfall-bastion-cast-probe.mjs` (new) — 10/10, on both pages.** It sweeps the camera through the rig's full pitch range and requires the throw to *follow* it within 9°, not merely to be non-zero — the bug it replaces produced a clean 0.0 at every angle, which no "does it go up at all" check would have caught. Then it places a flyer well off the reticle axis and requires the snap and a hit, and the same body on the ground at the same offset and requires neither.

Both pages, because the aim bug existed on exactly one of them and looked identical to a design decision from inside the game.

## Two probe faults worth recording

**`live[0]` is not "the enemy I just spawned."** The campaign is a populated world and `clearEnemies()` does not stop its garrisons returning, so the assist test picked a body **684 metres away** and measured that. Subjects are now matched by position.

**The Gate's bolt check was measuring the wrong thing and was flaky for a good reason.** It asserted the player took damage without the wall and none with it; run to run it came back 0 or 1 damaging hits at random. Bolts fired at a Bastion *do* reach him and are then eaten by the tower shield he is holding. What the Gate is for is stopping a bolt **reaching** you, so the check now counts `projectileState().contacts` — 4–7 without the wall, **0** with it, stable across three consecutive runs — and the shield's opinion of the ones that get through is a different system's business.

Regression: entry-point smoke clean on all six, carryover 20/20, commands 32/32, doctrine 24/24, swing 18/18, kit 40/40, arcs 12/12, campaign UI 97/99 (the same two pre-existing failures, proven on a clean-HEAD worktree earlier).
