#!/usr/bin/env python3

import requests
import os
import sys

APP_HOST = os.environ.get("APP_HOST", "localhost")
APP_PORT = int(os.environ.get("APP_PORT", 3001))
EMAIL = os.environ.get("FAKEBOOK_EMAIL", "admin@dbmx.net")
PASSWORD = os.environ.get("FAKEBOOK_PASSWORD", "admin")
BASE_URL = f"http://{APP_HOST}:{APP_PORT}"

def login():
    url = f"{BASE_URL}/auth"
    res = requests.post(url, json={"email": EMAIL, "password": PASSWORD})
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
    assert data["email"] == EMAIL
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
        "email": "user1@example.com",
        "nickname": "user1",
        "is_admin": False,
        "introduction": "hi!",
        "personality": "genki",
        "model": "gpt-4.1-nano",
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
    res = requests.get(f"{BASE_URL}/users", headers=headers, cookies=cookies)
    assert res.status_code == 200
    users = res.json()
    admin_user = next(u for u in users if u["email"] == EMAIL)
    admin_id = admin_user["id"]
    res = requests.post(f"{BASE_URL}/users/{admin_id}/follow", headers=headers, cookies=user1_cookies)
    assert res.status_code == 200, res.text
    print(f"[users] user1 followed admin: {admin_id}")
    res = requests.get(f"{BASE_URL}/users/{user1_id}/followees", headers=headers, cookies=user1_cookies)
    assert res.status_code == 200, res.text
    followees = res.json()
    print("[users] user1 followees:", followees)
    assert any(u["id"] == admin_id for u in followees)
    res = requests.get(f"{BASE_URL}/users/{admin_id}/followers", headers=headers, cookies=cookies)
    assert res.status_code == 200, res.text
    followers = res.json()
    print("[users] admin followers:", followers)
    assert any(u["id"] == user1_id for u in followers)
    res = requests.delete(f"{BASE_URL}/users/{admin_id}/follow", headers=headers, cookies=user1_cookies)
    assert res.status_code == 200, res.text
    print(f"[users] user1 unfollowed admin: {admin_id}")
    res = requests.get(f"{BASE_URL}/users/{user1_id}/followees", headers=headers, cookies=user1_cookies)
    assert all(u["id"] != admin_id for u in res.json())
    res = requests.get(f"{BASE_URL}/users/{admin_id}/followers", headers=headers, cookies=cookies)
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
        "title": "first post",
        "body": "hello, this is a test post!",
        "reply_to": None,
    }
    res = requests.post(f"{BASE_URL}/posts", json=post_input, headers=headers, cookies=cookies)
    assert res.status_code == 201, res.text
    post = res.json()
    post_id = post["id"]
    print("[posts] created:", post)
    res = requests.post(f"{BASE_URL}/posts/{post_id}/like", headers=headers, cookies=cookies)
    assert res.status_code == 200, res.text
    print("[posts] like: ok")
    res = requests.get(f"{BASE_URL}/posts/liked/detail", headers=headers, cookies=cookies)
    assert res.status_code == 200, res.text
    liked_posts = res.json()
    print("[posts] liked/detail:", liked_posts)
    assert any(p["id"] == post_id for p in liked_posts)
    res = requests.delete(f"{BASE_URL}/posts/{post_id}/like", headers=headers, cookies=cookies)
    assert res.status_code == 200, res.text
    print("[posts] unlike: ok")
    res = requests.delete(f"{BASE_URL}/posts/{post_id}/like", headers=headers, cookies=cookies)
    assert res.status_code == 404, res.text
    print("[posts] unlike again: not found (expected)")
    res = requests.get(f"{BASE_URL}/posts/{post_id}", headers=headers, cookies=cookies)
    assert res.status_code == 200, res.text
    got = res.json()
    assert got["title"] == post_input["title"]
    res = requests.get(f"{BASE_URL}/posts/{post_id}/detail", headers=headers, cookies=cookies)
    assert res.status_code == 200
    detail = res.json()
    assert detail["id"] == post_id
    assert detail["title"] == post_input["title"]
    assert detail["owner_nickname"] == "admin"
    res = requests.get(f"{BASE_URL}/posts/by-followees/detail?include_self=true", headers=headers, cookies=cookies)
    assert res.status_code == 200, res.text
    by_followees = res.json()
    print("[posts] by-followees/detail (self):", by_followees)
    assert any(p["id"] == post_id for p in by_followees)
    res = requests.delete(f"{BASE_URL}/posts/{post_id}", headers=headers, cookies=cookies)
    assert res.status_code == 200, res.text
    print("[posts] deleted")
    assert res.json()["result"] == "ok"
    res = requests.get(f"{BASE_URL}/posts/{post_id}", headers=headers, cookies=cookies)
    assert res.status_code == 404
    logout(session_id)
    print("[test_posts] OK")

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
