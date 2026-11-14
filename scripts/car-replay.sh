#!/usr/bin/env bash
# Car offline replay (PQ-T76): rebuilds every car of the bench from its saved drawings, no Meta call.
# Each c-<name>/ dir needs view-front.png, view-right.png (back, left, top optional) and the report.txt of
# its live run (the class materials are reused by hand). Writes <dir>/<OUT>/ (recipe.json, car.json, …).
# Usage: scripts/car-replay.sh [OUT=replay] [refDir] [names…]   (default ~/Téléchargements/generated-view, all c-*)
set -euo pipefail
OUT="${1:-replay}"
REF="${2:-$HOME/Téléchargements/generated-view}"
shift $(($# > 2 ? 2 : $#))
names=("$@")
[ ${#names[@]} -eq 0 ] && names=($(cd "$REF" && ls -d c-*/ 2>/dev/null | sed 's|^c-||; s|/$||'))
for n in "${names[@]}"; do
  D="$REF/c-$n"
  [ -f "$D/view-front.png" ] && [ -f "$D/report.txt" ] || { echo "✗ $n: no drawings or report in $D"; continue; }
  mats="$(grep -oE '#[0-9a-f]{6} [a-z]+ [0-9]' "$D/report.txt" | awk '{print $2}' | paste -sd, -)"
  views=()
  for v in front right back left top; do [ -f "$D/view-$v.png" ] && views+=("${v^^}=$D/view-$v.png"); done
  label=car
  case "$n" in truck* | pickup*) label=truck ;; minibus* | van*) label=van ;; esac
  # A saved car team reading (live run) is replayed for free.
  reading=()
  [ -f "$D/car-reading.json" ] && reading=(CAR_READING="$D/car-reading.json")
  if make -s views-3d "${views[@]}" "${reading[@]}" OUT="$D/$OUT" LABEL="$label" OFFLINE=1 MATERIALS="$mats" >"$D/$OUT.log" 2>&1; then
    echo "✓ $n: $(grep -oE 'car (not measured|[0-9]+ axles.*)' "$D/$OUT.log" | head -1)"
  else
    echo "✗ $n: replay failed ($D/$OUT.log)"
  fi
done
