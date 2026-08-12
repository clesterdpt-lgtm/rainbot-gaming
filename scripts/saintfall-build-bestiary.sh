#!/usr/bin/env bash
# Rebuild the SAINTFALL bestiary end to end: Blender -> raw .glb ->
# channel-stripped runtime .glb.
#
# The strip pass is not optional hygiene. Blender writes a track for
# every bone in the armature on every action whether or not it was
# keyed, and the leg chains are owned by the runtime IK - so a clip
# that ships its leg channels fights the solver every frame.
set -euo pipefail
cd "$(dirname "$0")/.."

SPECIES=("$@")
if [ ${#SPECIES[@]} -eq 0 ]; then
  SPECIES=(thresher gleaner harrow matriarch coulter)
fi

# Which bones the runtime owns, per species, and which clip is allowed
# to take them back.
#
# The walkers all hand their leg chains to the IK solver and get them
# back for `death`, because a corpse whose feet are still being solved
# against the ground stands up again. The Coulter has no legs: its
# whole body is a chain laid along a trail the runtime keeps, and it
# never gets that back - not even to die, because a death clip authored
# against a straight bind pose would snap a body that was arched eight
# metres out of the sand.
strip_pattern() {
  case "$1" in
    coulter) echo '^spine' ;;
    *) echo '^(coxa|femur|tibia|foot)' ;;
  esac
}
owns_pattern() {
  case "$1" in
    coulter) echo 'none' ;;
    *) echo 'death' ;;
  esac
}

for name in "${SPECIES[@]}"; do
  echo "=== $name ==="
  blender --background --factory-startup \
    --python "scripts/blender/saintfall-$name.py" -- \
    --output "assets/models/saintfall/source/$name.raw.glb" \
    --report "output/saintfall/models/$name.json" 2>&1 \
    | grep -vE "^(INFO|[0-9]{2}:[0-9]{2}:[0-9]{2} \||Blender |/Volumes|  res = )" || true

  node scripts/saintfall-optimize-model.mjs \
    --in "assets/models/saintfall/source/$name.raw.glb" \
    --out "assets/models/saintfall/$name.glb" \
    --leg-bones "$(strip_pattern "$name")" --own-legs "$(owns_pattern "$name")"
done
