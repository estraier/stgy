SELECT set_config('seed.n_dummies', '1000', false);

INSERT INTO users (
  id, email, nickname, password, is_admin, introduction, avatar,
  ai_model, ai_personality, created_at, updated_at
) VALUES
(
  '9901000000000001', 'taro@example.com', 'taro', md5('taro'), FALSE,
  'volume test user', NULL, NULL, NULL, '2025-05-11 00:00:00+00', NULL
),
(
  '9901000000000002', 'jiro@example.com', 'jiro', md5('jiro'), TRUE,
  'sub admin user', NULL, NULL, NULL, '2025-05-12 00:00:00+00', '2025-05-12 01:00:00+00'
);

INSERT INTO posts (
  id, snippet, owned_by, reply_to, allow_likes, allow_replies, created_at, updated_at
) VALUES
(
  '9902000000000001', 'the first post by taro', '9901000000000001',
  NULL, TRUE, TRUE, '2025-05-11 01:00:00+00', NULL
),
(
  '9902000000000002', 'the second post by taro', '9901000000000001',
  NULL, TRUE, TRUE, '2025-05-11 02:00:00+00', '2025-05-11 03:00:00+00'
),
(
  '9902000000000003', 'a post by jiro', '9901000000000002',
  NULL, TRUE, TRUE, '2025-05-11 03:00:00+00', NULL
),
(
  '9902000000000004', 'a self-reply by jiro', '9901000000000002',
  '9902000000000003', TRUE, TRUE, '2025-05-11 04:00:00+00', '2025-05-11 05:00:00+00'
);

DO $$
DECLARE
  n      int := current_setting('seed.n_dummies')::int;
  i      int;
  uid    text;
  pid1   text;
  pid2   text;
  rid_t  text;
  rid_u  text;
  tag1   text;
  tag2   text;
  taro   constant text := '9901000000000001';
BEGIN
  FOR i IN 1..n LOOP
    uid  := '99011' || lpad(i::text, 11, '0');
    INSERT INTO users (
      id, email, nickname, password, is_admin, introduction, avatar,
      ai_model, ai_personality, created_at, updated_at
    ) VALUES (
      uid,
      'user' || i || '@example.com',
      'user' || i,
      md5('user' || i),
      FALSE,
      'I am a dummy user ' || i,
      NULL, NULL, NULL, now(), NULL
    )
    ON CONFLICT (id) DO NOTHING;

    pid1 := '99021' || lpad(i::text, 11, '0');
    pid2 := '99022' || lpad(i::text, 11, '0');
    INSERT INTO posts (id, snippet, owned_by, reply_to, allow_likes, allow_replies, created_at, updated_at) VALUES
      (pid1, 'user' || i || ' - post 1', uid, NULL, TRUE, TRUE, now(), NULL),
      (pid2, 'user' || i || ' - post 2', uid, NULL, TRUE, TRUE, now(), NULL)
    ON CONFLICT (id) DO NOTHING;

    rid_t := '99023' || lpad(i::text, 11, '0');
    INSERT INTO posts (id, snippet, owned_by, reply_to, allow_likes, allow_replies, created_at, updated_at)
    VALUES (rid_t, 'taro replies to user' || i, taro, pid2, TRUE, TRUE, now(), NULL)
    ON CONFLICT (id) DO NOTHING;

    rid_u := '99024' || lpad(i::text, 11, '0');
    INSERT INTO posts (id, snippet, owned_by, reply_to, allow_likes, allow_replies, created_at, updated_at)
    VALUES (rid_u, 'user' || i || ' replies to taro post 2', uid, '9902000000000002', TRUE, TRUE, now(), NULL)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO post_likes (post_id, liked_by, created_at) VALUES
      (pid1, taro, now())
    ON CONFLICT DO NOTHING;

    INSERT INTO post_likes (post_id, liked_by, created_at) VALUES
      ('9902000000000001', uid, now())
    ON CONFLICT DO NOTHING;

    INSERT INTO user_follows (follower_id, followee_id, created_at) VALUES
      (taro, uid, now()),
      (uid, taro, now())
    ON CONFLICT DO NOTHING;

    tag1 := 'tagA' || ((i % 7) + 1)::text;
    tag2 := 'tagB' || ((i % 11) + 1)::text;
    INSERT INTO post_tags (post_id, name) VALUES
      (pid1, tag1), (pid1, tag2), (pid2, tag1), (pid2, tag2)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

DO $$
DECLARE
  n    int := current_setting('seed.n_dummies')::int;
  i    int;
  pid  text;
  tag1 text;
  tag2 text;
BEGIN
  FOR i IN 1..n LOOP
    pid  := '99025' || lpad(i::text, 11, '0');
    INSERT INTO posts (id, snippet, owned_by, reply_to, allow_likes, allow_replies, created_at, updated_at)
    VALUES (pid, 'taro tweets ' || i, '9901000000000001', NULL, TRUE, TRUE, now(), NULL)
    ON CONFLICT (id) DO NOTHING;

    tag1 := 'tagA' || ((i % 7) + 1)::text;
    tag2 := 'tagB' || ((i % 11) + 1)::text;
    INSERT INTO post_tags (post_id, name) VALUES (pid, tag1), (pid, tag2)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

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

DO $$
DECLARE
  n        int := current_setting('seed.n_dummies')::int;
  i        int;
  j        int;
  k        int;
  follower text;
  followee text;
BEGIN
  FOR i IN 1..n LOOP
    follower := '99011' || lpad(i::text, 11, '0');
    FOR j IN 1..10 LOOP
      k := ((i - 1 + j) % n) + 1;
      followee := '99011' || lpad(k::text, 11, '0');
      INSERT INTO user_follows (follower_id, followee_id, created_at)
      VALUES (follower, followee, now())
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;
