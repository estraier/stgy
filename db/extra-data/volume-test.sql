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
  '0001000000000101',
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
  '0001000000000102',
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
  '0002000000000101',
  'taroの投稿その1',
  '0001000000000101',
  NULL,
  '2025-05-11 01:00:00+00',
  NULL
),
(
  '0002000000000102',
  'taroの投稿その2',
  '0001000000000101',
  NULL,
  '2025-05-11 02:00:00+00',
  '2025-05-11 03:00:00+00'
),
(
  '0002000000000103',
  'jiroの投稿',
  '0001000000000102',
  NULL,
  '2025-05-11 03:00:00+00',
  NULL
),
(
  '0002000000000104',
  'jiroの自己返信',
  '0001000000000102',
  '0002000000000103',
  '2025-05-11 04:00:00+00',
  '2025-05-11 05:00:00+00'
);

DO $$
DECLARE
  i integer;
  uid text;
  pid1 text;
  pid2 text;
  tag1 text;
  tag2 text;
BEGIN
  FOR i IN 1..150 LOOP
    uid := '00011' || lpad(i::text, 11, '0');
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
    pid1 := '0002' || lpad((10000 + i * 2 - 1)::text, 12, '0');
    pid2 := '0002' || lpad((10000 + i * 2)::text, 12, '0');
    INSERT INTO posts (id, content, owned_by, reply_to, created_at, updated_at) VALUES
      (pid1, 'user' || i || 'の投稿1', uid, NULL, now(), NULL),
      (pid2, 'user' || i || 'の投稿2', uid, NULL, now(), NULL);
    INSERT INTO post_likes (post_id, liked_by, created_at) VALUES
      (pid1, '0001000000000101', now());
    INSERT INTO posts (id, content, owned_by, reply_to, created_at, updated_at) VALUES
      ('0002' || lpad((20000 + i)::text, 12, '0'), 'taroの返信 to user' || i || 'の投稿2', '0001000000000101', pid2, now(), NULL);
    INSERT INTO post_likes (post_id, liked_by, created_at) VALUES
      ('0002000000000101', uid, now());
    INSERT INTO posts (id, content, owned_by, reply_to, created_at) VALUES
      ('0002' || lpad((30000 + i)::text, 12, '0'), 'user' || i || 'からtaro投稿2への返信', uid, '0002000000000102', now());
    INSERT INTO user_follows (follower_id, followee_id, created_at) VALUES
      ('0001000000000101', uid, now()),
      (uid, '0001000000000101', now());
    tag1 := 'tagA' || (i % 7 + 1)::text;
    tag2 := 'tagB' || (i % 11 + 1)::text;
    INSERT INTO post_tags (post_id, name) VALUES
      (pid1, tag1), (pid1, tag2), (pid2, tag1), (pid2, tag2);
  END LOOP;
END $$;

DO $$
DECLARE
  i integer;
  pid text;
  tag1 text;
  tag2 text;
BEGIN
  FOR i IN 1..150 LOOP
    pid := '00021' || lpad(i::text, 11, '0');
    INSERT INTO posts (id, content, owned_by, reply_to, created_at, updated_at) VALUES
      (pid, 'taroのつぶやき' || i, '0001000000000101', NULL, now(), NULL);
    tag1 := 'tagA' || (i % 7 + 1)::text;
    tag2 := 'tagB' || (i % 11 + 1)::text;
    INSERT INTO post_tags (post_id, name) VALUES
      (pid, tag1), (pid, tag2);
  END LOOP;
END $$;
