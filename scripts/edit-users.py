#!/usr/bin/env python3

import os
import sys
import secrets
import requests

APP_HOST = os.environ.get("STGY_APP_HOST", "localhost")
APP_PORT = int(os.environ.get("STGY_APP_PORT", 3001))
ADMIN_EMAIL = os.environ.get("STGY_ADMIN_EMAIL", "admin@stgy.jp")
ADMIN_PASSWORD = os.environ.get("STGY_ADMIN_PASSWORD", "stgystgy")
BASE_URL = f"http://{APP_HOST}:{APP_PORT}"

REQUIRED_KEYS = [
  "email",
  "nickname",
  "password",
  "isAdmin",
  "blockStrangers",
  "locale",
  "timezone",
  "introduction",
]
NULLABLE_KEYS = ["avatar", "aiModel", "aiPersonality"]
PUBCONFIG_STR_KEYS = [
  "pubConfigSiteName",
  "pubConfigSubtitle",
  "pubConfigAuthor",
  "pubConfigIntroduction",
  "pubConfigDesignTheme",
]
PUBCONFIG_BOOL_KEYS = [
  "pubConfigShowServiceHeader",
  "pubConfigShowSiteName",
  "pubConfigShowPagenation",
  "pubConfigShowSideProfile",
  "pubConfigShowSideRecent",
]


def to_bool(s: str) -> bool:
  v = s.strip().lower()
  if v in ("true", "1", "yes", "y", "on"):
    return True
  if v in ("false", "0", "no", "n", "off"):
    return False
  raise ValueError(f"must be boolean, got: {s!r}")


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
        raise ValueError(
          f"{path}: heredoc terminator not found for key '{key}' (sep={sep!r})"
        )
      data[key] = "\n".join(buf).strip()
      continue
    data[key] = val.strip()
    i += 1
  return data


def normalize_payload(raw: dict) -> dict:
  out = {}
  if "id" in raw and raw["id"].strip():
    out["id"] = raw["id"].strip()
  for k in ("email", "nickname", "locale", "timezone", "introduction"):
    v = raw.get(k, "")
    v = v.strip()
    if k in REQUIRED_KEYS and not v:
      raise ValueError(f"{k} is required")
    out[k] = v
  if "password" not in raw:
    raise ValueError("password is required")
  pw = str(raw["password"]).strip()
  if pw == "*":
    gen = f"{secrets.randbits(32):08x}"
    out["password"] = gen
    out["_generatedPassword"] = gen
  else:
    if not pw:
      raise ValueError("password is required")
    out["password"] = pw
  if "isAdmin" not in raw:
    raise ValueError("isAdmin is required")
  out["isAdmin"] = to_bool(str(raw["isAdmin"]).strip())
  if "blockStrangers" not in raw:
    raise ValueError("blockStrangers is required")
  out["blockStrangers"] = to_bool(str(raw["blockStrangers"]).strip())
  for k in NULLABLE_KEYS:
    v = raw.get(k, "")
    v = v.strip() if isinstance(v, str) else v
    out[k] = None if (isinstance(v, str) and v == "") else v
  for k in PUBCONFIG_STR_KEYS:
    v = raw.get(k, "")
    if isinstance(v, str):
      v = v.strip()
    if v:
      out[k] = v
  for k in PUBCONFIG_BOOL_KEYS:
    if k in raw and str(raw[k]).strip() != "":
      out[k] = to_bool(str(raw[k]).strip())
  return out


def build_update_body(payload: dict) -> dict:
  return {
    "email": payload.get("email"),
    "nickname": payload.get("nickname"),
    "isAdmin": payload.get("isAdmin"),
    "blockStrangers": payload.get("blockStrangers"),
    "locale": payload.get("locale"),
    "timezone": payload.get("timezone"),
    "introduction": payload.get("introduction"),
    "avatar": payload.get("avatar"),
    "aiModel": payload.get("aiModel"),
    "aiPersonality": payload.get("aiPersonality"),
  }


def has_pub_config(payload: dict) -> bool:
  for k in PUBCONFIG_STR_KEYS:
    if k in payload:
      return True
  for k in PUBCONFIG_BOOL_KEYS:
    if k in payload:
      return True
  return False


def build_pub_config_body(payload: dict) -> dict:
  body: dict = {}
  if "pubConfigSiteName" in payload:
    body["siteName"] = payload["pubConfigSiteName"]
  if "pubConfigSubtitle" in payload:
    body["subtitle"] = payload["pubConfigSubtitle"]
  if "pubConfigAuthor" in payload:
    body["author"] = payload["pubConfigAuthor"]
  if "pubConfigIntroduction" in payload:
    body["introduction"] = payload["pubConfigIntroduction"]
  if "pubConfigDesignTheme" in payload:
    body["designTheme"] = payload["pubConfigDesignTheme"]
  if "pubConfigShowServiceHeader" in payload:
    body["showServiceHeader"] = payload["pubConfigShowServiceHeader"]
  if "pubConfigShowSiteName" in payload:
    body["showSiteName"] = payload["pubConfigShowSiteName"]
  if "pubConfigShowPagenation" in payload:
    body["showPagenation"] = payload["pubConfigShowPagenation"]
  if "pubConfigShowSideProfile" in payload:
    body["showSideProfile"] = payload["pubConfigShowSideProfile"]
  if "pubConfigShowSideRecent" in payload:
    body["showSideRecent"] = payload["pubConfigShowSideRecent"]
  return body


def login_admin(session: requests.Session) -> None:
  r = session.post(
    f"{BASE_URL}/auth", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
  )
  if r.status_code != 200:
    raise RuntimeError(f"admin login failed: {r.status_code} {r.text}")


def get_user_by_id(session: requests.Session, user_id: str):
  r = session.get(f"{BASE_URL}/users/{user_id}")
  if r.status_code == 404:
    return None
  if r.status_code != 200:
    raise RuntimeError(f"get user failed: {r.status_code} {r.text}")
  return r.json()


def create_user(session: requests.Session, payload: dict) -> dict:
  body = {
    "id": payload.get("id"),
    "email": payload["email"],
    "nickname": payload["nickname"],
    "password": payload["password"],
    "isAdmin": payload["isAdmin"],
    "blockStrangers": payload["blockStrangers"],
    "locale": payload["locale"],
    "timezone": payload["timezone"],
    "introduction": payload["introduction"],
    "avatar": payload.get("avatar"),
    "aiModel": payload.get("aiModel"),
    "aiPersonality": payload.get("aiPersonality"),
  }
  r = session.post(f"{BASE_URL}/users", json=body)
  if r.status_code != 201:
    raise RuntimeError(f"create user failed: {r.status_code} {r.text}")
  return r.json()


def update_user(session: requests.Session, user_id: str, payload: dict) -> dict:
  body = build_update_body(payload)
  r = session.put(f"{BASE_URL}/users/{user_id}", json=body)
  if r.status_code != 200:
    raise RuntimeError(f"update user failed: {r.status_code} {r.text}")
  return r.json()


def update_user_password(session: requests.Session, user_id: str, password: str) -> None:
  if not password.strip():
    return
  r = session.put(
    f"{BASE_URL}/users/{user_id}/password", json={"password": password}
  )
  if r.status_code != 200:
    raise RuntimeError(f"update password failed: {r.status_code} {r.text}")


def update_user_pub_config(session: requests.Session, user_id: str, payload: dict) -> None:
  body = build_pub_config_body(payload)
  if not body:
    return
  r = session.put(f"{BASE_URL}/users/{user_id}/pub-config", json=body)
  if r.status_code != 200:
    raise RuntimeError(f"update pub-config failed: {r.status_code} {r.text}")


def upsert_user(session: requests.Session, payload: dict) -> tuple[str, str]:
  user_id = payload.get("id", "") or ""
  if user_id:
    exists = get_user_by_id(session, user_id)
    if exists is not None:
      updated = update_user(session, user_id, payload)
      if payload.get("password"):
        update_user_password(session, user_id, payload["password"])
      return ("UPDATED", updated.get("id") or user_id)
  created = create_user(session, payload)
  return ("CREATED", created.get("id"))


def parse_cli(argv: list[str]) -> tuple[bool, list[str]]:
  insecure = False
  files: list[str] = []
  for a in argv[1:]:
    if a == "--insecure-password":
      insecure = True
    else:
      files.append(a)
  return insecure, files


def main(argv: list[str]) -> int:
  insecure, files = parse_cli(argv)
  if not files:
    print(f"usage: {argv[0]} [--insecure-password] <user1.md> [user2.md ...]")
    return 2
  sess = requests.Session()
  login_admin(sess)
  ok = 0
  err = 0
  for path in sorted(files):
    try:
      raw = parse_kv_file(path)
      if raw["password"] == "*" and insecure:
        email = str(raw.get("email", "")).strip()
        if not email:
          raise ValueError("email is required to derive insecure password")
        raw["password"] = email.split("@")[0].lower()
      payload = normalize_payload(raw)
      action, uid = upsert_user(sess, payload)
      if has_pub_config(payload):
        update_user_pub_config(sess, uid, payload)
      email = payload.get("email")
      nickname = payload.get("nickname")
      print(f"[{action}] {path} -> id={uid} email={email} nickname={nickname}")
      gen = payload.pop("_generatedPassword", None)
      if gen:
        print(f"[PWD] {path} -> password={gen}")
      ok += 1
    except Exception as e:
      print(f"[ERR] {path} -> {e}")
      err += 1
  print(f"[SUMMARY] ok={ok} err={err}")
  return 0 if err == 0 else 1


if __name__ == "__main__":
  sys.exit(main(sys.argv))
