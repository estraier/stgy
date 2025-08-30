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
  snippet,
  avatar,
  ai_model,
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
  '2025-04-01 03:40:00+00',
  '2025-04-01 08:45:00+00'
),
(
  '0001000000000002',
  'subadmin@dbmx.net',
  'subadmin',
  'NOT_MD5_THUS_CANNOT_LOGIN',
  TRUE,
  $$I am the sub-administrator of this site.
I provide technical information.
$$,
  NULL,
  NULL,
  '2025-04-02 04:40:00+00',
  NULL
),
(
  '0001000000000003',
  'ai-admin@dbmx.net',
  'AI admin',
  'NOT_MD5_THUS_CANNOT_LOGIN',
  TRUE,
  $$I am the AI administrator of this site.
There is no specific role/duty so far.
$$,
  NULL,
  'gpt-5-mini',
  '2025-04-02 04:40:00+00',
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

UPDATE user_details
SET ai_personality = 'Diligent to crawl around the site to keep it safe.'
WHERE user_id = '0001000000000003';

INSERT INTO user_follows (
  follower_id,
  followee_id,
  created_at
)
VALUES
('0001000000000001', '0001000000000002', '2025-07-04 11:11:01+00'),
('0001000000000001', '0001000000000003', '2025-07-04 11:12:01+00'),
('0001000000000001', '0001000000000001', '2025-07-04 11:12:01+00'),
('0001000000000002', '0001000000000001', '2025-07-04 11:12:01+00'),
('0001000000000002', '0001000000000003', '2025-07-04 11:12:01+00'),
('0001000000000003', '0001000000000001', '2025-07-04 11:12:01+00');
