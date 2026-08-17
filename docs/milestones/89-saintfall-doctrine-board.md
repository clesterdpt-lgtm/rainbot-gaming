# 89 — SAINTFALL Doctrine board

User report: "the vow is blocking some of the talents", plus a request to make
the Doctrine/Talent screen clean, modern, intuitive and visually appealing.

## The collision was structural, not cosmetic

`.sf-doctrine__order` is a three-row grid, `auto minmax(0,1fr) auto` — order
head, workspace, capstone band. The workspace carried
`#sf-native-ui .sf-doctrine__workspace{min-height:13.5rem}`.

A `minmax(0,1fr)` track can collapse to zero. The `min-height` cannot. So on
any playfield short enough that the head plus the 149–187px capstone band
consumed the panel, the middle track went to ~0 while the workspace kept
painting its 216px — and the Vow, later in the DOM, painted straight over the
rite grid. Measured on the pre-fix code at a 1008×567 playfield: the Vow
overlapped **all four rites and the inspector**, up to 41,856 px² per pair.

The regression suite was green on that frame. `doctrineLayoutAudit` compared
cards against *other cards* and never against the Vow, so a band lying across
the entire grid produced zero findings. 95/95 passed while the screen was
unusable.

## The board

The fix is one rule: every doctrine node lives in a track that can shrink to
zero, and nothing carries a `min-height` larger than the track it sits in.

- The Vow stopped being a full-width band and became the **crown row of the
  same column as the rites** — `.sf-doctrine__tree` is
  `grid-template-rows:minmax(0,1fr) auto`, rites above, crown below. A slab
  that is not a sibling of the grid cannot lie across it.
- The rite inspector became the **single surface that acts**. Selecting a rite
  or the Vow drives the same panel; `INSCRIBE`/`REFUND`/`BIND VOW` all live
  there. The per-card action rows (already hidden on desktop) and the Vow's
  own action row now stay out of the layout entirely on pointer devices.
- `renderCapstonePreview` shares `capstoneStatus()` with the crown card, so
  the strip and the panel can never disagree about why a Vow is barred.
- The ladder is legible without a diagram: every order is 2×T1 (gate 0), T2
  (gate 2), T3 (gate 4), capstone (gate 8), so the cards carry
  `TIER II · 2 PTS` and the crown carries `CAPSTONE VOW · 8 PTS` over a gate
  meter filled to `invested / 8`.
- Badges name the actual blocker. `LOCKED` told the player nothing; it is now
  `NEEDS 2 PTS` (tier gate not reached) or `NO POINTS` (gate open, pool
  empty), and the inspector's state chip uses the same vocabulary.

### Sizing

The playfield container is `container-type: inline-size`, so **`max-height`
container queries never match** — the first pass at responsive steps was
silently inert. The surface is a 16:9 box, so the steps read width instead:
≤1180px trims art and padding, ≤960px drops the rite blurb and the inspector's
requirement band, ≤760px hands the menu one deliberate scroll owner rather
than clipping. Above them, `.is-maxed` at `min-height:800px` scales art and
copy up — full screen caps the rite rows at 11rem and had been leaving most of
every card blank.

Two sizing bugs surfaced on the way:

- The card inherited `grid-template-rows:auto minmax(1.4em,auto) auto auto`,
  which kept reserving a blurb row after the blurb was hidden and pushed the
  state badge out of the card at 888×500.
- The inspector's bands were `flex:0 0 auto` with a growing rank ladder, so
  the ladder's natural height pushed the action foot out of a panel with
  `overflow:hidden`. The ladder is now `flex:1 1 0` — it takes only what is
  left, and the artwork and the action button keep their natural size.

## Touch

Landscape 844×390 was as broken as the desktop collision and had been shipping
that way. `grid-template-areas:none` was applied to the rite card while its
children still asked for named areas, so placement fell back to auto and every
rite name rendered as a single letter — "R.", "A.", "T.", "F." — under the
action row. Areas are named explicitly now.

Fixing the card exposed the next layer: the landscape order panel is
shrink-to-fit, so its width had been tracking the cards' max-content. Legible
names made the cards narrower and the whole board drifted into a centred
column 80px inside its own track. It is pinned to `width:100%`.

The crown's kicker and title sizes were being set by `.sf-doctrine__vow >
header` rules that stopped matching when a `vow-body` wrapper was introduced,
so "CAPSTONE VOW" rendered at roughly twice the size of the Vow's name.

Portrait tabs justified their contents to the start, so "Procession" sized past
its own column and printed over "Wing" — and because the label was never
clipped, `scrollWidth === clientWidth` and the suite's overflow check read
zero. Beside an 18px sigil there is no size that fits five order names at
390px, so the sigil stacks above and the name gets the full tab width.

## Verification

- `scripts/saintfall-ui-regression.mjs` — 97/97. `doctrineLayoutAudit` now
  compares **every** visible doctrine node against every other one (rites,
  Vow, inspector), not card-against-card, and a new 1280×720 pass covers the
  888×500 playfield, the tightest board that has to hold without scrolling.
- `scripts/saintfall-doctrine-board.mjs` — 9/9. Drives the production
  listeners: rite selection, inscribing to the order cap from the inspector,
  routing the Vow into the same inspector, binding and unbinding, keyboard
  reach on the crown, and order switching.
- The strengthened audit was checked against the pre-fix commit in a throwaway
  worktree to confirm it discriminates: 5 overlapping pairs there, 0 here.

High contrast needed matching-specificity overrides — the board selectors carry
an id plus three classes, so `body.sf-high-contrast #sf-native-ui :is(…)` was
losing the cascade to the board's own state colouring.
