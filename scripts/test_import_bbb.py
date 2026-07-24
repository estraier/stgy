#!/usr/bin/env python3

import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("import-bbb.py")
SPEC = importlib.util.spec_from_file_location("stgy_import_bbb", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
  raise RuntimeError(f"cannot load {MODULE_PATH}")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class FakeUploader:
  def __init__(self) -> None:
    self.urls: list[str] = []

  def rewrite(self, url: str) -> str:
    self.urls.append(url)
    return f"/images/uploaded/{Path(url).name}"


class ImportBbbFeaturedImageTest(unittest.TestCase):
  def test_converts_top_marker_to_featured_option(self) -> None:
    content = MODULE.transform_body(
      [
        "@image first.jpg [top] | second.png",
        "@image third.webp [TOP]",
      ],
      None,
      Path("article.art"),
    )

    self.assertEqual(
      content,
      "![](first.jpg){grid,featured}\n"
      "![](second.png){grid}\n\n"
      "![](third.webp){grid,featured}",
    )

  def test_preserves_featured_option_when_rewriting_uploaded_image(self) -> None:
    article = MODULE.Article(
      source_path=Path("article.art"),
      output_path=Path("post.txt"),
      title="Title",
      published_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
      tags=[],
      content=(
        "![](first.jpg){grid,featured}\n"
        "![](second.png){grid}"
      ),
    )
    uploader = FakeUploader()

    rewritten = MODULE.rewrite_article_images(article, uploader)

    self.assertEqual(uploader.urls, ["first.jpg", "second.png"])
    self.assertEqual(
      rewritten.content,
      "![](/images/uploaded/first.jpg){grid,featured}\n"
      "![](/images/uploaded/second.png){grid}",
    )


if __name__ == "__main__":
  unittest.main()
