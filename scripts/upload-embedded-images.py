#!/usr/bin/env python3

import argparse
import re
import sys
from pathlib import Path
from typing import Any, TextIO
from urllib.parse import urlsplit

import requests


DEFAULT_STGY_BASE = "http://localhost:8080/"
IMAGE_PLACEHOLDER_RE = re.compile(r"\{\{image:(?P<path>[^{}\r\n]+)\}\}")
IMAGE_CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
}


class StgyClient:
  def __init__(self, stgy_base: str, user_email: str, user_password: str):
    self.api_base = normalize_stgy_api_base(stgy_base)
    self.user_email = user_email
    self.user_password = user_password
    self.session = requests.Session()

  def close(self) -> None:
    self.session.close()

  def login(self) -> str:
    self._request(
      "POST",
      "/auth",
      expected={200},
      json_body={"email": self.user_email, "password": self.user_password},
    )
    session = require_dict(self._request("GET", "/auth", expected={200}), "login session")
    return require_string(session.get("userId"), "login user ID")

  def upload_image(self, owner_id: str, path: Path) -> str:
    content_type = IMAGE_CONTENT_TYPES.get(path.suffix.lower())
    if content_type is None:
      raise ValueError(f"unsupported image type: {path}")
    data = path.read_bytes()
    if not data:
      raise ValueError(f"file is empty: {path}")

    presigned = require_dict(
      self._request(
        "POST",
        f"/media/{owner_id}/images/presigned",
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

    finalized = require_dict(
      self._request(
        "POST",
        f"/media/{owner_id}/images/finalize",
        expected={200},
        json_body={"key": object_key},
      ),
      f"finalize response for {path}",
    )
    key = require_string(finalized.get("key"), f"final image key for {path}")
    return f"/images/{key}"

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


def normalize_stgy_api_base(value: str) -> str:
  raw = value.strip().rstrip("/")
  if not raw:
    raise ValueError("--stgy-base is empty")
  parsed = urlsplit(raw)
  if parsed.scheme not in {"http", "https"} or not parsed.netloc:
    raise ValueError("--stgy-base must be an absolute http or https URL")
  if parsed.query or parsed.fragment:
    raise ValueError("--stgy-base must not contain a query or fragment")
  return raw if parsed.path.rstrip("/").endswith("/backend") else raw + "/backend"


def require_dict(value: Any, label: str) -> dict[str, Any]:
  if not isinstance(value, dict):
    raise ValueError(f"{label} is invalid")
  return value


def require_string(value: Any, label: str) -> str:
  if not isinstance(value, str) or not value:
    raise ValueError(f"{label} is missing")
  return value


def resolve_image_path(data_dir: Path, placeholder_path: str) -> Path:
  relative_text = placeholder_path.strip()
  if not relative_text:
    raise ValueError("empty image path in placeholder")
  relative_path = Path(relative_text)
  if relative_path.is_absolute():
    raise ValueError(f"image path must be relative to --data-dir: {relative_text}")

  image_path = (data_dir / relative_path).resolve()
  try:
    image_path.relative_to(data_dir)
  except ValueError as exc:
    raise ValueError(f"image path escapes --data-dir: {relative_text}") from exc
  if not image_path.is_file():
    raise ValueError(f"image file not found: {relative_text}")
  if image_path.suffix.lower() not in IMAGE_CONTENT_TYPES:
    raise ValueError(f"unsupported image type: {relative_text}")
  return image_path


def collect_image_paths(text: str, data_dir: Path) -> tuple[Path, ...]:
  paths: list[Path] = []
  seen: set[Path] = set()
  for match in IMAGE_PLACEHOLDER_RE.finditer(text):
    path = resolve_image_path(data_dir, match.group("path"))
    if path not in seen:
      seen.add(path)
      paths.append(path)
  return tuple(paths)


def rewrite_image_placeholders(
  text: str,
  data_dir: Path,
  image_urls: dict[Path, str],
) -> str:
  def replace(match: re.Match[str]) -> str:
    path = resolve_image_path(data_dir, match.group("path"))
    replacement = image_urls.get(path)
    if replacement is None:
      raise ValueError(f"image was not uploaded: {match.group('path').strip()}")
    return replacement

  return IMAGE_PLACEHOLDER_RE.sub(replace, text)


def upload_and_rewrite(
  text: str,
  data_dir: Path,
  client: StgyClient,
  progress: TextIO = sys.stderr,
) -> str:
  image_paths = collect_image_paths(text, data_dir)
  if not image_paths:
    print("[SUMMARY] images=0", file=progress)
    return text

  owner_id = client.login()
  image_urls: dict[Path, str] = {}
  for path in image_paths:
    url = client.upload_image(owner_id, path)
    image_urls[path] = url
    print(f"[IMAGE] {path.relative_to(data_dir).as_posix()} -> {url}", file=progress)

  print(f"[SUMMARY] images={len(image_urls)}", file=progress)
  return rewrite_image_placeholders(text, data_dir, image_urls)


def read_utf8(path: Path | None) -> str:
  try:
    data = sys.stdin.buffer.read() if path is None else path.read_bytes()
  except OSError as exc:
    source = "standard input" if path is None else str(path)
    raise ValueError(f"cannot read {source}: {exc}") from exc
  try:
    return data.decode("utf-8")
  except UnicodeDecodeError as exc:
    source = "standard input" if path is None else str(path)
    raise ValueError(f"{source} is not valid UTF-8: {exc}") from exc


def write_utf8(path: Path | None, text: str) -> None:
  data = text.encode("utf-8")
  try:
    if path is None:
      sys.stdout.buffer.write(data)
      sys.stdout.buffer.flush()
    else:
      path.write_bytes(data)
  except OSError as exc:
    destination = "standard output" if path is None else str(path)
    raise ValueError(f"cannot write {destination}: {exc}") from exc


def parse_args(argv: list[str]) -> argparse.Namespace:
  parser = argparse.ArgumentParser(
    description=(
      "Upload images referenced by {{image:path}} placeholders and replace each "
      "placeholder with its STGY /images/ URL."
    )
  )
  parser.add_argument(
    "--stgy-base",
    default=DEFAULT_STGY_BASE,
    help=f"STGY site base URL (default: {DEFAULT_STGY_BASE})",
  )
  parser.add_argument(
    "--data-dir",
    type=Path,
    default=Path("."),
    help="base directory for image paths (default: current directory)",
  )
  parser.add_argument(
    "--input",
    type=Path,
    help="UTF-8 input file (default: standard input)",
  )
  parser.add_argument(
    "--output",
    type=Path,
    help="UTF-8 output file (default: standard output)",
  )
  parser.add_argument("--user-email", required=True)
  parser.add_argument("--user-password", required=True)
  return parser.parse_args(argv)


def main(argv: list[str]) -> int:
  args = parse_args(argv)
  client: StgyClient | None = None
  try:
    data_dir = args.data_dir.expanduser().resolve()
    if not data_dir.is_dir():
      raise ValueError(f"data directory not found: {data_dir}")
    input_path = args.input.expanduser().resolve() if args.input is not None else None
    output_path = args.output.expanduser().resolve() if args.output is not None else None

    source = read_utf8(input_path)
    client = StgyClient(args.stgy_base, args.user_email, args.user_password)
    rewritten = upload_and_rewrite(source, data_dir, client)
    write_utf8(output_path, rewritten)
    return 0
  except (OSError, ValueError, RuntimeError, requests.RequestException) as exc:
    print(f"[ERROR] {exc}", file=sys.stderr)
    return 1
  finally:
    if client is not None:
      client.close()


if __name__ == "__main__":
  sys.exit(main(sys.argv[1:]))
