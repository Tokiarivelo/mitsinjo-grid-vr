#!/usr/bin/env bash
# Builds the prepared demo objects (VS-T52) with Blender (bpy) and installs them in the app:
# views on the drawing background at 512 px + an optimised GLB → apps/web/public/models/prepared/<id>/.
# Needs video/.venv-blender (pip install bpy==5.3.0, apt libtbb12) and npx (@gltf-transform/cli).
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(cd ../.. && pwd)
WORK=${WORK:-/tmp/prepared}
PY=../.venv-blender/bin/python
for pair in sofa:hall-sofa car:street-car-white house:terrace-house; do
  script=${pair%%:*}; id=${pair#*:}
  [ -n "${ONLY:-}" ] && [ "$ONLY" != "$script" ] && continue
  rm -rf "$WORK/$id" && mkdir -p "$WORK/$id"
  "$PY" "$script.py" "$WORK/$id" | grep -E "^(view|glb)"
  ./paper.sh "$WORK/$id"
  dest="$ROOT/apps/web/public/models/prepared/$id"
  mkdir -p "$dest"
  for f in "$WORK/$id"/*.paper.png; do
    v=$(basename "$f" .paper.png)
    [ "$v" = hero ] && continue
    ffmpeg -loglevel error -y -i "$f" -vf scale=512:512:flags=lanczos "$dest/$v.png"
  done
  npx -y @gltf-transform/cli@4.1.1 optimize "$WORK/$id/$id.glb" "$dest/model.glb" \
    --compress false --texture-compress false --simplify-ratio 0.35 --simplify-error 0.0008 | tail -1
done
