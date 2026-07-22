#!/usr/bin/env python3

import argparse
import http.cookiejar
import json
import re
import ssl
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import defaultdict
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

DEFAULT_OWNER = "0001000000000001"
JST = timezone(timedelta(hours=9))
IMAGE_URL_PREFIX = "https://dbmx.net/hourou/data/"
HEREDOC_BASE = "____EOF____"
YAHOO_GEOCODER_URL = "https://map.yahooapis.jp/geocode/V1/geoCoder"
YAHOO_REFERER = "https://stgy.jp"
MAP_ZOOM = 8
OWNER_RE = re.compile(r"^[0-9A-Fa-f]{16}$")
HEADING_RE = re.compile(r"^(\*+)\s+(.+)$")
HYPHENS_RE = re.compile(r"^(\s*)(-{2,})(\s*)$")
MAP_ATTR_RE = re.compile(r"\[([A-Za-z][-_A-Za-z0-9]*)=(.*?)\]")
BBB_LINK_RE = re.compile(r"\[\[([^\[\]|]+)\|([^\[\]]+)\]\]")
FILENAME_LINK_RE = re.compile(r"^filename:(\d{8})$")
GENERATED_IMAGE_RE = re.compile(r"!\[\]\((.*)\)\{grid\}")
IMAGE_MIME_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
}


class StgyClient:
  def __init__(self, site_base: str, email: str, password: str):
    self.api_base = normalize_stgy_api_base(site_base)
    self.email = email
    self.password = password
    self.cookie_jar = http.cookiejar.CookieJar()
    self.opener = urllib.request.build_opener(
      urllib.request.HTTPCookieProcessor(self.cookie_jar)
    )
    self.curl_temp_dir = tempfile.TemporaryDirectory(prefix="stgy-import-bbb-")
    self.curl_cookie_path = Path(self.curl_temp_dir.name) / "cookies.txt"
    self.use_curl = False
    self.logged_in = False

  def login(self) -> dict:
    self._request_json(
      "POST",
      "/auth",
      {"email": self.email, "password": self.password},
      {200},
    )
    self.logged_in = True
    session = self._request_json("GET", "/auth", None, {200})
    if not isinstance(session, dict):
      raise ValueError("STGY login returned invalid session information")
    return session

  def logout(self) -> None:
    try:
      if self.logged_in:
        try:
          self._request_json("DELETE", "/auth", None, {200})
        except ValueError:
          pass
        self.logged_in = False
    finally:
      self.curl_temp_dir.cleanup()

  def upload_image(self, owner: str, path: Path) -> str:
    try:
      data = path.read_bytes()
    except OSError as exc:
      raise ValueError(f"cannot read image file {path}: {exc}") from exc
    if not data:
      raise ValueError(f"image file is empty: {path}")

    content_type = IMAGE_MIME_TYPES.get(path.suffix.lower())
    if content_type is None:
      raise ValueError(
        f"unsupported image type for STGY upload: {path} "
        "(supported: JPEG, PNG, WebP)"
      )

    owner_path = urllib.parse.quote(owner, safe="")
    presigned = self._request_json(
      "POST",
      f"/media/{owner_path}/images/presigned",
      {"filename": path.name, "sizeBytes": len(data)},
      {200},
    )
    if not isinstance(presigned, dict):
      raise ValueError(f"STGY returned invalid presigned upload data for {path}")
    upload_url = presigned.get("url")
    fields = presigned.get("fields")
    object_key = presigned.get("objectKey")
    if (
      not isinstance(upload_url, str)
      or not upload_url
      or not isinstance(fields, dict)
      or not isinstance(object_key, str)
      or not object_key
    ):
      raise ValueError(f"STGY returned invalid presigned upload data for {path}")
    if not all(isinstance(key, str) and isinstance(value, str) for key, value in fields.items()):
      raise ValueError(f"STGY returned invalid presigned upload fields for {path}")

    self._upload_multipart(
      upload_url,
      fields,
      path.name,
      data,
      content_type,
    )
    finalized = self._request_json(
      "POST",
      f"/media/{owner_path}/images/finalize",
      {"key": object_key},
      {200},
    )
    if not isinstance(finalized, dict):
      raise ValueError(f"STGY returned invalid finalize data for {path}")
    final_key = finalized.get("key")
    if not isinstance(final_key, str) or not final_key:
      raise ValueError(f"STGY returned no final image key for {path}")
    return f"/images/{final_key}"

  def create_post(self, payload: dict) -> dict:
    result = self._request_json("POST", "/posts", payload, {201})
    if not isinstance(result, dict):
      raise ValueError("STGY returned invalid post data")
    return result

  def _request_json(
    self,
    method: str,
    path: str,
    payload: dict | None,
    expected_statuses: set[int],
  ) -> object:
    if self.use_curl:
      return self._request_json_with_curl(method, path, payload, expected_statuses)

    url = self.api_base + path
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
      data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
      headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
      with self.opener.open(request, timeout=60) as response:
        status = response.status
        body = response.read()
    except urllib.error.HTTPError as exc:
      body = exc.read()
      detail = decode_http_error_body(body)
      suffix = f": {detail}" if detail else ""
      raise ValueError(f"STGY API {method} {path} failed: HTTP {exc.code}{suffix}") from exc
    except urllib.error.URLError as exc:
      if is_ssl_certificate_error(exc.reason):
        self.use_curl = True
        return self._request_json_with_curl(method, path, payload, expected_statuses)
      raise ValueError(f"STGY API {method} {path} failed: {exc.reason}") from exc

    if status not in expected_statuses:
      detail = decode_http_error_body(body)
      suffix = f": {detail}" if detail else ""
      raise ValueError(f"STGY API {method} {path} failed: HTTP {status}{suffix}")
    if not body:
      return {}
    try:
      return json.loads(body.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
      raise ValueError(f"STGY API {method} {path} returned invalid JSON") from exc

  def _request_json_with_curl(
    self,
    method: str,
    path: str,
    payload: dict | None,
    expected_statuses: set[int],
  ) -> object:
    url = self.api_base + path
    body_path = Path(self.curl_temp_dir.name) / ("response-" + uuid.uuid4().hex)
    self._seed_curl_cookie_file()
    command = [
      "curl",
      "--silent",
      "--show-error",
      "--max-time",
      "60",
      "--request",
      method,
      "--header",
      "Accept: application/json",
      "--output",
      str(body_path),
      "--write-out",
      "%{http_code}",
      "--cookie-jar",
      str(self.curl_cookie_path),
    ]
    if self.curl_cookie_path.exists():
      command.extend(["--cookie", str(self.curl_cookie_path)])
    input_text = None
    if payload is not None:
      command.extend([
        "--header",
        "Content-Type: application/json",
        "--data-binary",
        "@-",
      ])
      input_text = json.dumps(payload, ensure_ascii=False)
    command.append(url)

    try:
      completed = subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        input=input_text,
        timeout=65,
      )
      body = body_path.read_bytes() if body_path.exists() else b""
    except FileNotFoundError as exc:
      raise ValueError(
        f"STGY API {method} {path} failed: "
        "Python could not verify the TLS certificate and curl is not installed"
      ) from exc
    except subprocess.TimeoutExpired as exc:
      raise ValueError(f"STGY API {method} {path} failed: curl timed out") from exc
    except subprocess.CalledProcessError as exc:
      detail = (exc.stderr or "").strip()
      suffix = f": {detail}" if detail else ""
      raise ValueError(
        f"STGY API {method} {path} failed: curl failed{suffix}"
      ) from exc
    except OSError as exc:
      raise ValueError(f"STGY API {method} {path} failed: {exc}") from exc
    finally:
      try:
        body_path.unlink()
      except FileNotFoundError:
        pass

    try:
      status = int(completed.stdout.strip())
    except ValueError as exc:
      raise ValueError(
        f"STGY API {method} {path} failed: curl returned an invalid status"
      ) from exc
    if status not in expected_statuses:
      detail = decode_http_error_body(body)
      suffix = f": {detail}" if detail else ""
      raise ValueError(f"STGY API {method} {path} failed: HTTP {status}{suffix}")
    if not body:
      return {}
    try:
      return json.loads(body.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
      raise ValueError(f"STGY API {method} {path} returned invalid JSON") from exc

  def _seed_curl_cookie_file(self) -> None:
    if self.curl_cookie_path.exists():
      return
    cookies = list(self.cookie_jar)
    if not cookies:
      return
    lines = ["# Netscape HTTP Cookie File"]
    for cookie in cookies:
      include_subdomains = "TRUE" if cookie.domain_initial_dot else "FALSE"
      secure = "TRUE" if cookie.secure else "FALSE"
      expires = str(cookie.expires or 0)
      lines.append(
        "\t".join([
          cookie.domain,
          include_subdomains,
          cookie.path,
          secure,
          expires,
          cookie.name,
          cookie.value,
        ])
      )
    self.curl_cookie_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

  @staticmethod
  def _upload_multipart(
    url: str,
    fields: dict[str, str],
    filename: str,
    data: bytes,
    content_type: str,
  ) -> None:
    boundary = "----stgy-import-bbb-" + uuid.uuid4().hex
    body = bytearray()

    def append_line(value: str) -> None:
      body.extend(value.encode("utf-8"))
      body.extend(b"\r\n")

    for name, value in fields.items():
      append_line(f"--{boundary}")
      append_line(
        'Content-Disposition: form-data; name="{}"'.format(
          name.replace('"', "")
        )
      )
      append_line("")
      append_line(value)

    append_line(f"--{boundary}")
    append_line(
      'Content-Disposition: form-data; name="file"; filename="{}"'.format(
        filename.replace('"', "")
      )
    )
    append_line(f"Content-Type: {content_type}")
    append_line("")
    body.extend(data)
    body.extend(b"\r\n")
    append_line(f"--{boundary}--")

    request = urllib.request.Request(
      url,
      data=bytes(body),
      headers={
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Content-Length": str(len(body)),
      },
      method="POST",
    )
    try:
      with urllib.request.urlopen(request, timeout=120) as response:
        status = response.status
        response_body = response.read()
    except urllib.error.HTTPError as exc:
      detail = decode_http_error_body(exc.read())
      suffix = f": {detail}" if detail else ""
      raise ValueError(f"STGY storage upload failed: HTTP {exc.code}{suffix}") from exc
    except urllib.error.URLError as exc:
      if is_ssl_certificate_error(exc.reason):
        StgyClient._upload_multipart_with_curl(url, bytes(body), boundary)
        return
      raise ValueError(f"STGY storage upload failed: {exc.reason}") from exc

    if status not in {200, 201, 204}:
      detail = decode_http_error_body(response_body)
      suffix = f": {detail}" if detail else ""
      raise ValueError(f"STGY storage upload failed: HTTP {status}{suffix}")

  @staticmethod
  def _upload_multipart_with_curl(url: str, body: bytes, boundary: str) -> None:
    with tempfile.TemporaryDirectory(prefix="stgy-import-bbb-upload-") as temp_dir:
      body_path = Path(temp_dir) / "request.bin"
      response_path = Path(temp_dir) / "response.bin"
      body_path.write_bytes(body)
      command = [
        "curl",
        "--silent",
        "--show-error",
        "--max-time",
        "120",
        "--request",
        "POST",
        "--header",
        f"Content-Type: multipart/form-data; boundary={boundary}",
        "--data-binary",
        f"@{body_path}",
        "--output",
        str(response_path),
        "--write-out",
        "%{http_code}",
        url,
      ]
      try:
        completed = subprocess.run(
          command,
          check=True,
          capture_output=True,
          text=True,
          encoding="utf-8",
          timeout=125,
        )
      except FileNotFoundError as exc:
        raise ValueError(
          "STGY storage upload failed: Python could not verify the TLS certificate "
          "and curl is not installed"
        ) from exc
      except subprocess.TimeoutExpired as exc:
        raise ValueError("STGY storage upload failed: curl timed out") from exc
      except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or "").strip()
        suffix = f": {detail}" if detail else ""
        raise ValueError(f"STGY storage upload failed: curl failed{suffix}") from exc

      try:
        status = int(completed.stdout.strip())
      except ValueError as exc:
        raise ValueError(
          "STGY storage upload failed: curl returned an invalid status"
        ) from exc
      response_body = response_path.read_bytes() if response_path.exists() else b""
      if status not in {200, 201, 204}:
        detail = decode_http_error_body(response_body)
        suffix = f": {detail}" if detail else ""
        raise ValueError(f"STGY storage upload failed: HTTP {status}{suffix}")


class ImageUploader:
  def __init__(self, image_dir: Path, client: StgyClient, owner: str):
    try:
      self.image_dir = image_dir.expanduser().resolve(strict=True)
    except OSError as exc:
      raise ValueError(f"--image-dir is not accessible: {image_dir}: {exc}") from exc
    if not self.image_dir.is_dir():
      raise ValueError(f"--image-dir is not a directory: {image_dir}")
    self.client = client
    self.owner = owner
    self.cache: dict[Path, str] = {}

  def rewrite(self, url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme or parsed.netloc or url.startswith("/"):
      return url
    if parsed.query or parsed.fragment:
      raise ValueError(f"local image URL cannot contain query or fragment: {url!r}")

    relative_text = urllib.parse.unquote(parsed.path)
    if not relative_text:
      raise ValueError("local image path is empty")
    candidate = (self.image_dir / relative_text).resolve()
    try:
      candidate.relative_to(self.image_dir)
    except ValueError as exc:
      raise ValueError(f"local image path is outside --image-dir: {url!r}") from exc
    if not candidate.is_file():
      raise ValueError(f"local image file not found: {candidate}")

    uploaded = self.cache.get(candidate)
    if uploaded is None:
      uploaded = self.client.upload_image(self.owner, candidate)
      self.cache[candidate] = uploaded
      print(f"[UPLOADED] {candidate} -> {uploaded}")
    return uploaded


def normalize_stgy_api_base(value: str) -> str:
  raw = value.strip().rstrip("/")
  if not raw:
    raise ValueError("--stgy-base is empty")
  parsed = urllib.parse.urlsplit(raw)
  if parsed.scheme not in {"http", "https"} or not parsed.netloc:
    raise ValueError("--stgy-base must be an absolute http or https URL")
  if parsed.query or parsed.fragment:
    raise ValueError("--stgy-base must not contain a query or fragment")
  return raw if parsed.path.rstrip("/").endswith("/backend") else raw + "/backend"


def decode_http_error_body(body: bytes) -> str:
  if not body:
    return ""
  try:
    text = body.decode("utf-8", errors="replace").strip()
  except Exception:
    return ""
  if not text:
    return ""
  try:
    payload = json.loads(text)
  except json.JSONDecodeError:
    return text[:500]
  if isinstance(payload, dict) and isinstance(payload.get("error"), str):
    return payload["error"][:500]
  return text[:500]


def is_ssl_certificate_error(reason: object) -> bool:
  return (
    isinstance(reason, ssl.SSLCertVerificationError)
    or "CERTIFICATE_VERIFY_FAILED" in str(reason)
  )


class YahooGeocoder:
  def __init__(self, appid: str):
    self.appid = appid
    self.cache: dict[str, tuple[float, float]] = {}

  def geocode(self, query: str) -> tuple[float, float]:
    cached = self.cache.get(query)
    if cached is not None:
      return cached

    params = urllib.parse.urlencode({
      "appid": self.appid,
      "query": query,
      "output": "json",
      "results": "1",
    })
    request = urllib.request.Request(
      f"{YAHOO_GEOCODER_URL}?{params}",
      headers={
        "Accept": "application/json",
        "Referer": YAHOO_REFERER,
      },
    )
    try:
      with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
      raise ValueError(
        f"Yahoo geocoding failed for {query!r}: HTTP {exc.code}"
      ) from exc
    except urllib.error.URLError as exc:
      reason = exc.reason
      if (
        isinstance(reason, ssl.SSLCertVerificationError)
        or "CERTIFICATE_VERIFY_FAILED" in str(reason)
      ):
        payload = self._geocode_with_curl(query)
      else:
        raise ValueError(
          f"Yahoo geocoding failed for {query!r}: {reason}"
        ) from exc
    except (UnicodeError, json.JSONDecodeError) as exc:
      raise ValueError(
        f"Yahoo geocoding returned invalid JSON for {query!r}"
      ) from exc

    result_info = payload.get("ResultInfo")
    if not isinstance(result_info, dict):
      raise ValueError(f"Yahoo geocoding returned no ResultInfo for {query!r}")
    status = result_info.get("Status")
    if status != 200:
      description = result_info.get("Description")
      detail = f": {description}" if description else ""
      raise ValueError(
        f"Yahoo geocoding failed for {query!r}: status {status}{detail}"
      )

    features = payload.get("Feature")
    if isinstance(features, dict):
      features = [features]
    if not isinstance(features, list) or not features:
      raise ValueError(f"Yahoo geocoding found no result for {query!r}")
    feature = features[0]
    if not isinstance(feature, dict):
      raise ValueError(f"Yahoo geocoding returned an invalid result for {query!r}")
    geometry = feature.get("Geometry")
    if not isinstance(geometry, dict):
      raise ValueError(f"Yahoo geocoding returned no geometry for {query!r}")
    coordinates = geometry.get("Coordinates")
    if not isinstance(coordinates, str):
      raise ValueError(f"Yahoo geocoding returned no coordinates for {query!r}")

    parts = [part.strip() for part in coordinates.split(",")]
    if len(parts) != 2:
      raise ValueError(f"Yahoo geocoding returned invalid coordinates for {query!r}")
    try:
      lon = float(parts[0])
      lat = float(parts[1])
    except ValueError as exc:
      raise ValueError(
        f"Yahoo geocoding returned invalid coordinates for {query!r}"
      ) from exc
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
      raise ValueError(f"Yahoo geocoding returned invalid coordinates for {query!r}")

    result = (lon, lat)
    self.cache[query] = result
    return result

  def _geocode_with_curl(self, query: str) -> dict:
    command = [
      "curl",
      "--fail",
      "--silent",
      "--show-error",
      "--get",
      "--max-time",
      "30",
      YAHOO_GEOCODER_URL,
      "--data-urlencode",
      f"appid={self.appid}",
      "--data-urlencode",
      f"query={query}",
      "--data-urlencode",
      "output=json",
      "--data-urlencode",
      "results=1",
      "--header",
      "Accept: application/json",
      "--header",
      f"Referer: {YAHOO_REFERER}",
    ]
    try:
      completed = subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=35,
      )
    except FileNotFoundError as exc:
      raise ValueError(
        f"Yahoo geocoding failed for {query!r}: "
        "Python could not verify the TLS certificate and curl is not installed"
      ) from exc
    except subprocess.TimeoutExpired as exc:
      raise ValueError(
        f"Yahoo geocoding failed for {query!r}: curl timed out"
      ) from exc
    except subprocess.CalledProcessError as exc:
      detail = (exc.stderr or "").strip()
      suffix = f": {detail}" if detail else ""
      raise ValueError(
        f"Yahoo geocoding failed for {query!r}: curl failed{suffix}"
      ) from exc

    try:
      payload = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
      raise ValueError(
        f"Yahoo geocoding returned invalid JSON for {query!r}"
      ) from exc
    if not isinstance(payload, dict):
      raise ValueError(
        f"Yahoo geocoding returned invalid JSON for {query!r}"
      )
    return payload


@dataclass(frozen=True)
class Article:
  source_path: Path
  output_path: Path
  title: str
  published_at: datetime
  tags: list[str]
  content: str


def parse_args(argv: list[str]) -> argparse.Namespace:
  parser = argparse.ArgumentParser(
    description="Convert BBB .art files to STGY post files or post them through the API.",
  )
  parser.add_argument(
    "--owner",
    default=DEFAULT_OWNER,
    help=f"ownedBy value (default: {DEFAULT_OWNER})",
  )
  parser.add_argument(
    "--yahoo-appid",
    help="Yahoo geocoder Client ID used to convert @map/@maps directives",
  )
  parser.add_argument(
    "--output-dir",
    type=Path,
    default=Path.cwd(),
    help="output directory (default: current directory)",
  )
  parser.add_argument(
    "--image-dir",
    type=Path,
    help="root directory used to resolve and upload relative image paths",
  )
  parser.add_argument(
    "--stgy-base",
    help="STGY site base URL, for example http://localhost:8080",
  )
  parser.add_argument("--login-email", help="STGY login email")
  parser.add_argument("--login-password", help="STGY login password")
  parser.add_argument(
    "--post",
    action="store_true",
    help="post converted articles to STGY instead of writing post-*.txt files",
  )
  parser.add_argument("files", nargs="+", type=Path, help="input .art files")
  return parser.parse_args(argv)


def normalize_owner(value: str) -> str:
  owner = value.strip().upper()
  if not OWNER_RE.fullmatch(owner):
    raise ValueError("--owner must be a 16-character hexadecimal STGY ID")
  return owner


def parse_article_date(value: str, source_path: Path) -> datetime:
  raw = value.strip()
  if not raw:
    raise ValueError(f"{source_path}: @date is empty")

  date_prefix = re.match(r"^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(.*)$", raw)
  if date_prefix:
    normalized = (
      f"{date_prefix.group(1)}-{int(date_prefix.group(2)):02d}-"
      f"{int(date_prefix.group(3)):02d}{date_prefix.group(4)}"
    )
  else:
    normalized = raw
  date_only = re.fullmatch(r"\d{4}-\d{2}-\d{2}", normalized)
  if date_only:
    normalized += " 12:00:00"

  if normalized.endswith("Z"):
    normalized = normalized[:-1] + "+00:00"

  try:
    parsed = datetime.fromisoformat(normalized)
  except ValueError as exc:
    raise ValueError(
      f"{source_path}: unsupported @date value: {raw!r}"
    ) from exc

  if parsed.tzinfo is None:
    parsed = parsed.replace(tzinfo=JST)
  return parsed


def normalize_image_url(url: str) -> str:
  if url.startswith(IMAGE_URL_PREFIX):
    return "data/" + url[len(IMAGE_URL_PREFIX):]
  return url


def filename_link_post_id(target: str, source_path: Path) -> str:
  match = FILENAME_LINK_RE.fullmatch(target)
  if not match:
    raise ValueError(
      f"{source_path}: invalid filename link target: {target!r}"
    )
  try:
    published_at = datetime.strptime(match.group(1), "%Y%m%d").replace(
      hour=12,
      tzinfo=JST,
    )
  except ValueError as exc:
    raise ValueError(
      f"{source_path}: invalid filename link date: {target!r}"
    ) from exc
  return issue_id(published_at, defaultdict(int))


def transform_bbb_links(line: str, source_path: Path) -> str:
  def replace_link(match: re.Match[str]) -> str:
    label = match.group(1).strip()
    target = match.group(2).strip()
    if target.startswith("filename:"):
      target = f"/posts/{filename_link_post_id(target, source_path)}"
    return f"[{label}]({target})"

  return BBB_LINK_RE.sub(replace_link, line)


def format_coordinate(value: float) -> str:
  return f"{value:.8f}".rstrip("0").rstrip(".")


def parse_map_directive(line: str) -> tuple[str, list[str], str | None]:
  match = re.fullmatch(r"\s*@maps?\s+(.+?)\s*", line)
  if not match:
    raise ValueError(f"invalid @map directive: {line!r}")
  params = match.group(1)
  attrs: dict[str, str] = {}
  for attr_match in MAP_ATTR_RE.finditer(params):
    name = attr_match.group(1).lower()
    if name in attrs:
      raise ValueError(f"duplicate [{name}=...] in @map directive: {line!r}")
    attrs[name] = attr_match.group(2).strip()
  center = MAP_ATTR_RE.sub("", params).strip()
  if not center or "[" in center or "]" in center:
    raise ValueError(f"invalid center address in @map directive: {line!r}")

  via = [value.strip() for value in attrs.get("via", "").split(",") if value.strip()]
  float_dir = attrs.get("float")
  if float_dir is not None and float_dir not in {"left", "right"}:
    raise ValueError(f"invalid [float=...] in @map directive: {line!r}")
  return center, via, float_dir


def transform_map_directive(line: str, geocoder: YahooGeocoder | None) -> str:
  if geocoder is None:
    return f"```text\n{line.strip()}\n```"
  center, via, float_dir = parse_map_directive(line)
  addresses = [center, *via]
  coordinates = [geocoder.geocode(address) for address in addresses]
  center_lon, center_lat = coordinates[0]
  blocks = [
    f"{format_coordinate(center_lon)},{format_coordinate(center_lat)},{MAP_ZOOM}"
  ]
  for address, (lon, lat) in zip(addresses, coordinates):
    if ";" in address or "|" in address:
      raise ValueError(f"unsupported character in @map address: {address!r}")
    blocks.append(
      f"{format_coordinate(lon)},{format_coordinate(lat)};{address}"
    )
  options = f"{{float={float_dir}}}" if float_dir else ""
  return f"@[{center}](map://{'|'.join(blocks)}){options}"


def transform_body(
  lines: list[str],
  geocoder: YahooGeocoder | None,
  source_path: Path,
) -> str:
  output: list[str] = []

  for line in lines:
    stripped = line.strip()

    if stripped == "@page-toc":
      output.append("<!TOC!>")
      continue

    image_match = re.fullmatch(r"\s*@image\s+(.+?)\s*", line)
    if image_match:
      raw_urls = [part.strip() for part in image_match.group(1).split("|")]
      if any(not raw_url for raw_url in raw_urls):
        raise ValueError(f"invalid @image directive: {line!r}")
      urls = [raw_url.split(maxsplit=1)[0] for raw_url in raw_urls]
      if output and output[-1].startswith("![]("):
        output.append("")
      for url in urls:
        output.append(f"![]({normalize_image_url(url)}){{grid}}")
      continue

    youtube_match = re.fullmatch(r"\s*@youtube\s+(.+?)\s*", line)
    if youtube_match:
      output.append(f"@[]({youtube_match.group(1).strip()})")
      continue

    if re.match(r"^\s*@maps?\s+", line):
      try:
        output.append(transform_map_directive(line, geocoder))
      except ValueError as exc:
        raise ValueError(f"{source_path}: {exc}") from exc
      continue

    heading_match = HEADING_RE.fullmatch(line)
    if heading_match:
      level = len(heading_match.group(1)) + 1
      output.append(
        f"{'#' * level} "
        f"{transform_bbb_links(heading_match.group(2), source_path)}"
      )
      continue

    hyphens_match = HYPHENS_RE.fullmatch(line)
    if hyphens_match:
      output.append(
        hyphens_match.group(1)
        + hyphens_match.group(2)
        + "-"
        + hyphens_match.group(3)
      )
      continue

    output.append(transform_bbb_links(line, source_path))

  while output and not output[0].strip():
    output.pop(0)
  while output and not output[-1].strip():
    output.pop()
  return "\n".join(output)


def parse_article(
  path: Path,
  output_dir: Path,
  geocoder: YahooGeocoder | None,
) -> Article:
  try:
    text = path.read_text(encoding="utf-8-sig")
  except OSError as exc:
    raise ValueError(f"{path}: cannot read file: {exc}") from exc
  except UnicodeError as exc:
    raise ValueError(f"{path}: input is not valid UTF-8") from exc

  title: str | None = None
  date_value: str | None = None
  tags: list[str] = []
  tags_seen = False
  body_lines: list[str] = []

  for line in text.splitlines():
    title_match = re.fullmatch(r"\s*@title(?:\s+(.*?))?\s*", line)
    if title_match:
      if title is not None:
        raise ValueError(f"{path}: duplicate @title")
      title = (title_match.group(1) or "").strip()
      continue

    date_match = re.fullmatch(r"\s*@date(?:\s+(.*?))?\s*", line)
    if date_match:
      if date_value is not None:
        raise ValueError(f"{path}: duplicate @date")
      date_value = (date_match.group(1) or "").strip()
      continue

    tags_match = re.fullmatch(r"\s*@tags(?:\s+(.*?))?\s*", line)
    if tags_match:
      if tags_seen:
        raise ValueError(f"{path}: duplicate @tags")
      tags_seen = True
      tags = [tag.strip() for tag in (tags_match.group(1) or "").split(",") if tag.strip()]
      continue

    body_lines.append(line)

  if not title:
    raise ValueError(f"{path}: @title is required")
  if date_value is None:
    raise ValueError(f"{path}: @date is required")

  body = transform_body(body_lines, geocoder, path)
  content = f"# {title}"
  if body:
    content += "\n\n" + body

  output_path = output_dir / f"post-{path.stem}.txt"
  return Article(
    source_path=path,
    output_path=output_path,
    title=title,
    published_at=parse_article_date(date_value, path),
    tags=tags,
    content=content,
  )


def timestamp_milliseconds(value: datetime) -> int:
  epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
  delta = value.astimezone(timezone.utc) - epoch
  return (
    delta.days * 86_400_000
    + delta.seconds * 1000
    + delta.microseconds // 1000
  )


def issue_id(published_at: datetime, counters: dict[int, int]) -> str:
  milliseconds = timestamp_milliseconds(published_at)
  if milliseconds < 0 or milliseconds >= (1 << 43):
    raise ValueError(f"timestamp is outside the STGY Snowflake ID range: {published_at.isoformat()}")

  sequence = counters[milliseconds]
  if sequence >= (1 << 12):
    raise ValueError(
      f"more than 4096 articles share the same timestamp: {published_at.isoformat()}"
    )
  counters[milliseconds] += 1

  value = (milliseconds << 20) | sequence
  return f"{value:016X}"


def choose_heredoc(content: str) -> str:
  delimiter = HEREDOC_BASE
  while delimiter in content.splitlines():
    delimiter += "_"
  return delimiter


def format_published_at(value: datetime) -> str:
  timespec = "milliseconds" if value.microsecond else "seconds"
  return value.isoformat(sep=" ", timespec=timespec)


def rewrite_article_images(article: Article, uploader: ImageUploader) -> Article:
  output: list[str] = []
  for line in article.content.splitlines():
    match = GENERATED_IMAGE_RE.fullmatch(line)
    if match:
      output.append(f"![]({uploader.rewrite(match.group(1))}){{grid}}")
    else:
      output.append(line)
  return replace(article, content="\n".join(output))


def make_post_payload(article: Article, owner: str, post_id: str) -> dict:
  return {
    "id": post_id,
    "content": article.content,
    "ownedBy": owner,
    "replyTo": None,
    "locale": None,
    "publishedAt": format_published_at(article.published_at),
    "allowLikes": True,
    "allowReplies": True,
    "tags": article.tags,
  }


def render_post(article: Article, owner: str, post_id: str) -> str:
  delimiter = choose_heredoc(article.content)
  tags = ", ".join(article.tags)
  published_at = format_published_at(article.published_at)
  return (
    f"id: {post_id}\n"
    f"ownedBy: {owner}\n"
    f"publishedAt: {published_at}\n"
    "allowLikes: true\n"
    "allowReplies: true\n"
    f"tags: {tags}\n"
    f"content:<<{delimiter}\n"
    f"{article.content}\n"
    f"{delimiter}\n"
  )


def validate_stgy_args(args: argparse.Namespace) -> None:
  needs_stgy = args.post or args.image_dir is not None
  supplied = {
    "--stgy-base": args.stgy_base,
    "--login-email": args.login_email,
    "--login-password": args.login_password,
  }
  if needs_stgy:
    missing = [name for name, value in supplied.items() if not value]
    if missing:
      raise ValueError(
        f"{', '.join(missing)} required with "
        + ("--post or --image-dir" if len(missing) > 1 else "--post/--image-dir")
      )
  elif any(value for value in supplied.values()):
    raise ValueError(
      "--stgy-base, --login-email and --login-password are used only with "
      "--post or --image-dir"
    )


def main(argv: list[str]) -> int:
  args = parse_args(argv)
  client: StgyClient | None = None
  try:
    owner = normalize_owner(args.owner)
    validate_stgy_args(args)
    output_dir = args.output_dir.expanduser().resolve()
    yahoo_appid = (args.yahoo_appid or "").strip()
    geocoder = YahooGeocoder(yahoo_appid) if yahoo_appid else None
    articles = [
      parse_article(path.expanduser(), output_dir, geocoder)
      for path in args.files
    ]

    if not args.post:
      output_paths = [article.output_path for article in articles]
      if len(output_paths) != len(set(output_paths)):
        raise ValueError("multiple input files would produce the same output file name")

    counters: dict[int, int] = defaultdict(int)
    identified: list[tuple[Article, str]] = []
    for article in articles:
      identified.append((article, issue_id(article.published_at, counters)))

    if args.post or args.image_dir is not None:
      client = StgyClient(
        args.stgy_base,
        args.login_email,
        args.login_password,
      )
      session = client.login()
      login_user_id = session.get("userId")
      is_admin = session.get("userIsAdmin") is True
      if args.post and not is_admin:
        raise ValueError("--post requires an STGY administrator login to set article IDs")
      if args.image_dir is not None and not is_admin and login_user_id != owner:
        raise ValueError(
          "the STGY login user must be an administrator or match --owner "
          "when --image-dir is used"
        )

    if args.image_dir is not None:
      if client is None:
        raise ValueError("STGY client is not initialized")
      uploader = ImageUploader(args.image_dir, client, owner)
      identified = [
        (rewrite_article_images(article, uploader), post_id)
        for article, post_id in identified
      ]

    if args.post:
      if client is None:
        raise ValueError("STGY client is not initialized")
      for article, post_id in identified:
        created = client.create_post(make_post_payload(article, owner, post_id))
        created_id = created.get("id")
        if created_id != post_id:
          raise ValueError(
            f"STGY returned an unexpected article ID: expected {post_id}, got {created_id!r}"
          )
        print(f"[POSTED] {article.source_path} -> id={post_id}")
      return 0

    rendered = [
      (article, render_post(article, owner, post_id))
      for article, post_id in identified
    ]
    output_dir.mkdir(parents=True, exist_ok=True)
    for article, content in rendered:
      article.output_path.write_text(content, encoding="utf-8")
      print(f"[WROTE] {article.source_path} -> {article.output_path}")
    return 0
  except (OSError, ValueError) as exc:
    print(f"[ERR] {exc}", file=sys.stderr)
    return 1
  finally:
    if client is not None:
      client.logout()


if __name__ == "__main__":
  sys.exit(main(sys.argv[1:]))
