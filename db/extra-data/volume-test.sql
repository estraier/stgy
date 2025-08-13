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
  '00000000-0000-0000-0001-000000000101',
  'taro@example.com',
  'taro',
  md5('taro'),
  FALSE,
  'volume test user',
  NULL,
  NULL,
  NULL,
  '2025-05-11 00:00:00+00',
  NULL
),
(
  '00000000-0000-0000-0001-000000000102',
  'jiro@example.com',
  'jiro',
  md5('jiro'),
  TRUE,
  'sub admin user',
  NULL,
  NULL,
  NULL,
  '2025-05-12 00:00:00+00',
  '2025-05-12 01:00:00+00'
);

INSERT INTO posts (
  id,
  content,
  owned_by,
  reply_to,
  created_at,
  updated_at
)
VALUES
(
  '00000000-0000-0000-0002-000000000101',
  'taroの投稿その1',
  '00000000-0000-0000-0001-000000000101',
  NULL,
  '2025-05-11 01:00:00+00',
  NULL
),
(
  '00000000-0000-0000-0002-000000000102',
  'taroの投稿その2',
  '00000000-0000-0000-0001-000000000101',
  NULL,
  '2025-05-11 02:00:00+00',
  '2025-05-11 03:00:00+00'
),
(
  '00000000-0000-0000-0002-000000000103',
  'jiroの投稿',
  '00000000-0000-0000-0001-000000000102',
  NULL,
  '2025-05-11 03:00:00+00',
  NULL
),
(
  '00000000-0000-0000-0002-000000000104',
  'jiroの自己返信',
  '00000000-0000-0000-0001-000000000102',
  '00000000-0000-0000-0002-000000000103',
  '2025-05-11 04:00:00+00',
  '2025-05-11 05:00:00+00'
);

DO $$
DECLARE
  i integer;
  uid text;
  pid1 text;
  pid2 text;
BEGIN
  FOR i IN 1..150 LOOP
    uid := '00000000-0000-0000-0001-1' || lpad(i::text, 11, '0');
    INSERT INTO users (
      id, email, nickname, password, is_admin, introduction, avatar, ai_model, ai_personality, created_at, updated_at
    ) VALUES (
      uid,
      'user' || i || '@example.com',
      'user' || i,
      md5('user' || i),
      FALSE,
      'I am a dummy user ' || i,
      NULL,
      NULL,
      NULL,
      now(),
      NULL
    );
    pid1 := '00000000-0000-0000-0002-' || lpad((1000 + i * 2 - 1)::text, 12, '0');
    pid2 := '00000000-0000-0000-0002-' || lpad((1000 + i * 2)::text, 12, '0');
    INSERT INTO posts (id, content, owned_by, reply_to, created_at, updated_at) VALUES
      (pid1, 'user' || i || 'の投稿1', uid, NULL, now(), NULL),
      (pid2, 'user' || i || 'の投稿2', uid, NULL, now(), NULL);
    INSERT INTO post_likes (post_id, liked_by, created_at) VALUES
      (pid1, '00000000-0000-0000-0001-000000000101', now());
    INSERT INTO posts (id, content, owned_by, reply_to, created_at, updated_at) VALUES
      ('00000000-0000-0000-0002-' || lpad((2000 + i)::text, 12, '0'), 'taroの返信 to user' || i || 'の投稿2', '00000000-0000-0000-0001-000000000101', pid2, now(), NULL);
    INSERT INTO post_likes (post_id, liked_by, created_at) VALUES
      ('00000000-0000-0000-0002-000000000101', uid, now());
    INSERT INTO posts (id, content, owned_by, reply_to, created_at) VALUES
      ('00000000-0000-0000-0002-' || lpad((3000 + i)::text, 12, '0'), 'user' || i || 'からtaro投稿2への返信', uid, '00000000-0000-0000-0002-000000000102', now());
    INSERT INTO user_follows (follower_id, followee_id, created_at) VALUES
      ('00000000-0000-0000-0001-000000000101', uid, now()),
      (uid, '00000000-0000-0000-0001-000000000101', now());
  END LOOP;
END $$;

DO $$
DECLARE
  i integer;
  pid text;
BEGIN
  FOR i IN 1..150 LOOP
    pid := '00000000-0000-0000-0002-1' || lpad(i::text, 11, '0');
    INSERT INTO posts (id, content, owned_by, reply_to, created_at, updated_at) VALUES
      (pid, 'taroのつぶやき' || i, '00000000-0000-0000-0001-000000000101', NULL, now(), NULL);
  END LOOP;
END $$;
