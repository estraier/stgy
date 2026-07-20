#!/usr/bin/env python3

import argparse
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

DEFAULT_OWNER = "0001000000000001"
JST = timezone(timedelta(hours=9))
IMAGE_URL_PREFIX = "https://dbmx.net/hourou/data/"
HEREDOC_BASE = "____EOF____"
OWNER_RE = re.compile(r"^[0-9A-Fa-f]{16}$")
HEADING_RE = re.compile(r"^(\*+)\s+(.+)$")
HYPHENS_RE = re.compile(r"^(\s*)(-{2,})(\s*)$")


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


def transform_body(lines: list[str]) -> str:
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
      output.extend(["```text", stripped, "```"])
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


def parse_article(path: Path, output_dir: Path) -> Article:
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

  body = transform_body(body_lines)
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
    articles = [parse_article(path, output_dir) for path in args.files]

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
