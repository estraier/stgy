#!/usr/bin/env python3

import requests
import os
import sys

APP_HOST = os.environ.get("STGY_APP_HOST", "localhost")
APP_PORT = int(os.environ.get("STGY_APP_PORT", 3200))
BASE_URL = f"http://{APP_HOST}:{APP_PORT}"

def test_root():
  url = f"{BASE_URL}/health"
  res = requests.get(url)
  assert res.status_code == 200, res.text
  assert res.json() == {"result": "ok"}
  print(f"[root] health OK")

def main():
  test_funcs = {name: fn for name, fn in globals().items() if name.startswith("test_") and callable(fn)}

  if len(sys.argv) < 2:
    for name, fn in test_funcs.items():
      print(f"[run] {name}")
      fn()
  else:
    for scenario in sys.argv[1:]:
      func_name = scenario if scenario.startswith("test_") else f"test_{scenario}"
      if func_name not in test_funcs:
        print(f"Unknown scenario: {scenario}")
        sys.exit(1)
      test_funcs[func_name]()

if __name__ == "__main__":
  main()
