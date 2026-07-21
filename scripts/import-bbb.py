#!/usr/bin/env python3

import argparse
import json
import re
import ssl
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
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
    description="Convert BBB .art files to STGY seeder/post-*.txt files.",
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
      raw_urls = image_match.group(1).split("|")
      urls = [part.strip() for part in raw_urls]
      if any(not url for url in urls):
        raise ValueError(f"invalid @image directive: {line!r}")
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
      output.append(f"{'#' * level} {heading_match.group(2)}")
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

    output.append(line)

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


def render_post(article: Article, owner: str, post_id: str) -> str:
  delimiter = choose_heredoc(article.content)
  tags = ", ".join(article.tags)
  timespec = "milliseconds" if article.published_at.microsecond else "seconds"
  published_at = article.published_at.isoformat(sep=" ", timespec=timespec)
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


def main(argv: list[str]) -> int:
  args = parse_args(argv)
  try:
    owner = normalize_owner(args.owner)
    output_dir = args.output_dir.resolve()
    yahoo_appid = (args.yahoo_appid or "").strip()
    geocoder = YahooGeocoder(yahoo_appid) if yahoo_appid else None
    articles = [parse_article(path, output_dir, geocoder) for path in args.files]

    output_paths = [article.output_path for article in articles]
    if len(output_paths) != len(set(output_paths)):
      raise ValueError("multiple input files would produce the same output file name")

    counters: dict[int, int] = defaultdict(int)
    rendered: list[tuple[Article, str]] = []
    for article in articles:
      post_id = issue_id(article.published_at, counters)
      rendered.append((article, render_post(article, owner, post_id)))

    output_dir.mkdir(parents=True, exist_ok=True)
    for article, content in rendered:
      article.output_path.write_text(content, encoding="utf-8")
      print(f"[WROTE] {article.source_path} -> {article.output_path}")
    return 0
  except (OSError, ValueError) as exc:
    print(f"[ERR] {exc}", file=sys.stderr)
    return 1


if __name__ == "__main__":
  sys.exit(main(sys.argv[1:]))
