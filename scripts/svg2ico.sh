#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Usage: $0 input.svg [outdir]" >&2
  exit 1
fi

SVG="$1"
OUTDIR="${2:-.}"
MONO_THRESH="${MONO_THRESH:-94%}"

command -v rsvg-convert >/dev/null || { echo "rsvg-convert not found" >&2; exit 1; }
if command -v magick >/dev/null; then IM="magick"; elif command -v convert >/dev/null; then IM="convert"; else echo "ImageMagick not found" >&2; exit 1; fi

mkdir -p "$OUTDIR"

MASTER="$OUTDIR/icon-1024.png"
rsvg-convert -w 1024 -h 1024 -a -b none "$SVG" -o "$MASTER"

$IM "$MASTER" -define icon:auto-resize=256,128,64,48,32,16 "$OUTDIR/favicon.ico"

$IM "$MASTER" -resize 180x180 "$OUTDIR/apple-touch-icon.png"

$IM "$MASTER" -resize 512x512 "$OUTDIR/icon-512.png"
$IM "$MASTER" -resize 192x192 "$OUTDIR/icon-192.png"

MASK1024="$OUTDIR/icon-1024-maskable.png"
$IM "$MASTER" -resize 820x820 -gravity center -background none -extent 1024x1024 "$MASK1024"
$IM "$MASK1024" -resize 512x512 "$OUTDIR/icon-512-maskable.png"
$IM "$MASK1024" -resize 192x192 "$OUTDIR/icon-192-maskable.png"

$IM "$MASTER" -colorspace Gray -blur 0x0.4 -threshold "$MONO_THRESH" -write mpr:mask +delete \
  -size 1024x1024 xc:white mpr:mask -alpha off -compose CopyOpacity -composite \
  -resize 512x512 "$OUTDIR/icon-512-monochrome.png"
