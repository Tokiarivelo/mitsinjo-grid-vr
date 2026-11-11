#!/usr/bin/env bash
# Downloads the real photos of walls partly in shadow (PQ-T10) listed in
# apps/web/src/server/perception/__fixtures__/shape/shadow-walls.json into the local, gitignored
# real-photo folder, and writes their licences beside them. Wikimedia Commons, no key needed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/apps/web/src/server/perception/__fixtures__/shape/shadow-walls.json"
DEST="$ROOT/apps/web/src/server/perception/__fixtures__/shape/real/photos"
mkdir -p "$DEST"

node -e '
const walls = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
for (const w of walls) console.log([w.id, w.url, w.licence, w.author, w.source].join("\t"));
' "$MANIFEST" | while IFS=$'\t' read -r id url licence author source; do
  out="$DEST/$id.jpg"
  if [ -s "$out" ]; then
    echo "kept     $id"
    continue
  fi
  curl -fsSL -A "fixture-fetch/1.0" -o "$out" "$url"
  echo "fetched  $id ($licence, $author)"
  sleep 1
done

node -e '
const walls = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const rows = walls.map((w) => `| ${w.id} | ${w.file} | ${w.licence} | ${w.author} | ${w.source} |`);
require("fs").writeFileSync(
  process.argv[2],
  "# Real photos of walls partly in shadow (local only, gitignored)\n\nFrom Wikimedia Commons, under the licences below. Used only as local test fixtures (`make shadow-compare`).\n\n| ID | File | Licence | Author | Source |\n| -- | ---- | ------- | ------ | ------ |\n" + rows.join("\n") + "\n"
);
' "$MANIFEST" "$DEST/SOURCES-shadow.md"
echo "licences → $DEST/SOURCES-shadow.md"
