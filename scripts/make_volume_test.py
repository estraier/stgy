#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import time
import requests

APP_HOST = os.environ.get("FAKEBOOK_APP_HOST", "localhost")
APP_PORT = int(os.environ.get("FAKEBOOK_APP_PORT", 3001))
ADMIN_EMAIL = os.environ.get("FAKEBOOK_ADMIN_EMAIL", "admin@dbmx.net")
ADMIN_PASSWORD = os.environ.get("FAKEBOOK_ADMIN_PASSWORD", "admin")
BASE_URL = f"http://{APP_HOST}:{APP_PORT}"

NUM_DUMMY_USERS = 100

TARO_ID = "0001000000100000"
TARO_POST1_ID = "0002000000100001"
TARO_POST2_ID = "0001000000100002"

USERS_ID_START_HEX = "0001000000200001"
REPLY_ID_START_HEX = "0001000000300001"

def login_admin() -> tuple[requests.Session, str]:
  s = requests.Session()
  r = s.post(f"{BASE_URL}/auth", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
  if r.status_code != 200:
    raise RuntimeError(f"[admin login] failed: {r.status_code} {r.text}")
  sid = r.cookies.get("session_id")
  if not sid:
    raise RuntimeError("[admin login] no session_id")
  s.cookies.clear()
  s.cookies.set("session_id", sid)
  return s, sid

def switch_user(admin_session_id: str, user_id: str) -> requests.Session:
  tx = requests.Session()
  tx.cookies.set("session_id", admin_session_id)
  r = tx.post(f"{BASE_URL}/auth/switch-user", json={"id": user_id})
  if r.status_code != 200:
    raise RuntimeError(f"[switch-user] {user_id} failed: {r.status_code} {r.text}")
  user_sid = r.cookies.get("session_id")
  if not user_sid:
    try:
      user_sid = r.json().get("sessionId")
    except Exception:
      user_sid = None
  if not user_sid:
    raise RuntimeError(f"[switch-user] session_id not returned for user {user_id}")
  s = requests.Session()
  s.cookies.set("session_id", user_sid)
  return s

def ensure_user(
  admin: requests.Session,
  *,
  user_id: str,
  email: str,
  nickname: str,
  password: str,
  is_admin: bool,
  introduction: str,
  ai_model: str | None = None,
  ai_personality: str | None = None,
  avatar: str | None = None,
) -> dict:
  g = admin.get(f"{BASE_URL}/users/{user_id}")
  if g.status_code == 200:
    body = {
      "email": email,
      "nickname": nickname,
      "isAdmin": is_admin,
      "introduction": introduction,
      "avatar": avatar,
      "aiModel": ai_model,
      "aiPersonality": ai_personality,
    }
    r = admin.put(f"{BASE_URL}/users/{user_id}", json=body)
    if r.status_code != 200:
      raise RuntimeError(f"[users.update] {user_id} failed: {r.status_code} {r.text}")
    return r.json()
  body = {
    "id": user_id,
    "email": email,
    "nickname": nickname,
    "password": password,
    "isAdmin": is_admin,
    "introduction": introduction,
    "avatar": avatar,
    "aiModel": ai_model,
    "aiPersonality": ai_personality,
  }
  r = admin.post(f"{BASE_URL}/users", json=body)
  if r.status_code != 201:
    raise RuntimeError(f"[users.create] {user_id} failed: {r.status_code} {r.text}")
  return r.json()

def create_post_as_admin(
  admin: requests.Session,
  *,
  post_id: str | None,
  owned_by: str,
  content: str,
  reply_to: str | None,
  tags: list[str] | None = None,
  allow_likes: bool = True,
  allow_replies: bool = True,
) -> dict:
  body = {
    "content": content,
    "ownedBy": owned_by,
    "replyTo": reply_to,
    "allowLikes": allow_likes,
    "allowReplies": allow_replies,
    "tags": tags or [],
  }
  if post_id:
    body["id"] = post_id
  r = admin.post(f"{BASE_URL}/posts", json=body)
  if r.status_code != 201:
    raise RuntimeError(f"[posts.create] id={post_id} ownedBy={owned_by} failed: {r.status_code} {r.text}")
  return r.json()

def like_post(session: requests.Session, post_id: str) -> None:
  r = session.post(f"{BASE_URL}/posts/{post_id}/like")
  if r.status_code == 200:
    return
  if r.status_code in (400, 403, 404):
    print(f"[like] skip {post_id}: {r.status_code} {r.text}")
    return
  raise RuntimeError(f"[like] {post_id} failed: {r.status_code} {r.text}")

def follow_user(session: requests.Session, target_user_id: str) -> None:
  r = session.post(f"{BASE_URL}/users/{target_user_id}/follow")
  if r.status_code == 200:
    return
  if r.status_code in (400, 403):
    print(f"[follow] skip -> {target_user_id}: {r.status_code} {r.text}")
    return
  raise RuntimeError(f"[follow] -> {target_user_id} failed: {r.status_code} {r.text}")

def list_replies_to(session: requests.Session, post_id: str) -> list[dict]:
  r = session.get(f"{BASE_URL}/posts", params={"replyTo": post_id, "limit": 2000})
  if r.status_code != 200:
    raise RuntimeError(f"[list replies] replyTo={post_id} failed: {r.status_code} {r.text}")
  return r.json()

def hex_inc(base_hex: str, delta: int) -> str:
  v = int(base_hex, 16) + delta
  s = f"{v:0{len(base_hex)}X}"
  return s

def make_user_name(i: int) -> str:
  return f"user{i:05d}"

def main(argv: list[str]) -> int:
  admin, admin_sid = login_admin()
  print("[login] admin OK")

  print("[user] ensure taro")
  taro = ensure_user(
    admin,
    user_id=TARO_ID,
    email="taro@dbmx.net",
    nickname="taro",
    password="taro-taro",
    is_admin=True,
    introduction="I'm taro.",
    ai_model=None,
    ai_personality=None,
  )
  print(f"[user] taro: {taro['id']}")

  print("[post] taro post #1 (with ID)")
  p1 = create_post_as_admin(
    admin,
    post_id=TARO_POST1_ID,
    owned_by=TARO_ID,
    content="Hello, world",
    reply_to=None,
    tags=["bulk"],
  )
  print(f"[post] created: {p1['id']}")

  print("[post] taro post #2 (with ID)")
  p2 = create_post_as_admin(
    admin,
    post_id=TARO_POST2_ID,
    owned_by=TARO_ID,
    content="We will rock you.",
    reply_to=None,
    tags=["bulk"],
  )
  print(f"[post] created: {p2['id']}")

  print(f"[users] creating {NUM_DUMMY_USERS} users and 1 normal post each")
  users = []
  for i in range(1, NUM_DUMMY_USERS + 1):
    name = make_user_name(i)
    uid = hex_inc(USERS_ID_START_HEX, i - 1)
    u = ensure_user(
      admin,
      user_id=uid,
      email=f"{name}@dbmx.net",
      nickname=name,
      password=f"{name}-pw",
      is_admin=True,
      introduction=f"I'm {name}.",
      ai_model=None,
      ai_personality=None,
    )
    users.append(u)
    create_post_as_admin(
      admin,
      post_id=None,
      owned_by=uid,
      content=f"Post by {name}.",
      reply_to=None,
      tags=["bulk"],
    )
    if i % 10 == 0:
      print(f"  - created up to {name}")

  print("[replies] creating replies to taro's 2nd post (with IDs)")
  replies = []
  for i, u in enumerate(users, start=1):
    reply_id = hex_inc(REPLY_ID_START_HEX, i - 1)
    name = u["nickname"]
    pr = create_post_as_admin(
      admin,
      post_id=reply_id,
      owned_by=u["id"],
      content=f"Reply to taro by {name}.",
      reply_to=TARO_POST2_ID,
      tags=["bulk"],
    )
    replies.append(pr)
    if i % 10 == 0:
      print(f"  - replies created up to {name}")
  print(f"[replies] total: {len(replies)}")

  print("[follow] start: taro -> users")
  taro_sess = switch_user(admin_sid, TARO_ID)
  for u in users:
    follow_user(taro_sess, u["id"])
  print("[follow] done: taro -> users")

  print("[follow] start: users -> taro")
  for u in users:
    s = switch_user(admin_sid, u["id"])
    follow_user(s, TARO_ID)
  print("[follow] done: users -> taro")

  print("[like] start: users -> taro first post")
  for u in users:
    s = switch_user(admin_sid, u["id"])
    like_post(s, TARO_POST1_ID)
  print("[like] done: users -> taro first post")

  print("[like] start: taro -> replies to his posts")
  for pid in (p1["id"], p2["id"]):
    items = list_replies_to(taro_sess, pid)
    for it in items:
      like_post(taro_sess, it["id"])
  print("[like] done: taro -> replies to his posts")

  print("[SUMMARY] OK")
  return 0

if __name__ == "__main__":
  sys.exit(main(sys.argv))
