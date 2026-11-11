#!/usr/bin/env bash
# Downloads the real photos listed in a manifest of
# apps/web/src/server/perception/__fixtures__/shape/ into the local, gitignored real-photo folder,
# and writes their licences beside them. Wikimedia Commons, no key needed.
#   fetch-fixture-photos.sh shadow-walls   → walls partly in shadow (PQ-T10), SOURCES-shadow.md
#   fetch-fixture-photos.sh family-photos  → one photo per family without a capture (PQ-T13), SOURCES-family.md
set -euo pipefail

NAME="${1:?Usage: fetch-fixture-photos.sh shadow-walls|family-photos}"
case "$NAME" in
  shadow-walls) SOURCES="SOURCES-shadow.md"; TITLE="Real photos of walls partly in shadow"; USE='`make shadow-compare`' ;;
  family-photos) SOURCES="SOURCES-family.md"; TITLE="Real photos of the families the first set lacked"; USE='`make shape-capture`, `make eval-shape`' ;;
  *) echo "Unknown manifest: $NAME" >&2; exit 1 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/apps/web/src/server/perception/__fixtures__/shape/$NAME.json"
DEST="$ROOT/apps/web/src/server/perception/__fixtures__/shape/real/photos"
mkdir -p "$DEST"

node -e '
const rows = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
for (const w of rows) console.log([w.id, w.url, w.licence, w.author, w.source].join("\t"));
' "$MANIFEST" | while IFS=$'\t' read -r id url licence author source; do
  out="$DEST/$id.jpg"
  if [ -s "$out" ]; then
    echo "kept     $id"
    continue
  fi
  # Commons limits bursts (429): wait and try again.
  curl -fsSL --retry 4 --retry-delay 20 --retry-all-errors -A "fixture-fetch/1.0" -o "$out" "$url"
  echo "fetched  $id ($licence, $author)"
  sleep 4
done

node -e '
const [manifest, out, title, use] = process.argv.slice(1);
const rows = JSON.parse(require("fs").readFileSync(manifest, "utf8")).map(
  (w) => `| ${w.id} | ${w.file} | ${w.licence} | ${w.author} | ${w.source} |`
);
require("fs").writeFileSync(
  out,
  `# ${title} (local only, gitignored)\n\nFrom Wikimedia Commons, under the licences below. Used only as local test fixtures (${use}).\n\n| ID | File | Licence | Author | Source |\n| -- | ---- | ------- | ------ | ------ |\n` + rows.join("\n") + "\n"
);
' "$MANIFEST" "$DEST/$SOURCES" "$TITLE" "$USE"
echo "licences → $DEST/$SOURCES"
