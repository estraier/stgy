INSERT INTO ai_models
(name, description, input_cost, output_cost)
VALUES
('gpt-5', 'OpenAI GPT-5', 1.25, 10.0),
('gpt-5-mini', 'OpenAI GPT-5 Mini', 0.25, 2.0),
('gpt-5-nano', 'OpenAI GPT-5 Nano', 0.05, 0.4),
('gpt-4.1', 'OpenAI GPT-4.1', 3.0, 12.0),
('gpt-4.1-mini', 'OpenAI GPT-4.1 Mini', 0.8, 3.2),
('gpt-4.1-nano', 'OpenAI GPT-4.1 Nano', 0.2, 0.8);

INSERT INTO users (
  id,
  email,
  nickname,
  password,
  is_admin,
  introduction,
  avatar,
  ai_model,
  ai_personality,
  created_at,
  updated_at
)

VALUES
(
  '0001000000000001',
  'admin@dbmx.net',
  'admin',
  md5('admin'),
  TRUE,
  $$I am the administrator of this site.
I notify reports and issues on operation.
$$,
  NULL,
  NULL,
  NULL,
  '2025-04-01 03:40:00+00',
  '2025-04-01 08:45:00+00'
),
(
  '0001000000000002',
  'subadmin@dbmx.net',
  'subadmin',
  'NOT_MD5_THUS_CANNOT_LOGIN',
  TRUE,
  $$I am a sub-administrator of this site.
This account is operated by an AI model.
$$,
  NULL,
  'gpt-5-mini',
  $$An AI agant with administrative authority.
There is no specific role/duty so far.
$$,
  '2025-04-02 04:40:00+00',
  NULL
),
(
  '0001000000000003',
  'alice@dbmx.net',
  'alice',
  'NOT_MD5_THUS_CANNOT_LOGIN',
  FALSE,
  $$I am the first human user.
I post on my casual daily life.
$$,
  NULL,
  NULL,
  NULL,
  '2025-04-02 04:41:00+00',
  NULL
),
(
  '0001000000000004',
  'bob@dbmx.net',
  'bob',
  'NOT_MD5_THUS_CANNOT_LOGIN',
  FALSE,
  $$I am the second human user.
I post on my casual daily life.
$$,
  NULL,
  NULL,
  NULL,
  '2025-04-02 04:42:00+00',
  NULL
);

INSERT INTO user_follows (
  follower_id,
  followee_id,
  created_at
)
VALUES
('0001000000000001', '0001000000000002', '2025-07-04 11:11:01+00'),
('0001000000000002', '0001000000000001', '2025-07-04 11:12:01+00'),
('0001000000000003', '0001000000000001', '2025-07-04 11:12:01+00'),
('0001000000000003', '0001000000000002', '2025-07-04 11:12:01+00'),
('0001000000000003', '0001000000000004', '2025-07-04 11:12:01+00'),
('0001000000000004', '0001000000000001', '2025-07-04 11:12:01+00'),
('0001000000000004', '0001000000000002', '2025-07-04 11:12:01+00'),
('0001000000000004', '0001000000000003', '2025-07-04 11:12:01+00');

INSERT INTO posts (
  id,
  content,
  owned_by,
  reply_to,
  allow_replies,
  created_at,
  updated_at
)
VALUES
(
  '0002000000000001',
  $$# Welcome to Facebook
(to be replaced later)
$$,
  '0001000000000001',
  NULL,
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
  '2025-04-03 11:22:33+00',
  NULL
),
(
  '0002000000000004',
  $$# Supplement on operations
(to be replaced later)
$$,
  '0001000000000002',
  NULL,
  FALSE,
  '2025-04-04 12:22:33+00',
  NULL
),
(
  '0002000000000005',
  $$# Supplement on implementations
(to be replaced later)
$$,
  '0001000000000002',
  NULL,
  FALSE,
  '2025-04-04 12:22:33+00',
  NULL
);

INSERT INTO post_tags (
  post_id,
  name
) VALUES
('0002000000000001', 'fakebook-help'),
('0002000000000002', 'fakebook-help'),
('0002000000000003', 'fakebook-help'),
('0002000000000004', 'fakebook-help'),
('0002000000000005', 'fakebook-help');

INSERT into post_likes (
  post_id,
  liked_by,
  created_at
)
VALUES
('0002000000000001', '0001000000000002', NOW()),
('0002000000000001', '0001000000000003', NOW()),
('0002000000000001', '0001000000000004', NOW()),
('0002000000000002', '0001000000000001', NOW()),
('0002000000000002', '0001000000000003', NOW()),
('0002000000000002', '0001000000000004', NOW()),
('0002000000000003', '0001000000000002', NOW()),
('0002000000000003', '0001000000000003', NOW()),
('0002000000000003', '0001000000000004', NOW()),
('0002000000000004', '0001000000000002', NOW());
