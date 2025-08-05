#!/bin/bash

set -e

if [ $# -ne 2 ]; then
  echo "Usage: $0 input.svg favicon.ico"
  exit 1
fi

SVG="$1"
ICO="$2"

SIZES="16 32 48 64"
TMPFILES=""
for size in $SIZES; do
  TMP="_svg2ico_${size}.png"
  TMPFILES="$TMPFILES $TMP"
  rsvg-convert -w $size -h $size -a -b none "$SVG" -o "$TMP"
done

convert $TMPFILES "$ICO"

rm -f $TMPFILES
