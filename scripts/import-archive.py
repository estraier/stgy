#!/usr/bin/env python3

import argparse
import json
import os
import re
import secrets
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import unquote, urlsplit

import requests


DEFAULT_API_BASE = os.environ.get("STGY_BACKEND_API_BASE_URL", "http://localhost:3100")
DEFAULT_ADMIN_EMAIL = os.environ.get("STGY_ADMIN_EMAIL", "admin@stgy.jp")
DEFAULT_ADMIN_PASSWORD = os.environ.get("STGY_ADMIN_PASSWORD", "stgystgy")
ID_RE = re.compile(r"^[0-9A-F]{16}$")
EMBED_RE = re.compile(
  r"(?P<prefix>[!@]\[[^\]\r\n]*\]\(\s*)(?P<url>[^)\r\n]*?)(?P<suffix>\s*\))"
)
IMAGE_CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
}
TRACK_CONTENT_TYPES = {
  ".fit": "application/octet-stream",
  ".trjgz": "application/gzip",
}


@dataclass(frozen=True)
class ArchivePost:
  path: Path
  data: dict[str, Any]

  @property
  def id(self) -> str:
    return str(self.data["id"])

  @property
  def reply_to(self) -> str | None:
    value = self.data.get("replyTo")
    return value if isinstance(value, str) and value else None

  @property
  def content(self) -> str:
    return str(self.data["content"])


@dataclass(frozen=True)
class MediaReference:
  kind: str
  archive_path: Path


@dataclass(frozen=True)
class ImportPlan:
  data_dir: Path
  profile: dict[str, Any]
  posts: tuple[ArchivePost, ...]
  skipped_reply_count: int
  image_paths: tuple[Path, ...]
  track_master_paths: tuple[Path, ...]
  track_preview_to_master: dict[Path, Path]
  avatar_path: Path | None
  pub_config: dict[str, Any] | None


class StgyClient:
  def __init__(self, api_base: str, admin_email: str, admin_password: str):
    self.api_base = api_base.rstrip("/")
    self.admin_email = admin_email
    self.admin_password = admin_password
    self.session = requests.Session()

  def close(self) -> None:
    self.session.close()

  def login(self) -> dict[str, Any]:
    self._request(
      "POST",
      "/auth",
      expected={200},
      json_body={"email": self.admin_email, "password": self.admin_password},
    )
    data = self._request("GET", "/auth", expected={200})
    if not isinstance(data, dict) or not data.get("userIsAdmin"):
      raise RuntimeError("the supplied account is not an administrator")
    return data

  def get_user(self, user_id: str) -> dict[str, Any] | None:
    data = self._request("GET", f"/users/{user_id}", expected={200, 404})
    return None if data is None else require_dict(data, "user response")

  def create_user(self, body: dict[str, Any]) -> dict[str, Any]:
    return require_dict(
      self._request("POST", "/users", expected={201}, json_body=body),
      "created user response",
    )

  def update_user(self, user_id: str, body: dict[str, Any]) -> dict[str, Any]:
    return require_dict(
      self._request("PUT", f"/users/{user_id}", expected={200}, json_body=body),
      "updated user response",
    )

  def update_pub_config(self, user_id: str, body: dict[str, Any]) -> None:
    self._request(
      "PUT",
      f"/users/{user_id}/pub-config",
      expected={200},
      json_body=body,
    )

  def get_post(self, post_id: str) -> dict[str, Any] | None:
    data = self._request("GET", f"/posts/{post_id}", expected={200, 404})
    return None if data is None else require_dict(data, "post response")

  def create_post(self, body: dict[str, Any]) -> dict[str, Any]:
    return require_dict(
      self._request("POST", "/posts", expected={201}, json_body=body),
      "created post response",
    )

  def update_post(self, post_id: str, body: dict[str, Any]) -> dict[str, Any]:
    return require_dict(
      self._request("PUT", f"/posts/{post_id}", expected={200}, json_body=body),
      "updated post response",
    )

  def upload_image(self, owner_id: str, path: Path) -> str:
    content_type = IMAGE_CONTENT_TYPES.get(path.suffix.lower())
    if content_type is None:
      raise ValueError(f"unsupported image type: {path}")
    finalized = self._upload_and_finalize(
      path=path,
      content_type=content_type,
      presign_path=f"/media/{owner_id}/images/presigned",
      finalize_path=f"/media/{owner_id}/images/finalize",
    )
    key = require_string(finalized.get("key"), f"final image key for {path}")
    return f"/images/{key}"

  def upload_track(self, owner_id: str, path: Path) -> str:
    content_type = TRACK_CONTENT_TYPES.get(path.suffix.lower())
    if content_type is None:
      raise ValueError(f"unsupported track type: {path}")
    finalized = self._upload_and_finalize(
      path=path,
      content_type=content_type,
      presign_path=f"/media/{owner_id}/tracks/presigned",
      finalize_path=f"/media/{owner_id}/tracks/finalize",
    )
    master = require_dict(finalized.get("master"), f"final track master for {path}")
    preview_key = require_string(master.get("previewKey"), f"final track preview key for {path}")
    return f"/tracks/{preview_key}"

  def upload_avatar(self, owner_id: str, path: Path) -> None:
    content_type = IMAGE_CONTENT_TYPES.get(path.suffix.lower())
    if content_type is None:
      raise ValueError(f"unsupported avatar type: {path}")
    self._upload_and_finalize(
      path=path,
      content_type=content_type,
      presign_path=f"/media/{owner_id}/profiles/avatar/presigned",
      finalize_path=f"/media/{owner_id}/profiles/avatar/finalize",
    )

  def _upload_and_finalize(
    self,
    *,
    path: Path,
    content_type: str,
    presign_path: str,
    finalize_path: str,
  ) -> dict[str, Any]:
    data = path.read_bytes()
    if not data:
      raise ValueError(f"file is empty: {path}")
    presigned = require_dict(
      self._request(
        "POST",
        presign_path,
        expected={200},
        json_body={"filename": path.name, "sizeBytes": len(data)},
      ),
      f"presigned upload response for {path}",
    )
    upload_url = require_string(presigned.get("url"), f"upload URL for {path}")
    fields = require_dict(presigned.get("fields"), f"upload fields for {path}")
    object_key = require_string(presigned.get("objectKey"), f"object key for {path}")
    string_fields: dict[str, str] = {}
    for key, value in fields.items():
      if not isinstance(key, str) or not isinstance(value, str):
        raise ValueError(f"invalid upload field for {path}")
      string_fields[key] = value
    response = requests.post(
      upload_url,
      data=string_fields,
      files={"file": (path.name, data, content_type)},
      timeout=180,
    )
    if response.status_code not in {200, 201, 204}:
      raise RuntimeError(
        f"storage upload failed for {path}: HTTP {response.status_code} {response.text}"
      )
    return require_dict(
      self._request(
        "POST",
        finalize_path,
        expected={200},
        json_body={"key": object_key},
      ),
      f"finalize response for {path}",
    )

  def _request(
    self,
    method: str,
    path: str,
    *,
    expected: set[int],
    json_body: dict[str, Any] | None = None,
  ) -> Any:
    response = self.session.request(
      method,
      self.api_base + path,
      json=json_body,
      headers={"Accept": "application/json"},
      timeout=120,
    )
    if response.status_code == 404 and 404 in expected:
      return None
    if response.status_code not in expected:
      detail = response.text.strip()
      try:
        packet = response.json()
        if isinstance(packet, dict) and isinstance(packet.get("error"), str):
          detail = packet["error"]
      except ValueError:
        pass
      suffix = f": {detail}" if detail else ""
      raise RuntimeError(
        f"STGY API {method} {path} failed: HTTP {response.status_code}{suffix}"
      )
    if not response.content:
      return {}
    try:
      return response.json()
    except ValueError as exc:
      raise RuntimeError(f"STGY API {method} {path} returned invalid JSON") from exc


def require_dict(value: Any, label: str) -> dict[str, Any]:
  if not isinstance(value, dict):
    raise ValueError(f"{label} is invalid")
  return value


def require_string(value: Any, label: str) -> str:
  if not isinstance(value, str) or not value:
    raise ValueError(f"{label} is missing")
  return value


def normalize_id(value: Any, label: str) -> str:
  text = str(value or "").strip().upper()
  if not ID_RE.fullmatch(text):
    raise ValueError(f"{label} must be a 16-digit hexadecimal STGY ID: {value!r}")
  return text


def load_json_object(path: Path) -> dict[str, Any]:
  try:
    data = json.loads(path.read_text(encoding="utf-8"))
  except OSError as exc:
    raise ValueError(f"cannot read {path}: {exc}") from exc
  except json.JSONDecodeError as exc:
    raise ValueError(f"invalid JSON in {path}: {exc}") from exc
  if not isinstance(data, dict):
    raise ValueError(f"JSON root must be an object: {path}")
  return data


def validate_profile(profile: dict[str, Any], path: Path) -> dict[str, Any]:
  required_strings = ["id", "email", "nickname", "locale", "timezone", "introduction"]
  for key in required_strings:
    if not isinstance(profile.get(key), str):
      raise ValueError(f"{path}: {key} must be a string")
  profile = dict(profile)
  profile["id"] = normalize_id(profile["id"], f"{path}: id")
  for key in ["isAdmin", "blockStrangers"]:
    if not isinstance(profile.get(key), bool):
      raise ValueError(f"{path}: {key} must be boolean")
  for key in ["avatar", "aiModel", "aiPersonality"]:
    if profile.get(key) is not None and not isinstance(profile.get(key), str):
      raise ValueError(f"{path}: {key} must be a string or null")
  return profile


def validate_post(data: dict[str, Any], path: Path) -> ArchivePost:
  result = dict(data)
  result["id"] = normalize_id(result.get("id"), f"{path}: id")
  result["ownedBy"] = normalize_id(result.get("ownedBy"), f"{path}: ownedBy")
  reply_to = result.get("replyTo")
  result["replyTo"] = None if reply_to in {None, ""} else normalize_id(reply_to, f"{path}: replyTo")
  if not isinstance(result.get("content"), str) or not result["content"].strip():
    raise ValueError(f"{path}: content must be a non-empty string")
  for key in ["allowLikes", "allowReplies"]:
    if not isinstance(result.get(key), bool):
      raise ValueError(f"{path}: {key} must be boolean")
  if result.get("locale") is not None and not isinstance(result.get("locale"), str):
    raise ValueError(f"{path}: locale must be a string or null")
  if result.get("publishedAt") is not None and not isinstance(result.get("publishedAt"), str):
    raise ValueError(f"{path}: publishedAt must be a string or null")
  tags = result.get("tags")
  if not isinstance(tags, list) or not all(isinstance(tag, str) for tag in tags):
    raise ValueError(f"{path}: tags must be a string array")
  return ArchivePost(path=path, data=result)


def iter_embed_urls(text: str) -> Iterable[tuple[str, str]]:
  for match in EMBED_RE.finditer(text):
    yield match.group("prefix")[0], match.group("url").strip()


def resolve_archive_url(data_dir: Path, source_file: Path, url: str) -> Path | None:
  parts = urlsplit(url)
  if parts.scheme or parts.netloc or url.startswith("//"):
    return None
  path_text = unquote(parts.path)
  if not path_text or path_text.startswith("/"):
    return None
  candidate = (source_file.parent / path_text).resolve()
  try:
    candidate.relative_to(data_dir)
  except ValueError as exc:
    raise ValueError(f"archive reference escapes data directory: {source_file}: {url}") from exc
  return candidate


def find_track_master(data_dir: Path, preview_path: Path) -> Path:
  previews_dir = (data_dir / "tracks" / "previews").resolve()
  masters_dir = (data_dir / "tracks" / "masters").resolve()
  try:
    relative = preview_path.resolve().relative_to(previews_dir)
  except ValueError as exc:
    raise ValueError(f"track reference is not under tracks/previews: {preview_path}") from exc
  if relative.suffix.lower() != ".trjgz":
    raise ValueError(f"track preview must end in .trjgz: {preview_path}")
  stem = relative.name[:-len(".trjgz")]
  candidates = [masters_dir / relative.parent / f"{stem}.fit", masters_dir / relative.parent / f"{stem}.trjgz"]
  found = [path for path in candidates if path.is_file()]
  if len(found) != 1:
    raise ValueError(
      f"expected exactly one track master for {preview_path}, found {len(found)}"
    )
  return found[0].resolve()


def collect_media_references(
  data_dir: Path,
  posts: Iterable[ArchivePost],
) -> tuple[tuple[Path, ...], tuple[Path, ...], dict[Path, Path]]:
  images_dir = (data_dir / "images").resolve()
  previews_dir = (data_dir / "tracks" / "previews").resolve()
  image_paths: set[Path] = set()
  track_masters: set[Path] = set()
  preview_to_master: dict[Path, Path] = {}

  for post in posts:
    for kind, url in iter_embed_urls(post.content):
      candidate = resolve_archive_url(data_dir, post.path, url)
      if candidate is None:
        continue
      if kind == "!":
        try:
          candidate.relative_to(images_dir)
        except ValueError:
          continue
        if not candidate.is_file():
          raise ValueError(f"referenced image not found: {post.path}: {url}")
        if candidate.suffix.lower() not in IMAGE_CONTENT_TYPES:
          raise ValueError(f"referenced image type is unsupported: {candidate}")
        image_paths.add(candidate)
      elif kind == "@":
        try:
          candidate.relative_to(previews_dir)
        except ValueError:
          continue
        if not candidate.is_file():
          raise ValueError(f"referenced track preview not found: {post.path}: {url}")
        master = find_track_master(data_dir, candidate)
        preview_to_master[candidate] = master
        track_masters.add(master)

  return (
    tuple(sorted(image_paths, key=str)),
    tuple(sorted(track_masters, key=str)),
    preview_to_master,
  )


def load_import_plan(data_dir: Path, no_reply: bool = False, publish: bool = False) -> ImportPlan:
  root = data_dir.expanduser().resolve()
  if not root.is_dir():
    raise ValueError(f"data directory not found: {root}")
  profile_path = root / "profile.json"
  if not profile_path.is_file():
    raise ValueError(f"profile.json not found: {profile_path}")
  profile = validate_profile(load_json_object(profile_path), profile_path)

  posts_dir = root / "posts"
  if not posts_dir.is_dir():
    raise ValueError(f"posts directory not found: {posts_dir}")
  all_posts = tuple(
    validate_post(load_json_object(path), path)
    for path in sorted(posts_dir.glob("*.json"), key=lambda p: p.name)
  )
  ids = [post.id for post in all_posts]
  if len(ids) != len(set(ids)):
    raise ValueError("duplicate post IDs in archive")
  posts = tuple(post for post in all_posts if not (no_reply and post.reply_to is not None))
  skipped_reply_count = len(all_posts) - len(posts)
  if publish:
    for post in posts:
      created_at = post.data.get("createdAt")
      if not isinstance(created_at, str) or not created_at:
        raise ValueError(f"{post.path}: createdAt must be a non-empty string with --publish")

  image_paths, track_master_paths, preview_to_master = collect_media_references(root, posts)

  avatar_path: Path | None = None
  if profile.get("avatar"):
    candidate = root / "avatar.webp"
    if not candidate.is_file():
      raise ValueError(f"profile has an avatar but avatar.webp is missing: {candidate}")
    avatar_path = candidate.resolve()

  pub_path = root / "pub-config.json"
  pub_config = load_json_object(pub_path) if pub_path.is_file() else None
  return ImportPlan(
    data_dir=root,
    profile=profile,
    posts=posts,
    skipped_reply_count=skipped_reply_count,
    image_paths=image_paths,
    track_master_paths=track_master_paths,
    track_preview_to_master=preview_to_master,
    avatar_path=avatar_path,
    pub_config=pub_config,
  )


def rewrite_embeds(
  text: str,
  source_file: Path,
  data_dir: Path,
  image_urls: dict[Path, str],
  track_urls_by_preview: dict[Path, str],
) -> str:
  def replace(match: re.Match[str]) -> str:
    kind = match.group("prefix")[0]
    raw_url = match.group("url")
    stripped_url = raw_url.strip()
    candidate = resolve_archive_url(data_dir, source_file, stripped_url)
    replacement: str | None = None
    if candidate is not None:
      if kind == "!":
        replacement = image_urls.get(candidate)
      elif kind == "@":
        replacement = track_urls_by_preview.get(candidate)
    if replacement is None:
      return match.group(0)
    return f"{match.group('prefix')}{replacement}{match.group('suffix')}"

  return EMBED_RE.sub(replace, text)


def sort_posts_for_restore(posts: Iterable[ArchivePost]) -> list[ArchivePost]:
  by_id = {post.id: post for post in posts}
  ordered: list[ArchivePost] = []
  visiting: set[str] = set()
  done: set[str] = set()

  def visit(post: ArchivePost) -> None:
    if post.id in done:
      return
    if post.id in visiting:
      raise ValueError(f"cyclic reply relationship involving post {post.id}")
    visiting.add(post.id)
    if post.reply_to in by_id:
      visit(by_id[post.reply_to])
    visiting.remove(post.id)
    done.add(post.id)
    ordered.append(post)

  for post in sorted(by_id.values(), key=lambda item: item.id):
    visit(post)
  return ordered


def build_user_body(profile: dict[str, Any], introduction: str, password: str | None) -> dict[str, Any]:
  body: dict[str, Any] = {
    "email": profile["email"],
    "nickname": profile["nickname"],
    "isAdmin": profile["isAdmin"],
    "blockStrangers": profile["blockStrangers"],
    "locale": profile["locale"],
    "timezone": profile["timezone"],
    "introduction": introduction,
    "aiModel": profile.get("aiModel"),
    "aiPersonality": profile.get("aiPersonality"),
  }
  if password is not None:
    body["id"] = profile["id"]
    body["password"] = password
    body["avatar"] = None
  return body


def build_post_body(
  post: ArchivePost,
  owner_id: str,
  content: str,
  include_id: bool,
  publish: bool,
) -> dict[str, Any]:
  published_at = post.data.get("publishedAt")
  if publish:
    published_at = post.data.get("createdAt")
    if not isinstance(published_at, str) or not published_at:
      raise ValueError(f"{post.path}: createdAt must be a non-empty string with --publish")
  body: dict[str, Any] = {
    "content": content,
    "ownedBy": owner_id,
    "replyTo": post.data.get("replyTo"),
    "locale": post.data.get("locale"),
    "publishedAt": published_at,
    "allowLikes": post.data["allowLikes"],
    "allowReplies": post.data["allowReplies"],
    "tags": post.data["tags"],
  }
  if include_id:
    body["id"] = post.id
  return body


def validate_pub_config(data: dict[str, Any]) -> dict[str, Any]:
  allowed = {
    "siteName",
    "subtitle",
    "author",
    "introduction",
    "designTheme",
    "showServiceHeader",
    "showSiteName",
    "showPagenation",
    "showSideProfile",
    "showSideRecent",
  }
  return {key: value for key, value in data.items() if key in allowed}


def import_archive(
  plan: ImportPlan,
  client: StgyClient,
  owner_override: str | None,
  publish: bool = False,
) -> None:
  profile_id = normalize_id(plan.profile["id"], "profile ID")
  owner_id = normalize_id(owner_override, "--owner") if owner_override else profile_id
  client.login()

  existing_owner = client.get_user(owner_id)
  generated_password: str | None = None
  created_user = False

  if owner_override:
    if existing_owner is None:
      raise ValueError(f"--owner user does not exist: {owner_id}")
    print(f"[OWNER] using existing user {owner_id}")
  else:
    if existing_owner is None:
      generated_password = secrets.token_urlsafe(24)
      client.create_user(build_user_body(plan.profile, plan.profile["introduction"], generated_password))
      created_user = True
      print(f"[USER CREATED] {owner_id} nickname={plan.profile['nickname']}")
      print(f"[USER PASSWORD] {generated_password}")
    else:
      client.update_user(owner_id, build_user_body(plan.profile, plan.profile["introduction"], None))
      print(f"[USER UPDATED] {owner_id} nickname={plan.profile['nickname']}")

  archive_post_ids = {post.id for post in plan.posts}
  external_parents = sorted(
    {
      post.reply_to
      for post in plan.posts
      if post.reply_to is not None and post.reply_to not in archive_post_ids
    }
  )
  for parent_id in external_parents:
    if client.get_post(parent_id) is None:
      raise ValueError(
        f"reply target post is not in the archive and does not exist on the server: {parent_id}"
      )

  image_urls: dict[Path, str] = {}
  for path in plan.image_paths:
    url = client.upload_image(owner_id, path)
    image_urls[path] = url
    print(f"[IMAGE] {path.relative_to(plan.data_dir)} -> {url}")

  track_url_by_master: dict[Path, str] = {}
  for path in plan.track_master_paths:
    url = client.upload_track(owner_id, path)
    track_url_by_master[path] = url
    print(f"[TRACK] {path.relative_to(plan.data_dir)} -> {url}")
  track_urls_by_preview = {
    preview: track_url_by_master[master]
    for preview, master in plan.track_preview_to_master.items()
  }

  if not owner_override:
    rewritten_intro = rewrite_embeds(
      plan.profile["introduction"],
      plan.data_dir / "profile.json",
      plan.data_dir,
      image_urls,
      track_urls_by_preview,
    )
    client.update_user(owner_id, build_user_body(plan.profile, rewritten_intro, None))
    if plan.avatar_path is not None:
      client.upload_avatar(owner_id, plan.avatar_path)
      print(f"[AVATAR] {plan.avatar_path.relative_to(plan.data_dir)}")
    elif existing_owner is not None and existing_owner.get("avatar") is not None:
      body = build_user_body(plan.profile, rewritten_intro, None)
      body["avatar"] = None
      client.update_user(owner_id, body)
    if plan.pub_config is not None:
      pub_config = validate_pub_config(plan.pub_config)
      if pub_config:
        client.update_pub_config(owner_id, pub_config)
        print("[PUB CONFIG] restored")

  created = 0
  updated = 0
  for post in sort_posts_for_restore(plan.posts):
    rewritten_content = rewrite_embeds(
      post.content,
      post.path,
      plan.data_dir,
      image_urls,
      track_urls_by_preview,
    )
    existing_post = client.get_post(post.id)
    post_body = build_post_body(
      post,
      owner_id,
      rewritten_content,
      existing_post is None,
      publish,
    )
    if existing_post is None:
      client.create_post(post_body)
      created += 1
      print(f"[POST CREATED] {post.id}")
    else:
      client.update_post(post.id, post_body)
      updated += 1
      print(f"[POST UPDATED] {post.id}")

  print(
    "[SUMMARY] "
    f"owner={owner_id} user={'created' if created_user else ('skipped' if owner_override else 'updated')} "
    f"postsCreated={created} postsUpdated={updated} repliesSkipped={plan.skipped_reply_count} "
    f"images={len(image_urls)} tracks={len(track_url_by_master)}"
  )


def parse_args(argv: list[str]) -> argparse.Namespace:
  parser = argparse.ArgumentParser(
    description="Restore a STGY /export archive through the administrator API."
  )
  parser.add_argument("--data-dir", required=True, type=Path)
  parser.add_argument("--admin-email", default=DEFAULT_ADMIN_EMAIL)
  parser.add_argument("--admin-password", default=DEFAULT_ADMIN_PASSWORD)
  parser.add_argument("--owner", help="restore posts and referenced media under an existing user ID")
  parser.add_argument("--no-reply", action="store_true", help="do not import posts that are replies")
  parser.add_argument(
    "--publish",
    action="store_true",
    help="publish imported posts externally using each archived post's creation time",
  )
  return parser.parse_args(argv)


def main(argv: list[str]) -> int:
  args = parse_args(argv)
  client: StgyClient | None = None
  try:
    plan = load_import_plan(args.data_dir, args.no_reply, args.publish)
    client = StgyClient(DEFAULT_API_BASE, args.admin_email, args.admin_password)
    import_archive(plan, client, args.owner, args.publish)
    return 0
  except (OSError, ValueError, RuntimeError, requests.RequestException) as exc:
    print(f"[ERROR] {exc}", file=sys.stderr)
    return 1
  finally:
    if client is not None:
      client.close()


if __name__ == "__main__":
  sys.exit(main(sys.argv[1:]))
