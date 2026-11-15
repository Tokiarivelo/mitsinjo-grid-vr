#!/usr/bin/env bash
# Plant live bench (PQ-T82): for each <name>.jpg photo of resources/refine-3d, Muse Image draws the
# plant's front from the photo and the plant team reads it (Meta API cost, contributor model), then
# the plant is built. Saves t-<name>/ (t-<name>-photo/ when t-<name>/ holds another drawing): view-front.png, plant-reading.json and label.txt, so
# `make tree-replay` rebuilds it offline afterwards. Writes t-<name>/live/ and t-<name>/live.log.
# Usage: scripts/plant-live.sh name[:label] …   (label default "tree"; PARALLEL=n runs n at once)
set -euo pipefail
REF="$(cd "$(dirname "$0")/.." && pwd)/resources/refine-3d"
MODEL="${MODEL:-muse-spark-1.3-contributor}"
one() {
  local n="${1%%:*}" label="tree"
  [[ "$1" == *:* ]] && label="${1#*:}"
  local D="$REF/t-$n"
  # Never over a drawing made by hand or by another bench: a dir of its own.
  [ -f "$D/view-front.png" ] && [ ! -f "$D/.plant-live" ] && D="$REF/t-$n-photo"
  [ -f "$REF/$n.jpg" ] || { echo "✗ $n: no $REF/$n.jpg"; return; }
  mkdir -p "$D"
  if META_VISION_MODEL="$MODEL" META_PARTS_MODEL="$MODEL" make -s views-3d PHOTO="$REF/$n.jpg" \
    OUT="$D/live" LABEL="$label" >"$D/live.log" 2>&1; then
    cp "$D/live/view-front.png" "$D/view-front.png"
    [ -f "$D/live/plant-reading.json" ] && cp "$D/live/plant-reading.json" "$D/plant-reading.json"
    echo "$label" >"$D/label.txt"
    touch "$D/.plant-live"
    echo "✓ $n: $(grep -oE 'plant team for[^:]*: [^,]*, [a-z]+, [a-z]+ leaves' "$D/live.log" | head -1) · $(grep -oE 'plant [a-z]+, [0-9]+ stems.*side [0-9.]+' "$D/live.log" | head -1)"
  else
    echo "✗ $n: failed ($D/live.log)"
  fi
}
export -f one
export REF MODEL
printf '%s\n' "$@" | xargs -P "${PARALLEL:-3}" -I{} bash -c 'one "$@"' _ {}
# The results to look at (resources/generated-view/, VERSIONS.md): the live run is the `live` output.
names=(); for a in "$@"; do n="${a%%:*}"; [ -f "$REF/t-$n-photo/.plant-live" ] && n="$n-photo"; names+=("$n"); done
"$(dirname "$0")/plant-gallery.sh" live "${names[@]}"
