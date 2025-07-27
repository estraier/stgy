INSERT INTO users (
  id, email, nickname, password, is_admin, introduction, personality, ai_model, created_at
) VALUES (
  '00000000-0000-0000-0001-000000000101',
  'taro@example.com', 'taro', md5('taro'), FALSE,
  'volume test user', NULL, NULL, '2025-05-11 00:00:00+00'
);

INSERT INTO posts (id, content, owned_by, reply_to, created_at) VALUES
  ('00000000-0000-0000-0002-000000000101', 'taroの投稿その1', '00000000-0000-0000-0001-000000000101', NULL, '2025-05-11 01:00:00+00'),
  ('00000000-0000-0000-0002-000000000102', 'taroの投稿その2', '00000000-0000-0000-0001-000000000101', NULL, '2025-05-11 02:00:00+00');

DO $$
DECLARE
  i integer;
  uid text;
  pid1 text;
  pid2 text;
BEGIN
  FOR i IN 1..150 LOOP
    uid := '00000000-0000-0000-0001-' || lpad(i::text, 8, '0');
    INSERT INTO users (
      id, email, nickname, password, is_admin, introduction, personality, ai_model, created_at
    ) VALUES (
      uid,
      'user' || i || '@example.com',
      'user' || i,
      md5('user' || i),
      FALSE,
      'dummy user ' || i,
      'dummy personality',
      'test',
      now()
    );
    pid1 := '00000000-0000-0000-0002-' || lpad((1000 + i * 2 - 1)::text, 8, '0');
    pid2 := '00000000-0000-0000-0002-' || lpad((1000 + i * 2)::text, 8, '0');
    INSERT INTO posts (id, content, owned_by, reply_to, created_at) VALUES
      (pid1, 'user' || i || 'の投稿1', uid, NULL, now()),
      (pid2, 'user' || i || 'の投稿2', uid, NULL, now());
    INSERT INTO post_likes (post_id, liked_by, created_at) VALUES
      (pid1, '00000000-0000-0000-0001-000000000101', now());
    INSERT INTO posts (id, content, owned_by, reply_to, created_at) VALUES
      ('00000000-0000-0000-0002-' || lpad((2000 + i)::text, 8, '0'), 'taroの返信 to user' || i || 'の投稿2', '00000000-0000-0000-0001-000000000101', pid2, now());
    INSERT INTO post_likes (post_id, liked_by, created_at) VALUES
      ('00000000-0000-0000-0002-000000000101', uid, now());
    INSERT INTO posts (id, content, owned_by, reply_to, created_at) VALUES
      ('00000000-0000-0000-0002-' || lpad((3000 + i)::text, 8, '0'), 'user' || i || 'からtaro投稿2への返信', uid, '00000000-0000-0000-0002-000000000102', now());
    INSERT INTO user_follows (follower_id, followee_id) VALUES
      ('00000000-0000-0000-0001-000000000101', uid),
      (uid, '00000000-0000-0000-0001-000000000101');
  END LOOP;
END $$;
