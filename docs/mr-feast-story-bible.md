# Mr. Feast's Mansion — Story Bible (brainstorm draft)

> Narrative design proposal drafted 2026-07-18. Nothing here is implemented or promoted;
> it extends `docs/gameplan.md` without changing any agreed definition. When a slice is
> ready to build, promote it through `docs/backlog.md` into a numbered milestone.

## Logline

You are a mid-season replacement on a reality show whose audience is never on camera.
Three competitions decide who "goes home." Nobody has ever gone home. The show is a
menu, the prize is a contract, and the only person who wants you to win is the host —
because winning is how he finally gets to leave.

## The rules (the lore engine)

One supernatural premise generates everything, which is what keeps the scares coherent:

**Nothing in this house may take what was not signed over to it.**

- **The Patrons.** The show's true audience — the "secret elite audience" from the
  gameplan, sharpened into a supper cult: robed old money who believe the show is a
  summoning rite they control. They never appear on camera; they attend through the
  patron feed, and at each Elimination Dinner they are served the contestant who
  "left." Fear is seasoning: the games, the countdowns, and the manufactured scares
  exist to flavor the course. The feed is literally a feed.
- **The Guest of Honor.** The thing the Patrons believe they are summoning. Their
  theology is satanic in its set dressing — circles, candles, a grace said in no
  recognizable language — but the entity predates every name they have used for it.
  It has dined here for centuries under whatever table manners the era provides; the
  cult thinks it has been summoning a devil, and the devil thinks it has been
  ordering room service. Each Elimination Dinner opens one seal; the season finale is
  the scheduled arrival. It is never depicted — its presence is measured entirely in
  what the house does.
- **The Contract.** Every contestant signed one: *person and likeness, in perpetuity,
  win or lose.* "Person" is the body — that is the dinner. "Likeness" is everything
  else — and the house keeps it. Eliminated contestants keep appearing: new
  confessionals on the monitors recorded after they "went home," reruns walking the
  halls at night, their idle loops playing in their favorite chairs. The ghosts are
  syndication.
- **Consent is load-bearing.** The house cannot simply take people; they must enter,
  sign, play, and lose (or break the rules). That is why it must be a game show, why
  there is a prize, why Mr. Feast smiles, and why the finale requires you to *accept*
  something. The friendly format is not a disguise over the ritual — it is the ritual's
  legal paperwork.
- **The host is a former winner — and the vessel.** Every host is. The winner's
  check is a contract amendment: the winner "joins the production family," and what
  moves in with the job is the Guest's tenancy — "Mr. Feast" is the entity's stage
  persona, worn by successive winners until they wear out. He is not hunting the
  player — he is recruiting a successor, because a signed successor is the only door
  out of his own contract. The 19 tiltable portraits through the house are prior
  hosts. The whole season is a job interview, and the open position is not "host."

These rules retroactively explain mechanics that already shipped: Mr. Feast only
pursues witnessed infractions because unwitnessed players haven't broken the contract
where it can see; upstairs catches are warnings because upstairs is show floor; the
basement is instant game over because the basement is not part of the show — line six
of the shipped welcome says exactly that.

## Cast

| # | Name | Persona | Arc |
|---|------|---------|-----|
| 03 | Mara Voss | The Strategist | Day-one contestant; has watched nine people "go home" and strategized herself into denial. Eliminated after Game 2. |
| 07 | Kip Solano | The Wild Card | Treats everything as content. While he's alive the game is allowed to be funny. Eliminated after Game 1. |
| 10 | Juniper Cross | The Folklorist | Applied on purpose — she has been researching this estate for years. The player's ally and lore engine. Lost at Game 3. |
| 13 | *(prior)* | — | The previous Contestant 13: investigated, hid the badge/tape/key trail, "became our most-watched episode." Ghost guide and co-protagonist of the true ending. |
| 13 | **The player** | The Replacement | The season opened with twelve. Nine seats were already cleared before you arrived. Your number is reissued. |

**The number reveal.** The badge dug up in the hedge maze is the season's number 13
badge — and it is the player's own number, reissued after its previous holder was
served. Recommended placement: the dossier labels it neutrally ("Badge 13",
"Contestant credential") exactly as shipped, and the truth lands in Phase 2 when the
player sees the Elimination Dinner place settings — thirteen chairs, one empty, and a
place card holding their number.

**Elimination order is tonal design.** Kip first removes the comedy (and the ambient
audience-reaction sweeteners go with him). Mara second proves competence is not a
variable — the bottom slot is cast, not scored. Juniper last is the gut punch and the
knowledge handoff.

## Season structure

Three phases plus a finale, keyed to the camera-policy progression that already exists
(show → restricted → lockdown). Each phase is free-roam under a broadcast countdown,
then a sanctioned competition, then a scripted aftermath. In the demonic layer each
phase is also one seal: every Elimination Dinner opens the next, the poltergeist tier
rises with it, and the finale is a scheduled arrival.

### The schedule (timer design — answer to "timer vs. clue-trigger": both)

- A diegetic **LIVE chyron with a NEXT EVENT countdown** runs on the Ballroom set and
  a small HUD element. The first free-roam window lasts ten active post-welcome minutes,
  pauses with the game's existing pause surfaces, and calls Feast Says at expiry.
- **The first major clue calls the event early.** The discovery itself remains earned,
  then production summons everyone to the Ballroom and pauses new investigation
  progress until the competition ends. This preserves separate clue and minigame loops
  while preventing the whole mansion trail from being cleared before Game 1.
- **Competitions are contract-protected.** No enforcement during sanctioned play; the
  show's structure is the safest place in the house, and that safety is the trap. The
  player learns to dread the timer in both directions — you fear it ending, and you
  need it to end.
- Phase-3 corruption: the countdown shows :66 seconds, counts up briefly, and the
  chyron begins reading NEXT COURSE.

### Phase 1 — "Move-In Week" (show policy) — normal at 95%

- Free-roam: meet the cast, tour the estate, the shipped welcome. Wrongness stays
  deniable: the staff headcount is zero yet dinner appears; the fridge food is prop
  wax; a freezer manifest lists deliveries by weight only; Mr. Feast never eats on
  camera; thunder rolls with no rain on the glass for one beat.
- **Game 1 — FEAST SAYS.** Six short Ballroom rounds mix genuine movement/crouch
  orders with decoys that omit "Feast says." The orders weaponize distrust—one asks
  every contestant to point to the person they trust least—while remaining mechanically
  explicit and fair. Mara is nearly perfect, Juniper stays composed, Kip plays to the
  cameras and misses enough calls to finish last. The player must beat him; otherwise
  the player is the contestant eliminated.
- The **SCARE CAM** gag: a mascot pops from the coat closet with confetti; Mr. Feast
  crows "That's our SCARE CAM! Our audience loves a good scare." This trains the player
  to relax and establishes that the show manufactures fear (lore: seasoning) — the
  whole jump-scare economy hangs on this one diegetic joke.
- **Elimination 1 — Kip**, last in Feast Says. Cheerful jingle, confetti,
  "Kip has left the estate." Off-screen. His luggage never leaves the service door.

### Phase 2 — "Ratings Week" (restricted policy) — the investigation

- The shipped Contestant 13 trail is this phase's spine: misfiled book → shovel →
  maze badge/key/tape → Archive → Workroom. The XIII tape is the **midpoint reveal**:
  a half-whispered confession that the losers are cooked and served. Deliberately
  placed mid-game, not finale — "they eat the losers" is the *midpoint*, so the story
  still has somewhere to go (the contract/likeness/host cycle is the climax).
- Kip aftermath beats: his goodbye video loops on the monitor bank with the wrong room
  behind him (the Archive); his confessional is dated Day 41 of a 12-day season; his
  reserved seat stays reserved and nobody — including the player — may sit in it.
- **Game 2 — STORM RUN.** Ten active exploration minutes after Feast Says, or as
  soon as the player earns the next major clue, Mr. Feast calls the remaining cast
  to a rear-terrace start line. Five ordered television checkpoints cross the rear
  grounds, formal garden, front grounds, east lawn, and hedge-maze interior. Mara
  and Juniper visibly run the same authored course without exceeding the player's
  maximum sprint speed. Lightning is not a hazard: selected checkpoint approaches
  use a flash to reveal Mr. Feast standing impossibly close to the route, then hide
  him again when darkness returns.
- **Elimination 2 — Mara**, last across the Storm Run course despite calculating the
  optimal route. The show knew every shortcut before she chose it. Her elimination
  jingle begins outside and finishes somewhere beneath the floorboards.
- Aftermath: through a service hatch the player can overlook the **Elimination
  Dinner** — hooded patrons, thirteen place settings, silverware etiquette, no gore
  (the horror is the manners). One empty chair; the place card carries the player's
  number. This is where the badge reveal lands. Before the covers lift, the table
  says grace in no recognizable language and the elimination jingle plays once,
  slowly, in reverse — the first open confirmation that the show's cheerful
  furniture is liturgical.
- Supernatural onset (Lane 3 below): reruns on monitors first, then mirrors, then
  halls — and the first micro-poltergeist ticks: cutlery found aligned, a door eased
  open, one dining chair pulled out that nobody pulled.

### Phase 3 — "Finale Week" (lockdown) — horror, mask off

- The house stops pretending: sweetened audio is gone, foley detunes, some cameras
  track with their LEDs dark, housekeeping small talk swaps to the dark pools.
- Juniper's arc peaks: her research (the 20 lore books; give her hand-annotated
  margins in later phases, matching the shipped XIII marginalia craft) connects the
  show to feasts across eras — harvest banquet, séance supper, radio quiz dinner,
  cable-era show. The estate predates television; the format is redecorated each
  century. "The Choir Beneath the Floorboards" is a previous era's cast portrait.
  Her sharpest finding is the cult's error: the Patrons believe they summon and
  command the Guest, but the rite predates their theology — they inherited table
  manners, not authority. Nobody at that table is safe, including the people who
  think they set it.
- **The maze is the sigil.** The Workroom's eighth monitor occasionally cycles to a
  camera that does not exist: an aerial of the estate. From above, the hedge maze
  reads as a drawn circle-and-glyph, and the dead end where the player dug up Badge
  13 sits at its center. The maze was never landscaping — every contestant sent in
  is being walked through the circle, and XIII buried the evidence at its heart on
  purpose.
- **Game 3 — FEAST HUNT.** After Storm Run and the patron-feed sabotage, production
  calls the remaining contestants to the foyer. Three unmistakable gold show props
  are hidden across all three mansion levels. Cameras report the player's reliable
  position, Mr. Feast personally hunts whoever is seen, and a catch on any floor
  eliminates. Crouching, darkness, cover, and hiding remain the fair counters.
- Each recovered prop advances the house horror without creating another combat AI:
  the Listening Host and Veiled Waltz turn only while unobserved, camera LEDs go dark
  while tracking remains active, and Mr. Feast's cheerful announcements thin into
  silence. The statues redirect and frighten but never damage the player.
- **Juniper's end is deliberately simple and deferred.** Game 3 does not require a
  sacrifice cinematic. A later finale slice may eliminate or escort her offscreen
  after an authored warning about the Winner's Dinner, while her research remains
  the investigation-earned route to the true ending.

### Finale — THE WINNER'S DINNER

The banquet staging the gameplan already promises for the loss ending becomes the win
scene too: same table, same patrons, the player at the head. Mr. Feast presents the
check — and the check is a signature line. Three exits:

1. **Take the check (bad ending).** Accepting is signing; the rite completes and
   the Guest changes address. The moment the pen lifts, a chair pulls itself out
   for you at the head of the table — the first time the house has ever touched
   you, and now it is a courtesy. Smash cut: some seasons later, a new front door,
   a new contestant — and the shipped seven-line welcome plays again verbatim, in
   the player's voice. The intro is the outro. (Cheapest ending to build; maximal
   chill; the shipped script is reused untouched.)
2. **Run (escape ending).** Refuse and bolt: a storm-gate escape sequence that reuses
   every learned system — maze route, blind spots, hiding, the crouch meter — with
   lockdown fully hostile. Epilogue sting: nobody believes you; a teaser announces the
   show is "renewed." You got out; the table is still set.
3. **Serve the house cold (true ending).** Requires finishing what XIII started plus
   Juniper's research: cut the patron feed mid-course (the shipped Workroom sabotage,
   now placed at the story's climax) and burn the contract archive in the kitchen
   hearth — the contracts are the circle, and consent is the only fuel the rite has
   ever burned. Unsigned and uninvited, the Guest cannot arrive, and the Patrons
   flee an empty table. The reruns end — every kept
   likeness gets to stop performing. XIII's rerun looks into the camera, removes its
   badge, and walks off-frame. The player walks out the front door at dawn, on
   camera, carrying nothing the house owns.

Mr. Feast's finale presentation: rather than new facial tech (the retopology
experiment is paused), he puts on a porcelain **camera face** for the dinner — a
sculpted mask one size too smiley, in the estate statues' material language. The
gameplan's "smile that becomes subtly impossible," delivered as a mesh swap.

## Scare design — the three-lane system

Every scare belongs to exactly one lane, and each lane has one rule. Any new scare
idea that fits a lane is automatically coherent; anything that fits none gets cut.

- **Lane 1 — Production scares.** *The show did it.* Scare cams, confetti cannons,
  elimination jingles, prop skeletons with price tags. Phases 1–2. They train
  relaxation, establish manufactured fear as flavor, and license every later jump
  scare as an escalation of something diegetic.
- **Lane 2 — Enforcement scares.** *The contract did it.* All physical danger: Mr.
  Feast, pursuit, cameras, the basement rule, the Game 2 seeker. Only Lane 2 can hurt
  the player, so the threat model stays learnable and fair even at maximum weirdness.
- **Lane 3 — House scares.** *The house kept it, or the house owns it.* Two flavors
  under one property law. **Reruns**: all ghost content is recording-flavored —
  confessionals taped after elimination, idle loops in empty chairs, mirrors holding
  a frame too long, interlacing and chroma-split figures, a bleep censor over a
  warning a ghost is contractually barred from speaking. **Poltergeist**: as each
  seal opens, the Guest moves more of what is signed over to the estate — cutlery,
  doors, chairs, portraits, eventually the maze walls. The coherence rule that keeps
  all of it fair and sensible: **Lane 3 may move anything the house owns and may
  never touch the player, because the player is the one thing on the property that
  isn't signed yet.** Reruns replay and point; furniture herds, blocks, and
  arranges; every moving object is a property-rights demonstration. The one time the
  house finally touches the player — a chair pulled out as a courtesy — is the bad
  ending confirming itself.

### Placed scare bank (escalating)

1. **P1 (fake):** Scare-cam mascot, coat closet, confetti, laugh track. The anchor gag.
2. **P2:** Kip's confessional on the monitor bank — "Day 41," wrong room behind him,
   a smile frame held 20 frames too long.
3. **P2:** The bathroom mirror shows the hallway door behind you closed; it is open.
4. **P2:** Dumbwaiter opens on its own: Kip's ring light, still on, still recording.
   Quiet dread beat, no sting.
5. **P2:** A ghost tries to warn the player and the censor bleep fires at full mix
   over its mouth — the loudest sound in the phase. (The contract gags likenesses.)
6. **P2 (poltergeist onset):** dining chairs stand pulled out again minutes after
   Mr. Feast straightened them. He corrects the player's mischief with a quip; he
   corrects *these* in silence, without breaking stride. He can tell whose work it
   is, and he never comments on his employer's.
7. **P3:** Mara's rerun seated in her Library chair at 3 a.m., running her exact
   shipped idle loop, interlaced. She points at the Painting Room. She never stands.
8. **P3:** The Painting Room scoreboard (below) is noticed mid-tilt by the player —
   the canvas updates while briefly occluded, never on screen.
9. **P3 (poltergeist):** all 19 portraits hang tilted in unison, aiming down the
   hall at the basement door. Straighten one and the first re-tilts behind you —
   the player's own tamper verb, returned to sender.
10. **P3 (poltergeist):** the ballroom chairs stand arranged in an inward-facing
    ring around nothing, and the seat-reservation system reports every one of them
    occupied.
11. **P3 (poltergeist):** the Music Room piano plays the elimination jingle slowly
    and in reverse; the lid eases shut as the player enters.
12. **P3 (callback):** Same coat closet, same confetti sting — the confetti falls
    over nobody, and the door was already open.
13. **Maze night:** topiary and hedge gaps re-aim between lightning flashes; one
    figure in the hedge is the mascot suit, empty, propped on a frame.
14. **Dinner:** the covered platter is lifted and holds only a folded contract and a
    pen. The scare is comprehension, not volume.

### Ambient wrongness by phase (systems already shipped)

- **Lighting:** P1 warm and steady → P2 practicals stutter on storm beats → P3
  circuit-wide snaps to emergency amber (the fade/snap sync and prewarm system).
- **Audio:** P1 adds reaction sweeteners → P2 removes them (silence where applause
  was) → P3 detunes foley: doors a third low, footsteps doubled a half-beat late.
- **Painting Room as scoreboard:** after each elimination the four canvases advance —
  *The Garden Has Too Many Knees* gains a knee; *A Very Polite Eclipse* darkens one
  stop; *Five Doors, No Hallway* gains a door, ajar; *The Choir Beneath the
  Floorboards* adds a singer with a familiar silhouette. Never called out in text,
  matching the Milestone 49 neutral-clue convention.
- **Statues:** the Listening Host's head tilts one notch per phase (phase-keyed
  rotation, never witnessed). The Weeping Crown's fountain runs red only inside
  lightning flashes — pairs with the backlogged storm-flash stealth sampling.
- **Seating:** eliminated contestants' seats stay reserved and empty; the occupancy
  system already supports exclusive reservation.
- **Cameras:** P3 introduces fixtures that track with LEDs dark — wrongness the
  player feels through a learned system rather than a cutscene.

## Reveal drip (the player's knowledge curve)

1. **P1:** deniable oddities (wax food, zero staff, weight-only manifests).
2. **P1→2 hinge:** Kip's luggage; the Day 41 confessional.
3. **P2 midpoint:** the XIII tape — *the losers are eaten.* (The user-requested
   reveal, placed mid-story on purpose.)
4. **P2 late:** the Elimination Dinner overlook; the place card with your number.
5. **P3:** Juniper's research — the show predates the show; likenesses are kept;
   hosts are winners. The check is a contract.
6. **Finale:** the pen.

## Build slices (sized for the milestone workflow)

1. **Broadcast schedule & chyron** — phase flag, countdown UI, intercom lines,
   hot-clue acceleration. Small systemic spine everything else keys off.
2. **Game 1 core shipped; aftermath pending** — Feast Says now owns the first
   ten-minute/first-clue call, six-command Ballroom competition, Kip elimination,
   and investigation release. The jingle, luggage dressing, and reserved empty
   seat remain a later aftermath slice.
3. **Rerun system v1** — monitor-bank ghosts only (2D on existing render targets;
   no new character tech). Mirror and hall reruns later reuse the shipped contestant
   GLBs with a shader pass.
4. **Poltergeist system v1** — phase-keyed self-tampering that reuses the shipped
   tamper states (portrait tilt, chair pull, fridge door) plus a silent no-comment
   housekeeping variant for Mr. Feast; authored set pieces (portrait unison, chair
   ring, piano) come after the ambient tier works.
5. **Game 2 + Mara elimination + dinner overlook** — Storm Run crosses the full
   estate and turns the weather into a supernatural reveal language without adding
   a damaging weather-hazard system.
6. **Phase dressing pass** — painting scoreboard, audio sweetener/detune swaps,
   line-pool swaps, statue notches, the reverse-jingle motif.
7. **Game 3 core: Feast Hunt** — three mansion-wide props, live cameras, pursuit,
   hiding, and the first unobserved foyer-statue turns. Juniper's result is deferred.
8. **Winner's Dinner + three endings** — the shipped welcome replay is the bad
   ending's whole script; the shipped Workroom sabotage is the true ending's first
   half.
9. **Basement chapel / patron gallery** — the deferred "broader basement network"
   in `docs/backlog.md` is the natural home for the dinner overlook, the contract
   archive, and the cult's dressing room: robes on numbered coat hooks, a printed
   call sheet for the rite, thirteen chairs in storage.

## Open questions

- Does the player fail competitions (ELIMINATED game-over modal, reusing the CAUGHT
  overlay pattern) or are events unlosable set pieces? Recommended: failable, with
  the NPC elimination scripted among survivors — stakes stay real, order stays
  authored.
- How much of Mr. Feast's recruiting motive surfaces in text vs. stays subtext for a
  second playthrough?
- Whether `0513` gains a canon meaning (e.g., the air date of the first broadcast
  feast) or stays an unexplained production artifact.
- Player voice/backstory: silent replacement contestant, or explicitly connected to
  the prior 13 (applied to find them)? Silent is cheaper; the connection is stronger.
- How explicitly the cult is branded: stock satanic iconography is instantly legible
  and suits the influencer-conspiracy parody register, an invented house liturgy is
  scarier and more ownable. Current draft splits the difference — satanic set
  dressing on a nameless appetite, and the word "satanic" is only ever used by the
  Patrons about themselves, never by the house. Decide before authoring chapel art.
- Whether the Guest is ever depicted. Recommendation: never — Mr. Feast's porcelain
  camera face stays the only face the demon gets, so the entity makes the host
  scarier instead of demoting him to middle management.
- Whether poltergeist events may ever block progression (a door held shut) or stay
  pure theater. Recommendation: theater and herding only, never a lock the player
  cannot reopen — Lane 2 keeps the monopoly on real consequences.
