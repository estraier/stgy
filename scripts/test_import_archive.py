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
    self.assertFalse(args.id_from_date)
    self.assertTrue(
      MODULE.parse_args(["--data-dir", ".", "--id-from-date"]).id_from_date
    )
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
        "139.1,35.1;First;;;../images/first.jpg ../images/second.png|"
        "139.2,35.2;Second;;; ../images/second.png |"
        "139.3,35.3;External;;;https://example.com/one.jpg https://example.com/two.jpg)"
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
      self.assertIn(
        "139.1,35.1;First;;;/images/OWNER/masters/first.jpg "
        "/images/OWNER/masters/second.png",
        rewritten,
      )
      self.assertIn("139.2,35.2;Second;;; /images/OWNER/masters/second.png ", rewritten)
      self.assertIn(
        "https://example.com/one.jpg https://example.com/two.jpg",
        rewritten,
      )

  def test_uses_webp_when_referenced_image_is_missing(self) -> None:
    with tempfile.TemporaryDirectory() as temporary_directory:
      data_dir = Path(temporary_directory).resolve()
      posts_dir = data_dir / "posts"
      images_dir = data_dir / "images"
      posts_dir.mkdir()
      images_dir.mkdir()
      post_path = posts_dir / "0001.json"
      post_path.write_text("{}", encoding="utf-8")
      webp_image = images_dir / "photo.webp"
      webp_image.write_bytes(b"webp")
      content = (
        "![Photo](../images/photo.jpg)\n"
        "@[Map](map://139,35,13|139,35;Photo;;;../images/photo.png)"
      )
      post = MODULE.ArchivePost(
        path=post_path,
        data={"id": "0000000000000001", "content": content},
      )

      image_paths, track_paths, preview_to_master = MODULE.collect_media_references(
        data_dir,
        [post],
      )

      self.assertEqual(image_paths, (webp_image,))
      self.assertEqual(track_paths, ())
      self.assertEqual(preview_to_master, {})

      rewritten = MODULE.rewrite_embeds(
        content,
        post_path,
        data_dir,
        {webp_image: "/images/OWNER/masters/photo.webp"},
        {},
      )

      self.assertIn(
        "![Photo](/images/OWNER/masters/photo.webp)",
        rewritten,
      )
      self.assertIn(
        "139,35;Photo;;;/images/OWNER/masters/photo.webp",
        rewritten,
      )

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

  def test_reports_each_space_separated_map_pin_image_separately(self) -> None:
    with tempfile.TemporaryDirectory() as temporary_directory:
      data_dir = Path(temporary_directory).resolve()
      posts_dir = data_dir / "posts"
      images_dir = data_dir / "images"
      posts_dir.mkdir()
      images_dir.mkdir()
      post_path = posts_dir / "0001.json"
      post_path.write_text("{}", encoding="utf-8")
      existing = images_dir / "existing.jpg"
      existing.write_bytes(b"existing")
      post = MODULE.ArchivePost(
        path=post_path,
        data={
          "id": "0000000000000001",
          "content": (
            "@[Map](map://139,35,13|139,35;Two images;;;"
            "../images/existing.jpg ../images/missing.jpg)"
          ),
        },
      )

      with self.assertRaisesRegex(
        ValueError,
        r"referenced image not found: .*\.\./images/missing\.jpg$",
      ):
        MODULE.collect_media_references(data_dir, [post])

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


class ImportArchiveIdFromDateTest(unittest.TestCase):
  def test_generates_id_from_timezone_aware_created_at(self) -> None:
    self.assertEqual(
      MODULE.snowflake_id_from_created_at(
        "2026-02-16T12:00:00+09:00",
        "createdAt",
      ),
      "19C6463FB8000000",
    )
    self.assertEqual(
      MODULE.snowflake_id_from_created_at(
        "2026-02-16T03:00:00Z",
        "createdAt",
      ),
      "19C6463FB8000000",
    )

  def test_treats_timezone_less_created_at_as_utc(self) -> None:
    self.assertEqual(
      MODULE.snowflake_id_from_created_at(
        "2026-02-16T03:00:00",
        "createdAt",
      ),
      "19C6463FB8000000",
    )

  def test_import_uses_generated_user_and_post_ids_and_remaps_reply(self) -> None:
    class FakeClient:
      def __init__(self) -> None:
        self.created_users = []
        self.updated_users = []
        self.created_posts = []

      def login(self):
        return {"userIsAdmin": True}

      def get_user(self, _user_id):
        return None

      def get_post(self, _post_id):
        return None

      def create_user(self, body):
        self.created_users.append(body)
        return body

      def update_user(self, user_id, body):
        self.updated_users.append((user_id, body))
        return body

      def create_post(self, body):
        self.created_posts.append(body)
        return body

      def update_post(self, _post_id, _body):
        raise AssertionError("generated posts must not be updated")

      def upload_image(self, _owner_id, _path):
        raise AssertionError("no images expected")

      def upload_track(self, _owner_id, _path):
        raise AssertionError("no tracks expected")

      def upload_avatar(self, _owner_id, _path):
        raise AssertionError("no avatar expected")

      def update_pub_config(self, _owner_id, _body):
        raise AssertionError("no pub config expected")

    with tempfile.TemporaryDirectory() as temporary_directory:
      data_dir = Path(temporary_directory).resolve()
      posts_dir = data_dir / "posts"
      posts_dir.mkdir()
      parent = MODULE.ArchivePost(
        path=posts_dir / "parent.json",
        data={
          "id": "0000000000000010",
          "content": "parent",
          "replyTo": None,
          "createdAt": "2026-02-16T12:00:00+09:00",
          "publishedAt": None,
          "locale": "ja-JP",
          "allowLikes": True,
          "allowReplies": True,
          "tags": [],
        },
      )
      child = MODULE.ArchivePost(
        path=posts_dir / "child.json",
        data={
          "id": "0000000000000020",
          "content": "child",
          "replyTo": parent.id,
          "createdAt": "2026-02-16T12:00:00.001+09:00",
          "publishedAt": None,
          "locale": "ja-JP",
          "allowLikes": True,
          "allowReplies": True,
          "tags": [],
        },
      )
      plan = MODULE.ImportPlan(
        data_dir=data_dir,
        profile={
          "id": "0000000000000001",
          "createdAt": "2026-02-15T12:00:00+09:00",
          "email": "import@example.com",
          "nickname": "Imported",
          "isAdmin": False,
          "blockStrangers": False,
          "locale": "ja-JP",
          "timezone": "Asia/Tokyo",
          "introduction": "",
          "aiModel": None,
          "aiPersonality": None,
        },
        posts=(child, parent),
        skipped_reply_count=0,
        image_paths=(),
        track_master_paths=(),
        track_preview_to_master={},
        avatar_path=None,
        pub_config=None,
      )
      client = FakeClient()

      MODULE.import_archive(plan, client, None, False, True)

      expected_user_id = MODULE.snowflake_id_from_created_at(
        plan.profile["createdAt"],
        "createdAt",
      )
      expected_parent_id = MODULE.snowflake_id_from_created_at(
        parent.data["createdAt"],
        "createdAt",
      )
      expected_child_id = MODULE.snowflake_id_from_created_at(
        child.data["createdAt"],
        "createdAt",
      )
      self.assertEqual(client.created_users[0]["id"], expected_user_id)
      self.assertEqual(
        [post["id"] for post in client.created_posts],
        [expected_parent_id, expected_child_id],
      )
      self.assertIsNone(client.created_posts[0]["replyTo"])
      self.assertEqual(client.created_posts[1]["replyTo"], expected_parent_id)

  def test_rejects_duplicate_post_ids_generated_from_created_at(self) -> None:
    class FakeClient:
      def login(self):
        raise AssertionError("validation must fail before login")

    with tempfile.TemporaryDirectory() as temporary_directory:
      data_dir = Path(temporary_directory).resolve()
      posts_dir = data_dir / "posts"
      posts_dir.mkdir()
      common = {
        "content": "post",
        "replyTo": None,
        "createdAt": "2026-02-16T12:00:00+09:00",
        "publishedAt": None,
        "locale": "ja-JP",
        "allowLikes": True,
        "allowReplies": True,
        "tags": [],
      }
      posts = (
        MODULE.ArchivePost(
          path=posts_dir / "one.json",
          data={"id": "0000000000000010", **common},
        ),
        MODULE.ArchivePost(
          path=posts_dir / "two.json",
          data={"id": "0000000000000020", **common},
        ),
      )
      plan = MODULE.ImportPlan(
        data_dir=data_dir,
        profile={
          "id": "0000000000000001",
          "createdAt": "2026-02-15T12:00:00+09:00",
          "email": "import@example.com",
          "nickname": "Imported",
          "isAdmin": False,
          "blockStrangers": False,
          "locale": "ja-JP",
          "timezone": "Asia/Tokyo",
          "introduction": "",
          "aiModel": None,
          "aiPersonality": None,
        },
        posts=posts,
        skipped_reply_count=0,
        image_paths=(),
        track_master_paths=(),
        track_preview_to_master={},
        avatar_path=None,
        pub_config=None,
      )

      with self.assertRaisesRegex(ValueError, "duplicate post IDs generated"):
        MODULE.import_archive(plan, FakeClient(), None, False, True)


if __name__ == "__main__":
  unittest.main()
