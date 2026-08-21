# THE WHITE VIGIL — critique log

Every blind round against the Vesper-IX baseline, in order. The rubric
is `saintfall-summit-critique-rubric.md`; the reference pool is
`output/saintfall/summit/baseline-vesper` (30 Vesper frames, ultra,
1600x900, captured before any summit work began).

A defect is **not** closed because it was fixed. It is closed when a
later blind round stops naming it.

---

## Round 0 — pre-build instrumentation (no comparison)

Not a critique round. Recorded because the numbers it establishes are
what every later round is measured against.

| what | result |
|---|---|
| Vesper baseline captured | 30 frames, ultra, 1600x900 |
| Harness run-to-run noise | up to 75 k differing bytes of 5.76 M on `cathedral-front`; metrics stable to 2 d.p. **Any pixel comparison must be read against this floor.** |
| Vesper parity after the four engine edits | metrics identical to 2 d.p. on `establishing`, `cathedral-front`, `choir` |
| Vesper quality-tier suite | all checks passed |
| Vesper day/night suite | 27/29 — **both failures pre-existing on `main`**, verified in a clean worktree at `ed05914a` |
| Snow/ice shader compile | 13 programs, 0 errors, 0 GL errors; sastrugi relief and sparkle confirmed rendering |

**Open defects entering round 1:** none named yet.

---

<!-- Rounds are appended below. Template:

## Round N — <what changed since round N-1>

Seed: `N`  ·  Pairs: `12`  ·  Sheets: `output/saintfall/summit/blind/round-N`

### N.a identify
`RESULT: identified X / Y correctly (Z%)`
Reading: at chance / above chance / leaking — and if leaking, the tell.

### N.b prefer
`RESULT: ours A / T   reference B / T`

| pair | won | the critic's reason |
|---|---|---|

### Top defects named
1. …
2. …
3. …

### Changed in response
- …  (re-tested in round N+1)
-->
