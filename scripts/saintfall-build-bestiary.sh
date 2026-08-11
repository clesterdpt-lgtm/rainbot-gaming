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
  SPECIES=(thresher gleaner harrow matriarch)
fi

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
    --leg-bones '^(coxa|femur|tibia|foot)' --own-legs death
done
