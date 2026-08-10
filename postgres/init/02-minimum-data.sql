INSERT INTO ai_models
(label, service, chat_model, feature_model)
VALUES
('advanced', 'openai', 'gpt-5.6-sol', 'text-embedding-3-small'),
('balanced', 'openai', 'gpt-5.6-terra', 'text-embedding-3-small'),
('basic', 'openai', 'gpt-5.6-luna', 'text-embedding-3-small');

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
  $$[{"T":"h1","X":"Welcome to STGY"},{"T":"p","X":"Placeholder for the English version. The full text will be written later."}]$$,
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
  $$[{"T":"h1","X":"STGY Help"},{"T":"p","X":"Placeholder for the English version. The full text will be written later."}]$$,
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
  $$[{"T":"h1","X":"STGY Markdown Formatting"},{"T":"p","X":"Placeholder for the English version. The full text will be written later."}]$$,
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
  $$# Welcome to STGY

Placeholder for the English version. The full text will be written later.
$$
),
(
  0x0000000000010002,
  $$# STGY Help

Placeholder for the English version. The full text will be written later.
$$
),
(
  0x0000000000010003,
  $$# STGY Markdown Formatting

Placeholder for the English version. The full text will be written later.
$$
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
