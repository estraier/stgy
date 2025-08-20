-- configurable dummy user count (works across DO blocks in this session)
SELECT set_config('seed.n_dummies', '1000', false);  -- ←必要に応じて 10000 等に変更

-- === fixed users (IDs do not collide with dummy range) ===
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

-- initial posts for taro/jiro (unique, non-overlapping with dummy posts)
INSERT INTO posts (
  id, content, owned_by, reply_to, allow_likes, allow_replies, created_at, updated_at
) VALUES
(
  '9902000000000001', 'taroの投稿その1', '9901000000000001',
  NULL, TRUE, TRUE, '2025-05-11 01:00:00+00', NULL
),
(
  '9902000000000002', 'taroの投稿その2', '9901000000000001',
  NULL, TRUE, TRUE, '2025-05-11 02:00:00+00', '2025-05-11 03:00:00+00'
),
(
  '9902000000000003', 'jiroの投稿', '9901000000000002',
  NULL, TRUE, TRUE, '2025-05-11 03:00:00+00', NULL
),
(
  '9902000000000004', 'jiroの自己返信', '9901000000000002',
  '9902000000000003', TRUE, TRUE, '2025-05-11 04:00:00+00', '2025-05-11 05:00:00+00'
);

-- === dummy users & their posts/likes/replies/follows/tags ===
DO $$
DECLARE
  n      int := current_setting('seed.n_dummies')::int;
  i      int;
  uid    text;
  pid1   text;  -- user i post #1
  pid2   text;  -- user i post #2
  rid_t  text;  -- taro's reply to user i post #2
  rid_u  text;  -- user i reply to taro's post #2
  tag1   text;
  tag2   text;
  taro   constant text := '9901000000000001';
BEGIN
  FOR i IN 1..n LOOP
    uid  := '99011' || lpad(i::text, 11, '0');          -- dummy user IDs: 00011***********
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

    -- two root posts per user (distinct ranges)
    pid1 := '99021' || lpad(i::text, 11, '0');          -- 00021***********
    pid2 := '99022' || lpad(i::text, 11, '0');          -- 00022***********
    INSERT INTO posts (id, content, owned_by, reply_to, allow_likes, allow_replies, created_at, updated_at) VALUES
      (pid1, 'user' || i || 'の投稿1', uid, NULL, TRUE, TRUE, now(), NULL),
      (pid2, 'user' || i || 'の投稿2', uid, NULL, TRUE, TRUE, now(), NULL)
    ON CONFLICT (id) DO NOTHING;

    -- taro replies to user's 2nd post
    rid_t := '99023' || lpad(i::text, 11, '0');         -- 00023***********
    INSERT INTO posts (id, content, owned_by, reply_to, allow_likes, allow_replies, created_at, updated_at)
    VALUES (rid_t, 'taroの返信 to user' || i || 'の投稿2', taro, pid2, TRUE, TRUE, now(), NULL)
    ON CONFLICT (id) DO NOTHING;

    -- user replies to taro's 2nd post
    rid_u := '99024' || lpad(i::text, 11, '0');         -- 00024***********
    INSERT INTO posts (id, content, owned_by, reply_to, allow_likes, allow_replies, created_at, updated_at)
    VALUES (rid_u, 'user' || i || 'からtaro投稿2への返信', uid, '9902000000000002', TRUE, TRUE, now(), NULL)
    ON CONFLICT (id) DO NOTHING;

    -- likes (dedup-safe)
    INSERT INTO post_likes (post_id, liked_by, created_at) VALUES
      (pid1, taro, now())                                   -- taro likes user's post1
    ON CONFLICT DO NOTHING;

    INSERT INTO post_likes (post_id, liked_by, created_at) VALUES
      ('9902000000000001', uid, now())                      -- user likes taro's post1
    ON CONFLICT DO NOTHING;

    -- mutual follow between taro and the user
    INSERT INTO user_follows (follower_id, followee_id, created_at) VALUES
      (taro, uid, now()),
      (uid, taro, now())
    ON CONFLICT DO NOTHING;

    -- tags for user's two root posts
    tag1 := 'tagA' || ((i % 7) + 1)::text;
    tag2 := 'tagB' || ((i % 11) + 1)::text;
    INSERT INTO post_tags (post_id, name) VALUES
      (pid1, tag1), (pid1, tag2), (pid2, tag1), (pid2, tag2)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- === taro's additional N tweets (tagged) ===
DO $$
DECLARE
  n    int := current_setting('seed.n_dummies')::int;
  i    int;
  pid  text;     -- taro tweet id
  tag1 text;
  tag2 text;
BEGIN
  FOR i IN 1..n LOOP
    pid  := '99025' || lpad(i::text, 11, '0');              -- 00025***********
    INSERT INTO posts (id, content, owned_by, reply_to, allow_likes, allow_replies, created_at, updated_at)
    VALUES (pid, 'taroのつぶやき' || i, '9901000000000001', NULL, TRUE, TRUE, now(), NULL)
    ON CONFLICT (id) DO NOTHING;

    tag1 := 'tagA' || ((i % 7) + 1)::text;
    tag2 := 'tagB' || ((i % 11) + 1)::text;
    INSERT INTO post_tags (post_id, name) VALUES (pid, tag1), (pid, tag2)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- === ring follows: each dummy user follows next 10 users (wrap-around) ===
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
