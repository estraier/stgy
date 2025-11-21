#!/usr/bin/env python3

import sys


def srgb_to_linear(c_srgb) -> float:
  if c_srgb <= 0.04045:
    return c_srgb / 12.92
  return ((c_srgb + 0.055) / 1.055) ** 2.4


def hex_to_rgb(hex_color):
  s = hex_color.strip()
  if s.startswith("#"):
    s = s[1:]
  if len(s) != 6:
    raise ValueError("hex_color must be in '#RRGGBB' or 'RRGGBB' format")
  r8 = int(s[0:2], 16)
  g8 = int(s[2:4], 16)
  b8 = int(s[4:6], 16)
  return (r8 / 255.0, g8 / 255.0, b8 / 255.0)


def main():
  if len(sys.argv) == 2:
    hex_color = sys.argv[1]
    r, g, b = hex_to_rgb(hex_color)
    print(f"R={r:.3f}, G={g:.3f}, G={b:.3f} in sRGB")
    rl = srgb_to_linear(r)
    gl = srgb_to_linear(g)
    bl = srgb_to_linear(b)
    print(f"R={rl:.3f}, G={gl:.3f}, G={bl:.3f} in liner RGB")
    y = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl
    print(f"Luminance={y:.3f}")
  elif len(sys.argv) == 3:
    r1, g1, b1 = hex_to_rgb(sys.argv[1])
    rl1 = srgb_to_linear(r1)
    gl1 = srgb_to_linear(g1)
    bl1 = srgb_to_linear(b1)
    y1 = 0.2126 * rl1 + 0.7152 * gl1 + 0.0722 * bl1
    r2, g2, b2 = hex_to_rgb(sys.argv[2])
    rl2 = srgb_to_linear(r2)
    gl2 = srgb_to_linear(g2)
    bl2 = srgb_to_linear(b2)
    y2 = 0.2126 * rl2 + 0.7152 * gl2 + 0.0722 * bl2

    print(f"Luminance: {y1:.3f} vs {y2:.3f}")
    contrast = (max(y1, y2) + 0.05) / (min(y1, y2) + 0.05)
    print(f"Contrast: {contrast:.3f}")

  else:
    raise ValueError("usage: check_luminance.py RRGGBB [#RRGGBB]")


if __name__ == "__main__":
  main()
