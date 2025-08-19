#!/usr/bin/env python3

import requests
import os
import sys
import time
import base64

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
  assert data["userEmail"] == ADMIN_EMAIL
  assert "userNickname" in data
  assert "userIsAdmin" in data
  assert "userId" in data
  assert "loggedInAt" in data
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

def test_ai_models():
  print("[ai_models] admin login")
  session_id = login()
  cookies = {"session_id": session_id}
  headers = {"Content-Type": "application/json"}
  res = requests.get(f"{BASE_URL}/ai-models", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  models = res.json()
  print(f"[ai_models] list: {models}")
  assert isinstance(models, list)
  assert len(models) > 0, "No AI models found"
  m = models[0]
  for k in ("name", "description", "inputCost", "outputCost"):
    assert k in m, f"{k} missing in ai_model"
  name = models[0]["name"]
  res = requests.get(f"{BASE_URL}/ai-models/{name}", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  model = res.json()
  print(f"[ai_models] detail: {model}")
  assert model["name"] == name
  res = requests.get(f"{BASE_URL}/ai-models/__no_such_model__", headers=headers, cookies=cookies)
  assert res.status_code == 404, res.text
  print("[ai_models] 404 not found ok")
  logout(session_id)
  print("[test_ai_models] OK")

def test_users():
  print("[users] admin login")
  session_id = login()
  headers = {"Content-Type": "application/json"}
  cookies = {"session_id": session_id}
  user_input = {
    "email": f"user1-{session_id[:8]}@fakebook.com",
    "nickname": "user1",
    "isAdmin": False,
    "introduction": "hi!",
    "aiModel": "gpt-4.1",
    "aiPersonality": "super diligent",
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
  res = requests.get(f"{BASE_URL}/users/{admin_id}/detail?limit=1000&focusUserId={user1_id}", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  admin_detail = res.json()
  assert admin_detail["countFollowers"] > 0
  assert "countFollowees" in admin_detail
  assert admin_detail["isFollowedByFocusUser"] == True
  assert admin_detail["isFollowingFocusUser"] == False
  res = requests.get(f"{BASE_URL}/users/detail?limit=1000&focusUserId={admin_id}&order=social", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  users_detail = res.json()
  assert len(users_detail) >= 2
  user1_detail = next(u for u in users_detail if u["email"] == user1["email"])
  assert user1_detail["countFollowers"] == 0
  assert user1_detail["countFollowees"] == 1
  assert user1_detail["isFollowedByFocusUser"] == False
  assert user1_detail["isFollowingFocusUser"] == True
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
    "replyTo": None,
    "tags": ["hop", "step"],
  }
  res = requests.post(f"{BASE_URL}/posts", json=post_input, headers=headers, cookies=cookies)
  assert res.status_code == 201, res.text
  post = res.json()
  post_id = post["id"]
  user_id = post["ownedBy"]
  print("[posts] created:", post)
  res = requests.post(f"{BASE_URL}/posts/{post_id}/like", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  print("[posts] like: ok")
  res = requests.get(f"{BASE_URL}/posts/liked/detail?limit=1000&userId={user_id}", headers=headers, cookies=cookies)
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
  assert detail["ownerNickname"] == "admin"
  assert "countLikes" in detail
  assert "countReplies" in detail
  assert set(detail["tags"]) == {"hop", "step"}
  res = requests.get(f"{BASE_URL}/posts/by-followees/detail?limit=1000&userId={user_id}&includeSelf=true", headers=headers, cookies=cookies)
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
  admin_session_id = login()
  res = requests.get(f"{BASE_URL}/auth", cookies={"session_id": admin_session_id})
  res.raise_for_status()
  session = res.json()
  print(f"[session] {session}")
  admin_id = session["userId"]
  email = f"signup_test+{int(time.time())}@fakebook.xyz"
  password = "signup_pw1"
  res = requests.post(
    f"{BASE_URL}/signup/start",
    json={"email": email, "password": password}
  )
  assert res.status_code == 201, res.text
  signup_start = res.json()
  assert "signupId" in signup_start
  signup_id = signup_start["signupId"]
  print(f"[signup] got signup_id: {signup_id}")
  res = requests.post(
    f"{BASE_URL}/signup/verify",
    json={"signupId": signup_id, "verificationCode": TEST_SIGNUP_CODE}
  )
  assert res.status_code == 201, res.text
  res = res.json()
  print("[signup] created:", res)
  user_id = res["userId"]
  res = requests.post(
    f"{BASE_URL}/auth",
    json={"email": email, "password": password}
  )
  assert res.status_code == 200, res.text
  session_id = res.cookies.get("session_id")
  assert session_id
  print("[signup] login ok, session_id:", session_id)
  res = requests.get(f"{BASE_URL}/users?limit=1000", cookies={"session_id": session_id})
  assert res.status_code == 200
  users = res.json()
  assert any(u["id"] == admin_id and "@example." in u["email"] for u in users)
  assert any(u["email"] == email for u in users)
  print("[signup] list check ok")
  res = requests.get(f"{BASE_URL}/users/detail?limit=1000", cookies={"session_id": session_id})
  assert res.status_code == 200
  users = res.json()
  assert any(u["id"] == admin_id and "@example." in u["email"] for u in users)
  assert any(u["email"] == email for u in users)
  print("[signup] list detail check ok")
  res = requests.get(f"{BASE_URL}/users/{admin_id}", cookies={"session_id": session_id})
  assert res.status_code == 200
  user = res.json()
  print(f"[signup] get admin {user}")
  assert user["id"] == admin_id
  assert "@example." in user["email"]
  res = requests.get(f"{BASE_URL}/users/{user_id}", cookies={"session_id": admin_session_id})
  assert res.status_code == 200
  user = res.json()
  print(f"[signup] get new user {user}")
  assert user["id"] == user_id
  assert user["email"] == email
  new_email = email.replace("@", "-new@")
  res = requests.post(f"{BASE_URL}/users/{user_id}/email/start",
                      cookies={"session_id": session_id}, json={"email": new_email})
  assert res.status_code == 201, res.text
  data = res.json()
  update_email_id = data["updateEmailId"]
  print(f"[signup] update email started: {update_email_id}")
  res = requests.post(f"{BASE_URL}/users/{user_id}/email/verify",
                      cookies={"session_id": session_id},
                      json={
                        "updateEmailId": update_email_id,
                        "verificationCode": TEST_SIGNUP_CODE,
                      })
  assert res.status_code == 200, res.text
  print("[signup] update email OK")
  res = requests.get(f"{BASE_URL}/users/{user_id}", cookies={"session_id": admin_session_id})
  assert res.status_code == 200
  user = res.json()
  print(f"[signup] get new user {user}")
  assert user["id"] == user_id
  assert user["email"] == new_email
  res = requests.post(f"{BASE_URL}/users/password/reset/start",
                      json={"email": new_email})
  assert res.status_code == 201, res.text
  data = res.json()
  print(data)
  assert data["webCode"] == TEST_SIGNUP_CODE
  reset_password_id = data["resetPasswordId"]
  print(f"[signup] reset password started: {reset_password_id}")
  res = requests.post(f"{BASE_URL}/users/password/reset/verify",
                      json={"email": new_email, "resetPasswordId": reset_password_id,
                            "webCode": TEST_SIGNUP_CODE, "mailCode": TEST_SIGNUP_CODE,
                            "newPassword": "signup_pw2"})
  assert res.status_code == 200, res.text
  res = requests.get(f"{BASE_URL}/users/{user_id}", cookies={"session_id": admin_session_id})
  assert res.status_code == 200
  res = requests.post(
    f"{BASE_URL}/auth",
    json={"email": new_email, "password": "signup_pw2"}
  )
  assert res.status_code == 200, res.text
  new_session_id = res.cookies.get("session_id")
  print("[signup] login ok, session_id:", new_session_id)
  res = requests.delete(f"{BASE_URL}/users/{user_id}", cookies={"session_id": admin_session_id})
  assert res.status_code == 200, res.text
  print("[signup] user deleted")
  print("[test_signup] OK")

def test_media():
  print("[media] admin login")
  session_id = login()
  cookies = {"session_id": session_id}
  sess = get_session(session_id)
  user_id = sess["userId"]
  img_b64 = "UklGRlQAAABXRUJQVlA4IEgAAADwAwCdASpAAEAAPm02mEkkIqKhIggAgA2JaQDVqoAAEDdTUAV4hbkAAP7ni//43m81s4//+wd/+g7/9B3+yiX+GARoQAAAAAA="
  img_bytes = base64.b64decode(img_b64)
  filename = "sample.png"
  size_bytes = len(img_bytes)
  presigned_url = f"{BASE_URL}/media/{user_id}/images/presigned"
  res = requests.post(
    presigned_url,
    json={"filename": filename, "sizeBytes": size_bytes},
    cookies=cookies,
  )
  assert res.status_code == 200, res.text
  pres = res.json()
  print("[media] presigned:", pres)
  upload_url = pres["url"]
  fields = pres["fields"]
  files = {
    "file": (filename, img_bytes, "image/png"),
  }
  res = requests.post(upload_url, data=fields, files=files)
  assert res.status_code in (200, 201, 204), f"upload failed: {res.status_code} {res.text}"
  print("[media] uploaded to storage")
  finalize_url = f"{BASE_URL}/media/{user_id}/images/finalize"
  res = requests.post(finalize_url, json={"key": pres["objectKey"]}, cookies=cookies)
  assert res.status_code == 200, res.text
  meta = res.json()
  print("[media] finalized:", meta)
  time.sleep(0.1)
  assert "bucket" in meta and "key" in meta and meta["size"] > 0
  final_key = meta["key"]
  assert final_key.startswith(f"{user_id}/")
  rest_path = final_key[len(user_id) + 1 :]
  get_url = f"{BASE_URL}/media/{user_id}/images/{rest_path}"
  res = requests.get(get_url, cookies=cookies)
  assert res.status_code == 200, res.text
  assert res.content == img_bytes, "downloaded bytes mismatch"
  print("[media] downloaded OK")
  list_url = f"{BASE_URL}/media/{user_id}/images?offset=0&limit=10"
  res = requests.get(list_url, cookies=cookies)
  assert res.status_code == 200, res.text
  items = res.json()
  assert any(it["key"] == final_key for it in items), "finalized key not in list"
  print("[media] list OK (contains finalized object)")
  quota_url = f"{BASE_URL}/media/{user_id}/images/quota"
  res = requests.get(quota_url, cookies=cookies)
  quota = res.json()
  assert "yyyymm" in quota
  assert quota["bytesMasters"] > 0
  assert quota["bytesTotal"] > 0
  print("[media] quota OK")
  del_url = get_url
  res = requests.delete(del_url, cookies=cookies)
  assert res.status_code == 200, res.text
  print("[media] deleted")
  res = requests.get(get_url, cookies=cookies)
  assert res.status_code in (404, 400), f"expected not found, got {res.status_code}"
  print("[media] inexistence OK")
  avatar_filename = "avatar.png"
  avatar_bytes = img_bytes
  avatar_size = len(avatar_bytes)
  pres_url = f"{BASE_URL}/media/{user_id}/profiles/avatar/presigned"
  res = requests.post(
    pres_url,
    json={"filename": avatar_filename, "sizeBytes": avatar_size},
    cookies=cookies,
  )
  assert res.status_code == 200, res.text
  pres = res.json()
  print("[media] avatar presigned:", pres)
  avatar_upload_url = pres["url"]
  avatar_fields = pres["fields"]
  files = {"file": (avatar_filename, avatar_bytes, "image/png")}
  res = requests.post(avatar_upload_url, data=avatar_fields, files=files)
  assert res.status_code in (200, 201, 204), f"avatar upload failed: {res.status_code} {res.text}"
  print("[media] avatar uploaded to storage")
  finalize_url = f"{BASE_URL}/media/{user_id}/profiles/avatar/finalize"
  res = requests.post(finalize_url, json={"key": pres["objectKey"]}, cookies=cookies)
  assert res.status_code == 200, res.text
  meta = res.json()
  print("[media] avatar finalized:", meta)
  time.sleep(0.1)
  assert "bucket" in meta and "key" in meta and meta["size"] > 0
  get_url = f"{BASE_URL}/media/{user_id}/profiles/avatar"
  res = requests.get(get_url, cookies=cookies)
  assert res.status_code == 200, res.text
  assert res.content == avatar_bytes
  del_url = get_url
  res = requests.delete(del_url, cookies=cookies)
  assert res.status_code == 200, res.text
  print("[media] avatar deleted")
  res = requests.get(get_url, cookies=cookies)
  assert res.status_code in (404, 400)
  print("[media] avatar inexistence OK")
  logout(session_id)
  print("[test_media] OK")

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
