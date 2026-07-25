#!/usr/bin/env python3

import importlib.util
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("import-archive.py")
SPEC = importlib.util.spec_from_file_location("stgy_import_archive", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
  raise RuntimeError(f"cannot load {MODULE_PATH}")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ImportArchiveMapPinImageTest(unittest.TestCase):
  def test_stgy_base_defaults_and_normalizes_to_backend_api(self) -> None:
    args = MODULE.parse_args(["--data-dir", "."])
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
    for value in ["", "localhost:8080", "ftp://localhost/", "http://localhost/#fragment"]:
      with self.subTest(value=value):
        with self.assertRaisesRegex(ValueError, "--stgy-base"):
          MODULE.normalize_stgy_api_base(value)

  def test_collects_and_rewrites_local_map_pin_images(self) -> None:
    with tempfile.TemporaryDirectory() as temporary_directory:
      data_dir = Path(temporary_directory).resolve()
      posts_dir = data_dir / "posts"
      images_dir = data_dir / "images"
      posts_dir.mkdir()
      images_dir.mkdir()
      post_path = posts_dir / "0001.json"
      post_path.write_text("{}", encoding="utf-8")
      first_image = images_dir / "first.jpg"
      second_image = images_dir / "second.png"
      first_image.write_bytes(b"first")
      second_image.write_bytes(b"second")

      content = (
        "![same](../images/first.jpg)\n"
        "@[Map](map://139.0,35.0,13|"
        "139.1,35.1;First;;;../images/first.jpg|"
        "139.2,35.2;Second;;; ../images/second.png |"
        "139.3,35.3;External;;;https://example.com/external.jpg)"
      )
      post = MODULE.ArchivePost(
        path=post_path,
        data={"id": "0000000000000001", "content": content},
      )

      image_paths, track_paths, preview_to_master = MODULE.collect_media_references(
        data_dir,
        [post],
      )

      self.assertEqual(image_paths, (first_image, second_image))
      self.assertEqual(track_paths, ())
      self.assertEqual(preview_to_master, {})

      rewritten = MODULE.rewrite_embeds(
        content,
        post_path,
        data_dir,
        {
          first_image: "/images/OWNER/masters/first.jpg",
          second_image: "/images/OWNER/masters/second.png",
        },
        {},
      )

      self.assertIn("![same](/images/OWNER/masters/first.jpg)", rewritten)
      self.assertIn("139.1,35.1;First;;;/images/OWNER/masters/first.jpg", rewritten)
      self.assertIn("139.2,35.2;Second;;; /images/OWNER/masters/second.png ", rewritten)
      self.assertIn("https://example.com/external.jpg", rewritten)

  def test_collects_and_rewrites_track_source_with_pin_images(self) -> None:
    with tempfile.TemporaryDirectory() as temporary_directory:
      data_dir = Path(temporary_directory).resolve()
      posts_dir = data_dir / "posts"
      images_dir = data_dir / "images"
      previews_dir = data_dir / "tracks" / "previews"
      masters_dir = data_dir / "tracks" / "masters"
      posts_dir.mkdir()
      images_dir.mkdir()
      previews_dir.mkdir(parents=True)
      masters_dir.mkdir(parents=True)
      post_path = posts_dir / "0001.json"
      post_path.write_text("{}", encoding="utf-8")
      image_path = images_dir / "stop.jpg"
      preview_path = previews_dir / "ride.trjgz"
      master_path = masters_dir / "ride.fit"
      image_path.write_bytes(b"image")
      preview_path.write_bytes(b"preview")
      master_path.write_bytes(b"master")

      content = (
        "@[Ride](../tracks/previews/ride.trjgz|"
        "139.1,35.1;Stop;Rest;;../images/stop.jpg)"
      )
      post = MODULE.ArchivePost(
        path=post_path,
        data={"id": "0000000000000001", "content": content},
      )

      image_paths, track_paths, preview_to_master = MODULE.collect_media_references(
        data_dir,
        [post],
      )

      self.assertEqual(image_paths, (image_path,))
      self.assertEqual(track_paths, (master_path,))
      self.assertEqual(preview_to_master, {preview_path: master_path})

      rewritten = MODULE.rewrite_embeds(
        content,
        post_path,
        data_dir,
        {image_path: "/images/OWNER/masters/stop.jpg"},
        {preview_path: "/tracks/OWNER/masters/ride.fit"},
      )

      self.assertEqual(
        rewritten,
        "@[Ride](/tracks/OWNER/masters/ride.fit|"
        "139.1,35.1;Stop;Rest;;/images/OWNER/masters/stop.jpg)",
      )

  def test_rejects_missing_local_map_pin_image(self) -> None:
    with tempfile.TemporaryDirectory() as temporary_directory:
      data_dir = Path(temporary_directory).resolve()
      posts_dir = data_dir / "posts"
      images_dir = data_dir / "images"
      posts_dir.mkdir()
      images_dir.mkdir()
      post_path = posts_dir / "0001.json"
      post_path.write_text("{}", encoding="utf-8")
      post = MODULE.ArchivePost(
        path=post_path,
        data={
          "id": "0000000000000001",
          "content": "@[Map](map://139,35,13|139,35;Missing;;;../images/missing.jpg)",
        },
      )

      with self.assertRaisesRegex(ValueError, "referenced image not found"):
        MODULE.collect_media_references(data_dir, [post])


if __name__ == "__main__":
  unittest.main()
