#!/usr/bin/env bash
# Plant gallery (PQ-T82): the bench's results laid out to look at, one version per run in
# resources/generated-view/plants/v<NNN>-<date>-<run>/ (gitignored; `latest` links the newest), listed
# newest first in resources/generated-view/VERSIONS.md (version → date, commit, plants, scores). Per plant: photo.jpg (the input, when there is one), drawing.png (the 2D front the
# plant was built from), render.png (the 3D plant from four cameras), compare.jpg (all three side by
# side), plant.json, plant-reading.json (the plant team's reading). Plus index.md (scores, species)
# and all.jpg (every compare on one sheet). Needs ImageMagick for the sheets.
# Usage: scripts/plant-gallery.sh [OUT=replay] [names…]   (default every t-* with <OUT>/plant-sheet.png)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REF="$ROOT/resources/refine-3d"
GV="$ROOT/resources/generated-view"
OUT="${1:-replay}"
shift $(($# > 0 ? 1 : 0))
names=("$@")
[ ${#names[@]} -eq 0 ] && names=($(cd "$REF" && ls -d t-*/ | sed 's|^t-||; s|/$||'))
mkdir -p "$GV/plants"
last=$(cd "$GV/plants" && ls -d v[0-9][0-9][0-9]-* 2>/dev/null | sort | tail -1 | cut -c2-4 || true)
num=$(printf '%03d' $((10#${last:-0} + 1)))
stamp="$(date '+%Y-%m-%d %H:%M')"
version="v$num-$(date '+%Y%m%d-%H%M')-$OUT"
G="$GV/plants/$version"
mkdir -p "$G"
commit="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo ?)$(git -C "$ROOT" diff --quiet 2>/dev/null || echo '+changes')"
index="$G/index.md"
{
  echo "# Plant bench $version"
  echo
  echo "Generated $stamp from run \`$OUT\` on commit \`$commit\`."
  echo
  echo "| plant | label | team reading | built | IoU front / side | input → drawing → render |"
  echo "| --- | --- | --- | --- | --- | --- |"
} >"$index"
ious=()
sheets=()
for n in "${names[@]}"; do
  D="$REF/t-$n"
  [ -f "$D/$OUT/plant-sheet.png" ] || continue
  P="$G/$n"
  mkdir -p "$P"
  photo=""
  for c in "$REF/$n.jpg" "$REF/${n%-photo}.jpg" "$REF/${n%%[0-9]*}.jpg"; do
    [ -f "$c" ] && { photo="$c"; break; }
  done
  [ -n "$photo" ] && cp "$photo" "$P/photo.jpg"
  cp "$D/view-front.png" "$P/drawing.png"
  cp "$D/$OUT/plant-sheet.png" "$P/render.png"
  [ -f "$D/$OUT/plant.json" ] && cp "$D/$OUT/plant.json" "$P/plant.json"
  [ -f "$D/plant-reading.json" ] && cp "$D/plant-reading.json" "$P/plant-reading.json"
  log="$D/$OUT.log"
  built="$(grep -oE 'plant [a-z]+, [0-9]+ stems, [0-9]+ masses, [0-9]+ strands, [0-9]+ leaves, [0-9]+ tiers' "$log" 2>/dev/null | head -1 || true)"
  iou="$(grep -oE 'iou front [0-9.]+ side [0-9.]+' "$log" 2>/dev/null | head -1 | sed 's/iou front //; s/ side / \/ /' || true)"
  team="$(python3 -I -c 'import json,sys
try: d=json.load(open(sys.argv[1]))
except Exception: print("—"); sys.exit()
print(", ".join(str(x) for x in [d.get("species"), d.get("habit"), d.get("leaf")] if x))' "$P/plant-reading.json" 2>/dev/null || echo —)"
  label="$(cat "$D/label.txt" 2>/dev/null || echo "${n%%[0-9]*} tree")"
  [ -n "$iou" ] && ious+=("$iou")
  src="${photo:+[$(basename "$photo")]($n/photo.jpg) → }[drawing]($n/drawing.png) → [render]($n/render.png) · [compare]($n/compare.jpg)"
  echo "| $n | $label | $team | ${built:-not built} | ${iou:-—} | $src |" >>"$index"
  if command -v montage >/dev/null; then
    inputs=()
    [ -n "$photo" ] && inputs+=(-label photo "$P/photo.jpg")
    inputs+=(-label "2D drawing" "$P/drawing.png" -label "3D render: front, side, 3/4, top · IoU ${iou:-?}" "$P/render.png")
    montage "${inputs[@]}" -geometry '+6+6' -tile x1 -resize x420 -title "$n — $team" "$P/compare.jpg" 2>/dev/null &&
      sheets+=("$P/compare.jpg")
  fi
done
if command -v montage >/dev/null && [ ${#sheets[@]} -gt 0 ]; then
  montage "${sheets[@]}" -geometry '+4+4' -tile 1x -resize 1600x "$G/all.jpg" 2>/dev/null || true
fi
ln -sfn "$version" "$GV/plants/latest"
# VERSIONS.md: one row per version, newest first.
count=$(($(grep -c '^| ' "$index") - 2))
mean=$(printf '%s\n' "${ious[@]:-}" | LC_ALL=C awk -F' / ' 'NF==2 {s+=($1+$2)/2; n++} END {if (n) printf "%.2f", s/n; else print "—"}')
V="$GV/VERSIONS.md"
row="| $version | $stamp | \`$OUT\` | \`$commit\` | $count | $mean | [index](plants/$version/index.md) · [all](plants/$version/all.jpg) |"
python3 -I - "$V" "$row" <<'PY'
import os, sys
path, row = sys.argv[1], sys.argv[2]
head = [
    "# Generated versions",
    "",
    "Every generation run on the files of `resources/refine-3d`, newest first. `plants/latest` links the",
    "newest version. In each version, `index.md` maps every plant: input photo → 2D drawing → 3D render.",
    "Older hand tests (before versioning) are listed at the end.",
    "",
    "| version | generated | run | commit | plants | mean IoU | open |",
    "| --- | --- | --- | --- | --- | --- | --- |",
]
rows, tail = [], []
if os.path.exists(path):
    lines = open(path, encoding="utf-8").read().splitlines()
    i = 0
    while i < len(lines) and not lines[i].startswith("| --- "):
        i += 1
    i += 1
    while i < len(lines) and lines[i].startswith("| "):
        rows.append(lines[i]); i += 1
    tail = lines[i:]
open(path, "w", encoding="utf-8").write("\n".join(head + [row] + rows + tail) + "\n")
PY
echo "gallery: $G (index.md, all.jpg, <plant>/compare.jpg) · versions: $V"
