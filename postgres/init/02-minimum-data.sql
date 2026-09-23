INSERT INTO users (
  id,
  updated_at,
  nickname,
  avatar,
  locale,
  timezone,
  ai_model,
  snippet,
  is_admin,
  is_frozen,
  block_strangers
)
VALUES
(
  0x0000000000000001,
  '2025-04-01 08:45:00+00',
  'admin',
  NULL,
  'en-US',
  'Asia/Tokyo',
  NULL,
  $$[{"T":"p","X":"I am the administrator of this site. I post operational notices and important information."},{"T":"p","X":"Please use STGY responsibly and as intended."}]$$,
  TRUE,
  FALSE,
  FALSE
);

INSERT INTO user_secrets (
  user_id,
  email,
  password
)
VALUES
(
  0x0000000000000001,
  'admin@stgy.jp',
  decode('65d80ec850339f4f9f3a1d0b7ca185b352d3c42dffad2882d4cd768f243acd0a','hex')
);

INSERT INTO user_details (
  user_id,
  introduction,
  ai_personality
)
VALUES
(
  0x0000000000000001,
  $$I am the administrator of this site.
I post operational notices and important information.

Please use STGY responsibly and as intended.$$, 
  NULL
);

INSERT INTO posts (
  id,
  owned_by,
  reply_to,
  published_at,
  updated_at,
  locale,
  snippet,
  allow_likes,
  allow_replies
)
VALUES
(
  0x0000000000010001,
  0x0000000000000001,
  NULL,
  NULL,
  NULL,
  'en-US',
  $$[{"T":"h1","X":"Welcome to STGY"},{"T":"p","X":"Core seed content is loaded by the seeder."}]$$,
  FALSE,
  FALSE
),
(
  0x0000000000010002,
  0x0000000000000001,
  NULL,
  NULL,
  NULL,
  'en-US',
  $$[{"T":"h1","X":"Using STGY"},{"T":"p","X":"Core seed content is loaded by the seeder."}]$$,
  FALSE,
  FALSE
),
(
  0x0000000000010003,
  0x0000000000000001,
  NULL,
  NULL,
  NULL,
  'en-US',
  $$[{"T":"h1","X":"STGY post formatting"},{"T":"p","X":"Core seed content is loaded by the seeder."}]$$,
  FALSE,
  FALSE
);

INSERT INTO post_details (
  post_id,
  content
)
VALUES
(
  0x0000000000010001,
  $post$# Welcome to STGY

Core seed content is loaded by the seeder.
$post$
),
(
  0x0000000000010002,
  $post$# Using STGY

Core seed content is loaded by the seeder.
$post$
),
(
  0x0000000000010003,
  $post$# STGY post formatting

Core seed content is loaded by the seeder.
$post$
);

INSERT INTO ai_post_summaries (
  post_id,
  source_updated_at,
  summary,
  hashes,
  features
)
VALUES
(
  0x0000000000010001,
  id_to_timestamp(0x0000000000010001),
  NULL,
  NULL,
  NULL
),
(
  0x0000000000010002,
  id_to_timestamp(0x0000000000010002),
  NULL,
  NULL,
  NULL
),
(
  0x0000000000010003,
  id_to_timestamp(0x0000000000010003),
  NULL,
  NULL,
  NULL
);
