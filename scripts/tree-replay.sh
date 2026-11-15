#!/usr/bin/env bash
# Tree offline replay (PQ-T79): rebuilds every tree of the bench from its saved drawings, no Meta call.
# Each t-<name>/ dir needs view-front.png: like the live route, a tree is built from its front alone (its
# side is its front); SIDES=1 also feeds the saved right / back / left / top drawings (the old bench).
# A tree is read on its pixels (no materials by hand). Writes <dir>/<OUT>/.
# Usage: scripts/tree-replay.sh [OUT=replay] [refDir] [names…]   (default resources/refine-3d, all t-*)
set -euo pipefail
OUT="${1:-replay}"
REF="${2:-$(cd "$(dirname "$0")/.." && pwd)/resources/refine-3d}"
shift $(($# > 2 ? 2 : $#))
names=("$@")
[ ${#names[@]} -eq 0 ] && names=($(cd "$REF" && ls -d t-*/ 2>/dev/null | sed 's|^t-||; s|/$||'))
for n in "${names[@]}"; do
  D="$REF/t-$n"
  [ -f "$D/view-front.png" ] || { echo "✗ $n: no front drawing in $D"; continue; }
  views=("FRONT=$D/view-front.png")
  if [ -n "${SIDES:-}" ]; then
    for v in right back left top; do [ -f "$D/view-$v.png" ] && views+=("${v^^}=$D/view-$v.png"); done
  fi
  kind="${n%%[0-9]*}"
  label="$kind tree"
  case "$n" in gardenia* | bush* | banana*) label="$kind plant" ;; esac
  if make -s views-3d "${views[@]}" OUT="$D/$OUT" LABEL="$label" OFFLINE=1 >"$D/$OUT.log" 2>&1; then
    echo "✓ $n: $(grep -oE '[0-9]+ parts \((no trunk|trunk).*overall [0-9.]+' "$D/$OUT.log" | head -1)"
  else
    echo "✗ $n: replay failed ($D/$OUT.log)"
  fi
done
