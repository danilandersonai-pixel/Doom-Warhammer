#!/bin/bash
# CC0-текстуры ambientCG → 256 px, ограниченная палитра без дизеринга → assets/textures/*.png
# Использование: tools/make_textures.sh <папка с *_Color.jpg из архивов 1K-JPG>
set -e
SRC=$1; OUT=$(dirname "$0")/../assets/textures
mkdir -p "$OUT"
conv() { # src name colors [extra filter]
  ffmpeg -loglevel error -y -i "$SRC/$1" -vf "scale=256:256:flags=area${4:+,$4},split[a][b];[a]palettegen=max_colors=$3:stats_mode=full[p];[b][p]paletteuse=dither=none" -update 1 "$OUT/$2.png"
}
conv PavingStones138_color.jpg floor 24 "eq=saturation=0.6:brightness=-0.02"
conv MetalPlates013_color.jpg metal 24
conv Metal041B_color.jpg rust 24
conv Rock051_color.jpg rock 24 "eq=saturation=0.5"
conv PavingStones128_color.jpg cobble 24 "eq=saturation=0.45"
ls -la "$OUT"
