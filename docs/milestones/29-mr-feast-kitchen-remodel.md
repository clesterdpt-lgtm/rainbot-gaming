# Mr. Feast Kitchen Remodel

## Objective

Replace the loose kitchen furniture with a high-quality, mansion-appropriate working kitchen while preserving the open connection to the ballroom and the separate basement-stair door.

## Acceptance criteria

- A U-shaped antique-marble countertop follows the inner kitchen/ballroom wall, rear wall, and east-lawn wall on one shared height datum.
- Dark-oak base cabinets sit directly beneath every usable counter run; exactly one food cabinet and one dish cabinet remain stocked and interactive.
- The kitchen contains an interactive refrigerator, a recognizable oven/range with a connected hood, and a visible sink basin with a working faucet.
- The faucet toggles through the existing water interaction and reports `kitchen sink` in `waterRunning` diagnostics.
- Kitchen-only rear and east windows are shorter, begin above the backsplash, and replace the former exterior service door.
- The retired service door, exterior threshold/ramp, and QA routes are removed; the terrace doors remain the rear exterior exit.
- Two visible pendant fixtures and switch-linked task glows share one bounded kitchen light source so the fixed shader budget does not grow.
- The large uncased ballroom opening and the internal basement-stair door remain clear and traversable.
- Named QA views cover the ballroom reveal, inner run, rear sink, east range, refrigerator, and exterior window alignment.

## Visual direction

Use dark oak, antique marble, cream enamel, porcelain, aged iron, and brass. Keep the center of the room open so the U-shaped work triangle reads immediately from the ballroom. Counter slabs must butt together without coplanar overlap, cabinet faces must share a single line, and the faucet stream must land inside the modeled basin.

## Exit condition

The renovation regression suite, syntax check, browser console check, kitchen-only lighting check, running-water diagnostic, and multiple in-game screenshots all pass without geometry intersections or blocked circulation.
