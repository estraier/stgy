#!/usr/bin/env python3

import os
import sys
import requests

APP_HOST = os.environ.get("STGY_APP_HOST", "localhost")
APP_PORT = int(os.environ.get("STGY_APP_PORT", 3001))
ADMIN_EMAIL = os.environ.get("STGY_ADMIN_EMAIL", "admin@stgy.jp")
ADMIN_PASSWORD = os.environ.get("STGY_ADMIN_PASSWORD", "stgystgy")
BASE_URL = f"http://{APP_HOST}:{APP_PORT}"

REQUIRED_KEYS = ["content", "ownedBy", "allowLikes", "allowReplies"]
NULLABLE_KEYS = ["id", "replyTo"]

def to_bool(s: str) -> bool:
  v = s.strip().lower()
  if v in ("true", "1", "yes", "y", "on"): return True
  if v in ("false", "0", "no", "n", "off"): return False
  raise ValueError(f"boolean expected, got: {s!r}")

def split_tags(s: str) -> list[str]:
  if s is None: return []
  return [t.strip() for t in s.split(",") if t.strip()]

def parse_kv_file(path: str) -> dict:
  with open(path, "r", encoding="utf-8") as f:
    lines = f.read().splitlines()
  i = 0
  data = {}
  while i < len(lines):
    line = lines[i]
    if not line.strip():
      i += 1
      continue
    if ":" not in line:
      raise ValueError(f"{path}: invalid line (no colon): {line!r}")
    key, val = line.split(":", 1)
    key = key.strip()
    val = val.lstrip()
    if val.startswith("<<"):
      sep = val[2:].strip()
      i += 1
      buf = []
      found = False
      while i < len(lines):
        if lines[i] == sep:
          found = True
          i += 1
          break
        buf.append(lines[i])
        i += 1
      if not found:
        raise ValueError(f"{path}: heredoc terminator not found for key '{key}' (sep={sep!r})")
      data[key] = "\n".join(buf).strip()
      continue
    data[key] = val.strip()
    i += 1
  return data

def normalize_payload(raw: dict) -> dict:
  out = {}
  for k in NULLABLE_KEYS:
    v = (raw.get(k, "") or "").strip()
    out[k] = (None if v == "" else v)
  for k in ("content", "ownedBy"):
    v = (raw.get(k, "") or "").strip()
    if not v:
      raise ValueError(f"{k} is required")
    out[k] = v
  if "allowLikes" not in raw:
    raise ValueError("allowLikes is required")
  if "allowReplies" not in raw:
    raise ValueError("allowReplies is required")
  out["allowLikes"] = to_bool(str(raw["allowLikes"]))
  out["allowReplies"] = to_bool(str(raw["allowReplies"]))
  if "tags" in raw:
    tags_raw = (raw.get("tags") or "").strip()
    out["tags"] = split_tags(tags_raw)
  else:
    out["tags"] = []
  return out

def login_admin(session: requests.Session) -> None:
  r = session.post(f"{BASE_URL}/auth", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
  if r.status_code != 200:
    raise RuntimeError(f"admin login failed: {r.status_code} {r.text}")

def get_post_by_id(session: requests.Session, post_id: str):
  r = session.get(f"{BASE_URL}/posts/{post_id}")
  if r.status_code == 404:
    return None
  if r.status_code != 200:
    raise RuntimeError(f"get post failed: {r.status_code} {r.text}")
  return r.json()

def create_post(session: requests.Session, payload: dict) -> dict:
  body = {
    "id": payload.get("id"),
    "content": payload["content"],
    "ownedBy": payload["ownedBy"],
    "replyTo": payload["replyTo"],
    "allowLikes": payload["allowLikes"],
    "allowReplies": payload["allowReplies"],
    "tags": payload["tags"],
  }
  if payload.get("id"):
    body["id"] = payload["id"]
  r = session.post(f"{BASE_URL}/posts", json=body)
  if r.status_code != 201:
    raise RuntimeError(f"create post failed: {r.status_code} {r.text}")
  return r.json()

def update_post(session: requests.Session, post_id: str, payload: dict) -> dict:
  body = {
    "content": payload["content"],
    "ownedBy": payload["ownedBy"],
    "replyTo": payload["replyTo"],
    "allowLikes": payload["allowLikes"],
    "allowReplies": payload["allowReplies"],
    "tags": payload["tags"],
  }
  r = session.put(f"{BASE_URL}/posts/{post_id}", json=body)
  if r.status_code != 200:
    raise RuntimeError(f"update post failed: {r.status_code} {r.text}")
  return r.json()

def upsert_post(session: requests.Session, payload: dict) -> tuple[str, str]:
  pid = (payload.get("id") or "") or ""
  if pid:
    exists = get_post_by_id(session, pid)
    if exists is not None:
      updated = update_post(session, pid, payload)
      return ("UPDATED", updated.get("id") or pid)
  created = create_post(session, payload)
  return ("CREATED", created.get("id"))

def main(argv: list[str]) -> int:
  if len(argv) < 2:
    print(f"usage: {argv[0]} <post1.md> [post2.md ...]")
    return 2
  files = sorted(argv[1:])
  sess = requests.Session()
  login_admin(sess)
  ok = 0
  err = 0
  for path in files:
    try:
      raw = parse_kv_file(path)
      payload = normalize_payload(raw)
      action, pid = upsert_post(sess, payload)
      owned_by = payload.get("ownedBy")
      reply_to = payload.get("replyTo")
      tags = ",".join(payload.get("tags", []))
      print(f"[{action}] {path} -> id={pid} ownedBy={owned_by} replyTo={reply_to} tags=[{tags}]")
      ok += 1
    except Exception as e:
      print(f"[ERR] {path} -> {e}")
      err += 1
  print(f"[SUMMARY] ok={ok} err={err}")
  return 0 if err == 0 else 1

if __name__ == "__main__":
  sys.exit(main(sys.argv))
