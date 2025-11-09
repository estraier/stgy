#!/usr/bin/env python3

import argparse
import os
import sys

def parse_args():
  p = argparse.ArgumentParser(prog="scan_non_ascii")
  p.add_argument("root", nargs="?", default=".")
  p.add_argument("--ext", default="ts,tsx,js,jsx,html,css,json,md")
  p.add_argument("--exclude-dir", default=".git,node_modules,dist,build,.next,coverage,.turbo,.cache,.venv,venv,vendor")
  p.add_argument("--max-line-len", type=int, default=300)
  return p.parse_args()

def list_files(root, allow_exts, exclude_dirs):
  for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = [d for d in dirnames if d not in exclude_dirs]
    for fn in filenames:
      if not allow_exts:
        yield os.path.join(dirpath, fn)
      else:
        _, ext = os.path.splitext(fn)
        if ext.lower().lstrip(".") in allow_exts:
          yield os.path.join(dirpath, fn)

def has_non_ascii_bytes(b):
  return any(x > 0x7F for x in b)

def find_non_ascii_positions(text):
  res = []
  line_no = 0
  for line in text.splitlines():
    line_no += 1
    cols = []
    for i, ch in enumerate(line, start=1):
      if ord(ch) > 127:
        cols.append(i)
    if cols:
      res.append((line_no, line, cols))
  return res

def mark_line(line, cols, max_len):
  s = []
  for i, ch in enumerate(line, start=1):
    m = ch
    if i in cols:
      s.append("⟦" + m + "⟧")
    else:
      s.append(m)
    if max_len and len("".join(s)) >= max_len:
      s.append(" …")
      break
  return "".join(s)

def main():
  args = parse_args()
  allow_exts = {e.strip().lstrip(".").lower() for e in args.ext.split(",") if e.strip()}
  exclude_dirs = {e.strip() for e in args.exclude_dir.split(",") if e.strip()}
  any_found = False
  for path in list_files(args.root, allow_exts, exclude_dirs):
    try:
      with open(path, "rb") as f:
        b = f.read()
    except Exception:
      continue
    if not has_non_ascii_bytes(b):
      continue
    try:
      text = b.decode("utf-8", errors="replace")
    except Exception:
      continue
    hits = find_non_ascii_positions(text)
    if not hits:
      continue
    any_found = True
    for ln, line, cols in hits:
      preview = mark_line(line, cols, args.max_line_len)
      print(f"{path}:{ln}: {preview}")
  sys.exit(1 if any_found else 0)

if __name__ == "__main__":
  main()
