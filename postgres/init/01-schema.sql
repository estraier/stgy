CREATE EXTENSION IF NOT EXISTS pageinspect;
SELECT current_database() AS db \gset
ALTER DATABASE :"db" SET default_toast_compression = 'lz4';
ALTER SYSTEM SET timezone = 'UTC';

CREATE TABLE ai_models (
  label VARCHAR(50) PRIMARY KEY,
  service VARCHAR(50) NOT NULL,
  name VARCHAR(50) NOT NULL
);

CREATE TABLE users (
  id BIGINT PRIMARY KEY,
  updated_at TIMESTAMPTZ,
  snippet VARCHAR(4096) NOT NULL,
  nickname VARCHAR(50) NOT NULL,
  avatar VARCHAR(100),
  locale VARCHAR(50) NOT NULL,
  timezone VARCHAR(50) NOT NULL,
  ai_model VARCHAR(50) REFERENCES ai_models(label) ON DELETE SET NULL,
  is_admin BOOLEAN NOT NULL,
  block_strangers BOOLEAN NOT NULL
);
CREATE INDEX idx_users_nickname_id ON users(LOWER(nickname) text_pattern_ops, id);
CREATE INDEX idx_users_ai_id ON users (id) WHERE ai_model IS NOT NULL;

CREATE TABLE user_secrets (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(100) NOT NULL UNIQUE,
  password BYTEA NOT NULL
);

CREATE TABLE user_details (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  introduction VARCHAR(65535) NOT NULL,
  ai_personality VARCHAR(65535)
);

CREATE TABLE user_follows (
  follower_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX idx_user_follows_follower_created_at ON user_follows (follower_id, created_at);
CREATE INDEX idx_user_follows_followee_created_at ON user_follows (followee_id, created_at);

CREATE TABLE user_blocks (
  blocker_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blockee_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (blocker_id, blockee_id)
);
CREATE INDEX idx_user_blocks_blocker_created_at ON user_blocks (blocker_id, created_at);
CREATE INDEX idx_user_blocks_blockee_created_at ON user_blocks (blockee_id, created_at);

CREATE TABLE user_pub_configs (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  site_name VARCHAR(50) NOT NULL DEFAULT '',
  subtitle VARCHAR(50) NOT NULL DEFAULT '',
  author VARCHAR(50) NOT NULL DEFAULT '',
  introduction VARCHAR(1000) NOT NULL DEFAULT '',
  design_theme VARCHAR(50) NOT NULL DEFAULT '',
  show_service_header BOOLEAN NOT NULL DEFAULT TRUE,
  show_site_name BOOLEAN NOT NULL DEFAULT TRUE,
  show_pagenation BOOLEAN NOT NULL DEFAULT TRUE,
  show_side_profile BOOLEAN NOT NULL DEFAULT TRUE,
  show_side_recent BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE posts (
  id BIGINT PRIMARY KEY,
  owned_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reply_to BIGINT,
  published_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  snippet VARCHAR(4096) NOT NULL,
  locale VARCHAR(50),
  allow_likes BOOLEAN NOT NULL,
  allow_replies BOOLEAN NOT NULL
);
CREATE INDEX idx_posts_owned_by_id ON posts(owned_by, id);
CREATE INDEX idx_posts_reply_to_id ON posts(reply_to, id);
CREATE INDEX idx_posts_root_id ON posts (id) WHERE reply_to IS NULL;
CREATE INDEX idx_posts_root_owned_by_id ON posts (owned_by, id) WHERE reply_to IS NULL;
CREATE INDEX idx_posts_public_owned_by_published_at ON posts (owned_by, published_at) WHERE published_at IS NOT NULL;

CREATE OR REPLACE FUNCTION posts_reply_to_exists_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.reply_to IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM posts WHERE id = NEW.reply_to) THEN
    RAISE EXCEPTION 'reply_to % does not exist', NEW.reply_to;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER posts_reply_to_exists
AFTER INSERT OR UPDATE OF reply_to ON posts
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION posts_reply_to_exists_fn();

CREATE TABLE post_details (
  post_id BIGINT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  content VARCHAR(65535) NOT NULL
);

CREATE TABLE post_tags (
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL,
  is_root BOOLEAN NOT NULL,
  PRIMARY KEY (post_id, name)
);
CREATE INDEX idx_post_tags_name_post_id ON post_tags(name, post_id);
CREATE INDEX idx_post_tags_root_name_post_id ON post_tags(name, post_id) WHERE is_root;

CREATE TABLE post_likes (
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  liked_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (post_id, liked_by)
);
CREATE INDEX idx_post_likes_post_id_created_at ON post_likes(post_id, created_at);
CREATE INDEX idx_post_likes_liked_by_created_at ON post_likes(liked_by, created_at);

CREATE TABLE ai_post_summaries (
  post_id BIGINT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  summary VARCHAR(65535),
  features BYTEA
);
CREATE INDEX idx_ai_post_summaries_empty ON ai_post_summaries (post_id) WHERE summary IS NULL;

CREATE TABLE ai_post_tags (
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL,
  PRIMARY KEY (post_id, name)
);
CREATE INDEX idx_ai_post_tags_name_post_id ON ai_post_tags(name, post_id);

CREATE TABLE ai_actions (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  done_at TIMESTAMPTZ NOT NULL,
  action VARCHAR(65535) NOT NULL
);
CREATE INDEX idx_ai_actions_user_id_done_at ON ai_actions(user_id, done_at);
CREATE INDEX idx_ai_actions_done_at ON ai_actions(done_at);

CREATE TABLE ai_interests (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload VARCHAR(65535) NOT NULL
);

CREATE TABLE ai_peer_impressions (
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  peer_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  payload VARCHAR(65535) NOT NULL,
  PRIMARY KEY (user_id, peer_id)
);
CREATE INDEX idx_ai_peer_impressions_peer_id ON ai_peer_impressions(peer_id);

CREATE TABLE ai_post_impressions (
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  peer_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,
  payload VARCHAR(65535) NOT NULL,
  PRIMARY KEY (user_id, peer_id, post_id)
);
CREATE INDEX idx_ai_post_impressions_post_id_user_id ON ai_post_impressions(post_id, user_id);

CREATE TABLE event_logs (
  partition_id SMALLINT NOT NULL,
  event_id BIGINT NOT NULL,
  payload VARCHAR(65535) NOT NULL,
  PRIMARY KEY (partition_id, event_id)
);
CREATE INDEX event_logs_event_id_hash ON event_logs USING HASH (event_id);

CREATE TABLE event_log_cursors (
  consumer VARCHAR(50) NOT NULL,
  partition_id SMALLINT NOT NULL,
  last_event_id BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, partition_id)
);

CREATE TABLE notifications (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot VARCHAR(50) NOT NULL,
  term VARCHAR(50) NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  payload VARCHAR(65535) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, slot, term)
) PARTITION BY HASH (user_id);
CREATE INDEX idx_notifications_user_read_ts ON notifications(user_id, is_read, updated_at);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);

DO $$
DECLARE
  parts int := 8;
  i int;
BEGIN
  FOR i IN 0..parts-1 LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
         FOR VALUES WITH (MODULUS %s, REMAINDER %s);',
      'notifications_p' || i, 'notifications', parts, i
    );
    EXECUTE format(
      'ALTER TABLE %I SET (
         fillfactor=75,
         autovacuum_vacuum_scale_factor=0.1, autovacuum_vacuum_threshold=1000,
         autovacuum_analyze_scale_factor=0.3, autovacuum_analyze_threshold=1000
       );',
      'notifications_p' || i
    );
  END LOOP;
END$$;

CREATE TABLE user_counts (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  follower_count INT NOT NULL DEFAULT 0,
  followee_count INT NOT NULL DEFAULT 0,
  post_count INT NOT NULL DEFAULT 0
);
ALTER TABLE user_counts
  SET (fillfactor=75,
       autovacuum_vacuum_scale_factor=0.1, autovacuum_vacuum_threshold=1000,
       autovacuum_analyze_scale_factor=0.3, autovacuum_analyze_threshold=1000);

CREATE TABLE post_counts (
  post_id BIGINT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  like_count INT NOT NULL DEFAULT 0,
  reply_count INT NOT NULL DEFAULT 0
) PARTITION BY HASH (post_id);

DO $$
DECLARE
  parts int := 8;
  i int;
BEGIN
  FOR i IN 0..parts-1 LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
         FOR VALUES WITH (MODULUS %s, REMAINDER %s);',
      'post_counts_p' || i, 'post_counts', parts, i
    );
    EXECUTE format(
      'ALTER TABLE %I SET (
         fillfactor=75,
         autovacuum_vacuum_scale_factor=0.1, autovacuum_vacuum_threshold=1000,
         autovacuum_analyze_scale_factor=0.3, autovacuum_analyze_threshold=1000
       );',
      'post_counts_p' || i
    );
  END LOOP;
END$$;

CREATE OR REPLACE FUNCTION trg_user_follows_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO user_counts (user_id, followee_count) VALUES (NEW.follower_id, 1)
      ON CONFLICT (user_id) DO UPDATE SET followee_count = user_counts.followee_count + 1;
    INSERT INTO user_counts (user_id, follower_count) VALUES (NEW.followee_id, 1)
      ON CONFLICT (user_id) DO UPDATE SET follower_count = user_counts.follower_count + 1;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE user_counts SET followee_count = GREATEST(followee_count - 1, 0) WHERE user_id = OLD.follower_id;
    UPDATE user_counts SET follower_count = GREATEST(follower_count - 1, 0) WHERE user_id = OLD.followee_id;
    DELETE FROM user_counts WHERE user_id = OLD.follower_id AND follower_count = 0 AND followee_count = 0 AND post_count = 0;
    DELETE FROM user_counts WHERE user_id = OLD.followee_id AND follower_count = 0 AND followee_count = 0 AND post_count = 0;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_follows_counts_ins
AFTER INSERT ON user_follows
FOR EACH ROW EXECUTE FUNCTION trg_user_follows_counts();

CREATE TRIGGER trg_user_follows_counts_del
AFTER DELETE ON user_follows
FOR EACH ROW EXECUTE FUNCTION trg_user_follows_counts();

CREATE OR REPLACE FUNCTION trg_user_post_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO user_counts (user_id, post_count) VALUES (NEW.owned_by, 1)
      ON CONFLICT (user_id) DO UPDATE SET post_count = user_counts.post_count + 1;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE user_counts SET post_count = GREATEST(post_count - 1, 0) WHERE user_id = OLD.owned_by;
    DELETE FROM user_counts WHERE user_id = OLD.owned_by AND follower_count = 0 AND followee_count = 0 AND post_count = 0;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.owned_by <> OLD.owned_by THEN
      UPDATE user_counts SET post_count = GREATEST(post_count - 1, 0) WHERE user_id = OLD.owned_by;
      DELETE FROM user_counts WHERE user_id = OLD.owned_by AND follower_count = 0 AND followee_count = 0 AND post_count = 0;
      INSERT INTO user_counts (user_id, post_count) VALUES (NEW.owned_by, 1)
        ON CONFLICT (user_id) DO UPDATE SET post_count = user_counts.post_count + 1;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_post_counts_ins
AFTER INSERT ON posts
FOR EACH ROW EXECUTE FUNCTION trg_user_post_counts();

CREATE TRIGGER trg_user_post_counts_del
AFTER DELETE ON posts
FOR EACH ROW EXECUTE FUNCTION trg_user_post_counts();

CREATE TRIGGER trg_user_post_counts_upd
AFTER UPDATE OF owned_by ON posts
FOR EACH ROW EXECUTE FUNCTION trg_user_post_counts();

CREATE OR REPLACE FUNCTION trg_post_like_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO post_counts (post_id, like_count) VALUES (NEW.post_id, 1)
      ON CONFLICT (post_id) DO UPDATE SET like_count = post_counts.like_count + 1;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE post_counts SET like_count = GREATEST(like_count - 1, 0) WHERE post_id = OLD.post_id;
    DELETE FROM post_counts WHERE post_id = OLD.post_id AND like_count = 0 AND reply_count = 0;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_post_like_counts_ins
AFTER INSERT ON post_likes
FOR EACH ROW EXECUTE FUNCTION trg_post_like_counts();

CREATE TRIGGER trg_post_like_counts_del
AFTER DELETE ON post_likes
FOR EACH ROW EXECUTE FUNCTION trg_post_like_counts();

CREATE OR REPLACE FUNCTION trg_post_reply_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.reply_to IS NOT NULL THEN
      INSERT INTO post_counts (post_id, reply_count) VALUES (NEW.reply_to, 1)
        ON CONFLICT (post_id) DO UPDATE SET reply_count = post_counts.reply_count + 1;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.reply_to IS NOT NULL THEN
      UPDATE post_counts SET reply_count = GREATEST(reply_count - 1, 0) WHERE post_id = OLD.reply_to;
      DELETE FROM post_counts WHERE post_id = OLD.reply_to AND like_count = 0 AND reply_count = 0;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.reply_to IS DISTINCT FROM OLD.reply_to THEN
      IF OLD.reply_to IS NOT NULL THEN
        UPDATE post_counts SET reply_count = GREATEST(reply_count - 1, 0) WHERE post_id = OLD.reply_to;
        DELETE FROM post_counts WHERE post_id = OLD.reply_to AND like_count = 0 AND reply_count = 0;
      END IF;
      IF NEW.reply_to IS NOT NULL THEN
        INSERT INTO post_counts (post_id, reply_count) VALUES (NEW.reply_to, 1)
          ON CONFLICT (post_id) DO UPDATE SET reply_count = post_counts.reply_count + 1;
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_post_reply_counts_ins
AFTER INSERT ON posts
FOR EACH ROW EXECUTE FUNCTION trg_post_reply_counts();

CREATE TRIGGER trg_post_reply_counts_del
AFTER DELETE ON posts
FOR EACH ROW EXECUTE FUNCTION trg_post_reply_counts();

CREATE TRIGGER trg_post_reply_counts_upd
AFTER UPDATE OF reply_to ON posts
FOR EACH ROW EXECUTE FUNCTION trg_post_reply_counts();

CREATE OR REPLACE FUNCTION id_to_timestamp(id BIGINT)
RETURNS timestamptz
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT timestamptz 'epoch' + (id >> 20) * interval '1 millisecond';
$$;

CREATE OR REPLACE FUNCTION timestamp_to_id_min(ts timestamptz)
RETURNS bigint
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT ceil(EXTRACT(EPOCH FROM ts) * 1000.0)::bigint << 20;
$$;

CREATE OR REPLACE FUNCTION timestamp_to_id_max(ts timestamptz)
RETURNS bigint
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT ((floor(EXTRACT(EPOCH FROM ts) * 1000.0)::bigint + 1) << 20) - 1;
$$;
