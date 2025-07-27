#!/usr/bin/env python3

import requests
import os
import sys

APP_HOST = os.environ.get("FAKEBOOK_APP_HOST", "localhost")
APP_PORT = int(os.environ.get("FAKEBOOK_APP_PORT", 3001))
ADMIN_EMAIL = os.environ.get("FAKEBOOK_ADMIN_EMAIL", "admin@dbmx.net")
ADMIN_PASSWORD = os.environ.get("FAKEBOOK_ADMIN_PASSWORD", "admin")
TEST_SIGNUP_CODE = os.environ.get("FAKEBOOK_TEST_SIGNUP_CODE", "000000")
BASE_URL = f"http://{APP_HOST}:{APP_PORT}"

def login():
  url = f"{BASE_URL}/auth"
  res = requests.post(url, json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
  res.raise_for_status()
  cookies = res.cookies.get_dict()
  session_id = cookies.get("session_id")
  assert session_id, "Session ID not found in cookies"
  print(f"[login] session_id: {session_id}")
  return session_id

def get_session(session_id):
  url = f"{BASE_URL}/auth"
  res = requests.get(url, cookies={"session_id": session_id})
  res.raise_for_status()
  data = res.json()
  print(f"[session] {data}")
  assert data["user_email"] == ADMIN_EMAIL
  assert "user_nickname" in data
  assert "user_id" in data
  assert "logged_in_at" in data
  return data

def logout(session_id):
  url = f"{BASE_URL}/auth"
  res = requests.delete(url, cookies={"session_id": session_id})
  res.raise_for_status()
  print("[logout] OK")

def test_auth():
  session_id = login()
  get_session(session_id)
  logout(session_id)
  print("[test_auth] OK")

def test_users():
  print("[users] admin login")
  session_id = login()
  headers = {"Content-Type": "application/json"}
  cookies = {"session_id": session_id}
  user_input = {
    "email": f"user1-{session_id[:8]}@example.com",
    "nickname": "user1",
    "is_admin": False,
    "introduction": "hi!",
    "personality": "super diligent",
    "model": "gpt-4.1",
    "password": "password1"
  }
  res = requests.post(f"{BASE_URL}/users", json=user_input, headers=headers, cookies=cookies)
  assert res.status_code == 201, res.text
  user1 = res.json()
  user1_id = user1["id"]
  print("[users] created:", user1)
  res = requests.post(f"{BASE_URL}/auth", json={"email": user_input["email"], "password": user_input["password"]})
  assert res.status_code == 200, res.text
  user1_session = res.cookies.get("session_id")
  assert user1_session
  user1_cookies = {"session_id": user1_session}
  print("[users] user1 login OK")
  res = requests.get(f"{BASE_URL}/users?limit=1000", headers=headers, cookies=cookies)
  assert res.status_code == 200
  users = res.json()
  admin_user = next(u for u in users if u["email"] == ADMIN_EMAIL)
  admin_id = admin_user["id"]
  res = requests.get(f"{BASE_URL}/users/{admin_id}", headers=headers, cookies=cookies)
  got_admin_user = res.json()
  assert got_admin_user["id"] == admin_id
  for key, value in got_admin_user.items():
    assert admin_user[key] == value
  res = requests.post(f"{BASE_URL}/users/{admin_id}/follow", headers=headers, cookies=user1_cookies)
  assert res.status_code == 200, res.text
  print(f"[users] user1 followed admin: {admin_id}")
  res = requests.get(f"{BASE_URL}/users/{user1_id}/followees/detail?limit=1000", headers=headers, cookies=user1_cookies)
  assert res.status_code == 200, res.text
  followees = res.json()
  print("[users] user1 followees:", followees)
  assert any(u["id"] == admin_id for u in followees)
  res = requests.get(f"{BASE_URL}/users/{admin_id}/followers/detail?limit=1000", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  followers = res.json()
  print("[users] admin followers:", followers)
  assert any(u["id"] == user1_id for u in followers)
  res = requests.get(f"{BASE_URL}/users/{admin_id}/detail?limit=1000&focus_user_id={user1_id}", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  admin_detail = res.json()
  assert admin_detail["count_followers"] > 0
  assert "count_followees" in admin_detail
  assert admin_detail["is_followed_by_focus_user"] == True
  assert admin_detail["is_following_focus_user"] == False
  res = requests.get(f"{BASE_URL}/users/detail?limit=1000&focus_user_id={admin_id}&order=social", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  users_detail = res.json()
  assert len(users_detail) >= 2
  user1_detail = next(u for u in users_detail if u["email"] == user1["email"])
  assert user1_detail["count_followers"] == 0
  assert user1_detail["count_followees"] == 1
  assert user1_detail["is_followed_by_focus_user"] == False
  assert user1_detail["is_following_focus_user"] == True
  res = requests.delete(f"{BASE_URL}/users/{admin_id}/follow", headers=headers, cookies=user1_cookies)
  assert res.status_code == 200, res.text
  print(f"[users] user1 unfollowed admin: {admin_id}")
  res = requests.get(f"{BASE_URL}/users/{user1_id}/followees/detail?limit=1000", headers=headers, cookies=user1_cookies)
  assert all(u["id"] != admin_id for u in res.json())
  res = requests.get(f"{BASE_URL}/users/{admin_id}/followers/detail?limit=1000", headers=headers, cookies=cookies)
  assert all(u["id"] != user1_id for u in res.json())
  res = requests.delete(f"{BASE_URL}/users/{user1_id}", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  print("[users] user1 deleted")
  logout(session_id)
  print("[test_users] OK")

def test_posts():
  print("[posts] login")
  session_id = login()
  headers = {"Content-Type": "application/json"}
  cookies = {"session_id": session_id}
  post_input = {
    "content": "hello, this is a test post!",
    "reply_to": None,
    "tags": ["hop", "step"],
  }
  res = requests.post(f"{BASE_URL}/posts", json=post_input, headers=headers, cookies=cookies)
  assert res.status_code == 201, res.text
  post = res.json()
  post_id = post["id"]
  user_id = post["owned_by"]
  print("[posts] created:", post)
  res = requests.post(f"{BASE_URL}/posts/{post_id}/like", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  print("[posts] like: ok")
  res = requests.get(f"{BASE_URL}/posts/liked/detail?limit=1000&user_id={user_id}", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  liked_posts = res.json()
  print("[posts] liked/detail:", liked_posts)
  assert any(p["id"] == post_id for p in liked_posts)
  res = requests.get(f"{BASE_URL}/posts/{post_id}/likers?limit=1000", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  likers = res.json()
  print("[posts] likers:", likers)
  assert isinstance(likers, list)
  assert any(u["id"] == user_id for u in likers)
  res = requests.delete(f"{BASE_URL}/posts/{post_id}/like", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  print("[posts] unlike: ok")
  res = requests.delete(f"{BASE_URL}/posts/{post_id}/like", headers=headers, cookies=cookies)
  assert res.status_code == 404, res.text
  print("[posts] unlike again: not found (expected)")
  res = requests.get(f"{BASE_URL}/posts/{post_id}", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  got = res.json()
  assert got["content"] == post_input["content"]
  res = requests.get(f"{BASE_URL}/posts/{post_id}/detail", headers=headers, cookies=cookies)
  assert res.status_code == 200
  detail = res.json()
  assert detail["id"] == post_id
  assert detail["content"] == post_input["content"]
  assert detail["owner_nickname"] == "admin"
  assert set(detail["tags"]) == {"hop", "step"}
  res = requests.get(f"{BASE_URL}/posts/by-followees/detail?limit=1000&user_id={user_id}&include_self=true", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  by_followees = res.json()
  print("[posts] by-followees/detail (self):", by_followees)
  assert any(p["id"] == post_id for p in by_followees)
  res = requests.put(f"{BASE_URL}/posts/{post_id}", json={}, headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  post_updated = res.json()
  assert post_updated["id"] == post_id
  assert post_updated["content"] == post_input["content"]
  update_input = {
    "content": "edited",
    "tags": ["jump"],
  }
  res = requests.put(f"{BASE_URL}/posts/{post_id}", json=update_input, headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  post_updated = res.json()
  assert post_updated["id"] == post_id
  assert post_updated["content"] == update_input["content"]
  res = requests.get(f"{BASE_URL}/posts/{post_id}/detail", headers=headers, cookies=cookies)
  assert res.status_code == 200
  detail = res.json()
  assert detail["id"] == post_id
  assert detail["content"] == update_input["content"]
  assert set(detail["tags"]) == set(update_input["tags"])
  res = requests.delete(f"{BASE_URL}/posts/{post_id}", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  print("[posts] deleted")
  assert res.json()["result"] == "ok"
  res = requests.get(f"{BASE_URL}/posts/{post_id}", headers=headers, cookies=cookies)
  assert res.status_code == 404
  logout(session_id)
  print("[test_posts] OK")

def test_signup():
  print("[signup] start")
  email = "signup_test@example.com"
  password = "signup_pw1"
  res = requests.post(
    f"{BASE_URL}/signup/start",
    json={"email": email, "password": password}
  )
  assert res.status_code == 201, res.text
  signup_start = res.json()
  assert "signup_id" in signup_start
  signup_id = signup_start["signup_id"]
  print(f"[signup] got signup_id: {signup_id}")
  res = requests.post(
    f"{BASE_URL}/signup/verify",
    json={"signup_id": signup_id, "verification_code": TEST_SIGNUP_CODE}
  )
  assert res.status_code == 201, res.text
  res = res.json()
  print("[signup] created:", res)
  user_id = res["user_id"]
  res = requests.post(
    f"{BASE_URL}/auth",
    json={"email": email, "password": password}
  )
  assert res.status_code == 200, res.text
  session_id = res.cookies.get("session_id")
  assert session_id
  print("[signup] login ok, session_id:", session_id)
  admin_session = login()
  cookies = {"session_id": admin_session}
  res = requests.delete(f"{BASE_URL}/users/{user_id}", cookies=cookies)
  assert res.status_code == 200, res.text
  print("[signup] user deleted")
  print("[test_signup] OK")

def main():
  test_funcs = {name: fn for name, fn in globals().items() if name.startswith("test_") and callable(fn)}
  if len(sys.argv) < 2:
    print("No scenario specified. Running all tests:")
    for name, fn in test_funcs.items():
      print(f"[run] {name}")
      fn()
  else:
    for scenario in sys.argv[1:]:
      func_name = f"test_{scenario}"
      if func_name not in test_funcs:
        raise ValueError(f"Unknown scenario: {scenario}")
      test_funcs[func_name]()

if __name__ == "__main__":
  main()
