#!/usr/bin/env bash
# Tree offline replay (PQ-T79): rebuilds every tree of the bench from its saved drawings, no Meta call.
# Each t-<name>/ dir needs view-front.png and one side (view-right.png or view-left.png); back, left and
# top are used when present. A tree is read on its pixels (no materials by hand). Writes <dir>/<OUT>/.
# Usage: scripts/tree-replay.sh [OUT=replay] [refDir] [names…]   (default resources/refine-3d, all t-*)
set -euo pipefail
OUT="${1:-replay}"
REF="${2:-$(cd "$(dirname "$0")/.." && pwd)/resources/refine-3d}"
shift $(($# > 2 ? 2 : $#))
names=("$@")
[ ${#names[@]} -eq 0 ] && names=($(cd "$REF" && ls -d t-*/ 2>/dev/null | sed 's|^t-||; s|/$||'))
for n in "${names[@]}"; do
  D="$REF/t-$n"
  [ -f "$D/view-front.png" ] && [ -f "$D/view-right.png" ] || { echo "✗ $n: no drawings in $D"; continue; }
  views=()
  for v in front right back left top; do [ -f "$D/view-$v.png" ] && views+=("${v^^}=$D/view-$v.png"); done
  label="$n tree"
  case "$n" in gardenia* | bush* | banana*) label="$n plant" ;; esac
  if make -s views-3d "${views[@]}" OUT="$D/$OUT" LABEL="$label" OFFLINE=1 >"$D/$OUT.log" 2>&1; then
    echo "✓ $n: $(grep -oE '[0-9]+ parts \((no trunk|trunk).*overall [0-9.]+' "$D/$OUT.log" | head -1)"
  else
    echo "✗ $n: replay failed ($D/$OUT.log)"
  fi
done
