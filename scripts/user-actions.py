#!/usr/bin/env python3

import os
import sys
import requests

APP_HOST = os.environ.get("STGY_APP_HOST", "localhost")
APP_PORT = int(os.environ.get("STGY_APP_PORT", 3100))
ADMIN_EMAIL = os.environ.get("STGY_ADMIN_EMAIL", "admin@stgy.jp")
ADMIN_PASSWORD = os.environ.get("STGY_ADMIN_PASSWORD", "stgystgy")
BASE_URL = f"http://{APP_HOST}:{APP_PORT}"

def admin_login():
  url = f"{BASE_URL}/auth"
  res = requests.post(url, json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
  if res.status_code != 200:
    raise SystemExit(f"[auth] admin login failed: {res.status_code} {res.text}")
  sid = res.cookies.get("session_id")
  if not sid:
    raise SystemExit("[auth] session_id cookie missing after admin login")
  return {"session_id": sid}

def switch_user(admin_cookies, user_id):
  url = f"{BASE_URL}/auth/switch-user"
  res = requests.post(url, json={"id": user_id}, cookies=admin_cookies)
  if res.status_code != 200:
    raise RuntimeError(f"[switch-user] {user_id}: {res.status_code} {res.text}")
  sid = res.cookies.get("session_id")
  if not sid:
    try:
      sid = res.json().get("sessionId")
    except Exception:
      sid = None
  if not sid:
    raise RuntimeError(f"[switch-user] {user_id}: session_id not returned")
  return {"session_id": sid}

def do_like(cookies, post_id):
  url = f"{BASE_URL}/posts/{post_id}/like"
  res = requests.post(url, cookies=cookies)
  if res.status_code == 200:
    return True, "ok"
  return False, f"{res.status_code} {res.text}"

def do_follow(cookies, target_user_id):
  url = f"{BASE_URL}/users/{target_user_id}/follow"
  res = requests.post(url, cookies=cookies)
  if res.status_code == 200:
    return True, "ok"
  return False, f"{res.status_code} {res.text}"

def do_block(cookies, target_user_id):
  url = f"{BASE_URL}/users/{target_user_id}/block"
  res = requests.post(url, cookies=cookies)
  if res.status_code == 200:
    return True, "ok"
  return False, f"{res.status_code} {res.text}"

def delete_user(admin_cookies, user_id):
  url = f"{BASE_URL}/users/{user_id}"
  res = requests.delete(url, cookies=admin_cookies)
  if res.status_code == 200:
    return True, "ok"
  return False, f"{res.status_code} {res.text}"

def delete_post(admin_cookies, post_id):
  url = f"{BASE_URL}/posts/{post_id}"
  res = requests.delete(url, cookies=admin_cookies)
  if res.status_code == 200:
    return True, "ok"
  return False, f"{res.status_code} {res.text}"

def parse_line(line):
  s = line.strip()
  if not s:
    return None, None
  if ":" not in s:
    raise ValueError("action line must contain ':'")
  k, v = s.split(":", 1)
  key = k.strip()
  value = v.strip()
  if not key:
    raise ValueError("action name is empty")
  return key, value

def parse_csv_ids(v):
  parts = [p.strip() for p in v.split(",")]
  if len(parts) != 2 or not all(parts):
    raise ValueError("need exactly two non-empty comma-separated ids")
  return parts[0], parts[1]

def main(argv=None):
  if argv is None:
    argv = sys.argv
  if len(argv) < 2:
    print("usage: user-actions.py <files...>")
    return 2

  files = sorted(argv[1:])
  admin_cookies = admin_login()
  switched_cache = {}
  ok_count = 0
  err_count = 0

  for path in files:
    with open(path, "r", encoding="utf-8") as f:
      for line_number, raw in enumerate(f, 1):
        try:
          k, v = parse_line(raw)
        except ValueError as e:
          print(f"[ERR] {path}:{line_number}: {e}: {raw.strip()!r}")
          err_count += 1
          continue
        if not k:
          continue

        if k in ("like", "follow", "block"):
          try:
            actor_id, target_id = parse_csv_ids(v)
          except ValueError as e:
            print(f"[{k}] {path}:{line_number}: malformed action: {e}")
            err_count += 1
            continue

          if actor_id not in switched_cache:
            try:
              switched_cache[actor_id] = switch_user(admin_cookies, actor_id)
            except Exception as e:
              print(f"[switch-user] {actor_id}: {e}")
              err_count += 1
              continue

          if k == "like":
            ok, msg = do_like(switched_cache[actor_id], target_id)
            target_label = f"post {target_id}"
          elif k == "follow":
            ok, msg = do_follow(switched_cache[actor_id], target_id)
            target_label = f"user {target_id}"
          else:
            ok, msg = do_block(switched_cache[actor_id], target_id)
            target_label = f"user {target_id}"

          if ok:
            print(f"[{k}] {actor_id} -> {target_label}: ok")
            ok_count += 1
          else:
            print(f"[{k}] {actor_id} -> {target_label}: {msg}")
            err_count += 1

        elif k == "delete-user":
          user_id = v
          if not user_id:
            print(f"[delete-user] {path}:{line_number}: user id is empty")
            err_count += 1
            continue
          ok, msg = delete_user(admin_cookies, user_id)
          if ok:
            print(f"[delete-user] {user_id}: ok")
            ok_count += 1
          else:
            print(f"[delete-user] {user_id}: {msg}")
            err_count += 1

        elif k == "delete-post":
          post_id = v
          if not post_id:
            print(f"[delete-post] {path}:{line_number}: post id is empty")
            err_count += 1
            continue
          ok, msg = delete_post(admin_cookies, post_id)
          if ok:
            print(f"[delete-post] {post_id}: ok")
            ok_count += 1
          else:
            print(f"[delete-post] {post_id}: {msg}")
            err_count += 1

        else:
          print(f"[ERR] {path}:{line_number}: unknown action: {k}")
          err_count += 1

  print(f"[SUMMARY] ok={ok_count} err={err_count}")
  return 0 if err_count == 0 else 1

if __name__ == "__main__":
  sys.exit(main())
