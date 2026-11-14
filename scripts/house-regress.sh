#!/usr/bin/env bash
# House zero-regression check (PQ-T76), offline only: no Meta call, no cost.
# Replays the saved drawings + saved single reading of the reference houses and compares the plans
# with their PQ-T72 references, then runs the mesh hash tests.
#   bungalow: house.json must equal house-pq-t72.json byte for byte;
#   school:   only the `base` line may differ (measured plinth colour, PQ-T74, intended).
# Usage: scripts/house-regress.sh [refDir]   (default ~/Téléchargements/generated-view)
set -euo pipefail
REF="${1:-$HOME/Téléchargements/generated-view}"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
fail=0

for h in bungalow school; do
  D="$REF/$h"
  for f in view-front.png view-right.png house-reading-single.json house-pq-t72.json report.txt; do
    [ -f "$D/$f" ] || { echo "✗ $h: missing $D/$f"; exit 1; }
  done
  # Materials by hand, as named in the reference run (largest class first): no naming call.
  mats="$(grep -oE '#[0-9a-f]{6} [a-z]+ [0-9]' "$D/report.txt" | awk '{print $2}' | paste -sd, -)"
  views=()
  for v in front right back left top; do
    [ -f "$D/view-$v.png" ] && views+=("${v^^}=$D/view-$v.png")
  done
  make -s views-3d "${views[@]}" OUT="$OUT/$h" LABEL=house OFFLINE=1 \
    READING="$D/house-reading-single.json" MATERIALS="$mats" >"$OUT/$h.log" 2>&1 ||
    { echo "✗ $h: replay failed (see below)"; tail -20 "$OUT/$h.log"; fail=1; continue; }
  if [ "$h" = bungalow ]; then
    if cmp -s "$OUT/$h/house.json" "$D/house-pq-t72.json"; then echo "✓ bungalow: house.json = house-pq-t72.json"
    else echo "✗ bungalow: house.json differs from house-pq-t72.json"; diff "$OUT/$h/house.json" "$D/house-pq-t72.json" | head -20; fail=1; fi
  else
    changed="$(diff "$OUT/$h/house.json" "$D/house-pq-t72.json" | grep -E '^[<>]' | grep -vc '"base"' || true)"
    if [ "$changed" = 0 ]; then echo "✓ school: only the base line differs"
    else echo "✗ school: lines other than base differ"; diff "$OUT/$h/house.json" "$D/house-pq-t72.json" | head -20; fail=1; fi
  fi
done

pnpm --filter web exec vitest run src/lib/__tests__/house-mesh.test.ts >"$OUT/mesh.log" 2>&1 &&
  echo "✓ house-mesh.test.ts: mesh hashes unchanged" ||
  { echo "✗ house-mesh.test.ts"; tail -20 "$OUT/mesh.log"; fail=1; }
exit $fail
