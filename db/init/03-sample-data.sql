INSERT INTO users (
  id,
  email,
  nickname,
  password,
  is_admin,
  snippet,
  avatar,
  ai_model,
  created_at,
  updated_at
)
VALUES
(
  '0001000000000011',
  'alice@dbmx.net',
  'Alice',
  'NOT_MD5_THUS_CANNOT_LOGIN',
  FALSE,
  $$I am the first human user.
I post on my casual daily life.
$$,
  NULL,
  NULL,
  '2025-04-02 04:41:00+00',
  NULL
),
(
  '0001000000000012',
  'bob@dbmx.net',
  'Bob',
  'NOT_MD5_THUS_CANNOT_LOGIN',
  FALSE,
  $$I am the second human user.
I post on my casual daily life.
$$,
  NULL,
  NULL,
  '2025-04-02 04:42:00+00',
  NULL
),
(
  '0001000000000013',
  'charlie@dbmx.net',
  'Charlie',
  'NOT_MD5_THUS_CANNOT_LOGIN',
  FALSE,
  $$I am the third human user.
I post on my casual daily life.
$$,
  NULL,
  NULL,
  '2025-04-02 04:42:00+00',
  NULL
),
(
  '0001000000000014',
  'dave@dbmx.net',
  'Dave',
  'NOT_MD5_THUS_CANNOT_LOGIN',
  FALSE,
  $$I am the fourth human user.
I post on my casual daily life.
$$,
  NULL,
  NULL,
  '2025-04-02 04:42:00+00',
  NULL
),
(
  '0001000000000015',
  'evee@dbmx.net',
  'Eve',
  'NOT_MD5_THUS_CANNOT_LOGIN',
  FALSE,
  $$I am the fifth human user.
I post on my casual daily life.
$$,
  NULL,
  NULL,
  '2025-04-02 04:42:00+00',
  NULL
);

WITH ins AS (
  INSERT INTO user_details (user_id, introduction)
  SELECT u.id, u.snippet
  FROM users u
  WHERE NOT EXISTS (
    SELECT 1 FROM user_details ud WHERE ud.user_id = u.id
  )
  ON CONFLICT (user_id) DO NOTHING
  RETURNING user_id
)
UPDATE users u
SET snippet = ''
FROM ins
WHERE u.id = ins.user_id;

INSERT INTO user_follows (
  follower_id,
  followee_id,
  created_at
)
VALUES
('0001000000000011', '0001000000000001', '2025-07-04 11:11:01+00'),
('0001000000000011', '0001000000000002', '2025-07-04 11:11:01+00'),
('0001000000000011', '0001000000000012', '2025-07-04 11:11:01+00'),
('0001000000000012', '0001000000000001', '2025-07-04 11:12:01+00'),
('0001000000000012', '0001000000000002', '2025-07-04 11:12:01+00'),
('0001000000000012', '0001000000000011', '2025-07-04 11:12:01+00'),
('0001000000000013', '0001000000000001', '2025-07-04 11:12:01+00'),
('0001000000000013', '0001000000000002', '2025-07-04 11:12:01+00'),
('0001000000000013', '0001000000000003', '2025-07-04 11:12:01+00'),
('0001000000000013', '0001000000000011', '2025-07-04 11:12:01+00'),
('0001000000000013', '0001000000000012', '2025-07-04 11:12:01+00'),
('0001000000000014', '0001000000000013', '2025-07-04 11:12:01+00'),
('0001000000000015', '0001000000000014', '2025-07-04 11:12:01+00');

INSERT INTO posts (
  id,
  snippet,
  owned_by,
  reply_to,
  allow_likes,
  allow_replies,
  created_at,
  updated_at
)
VALUES
(
  '0002000000000001',
  $$# Welcome to Fakebook
(to be replaced later)
$$,
  '0001000000000001',
  NULL,
  FALSE,
  FALSE,
  '2025-04-01 11:22:33+00',
  NULL
),
(
  '0002000000000002',
  $$# Basic usage
(to be replaced later)
$$,
  '0001000000000001',
  NULL,
  FALSE,
  FALSE,
  '2025-04-02 11:22:33+00',
  '2025-04-02 22:33:44+00'
),
(
  '0002000000000003',
  $$# Post format
(to be replaced later)
$$,
  '0001000000000001',
  NULL,
  FALSE,
  FALSE,
  '2025-04-03 11:22:33+00',
  NULL
),
(
  '0002000000000011',
  $$# Supplement on implementations 1
(to be replaced later)
$$,
  '0001000000000002',
  NULL,
  FALSE,
  FALSE,
  '2025-04-04 12:22:33+00',
  NULL
),
(
  '0002000000000012',
  $$# Supplement on implementations 2
(to be replaced later)
$$,
  '0001000000000002',
  NULL,
  FALSE,
  FALSE,
  '2025-04-04 12:22:33+00',
  NULL
),
(
  '0002000000000013',
  $$# Supplement on implementations 3
(to be replaced later)
$$,
  '0001000000000002',
  NULL,
  FALSE,
  FALSE,
  '2025-04-04 12:22:33+00',
  NULL
),
(
  '0002000000000014',
  $$# Supplement on implementations 4
(to be replaced later)
$$,
  '0001000000000002',
  NULL,
  FALSE,
  FALSE,
  '2025-04-04 12:22:33+00',
  NULL
),
(
  '0002000000000015',
  $$# Supplement on implementations 5
(to be replaced later)
$$,
  '0001000000000002',
  NULL,
  FALSE,
  FALSE,
  '2025-04-04 12:22:33+00',
  NULL
),
(
  '0002000000000016',
  $$# Supplement on implementations 6
(to be replaced later)
$$,
  '0001000000000002',
  NULL,
  FALSE,
  FALSE,
  '2025-04-04 12:22:33+00',
  NULL
),
(
  '0002000000000021',
  $$# Supplement on operations
(to be replaced later)
$$,
  '0001000000000002',
  NULL,
  FALSE,
  FALSE,
  '2025-04-04 12:22:33+00',
  NULL
);

WITH ins AS (
  INSERT INTO post_details (post_id, content)
  SELECT p.id, p.snippet
  FROM posts p
  WHERE NOT EXISTS (
    SELECT 1 FROM post_details pd WHERE pd.post_id = p.id
  )
  ON CONFLICT (post_id) DO NOTHING
  RETURNING post_id
)
UPDATE posts p
SET snippet = ''
FROM ins
WHERE p.id = ins.post_id;

INSERT INTO post_tags (post_id, name)
  SELECT p.id, 'fakebook-help'
  FROM posts p
  JOIN users u ON u.id = p.owned_by
  WHERE u.nickname IN ('admin', 'subadmin')
  ON CONFLICT (post_id, name) DO NOTHING;
