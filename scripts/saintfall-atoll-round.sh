#!/bin/bash
# ============================================================
#  SAINTFALL - one review round for The Green Antiphon
#
#  Captures the atoll's authored camera set, then builds a BLIND
#  A/B round against a Vesper-IX reference pool of the same size,
#  at the same resolution, from the same engine.
#
#  The comparison is the point. "Does it look good" is not a
#  question anybody answers the same way twice; "which of these
#  two would you rather ship, and you do not know which is which"
#  is. The rig randomises the sides and writes the answer key to
#  _key.json, which the reviewing agent must not read.
#
#  Usage:
#    scripts/saintfall-atoll-round.sh <round-number> [time] [quality]
#
#  e.g.
#    scripts/saintfall-atoll-round.sh 1
#    scripts/saintfall-atoll-round.sh 4 vespers ultra
#
#  Then, after the critic has answered:
#    node scripts/saintfall-blind-compare.mjs \
#      --reveal output/saintfall/island/blind/r1 --mode prefer \
#      --answers A,B,A,...
# ============================================================
set -uo pipefail
cd "$(dirname "$0")/.."

ROUND="${1:?usage: saintfall-atoll-round.sh <round-number> [time] [quality]}"
TIME="${2:-trade}"
QUALITY="${3:-ultra}"

OURS="output/saintfall/island/antiphon-r${ROUND}"
REFS="output/saintfall/island/ref-vesper"
BLIND="output/saintfall/island/blind/r${ROUND}"

echo "=============================================================="
echo " ROUND ${ROUND}   time=${TIME}  quality=${QUALITY}"
echo "=============================================================="

echo
echo "--- 1/3  capturing the atoll -----------------------------------"
node scripts/saintfall-shots.mjs \
  --page saintfall-green-antiphon.html \
  --out "${OURS}" \
  --time "${TIME}" \
  --quality "${QUALITY}" \
  --width 1600 --height 900 --warm 4
SHOTS=$?

COUNT=$(ls "${OURS}"/*.png 2>/dev/null | wc -l | tr -d ' ')
echo "captured ${COUNT} frames (shots exit ${SHOTS})"
if [ "${COUNT}" -lt 4 ]; then
  echo "FEWER THAN FOUR FRAMES. The level did not render; there is nothing to review."
  echo "Read ${OURS}/report.json and the console output above before doing anything else."
  exit 2
fi

echo
echo "--- 2/3  acceptance gates --------------------------------------"
if [ -f scripts/saintfall-atoll-audit.mjs ]; then
  node scripts/saintfall-atoll-audit.mjs --quality "${QUALITY}" --time "${TIME}" \
    --json "output/saintfall/island/gates-r${ROUND}.json"
  echo "gates exit $?"
else
  echo "(no audit script yet - skipped)"
fi

echo
echo "--- 3/3  building the blind round ------------------------------"
# The seed is the round number, so two rounds never randomise the
# same way and a critic cannot carry an answer over from the last one.
node scripts/saintfall-blind-compare.mjs \
  --ours "${OURS}" \
  --refs "${REFS}" \
  --out  "${BLIND}" \
  --seed "${ROUND}"


# --- close the two leaks the generic rig leaves for THIS comparison ---
#
# 1. THE KEY IS MOVED OUT OF THE FOLDER THE CRITIC IS POINTED AT.
#    "Do not open _key.json" is an instruction, and an instruction is
#    not a guarantee. The reveal step copies it back for the ten
#    seconds it needs it. This costs two lines and removes the whole
#    question of whether a round was honest.
#
# 2. THE README IS REWRITTEN. The generic rig's copy says the other
#    panel is "a shipped commercial game", because it was written to
#    pair our bosses against Halo. Here BOTH panels are ours - one is
#    Vesper-IX, the shipped first world, and one is the atoll - and a
#    critic who has been told one side is a commercial release will
#    find reasons to prefer whichever they guess that is.
KEYS="output/saintfall/island/keys"
mkdir -p "${KEYS}"
if [ -f "${BLIND}/_key.json" ]; then
  mv "${BLIND}/_key.json" "${KEYS}/r${ROUND}.json"
fi

cat > "${BLIND}/README.txt" <<'TXT'
BLIND COMPARISON SET

Each pair-NN folder holds A.png, B.png and side-by-side.png.
The two panels come from two different levels of the same game. You are
not told which is which, and the sides were randomised per pair.

For each pair, answer one question:

    WHICH PANEL WOULD YOU RATHER SHIP?

Judge ONLY the quality of the rendering: surface and material
believability, light response and specular, silhouette readability,
shadow and contact, value range, colour separation between subject and
background, composition, and sense of weight and scale.

Ignore subject matter entirely. A beach is not better or worse than a
desert. Ignore how much you like the art direction; a well-executed
frame of a subject you dislike still wins.

Both panels were cropped by the SAME per-edge inset, resampled to the
same size and JPEG round-tripped identically, so framing, sharpness,
resolution, aspect and compression artefacts carry no information about
which is which.

A TIE IS A LOSS. Say which letter, and say why in terms of craft.
TXT

echo
echo "=============================================================="
echo " Pairs:      ${BLIND}"
echo " Answer key: ${KEYS}/r${ROUND}.json   (moved OUT of the pairs folder)"
echo
echo " Reveal with:"
echo "   cp ${KEYS}/r${ROUND}.json ${BLIND}/_key.json && \\"
echo "   node scripts/saintfall-blind-compare.mjs \\"
echo "     --reveal ${BLIND} --mode prefer --answers <A,B,...>"
echo "=============================================================="
