#!/usr/bin/env python3

import importlib.util
import io
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("upload-embedded-images.py")
SPEC = importlib.util.spec_from_file_location("stgy_upload_embedded_images", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
  raise RuntimeError(f"cannot load {MODULE_PATH}")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class FakeClient:
  def __init__(self) -> None:
    self.login_count = 0
    self.uploaded: list[tuple[str, Path]] = []

  def login(self) -> str:
    self.login_count += 1
    return "19F979885A400000"

  def upload_image(self, owner_id: str, path: Path) -> str:
    self.uploaded.append((owner_id, path))
    index = len(self.uploaded)
    return f"/images/{owner_id}/masters/797392/image-{index}.webp"


class UploadEmbeddedImagesTest(unittest.TestCase):
  def test_stgy_base_defaults_and_normalizes_to_backend_api(self) -> None:
    args = MODULE.parse_args([
      "--user-email",
      "admin@stgy.jp",
      "--user-password",
      "stgystgy",
    ])
    self.assertEqual(args.stgy_base, "http://localhost:8080/")
    self.assertEqual(
      MODULE.normalize_stgy_api_base("http://localhost:8080/"),
      "http://localhost:8080/backend",
    )
    self.assertEqual(
      MODULE.normalize_stgy_api_base("https://stgy.jp"),
      "https://stgy.jp/backend",
    )
    self.assertEqual(
      MODULE.normalize_stgy_api_base("https://stgy.jp/backend/"),
      "https://stgy.jp/backend",
    )

  def test_rejects_invalid_stgy_base(self) -> None:
    for value in ["", "localhost:8080", "ftp://localhost/", "http://localhost/?x=1"]:
      with self.subTest(value=value):
        with self.assertRaisesRegex(ValueError, "--stgy-base"):
          MODULE.normalize_stgy_api_base(value)

  def test_uploads_rewrites_and_deduplicates_images(self) -> None:
    with tempfile.TemporaryDirectory() as temporary_directory:
      data_dir = Path(temporary_directory).resolve()
      (data_dir / "sub").mkdir()
      first = data_dir / "hokkaido-gov.jpg"
      second = data_dir / "sub" / "hokkaido-town.png"
      first.write_bytes(b"first")
      second.write_bytes(b"second")
      source = (
        "141.354404,43.062087;北海道：札幌市;2024/07/27;;"
        "{{image:hokkaido-gov.jpg}} {{image:sub/hokkaido-town.png}}\n"
        "140.740593,40.824448;青森県：青森市;2024/07/25;;"
        "{{image:./hokkaido-gov.jpg}}\n"
      )
      client = FakeClient()
      progress = io.StringIO()

      rewritten = MODULE.upload_and_rewrite(source, data_dir, client, progress)

      first_url = "/images/19F979885A400000/masters/797392/image-1.webp"
      second_url = "/images/19F979885A400000/masters/797392/image-2.webp"
      self.assertEqual(
        rewritten,
        (
          "141.354404,43.062087;北海道：札幌市;2024/07/27;;"
          f"{first_url} {second_url}\n"
          "140.740593,40.824448;青森県：青森市;2024/07/25;;"
          f"{first_url}\n"
        ),
      )
      self.assertEqual(client.login_count, 1)
      self.assertEqual(
        client.uploaded,
        [
          ("19F979885A400000", first),
          ("19F979885A400000", second),
        ],
      )
      self.assertIn("[IMAGE] hokkaido-gov.jpg ->", progress.getvalue())
      self.assertIn("[SUMMARY] images=2", progress.getvalue())

  def test_returns_input_without_login_when_there_are_no_placeholders(self) -> None:
    with tempfile.TemporaryDirectory() as temporary_directory:
      data_dir = Path(temporary_directory).resolve()
      client = FakeClient()
      progress = io.StringIO()

      rewritten = MODULE.upload_and_rewrite("plain text\n", data_dir, client, progress)

      self.assertEqual(rewritten, "plain text\n")
      self.assertEqual(client.login_count, 0)
      self.assertEqual(client.uploaded, [])
      self.assertEqual(progress.getvalue(), "[SUMMARY] images=0\n")

  def test_rejects_path_escaping_data_directory_before_login(self) -> None:
    with tempfile.TemporaryDirectory() as temporary_directory:
      root = Path(temporary_directory).resolve()
      data_dir = root / "data"
      data_dir.mkdir()
      outside = root / "outside.jpg"
      outside.write_bytes(b"outside")
      client = FakeClient()

      with self.assertRaisesRegex(ValueError, "escapes --data-dir"):
        MODULE.upload_and_rewrite(
          "{{image:../outside.jpg}}",
          data_dir,
          client,
          io.StringIO(),
        )

      self.assertEqual(client.login_count, 0)
      self.assertEqual(client.uploaded, [])

  def test_rejects_missing_or_unsupported_images_before_login(self) -> None:
    with tempfile.TemporaryDirectory() as temporary_directory:
      data_dir = Path(temporary_directory).resolve()
      unsupported = data_dir / "image.gif"
      unsupported.write_bytes(b"gif")
      client = FakeClient()

      with self.assertRaisesRegex(ValueError, "image file not found"):
        MODULE.upload_and_rewrite(
          "{{image:missing.jpg}}",
          data_dir,
          client,
          io.StringIO(),
        )
      with self.assertRaisesRegex(ValueError, "unsupported image type"):
        MODULE.upload_and_rewrite(
          "{{image:image.gif}}",
          data_dir,
          client,
          io.StringIO(),
        )

      self.assertEqual(client.login_count, 0)
      self.assertEqual(client.uploaded, [])


if __name__ == "__main__":
  unittest.main()
