#!/usr/bin/env python3
import pathlib
import subprocess
import tarfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "stgy-current-source.tar.gz"

EXCLUDE_PARTS = {
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".turbo",
  ".next",
}

EXCLUDE_FILES = {
  "stgy-current-source.tar.gz",
}

def git_visible_paths():
  raw = subprocess.check_output(
    ["git", "ls-files", "-z", "-c", "-o", "--exclude-standard"],
    cwd=ROOT,
  )
  return [p.decode() for p in raw.split(b"\0") if p]

def should_include(rel):
  parts = pathlib.PurePosixPath(rel).parts
  if any(part in EXCLUDE_PARTS for part in parts):
    return False
  if pathlib.PurePosixPath(rel).name in EXCLUDE_FILES:
    return False
  return True

def main():
  paths = [
    rel for rel in git_visible_paths()
    if should_include(rel)
  ]

  with tarfile.open(OUT, "w:gz") as tar:
    for rel in paths:
      path = ROOT / rel
      if path.is_file() or path.is_symlink():
        tar.add(path, arcname=rel)

  print(OUT.relative_to(ROOT))
  print(f"{len(paths)} files archived")

if __name__ == "__main__":
  main()
