#!/usr/bin/env python3

import os
import sys
import requests

APP_HOST = os.environ.get("STGY_APP_HOST", "localhost")
APP_PORT = int(os.environ.get("STGY_APP_PORT", 3001))
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
  if not s or ":" not in s:
    return None, None
  k, v = s.split(":", 1)
  return k.strip(), v.strip()

def parse_csv_ids(v):
  parts = [p.strip() for p in v.split(",")]
  if len(parts) < 2:
    raise ValueError("need two comma-separated ids")
  return parts[0], parts[1]

def main():
  if len(sys.argv) < 2:
    print("usage: user_actions.py <files...>")
    sys.exit(1)

  files = sorted(sys.argv[1:])
  admin_cookies = admin_login()
  switched_cache = {}

  for path in files:
    with open(path, "r", encoding="utf-8") as f:
      for raw in f:
        k, v = parse_line(raw)
        if not k:
          continue
        if k == "like":
          try:
            actor_id, post_id = parse_csv_ids(v)
          except Exception as e:
            print(f"[like] skip malformed '{raw.strip()}': {e}")
            continue
          if actor_id not in switched_cache:
            try:
              switched_cache[actor_id] = switch_user(admin_cookies, actor_id)
            except Exception as e:
              print(f"[switch-user] {actor_id}: {e}")
              continue
          ok, msg = do_like(switched_cache[actor_id], post_id)
          if ok:
            print(f"[like] {actor_id} -> post {post_id}: ok")
          else:
            print(f"[like] {actor_id} -> post {post_id}: {msg}")

        elif k == "follow":
          try:
            actor_id, target_id = parse_csv_ids(v)
          except Exception as e:
            print(f"[follow] skip malformed '{raw.strip()}': {e}")
            continue
          if actor_id not in switched_cache:
            try:
              switched_cache[actor_id] = switch_user(admin_cookies, actor_id)
            except Exception as e:
              print(f"[switch-user] {actor_id}: {e}")
              continue
          ok, msg = do_follow(switched_cache[actor_id], target_id)
          if ok:
            print(f"[follow] {actor_id} -> user {target_id}: ok")
          else:
            print(f"[follow] {actor_id} -> user {target_id}: {msg}")

        elif k == "block":
          try:
            actor_id, target_id = parse_csv_ids(v)
          except Exception as e:
            print(f"[follow] skip malformed '{raw.strip()}': {e}")
            continue
          if actor_id not in switched_cache:
            try:
              switched_cache[actor_id] = switch_user(admin_cookies, actor_id)
            except Exception as e:
              print(f"[switch-user] {actor_id}: {e}")
              continue
          ok, msg = do_block(switched_cache[actor_id], target_id)
          if ok:
            print(f"[block] {actor_id} -> user {target_id}: ok")
          else:
            print(f"[block] {actor_id} -> user {target_id}: {msg}")

        elif k == "delete-user":
          user_id = v
          ok, msg = delete_user(admin_cookies, user_id)
          if ok:
            print(f"[delete-user] {user_id}: ok")
          else:
            print(f"[delete-user] {user_id}: {msg}")

        elif k == "delete-post":
          post_id = v
          ok, msg = delete_post(admin_cookies, post_id)
          if ok:
            print(f"[delete-post] {post_id}: ok")
          else:
            print(f"[delete-post] {post_id}: {msg}")

        else:
          print(f"[skip] unknown action: {k}")

if __name__ == "__main__":
  main()
