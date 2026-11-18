#!/usr/bin/env bash
# Flattens the transparent Blender views of DIR onto the app's pale blue drawing background (214,228,240).
set -euo pipefail
for f in "$1"/*.png; do
  ffmpeg -loglevel error -y -f lavfi -i "color=c=0xD6E4F0:s=$(ffprobe -v error -select_streams v -show_entries stream=width,height -of csv=s=x:p=0 "$f")" \
    -i "$f" -filter_complex "[0][1]overlay=format=auto,format=rgb24" -frames:v 1 "${f%.png}.paper.png"
done
