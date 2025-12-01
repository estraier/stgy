#! /usr/bin/env python3

import requests
import os
import sys
import time
import base64

APP_HOST = os.environ.get("STGY_APP_HOST", "localhost")
APP_PORT = int(os.environ.get("STGY_APP_PORT", 3001))
ADMIN_EMAIL = os.environ.get("STGY_ADMIN_EMAIL", "admin@stgy.jp")
ADMIN_PASSWORD = os.environ.get("STGY_ADMIN_PASSWORD", "stgystgy")
TEST_SIGNUP_CODE = os.environ.get("STGY_TEST_SIGNUP_CODE", "000000")
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
  assert "userId" in data
  assert "userNickname" in data
  assert "userIsAdmin" in data
  assert "userCreatedAt" in data
  assert "userUpdatedAt" in data
  assert "loggedInAt" in data
  return data

def logout(session_id):
  url = f"{BASE_URL}/auth"
  res = requests.delete(url, cookies={"session_id": session_id})
  res.raise_for_status()
  print("[logout] OK")

def test_auth():
  session_id = login()
  sess = get_session(session_id)
  user_id = sess["userId"]
  cookies = {"session_id": session_id}
  headers = {"Content-Type": "application/json"}
  su_input = {
    "id": user_id,
  }
  res = requests.post(f"{BASE_URL}/auth/switch-user", json=su_input, headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  cookies = res.cookies.get_dict()
  su_session_id = cookies.get("session_id")
  assert su_session_id != session_id
  su_sess = get_session(su_session_id)
  assert su_sess["userId"] == user_id
  print("[auth] switch-user OK")
  logout(su_session_id)
  logout(session_id)
  print("[test_auth] OK")

def test_ai_users():
  print("[ai_users] admin login")
  session_id = login()
  cookies = {"session_id": session_id}
  headers = {"Content-Type": "application/json"}
  res = requests.get(f"{BASE_URL}/ai-models", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  models = res.json()
  assert isinstance(models, list) and len(models) > 0, "No AI models available"
  ai_model_label = models[0]["label"]
  ts = int(time.time())
  email = f"aiuser-{ts}@stgy.xyz"
  nickname = f"ai-user-{ts}"
  create_body = {
    "email": email,
    "nickname": nickname,
    "isAdmin": False,
    "introduction": "hello, I'm an AI agent",
    "aiModel": ai_model_label,
    "aiPersonality": "helpful and curious",
    "password": "pw-aiuser-1",
    "locale": "ja-JP",
    "timezone": "Asia/Tokyo",
  }
  res = requests.post(f"{BASE_URL}/users", json=create_body, headers=headers, cookies=cookies)
  assert res.status_code == 201, res.text
  created = res.json()
  ai_user_id = created["id"]
  print(f"[ai_users] created AI user: {created}")
  res = requests.get(
    f"{BASE_URL}/ai-users?limit=2000&order=desc",
    headers=headers,
    cookies=cookies,
  )
  assert res.status_code == 200, res.text
  ai_users = res.json()
  print(f"[ai_users] list: {ai_users}")
  assert isinstance(ai_users, list)
  assert any(u["id"] == ai_user_id for u in ai_users), "created AI user not in list"
  assert all(u.get("aiModel") is not None for u in ai_users)
  res = requests.get(f"{BASE_URL}/ai-users/{ai_user_id}", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  got = res.json()
  print(f"[ai_users] detail: {got}")
  assert got["id"] == ai_user_id
  assert got["nickname"] == nickname
  assert got["isAdmin"] is False
  assert got["aiModel"] == ai_model_label
  assert got["email"] == email
  assert got["introduction"] == create_body["introduction"]
  assert got["aiPersonality"] == create_body["aiPersonality"]
  assert isinstance(got["createdAt"], str) and len(got["createdAt"]) > 0
  assert "updatedAt" in got
  sess = get_session(session_id)
  admin_id = sess["userId"]
  chat_body = {
    "model": ai_model_label,
    "messages": [
      {"role": "user", "content": "Just echo back 'Hello World'."},
    ],
  }
  res = requests.post(
    f"{BASE_URL}/ai-users/chat",
    json=chat_body,
    headers=headers,
    cookies=cookies,
  )
  if res.status_code == 501:
    print(f"[ai_users] chat is disabled")
  else:
    assert res.status_code == 200, res.text
    chat_res = res.json()
    assert "message" in chat_res
    message = chat_res["message"]
    assert "content" in message
    print(f"[ai_users] chat response: {message['content']}")
  res = requests.get(
    f"{BASE_URL}/ai-users/{ai_user_id}/interests",
    headers=headers,
    cookies=cookies,
  )
  assert res.status_code == 404, res.text
  interest_body = {"description": "I am currently interested in integration tests"}
  res = requests.post(
    f"{BASE_URL}/ai-users/{ai_user_id}/interests",
    json=interest_body,
    headers=headers,
    cookies=cookies,
  )
  assert res.status_code == 200, res.text
  saved_interest = res.json()
  assert saved_interest["userId"] == ai_user_id
  assert saved_interest["description"] == interest_body["description"]
  res = requests.get(
    f"{BASE_URL}/ai-users/{ai_user_id}/interests",
    headers=headers,
    cookies=cookies,
  )
  assert res.status_code == 200, res.text
  got_interest = res.json()
  assert got_interest == saved_interest
  res = requests.get(
    f"{BASE_URL}/ai-users/{ai_user_id}/peer-impressions?limit=10&offset=0&order=desc",
    headers=headers,
    cookies=cookies,
  )
  assert res.status_code == 200, res.text
  peer_impressions = res.json()
  assert isinstance(peer_impressions, list)
  assert len(peer_impressions) == 0
  res = requests.get(
    f"{BASE_URL}/ai-users/{ai_user_id}/peer-impressions/{admin_id}",
    headers=headers,
    cookies=cookies,
  )
  assert res.status_code == 404, res.text
  res = requests.head(
    f"{BASE_URL}/ai-users/{ai_user_id}/peer-impressions/{admin_id}",
    headers=headers,
    cookies=cookies,
  )
  assert res.status_code == 404, res.text
  peer_body = {
    "peerId": admin_id,
    "description": "admin user looks reliable",
  }
  res = requests.post(
    f"{BASE_URL}/ai-users/{ai_user_id}/peer-impressions",
    json=peer_body,
    headers=headers,
    cookies=cookies,
  )
  assert res.status_code == 200, res.text
  saved_peer = res.json()
  assert saved_peer["userId"] == ai_user_id
  assert saved_peer["peerId"] == admin_id
  assert saved_peer["description"] == peer_body["description"]
  assert isinstance(saved_peer.get("updatedAt"), str) and len(saved_peer["updatedAt"]) > 0
  res = requests.head(
    f"{BASE_URL}/ai-users/{ai_user_id}/peer-impressions/{admin_id}",
    headers=headers,
    cookies=cookies,
  )
  assert res.status_code == 200, res.text
  res = requests.get(
    f"{BASE_URL}/ai-users/{ai_user_id}/peer-impressions?limit=10&offset=0&order=desc",
    headers=headers,
    cookies=cookies,
  )
  assert res.status_code == 200, res.text
  peer_impressions = res.json()
  assert any(p["peerId"] == admin_id for p in peer_impressions)
  res = requests.get(
    f"{BASE_URL}/ai-users/{ai_user_id}/peer-impressions?limit=10&offset=0&order=desc&peerId={admin_id}",
    headers=headers,
    cookies=cookies,
  )
  assert res.status_code == 200, res.text
  filtered_peer_impressions = res.json()
  assert len(filtered_peer_impressions) == 1
  assert filtered_peer_impressions[0]["peerId"] == admin_id
  res = requests.get(
    f"{BASE_URL}/ai-users/{ai_user_id}/peer-impressions/{admin_id}",
    headers=headers,
    cookies=cookies,
  )
  assert res.status_code == 200, res.text
  got_peer = res.json()
  assert got_peer["peerId"] == admin_id
  assert got_peer["description"] == peer_body["description"]
  post_body = {
    "content": "hello from ai-users impression test",
    "replyTo": None,
    "tags": ["ai-users", "impression"],
  }
  res = requests.post(f"{BASE_URL}/posts", json=post_body, headers=headers, cookies=cookies)
  assert res.status_code == 201, res.text
  post = res.json()
  post_id = post["id"]
  owner_id = post["ownedBy"]
  print(f"[ai_users] created post for impression test: {post}")
  res = requests.get(
    f"{BASE_URL}/ai-users/{ai_user_id}/post-impressions?limit=10&offset=0&order=desc",
    headers=headers,
    cookies=cookies,
  )
  assert res.status_code == 200, res.text
  post_impressions = res.json()
  assert isinstance(post_impressions, list)
  assert len(post_impressions) == 0
  res = requests.get(
    f"{BASE_URL}/ai-users/{ai_user_id}/post-impressions/{post_id}",
    headers=headers,
    cookies=cookies,
  )
  assert res.status_code == 404, res.text
  res = requests.head(
    f"{BASE_URL}/ai-users/{ai_user_id}/post-impressions/{post_id}",
    headers=headers,
    cookies=cookies,
  )
  assert res.status_code == 404, res.text
  post_imp_body = {
    "postId": post_id,
    "description": "this post looks great",
  }
  res = requests.post(
    f"{BASE_URL}/ai-users/{ai_user_id}/post-impressions",
    json=post_imp_body,
    headers=headers,
    cookies=cookies,
  )
  assert res.status_code == 200, res.text
  saved_post_imp = res.json()
  assert saved_post_imp["userId"] == ai_user_id
  assert saved_post_imp["postId"] == post_id
  assert saved_post_imp["ownerId"] == owner_id
  assert saved_post_imp["description"] == post_imp_body["description"]
  assert isinstance(saved_post_imp.get("updatedAt"), str) and len(saved_post_imp["updatedAt"]) > 0
  res = requests.head(
    f"{BASE_URL}/ai-users/{ai_user_id}/post-impressions/{post_id}",
    headers=headers,
    cookies=cookies,
  )
  assert res.status_code == 200, res.text
  res = requests.get(
    f"{BASE_URL}/ai-users/{ai_user_id}/post-impressions?limit=10&offset=0&order=desc",
    headers=headers,
    cookies=cookies,
  )
  assert res.status_code == 200, res.text
  post_impressions = res.json()
  assert any(
    p["postId"] == post_id and p["ownerId"] == owner_id for p in post_impressions
  )
  res = requests.get(
    f"{BASE_URL}/ai-users/{ai_user_id}/post-impressions"
    f"?limit=10&offset=0&order=desc&postId={post_id}",
    headers=headers,
    cookies=cookies,
  )
  assert res.status_code == 200, res.text
  filtered_post_impressions = res.json()
  assert len(filtered_post_impressions) == 1
  assert filtered_post_impressions[0]["postId"] == post_id
  assert filtered_post_impressions[0]["ownerId"] == owner_id
  res = requests.get(
    f"{BASE_URL}/ai-users/{ai_user_id}/post-impressions"
    f"?limit=10&offset=0&order=desc&ownerId={owner_id}",
    headers=headers,
    cookies=cookies,
  )
  assert res.status_code == 200, res.text
  by_owner = res.json()
  assert len(by_owner) >= 1
  assert any(
    p["postId"] == post_id and p["ownerId"] == owner_id for p in by_owner
  )
  res = requests.get(
    f"{BASE_URL}/ai-users/{ai_user_id}/post-impressions"
    f"?limit=10&offset=0&order=desc&ownerId={owner_id}&postId={post_id}",
    headers=headers,
    cookies=cookies,
  )
  assert res.status_code == 200, res.text
  by_owner_and_post = res.json()
  assert len(by_owner_and_post) == 1
  assert by_owner_and_post[0]["userId"] == ai_user_id
  assert by_owner_and_post[0]["ownerId"] == owner_id
  assert by_owner_and_post[0]["postId"] == post_id
  res = requests.get(
    f"{BASE_URL}/ai-users/{ai_user_id}/post-impressions/{post_id}",
    headers=headers,
    cookies=cookies,
  )
  assert res.status_code == 200, res.text
  got_post_imp = res.json()
  assert got_post_imp["postId"] == post_id
  assert got_post_imp["ownerId"] == owner_id
  assert got_post_imp["description"] == post_imp_body["description"]
  res = requests.delete(f"{BASE_URL}/posts/{post_id}", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  print("[ai_users] cleanup post deleted")
  res = requests.delete(f"{BASE_URL}/users/{ai_user_id}", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  print("[ai_users] cleanup user deleted")
  logout(session_id)
  print("[test_ai_users] OK")

def test_users():
  print("[users] admin login")
  session_id = login()
  headers = {"Content-Type": "application/json"}
  cookies = {"session_id": session_id}
  user_input = {
    "email": f"user1-{session_id[:8]}@stgy.com",
    "nickname": "user1",
    "isAdmin": False,
    "introduction": "hi!",
    "aiModel": "advanced",
    "aiPersonality": "super diligent",
    "password": "password1",
    "locale": "ja-JP",
    "timezone": "Asia/Tokyo",
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
  res = requests.get(f"{BASE_URL}/users/count", cookies=cookies)
  assert res.status_code == 200
  count = res.json()["count"]
  assert count >= 2
  print("[users] count:", count)
  res = requests.get(f"{BASE_URL}/users?limit=2000", headers=headers, cookies=cookies)
  assert res.status_code == 200
  users = res.json()
  admin_user = min((u for u in users), key=lambda u: u["id"])
  admin_id = admin_user["id"]
  res = requests.get(f"{BASE_URL}/users/{admin_id}", headers=headers, cookies=cookies)
  got_admin_user = res.json()
  assert got_admin_user["id"] == admin_id
  for key, value in got_admin_user.items():
    if key in ["email", "locale", "timezone", "introduction", "aiPersonality"]: continue
    assert admin_user[key] == value
  res = requests.get(f"{BASE_URL}/users/{admin_id}/lite", headers=headers, cookies=cookies)
  lite_admin_user = res.json()
  assert lite_admin_user["id"] == admin_id
  for key, value in lite_admin_user.items():
    assert admin_user[key] == value
  res = requests.post(f"{BASE_URL}/users/{admin_id}/follow", headers=headers, cookies=user1_cookies)
  assert res.status_code == 200, res.text
  print(f"[users] user1 followed admin: {admin_id}")
  res = requests.post(f"{BASE_URL}/users/{admin_id}/block", headers=headers, cookies=user1_cookies)
  assert res.status_code == 200, res.text
  print(f"[users] user1 blocked admin: {admin_id}")
  res = requests.get(f"{BASE_URL}/users/{user1_id}/followees?limit=2000", headers=headers, cookies=user1_cookies)
  assert res.status_code == 200, res.text
  followees = res.json()
  print("[users] user1 followees:", followees)
  assert any(u["id"] == admin_id for u in followees)
  res = requests.get(f"{BASE_URL}/users/{admin_id}/followers?limit=2000", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  followers = res.json()
  print("[users] admin followers:", followers)
  assert any(u["id"] == user1_id for u in followers)
  res = requests.get(f"{BASE_URL}/users/{admin_id}?limit=2000&focusUserId={user1_id}", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  admin = res.json()
  assert admin["countFollowers"] > 0
  assert "countFollowees" in admin
  assert admin["isFollowedByFocusUser"] == True
  assert admin["isFollowingFocusUser"] == False
  assert admin["isBlockedByFocusUser"] == True
  assert admin["isBlockingFocusUser"] == False
  res = requests.get(f"{BASE_URL}/users?limit=2000&focusUserId={admin_id}&order=social", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  users = res.json()
  assert len(users) >= 2
  user1 = next(u for u in users if u["nickname"] == user1["nickname"])
  assert user1["countFollowers"] == 0
  assert user1["countFollowees"] == 1
  assert user1["isFollowedByFocusUser"] == False
  assert user1["isFollowingFocusUser"] == True
  res = requests.delete(f"{BASE_URL}/users/{admin_id}/follow", headers=headers, cookies=user1_cookies)
  assert res.status_code == 200, res.text
  print(f"[users] user1 unfollowed admin: {admin_id}")
  res = requests.delete(f"{BASE_URL}/users/{admin_id}/block", headers=headers, cookies=user1_cookies)
  assert res.status_code == 200, res.text
  print(f"[users] user1 unblocked admin: {admin_id}")
  res = requests.get(f"{BASE_URL}/users/{user1_id}/followees?limit=2000", headers=headers, cookies=user1_cookies)
  assert all(u["id"] != admin_id for u in res.json())
  res = requests.get(f"{BASE_URL}/users/{admin_id}/followers?limit=2000", headers=headers, cookies=cookies)
  assert all(u["id"] != user1_id for u in res.json())
  res = requests.get(f"{BASE_URL}/users/{user1_id}/pub-config", headers=headers)
  assert res.status_code == 200, res.text
  cfg = res.json()
  print("[users] pub-config default:", cfg)
  assert cfg["siteName"] == ""
  assert cfg["subtitle"] == ""
  assert cfg["author"] == ""
  assert cfg["introduction"] == ""
  assert cfg["designTheme"] == ""
  assert cfg["showServiceHeader"] is True
  assert cfg["showSiteName"] is True
  assert cfg["showPagenation"] is True
  assert cfg["showSideProfile"] is True
  assert cfg["showSideRecent"] is True
  update1 = {
    "siteName": "site1",
    "subtitle": "subtitle1",
    "author": "user1",
    "introduction": "hello site",
    "designTheme": "paper",
    "showServiceHeader": False,
    "showSiteName": False,
    "showPagenation": False,
    "showSideProfile": False,
    "showSideRecent": True,
  }
  res = requests.put(f"{BASE_URL}/users/{user1_id}/pub-config", json=update1, headers=headers, cookies=user1_cookies)
  assert res.status_code == 200, res.text
  saved1 = res.json()
  print("[users] pub-config updated1:", saved1)
  assert saved1["siteName"] == "site1"
  assert saved1["subtitle"] == "subtitle1"
  assert saved1["author"] == "user1"
  assert saved1["introduction"] == "hello site"
  assert saved1["designTheme"] == "paper"
  assert saved1["showServiceHeader"] is False
  assert saved1["showSiteName"] is False
  assert saved1["showPagenation"] is False
  assert saved1["showSideProfile"] is False
  assert saved1["showSideRecent"] is True
  res = requests.get(f"{BASE_URL}/users/{user1_id}/pub-config", headers=headers, cookies=user1_cookies)
  assert res.status_code == 200, res.text
  got1 = res.json()
  saved1["locale"] = got1["locale"]
  assert got1 == saved1
  update2 = {
    "designTheme": "dark",
    "showServiceHeader": True,
  }
  res = requests.put(f"{BASE_URL}/users/{user1_id}/pub-config", json=update2, headers=headers, cookies=user1_cookies)
  assert res.status_code == 200, res.text
  saved2 = res.json()
  print("[users] pub-config updated2:", saved2)
  assert saved2["siteName"] == "site1"
  assert saved2["subtitle"] == "subtitle1"
  assert saved2["author"] == "user1"
  assert saved2["introduction"] == "hello site"
  assert saved2["designTheme"] == "dark"
  assert saved2["showServiceHeader"] is True
  assert saved2["showSiteName"] is False
  assert saved2["showPagenation"] is False
  assert saved2["showSideProfile"] is False
  assert saved2["showSideRecent"] is True
  res = requests.get(f"{BASE_URL}/users/{user1_id}/pub-config", headers=headers, cookies=user1_cookies)
  assert res.status_code == 200, res.text
  got2 = res.json()
  saved2["locale"] = got2["locale"]
  assert got2 == saved2
  res = requests.delete(f"{BASE_URL}/users/{user1_id}", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  print("[users] user1 deleted")
  res = requests.get(f"{BASE_URL}/users/friends/by-nickname-prefix?limit=2000&nicknamePrefix=adm", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  friends = res.json()
  assert any(u["id"] == admin_id for u in friends)
  print("[users] nickname search OK")
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
  res = requests.get(f"{BASE_URL}/posts/count", cookies=cookies)
  assert res.status_code == 200
  count = res.json()["count"]
  assert count >= 1
  print("[posts] count:", count)
  res = requests.post(f"{BASE_URL}/posts/{post_id}/like", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  print("[posts] like: ok")
  res = requests.get(f"{BASE_URL}/posts/liked?limit=2000&userId={user_id}", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  liked_posts = res.json()
  print("[posts] liked:", liked_posts)
  assert any(p["id"] == post_id for p in liked_posts)
  res = requests.get(f"{BASE_URL}/posts/{post_id}/likers?limit=2000", headers=headers, cookies=cookies)
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
  res = requests.get(f"{BASE_URL}/posts/{post_id}?focusUserId={user_id}", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  post = res.json()
  assert post["id"] == post_id
  assert "hello" in post["snippet"]
  assert post["content"] == post_input["content"]
  assert post["ownerNickname"] == "admin"
  assert "ownerLocale" in post
  assert "countLikes" in post
  assert "countReplies" in post
  assert set(post["tags"]) == {"hop", "step"}
  assert post["isLikedByFocusUser"] == False
  assert post["isRepliedByFocusUser"] == False
  assert post["isBlockingFocusUser"] == False
  res = requests.get(f"{BASE_URL}/posts/{post_id}/lite", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  lite_post = res.json()
  assert lite_post["id"] == post_id
  for key, value in lite_post.items():
    assert post[key] == value
  res = requests.get(f"{BASE_URL}/posts/by-followees?limit=2000&userId={user_id}&includeSelf=true", headers=headers, cookies=cookies)
  assert res.status_code == 200, res.text
  by_followees = res.json()
  print("[posts] by-followees (self):", by_followees)
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
  assert "edited" in post_updated["snippet"]
  res = requests.get(f"{BASE_URL}/posts/{post_id}", headers=headers, cookies=cookies)
  assert res.status_code == 200
  post = res.json()
  assert post["id"] == post_id
  assert post["content"] == update_input["content"]
  assert set(post["tags"]) == set(update_input["tags"])
  published_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 1))
  res = requests.put(
    f"{BASE_URL}/posts/{post_id}",
    json={"publishedAt": published_at},
    headers=headers,
    cookies=cookies,
  )
  assert res.status_code == 200, res.text
  res = requests.get(f"{BASE_URL}/posts/pub/{post_id}")
  assert res.status_code == 200, res.text
  pub_post = res.json()
  assert pub_post["id"] == post_id
  assert isinstance(pub_post.get("publishedAt"), str) and len(pub_post["publishedAt"]) > 0
  res = requests.get(f"{BASE_URL}/posts/pub-by-user/{user_id}?limit=2000&order=desc")
  assert res.status_code == 200, res.text
  pub_list = res.json()
  assert any(p.get("id") == post_id for p in pub_list)

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
  email = f"signup_test+{int(time.time())}@stgy.xyz"
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
  res = requests.get(f"{BASE_URL}/users?limit=2000", cookies={"session_id": session_id})
  assert res.status_code == 200
  users = res.json()
  assert any(u["id"] == admin_id for u in users)
  print("[signup] list check ok")
  res = requests.get(f"{BASE_URL}/users?limit=2000", cookies={"session_id": session_id})
  assert res.status_code == 200
  users = res.json()
  assert any(u["id"] == admin_id for u in users)
  print("[signup] list check ok")
  res = requests.get(f"{BASE_URL}/users/{admin_id}", cookies={"session_id": session_id})
  assert res.status_code == 200
  user = res.json()
  print(f"[signup] get admin {user}")
  assert user["id"] == admin_id
  assert "@stgy." in user["email"]
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
  filename = "sample.webp"
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
    "file": (filename, img_bytes, "image/webp"),
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
  avatar_filename = "avatar.webp"
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
  files = {"file": (avatar_filename, avatar_bytes, "image/webp")}
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

def test_notifications():
  print("[notifications] admin login")
  admin_session = login()
  admin_cookies = {"session_id": admin_session}
  headers = {"Content-Type": "application/json"}
  email = f"notif_user+{int(time.time())}@stgy.xyz"
  password = "pw1-notif"
  user_input = {
    "email": email,
    "nickname": "notif-user",
    "isAdmin": False,
    "introduction": "hello",
    "aiModel": "advanced",
    "aiPersonality": "curious",
    "password": password,
    "locale": "ja-JP",
    "timezone": "Asia/Tokyo",
  }
  res = requests.post(f"{BASE_URL}/users", json=user_input, headers=headers, cookies=admin_cookies)
  assert res.status_code == 201, res.text
  new_user = res.json()
  new_user_id = new_user["id"]
  print(f"[notifications] created user: {new_user_id}")
  res = requests.post(f"{BASE_URL}/auth", json={"email": email, "password": password})
  assert res.status_code == 200, res.text
  user_session = res.cookies.get("session_id")
  assert user_session
  user_cookies = {"session_id": user_session}
  print("[notifications] created user login OK")
  post_input = {"content": "hello from notif test", "replyTo": None, "tags": ["t1"]}
  res = requests.post(f"{BASE_URL}/posts", json=post_input, headers=headers, cookies=user_cookies)
  assert res.status_code == 201, res.text
  post = res.json()
  post_id = post["id"]
  print(f"[notifications] user posted: {post_id}")
  res = requests.post(f"{BASE_URL}/users/{new_user_id}/follow", headers=headers, cookies=admin_cookies)
  assert res.status_code == 200, res.text
  res = requests.delete(f"{BASE_URL}/users/{new_user_id}/follow", headers=headers, cookies=admin_cookies)
  assert res.status_code == 200, res.text
  res = requests.post(f"{BASE_URL}/users/{new_user_id}/follow", headers=headers, cookies=admin_cookies)
  assert res.status_code == 200, res.text
  print("[notifications] follow/unfollow/follow done")
  res = requests.post(f"{BASE_URL}/posts/{post_id}/like", headers=headers, cookies=admin_cookies)
  assert res.status_code == 200, res.text
  res = requests.delete(f"{BASE_URL}/posts/{post_id}/like", headers=headers, cookies=admin_cookies)
  assert res.status_code == 200, res.text
  res = requests.post(f"{BASE_URL}/posts/{post_id}/like", headers=headers, cookies=admin_cookies)
  assert res.status_code == 200, res.text
  print("[notifications] like/unlike/like done")
  res = requests.post(
    f"{BASE_URL}/posts",
    json={"content": "first reply", "replyTo": post_id, "tags": ["r"]},
    headers=headers,
    cookies=admin_cookies,
  )
  assert res.status_code == 201, res.text
  res = requests.post(
    f"{BASE_URL}/posts",
    json={"content": "second reply", "replyTo": post_id, "tags": ["r"]},
    headers=headers,
    cookies=admin_cookies,
  )
  assert res.status_code == 201, res.text
  print("[notifications] two replies done")
  time.sleep(0.1)
  res = requests.get(f"{BASE_URL}/notifications/feed", cookies=user_cookies)
  assert res.status_code == 200, res.text
  feed = res.json()
  print("[notifications] feed:", feed)
  assert isinstance(feed, list)
  assert len(feed) == 3, f"expected 3 notifications, got {len(feed)}"
  by_slot = {n["slot"]: n for n in feed}
  follow_slot = "follow"
  like_slot = f"like:{post_id}"
  reply_slot = f"reply:{post_id}"
  assert follow_slot in by_slot, f"missing {follow_slot}"
  assert like_slot in by_slot, f"missing {like_slot}"
  assert reply_slot in by_slot, f"missing {reply_slot}"
  nf = by_slot[follow_slot]
  assert nf["isRead"] is False
  assert nf.get("countUsers") == 1
  assert any(r.get("userNickname") == "admin" for r in nf["records"])
  nl = by_slot[like_slot]
  assert nl["isRead"] is False
  assert nl.get("countUsers") == 1
  assert any(r.get("userNickname") == "admin" for r in nl["records"])
  assert any(r.get("postSnippet") == "hello from notif test" for r in nl["records"])
  nr = by_slot[reply_slot]
  assert nr["isRead"] is False
  assert nr.get("countUsers") == 1
  assert nr.get("countPosts") == 2
  assert any(r.get("userNickname") == "admin" for r in nr["records"])
  assert any(r.get("postSnippet") == "hello from notif test" for r in nr["records"])
  res = requests.post(
    f"{BASE_URL}/notifications/mark",
    json={"slot": follow_slot, "term": nf["term"], "isRead": True},
    headers=headers,
    cookies=user_cookies,
  )
  assert res.status_code == 204, res.text
  res = requests.get(f"{BASE_URL}/notifications/feed", cookies=user_cookies)
  assert res.status_code == 200, res.text
  feed2 = res.json()
  by_slot2 = {n["slot"]: n for n in feed2}
  assert by_slot2[follow_slot]["isRead"] is True
  res = requests.post(
    f"{BASE_URL}/notifications/mark-all",
    json={"isRead": True},
    headers=headers,
    cookies=user_cookies,
  )
  assert res.status_code == 204, res.text
  res = requests.get(f"{BASE_URL}/notifications/feed", cookies=user_cookies)
  assert res.status_code == 200, res.text
  feed3 = res.json()
  assert all(n["isRead"] is True for n in feed3), f"not all read: {feed3}"
  print("[notifications] marking read OK")
  latest = max(n["updatedAt"] for n in feed3)
  print("[notifications] latest updatedAt =", latest)
  res = requests.get(
    f"{BASE_URL}/notifications/feed",
    params={"newerThan": latest},
    cookies=user_cookies,
  )
  assert res.status_code == 304, f"expected 304, got {res.status_code}: {res.text}"
  print("[notifications] newerThan=latest -> 304 OK")
  res = requests.post(
    f"{BASE_URL}/posts",
    json={"content": "third reply for 304 check", "replyTo": post_id, "tags": ["r"]},
    headers=headers,
    cookies=admin_cookies,
  )
  assert res.status_code == 201, res.text
  time.sleep(0.1)
  res = requests.get(
    f"{BASE_URL}/notifications/feed",
    params={"newerThan": latest},
    cookies=user_cookies,
  )
  assert res.status_code == 200, f"expected 200 after new notification, got {res.status_code}"
  feed4 = res.json()
  assert isinstance(feed4, list)
  by_slot4 = {n["slot"]: n for n in feed4}
  assert reply_slot in by_slot4, f"missing {reply_slot} after new reply"
  assert by_slot4[reply_slot].get("countPosts") == 3, f"expected 3 replies, got {by_slot4[reply_slot].get('countPosts')}"
  print("[notifications] newerThan=latest -> 200 after new notification OK")
  res = requests.delete(f"{BASE_URL}/users/{new_user_id}", headers=headers, cookies=admin_cookies)
  assert res.status_code == 200, res.text
  print("[notifications] cleanup user deleted")
  logout(admin_session)
  print("[test_notifications] OK")

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
