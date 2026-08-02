#!/usr/bin/env python3

import json
import os
import sys

import requests

APP_HOST = os.environ.get("STGY_APP_HOST", "localhost")
APP_PORT = int(os.environ.get("STGY_APP_PORT", 3100))
ADMIN_EMAIL = os.environ.get("STGY_ADMIN_EMAIL", "admin@stgy.jp")
ADMIN_PASSWORD = os.environ.get("STGY_ADMIN_PASSWORD", "stgystgy")
BASE_URL = f"http://{APP_HOST}:{APP_PORT}"


def login_admin(session: requests.Session) -> None:
  res = session.post(
    f"{BASE_URL}/auth",
    json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
  )
  if res.status_code != 200:
    raise RuntimeError(f"admin login failed: {res.status_code} {res.text}")


def load_agreement(path: str) -> tuple[str, list[dict]]:
  with open(path, "r", encoding="utf-8") as file:
    data = json.load(file)
  if not isinstance(data, dict):
    raise ValueError("root must be an object")
  agreement_id = data.get("id")
  contents = data.get("contents")
  if not isinstance(agreement_id, str) or not agreement_id.strip():
    raise ValueError("id is required")
  if not isinstance(contents, list):
    raise ValueError("contents must be an array")
  return agreement_id.strip(), contents


def put_agreement(session: requests.Session, agreement_id: str, contents: list[dict]) -> dict:
  res = session.post(f"{BASE_URL}/agreement-terms/{agreement_id}", json=contents)
  if res.status_code != 200:
    raise RuntimeError(f"put agreement failed: {res.status_code} {res.text}")
  return res.json()


def main(argv: list[str]) -> int:
  if len(argv) < 2:
    print(f"usage: {argv[0]} <agreement1.json> [agreement2.json ...]")
    return 2

  session = requests.Session()
  login_admin(session)
  ok = 0
  err = 0
  for path in sorted(argv[1:]):
    try:
      agreement_id, contents = load_agreement(path)
      result = put_agreement(session, agreement_id, contents)
      print(
        f"[UPSERTED] {path} -> id={result['id']} locales="
        f"{','.join(item['locale'] for item in result['contents'])}"
      )
      ok += 1
    except Exception as error:
      print(f"[ERR] {path} -> {error}")
      err += 1
  print(f"[SUMMARY] ok={ok} err={err}")
  return 0 if err == 0 else 1


if __name__ == "__main__":
  sys.exit(main(sys.argv))
