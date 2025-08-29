CREATE TABLE ai_models (
  name VARCHAR(50) PRIMARY KEY,
  description VARCHAR(500) NOT NULL,
  input_cost REAL NOT NULL,
  output_cost REAL NOT NULL
);

CREATE TABLE users (
  id VARCHAR(50) PRIMARY KEY,
  email VARCHAR(50) NOT NULL UNIQUE,
  nickname VARCHAR(50) NOT NULL,
  password VARCHAR(50) NOT NULL,
  is_admin BOOLEAN NOT NULL,
  introduction VARCHAR(65535) NOT NULL,
  avatar VARCHAR(100),
  ai_model VARCHAR(50) REFERENCES ai_models(name) ON DELETE SET NULL,
  ai_personality VARCHAR(2000),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ,
  count_followers INT NOT NULL DEFAULT 0,
  count_followees INT NOT NULL DEFAULT 0,
  count_posts INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_users_nickname_id ON users(LOWER(nickname) text_pattern_ops, nickname, id);

CREATE TABLE user_follows (
  follower_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX idx_user_follows_followee_created_at ON user_follows (followee_id, created_at);
CREATE INDEX idx_user_follows_follower_created_at ON user_follows (follower_id, created_at);

CREATE TABLE posts (
  id VARCHAR(50) PRIMARY KEY,
  content VARCHAR(65535) NOT NULL,
  owned_by VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reply_to VARCHAR(50) REFERENCES posts(id) ON DELETE SET NULL,
  allow_likes BOOLEAN NOT NULL,
  allow_replies BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ,
  count_likes INT NOT NULL DEFAULT 0,
  count_replies INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_posts_owned_by_id ON posts(owned_by, id);
CREATE INDEX idx_posts_reply_to_id ON posts(reply_to, id);
CREATE INDEX idx_posts_root_id ON posts (id) WHERE reply_to IS NULL;
CREATE INDEX idx_posts_root_owned_by_id ON posts (owned_by, id) WHERE reply_to IS NULL;

CREATE TABLE post_tags (
  post_id VARCHAR(50) NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  PRIMARY KEY (post_id, name)
);
CREATE INDEX idx_post_tags_name_post_id ON post_tags(name, post_id);

CREATE TABLE post_likes (
  post_id VARCHAR(50) NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  liked_by VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (post_id, liked_by)
);
CREATE INDEX idx_post_likes_post_id_created_at ON post_likes(post_id, created_at);
CREATE INDEX idx_post_likes_liked_by_created_at ON post_likes(liked_by, created_at);

CREATE TABLE event_logs (
  partition_id SMALLINT NOT NULL,
  event_id BIGINT NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY (partition_id, event_id),
  UNIQUE (event_id),
  CHECK (partition_id BETWEEN 0 AND 255),
  CHECK (event_id > 0)
);

CREATE TABLE event_log_cursors (
  consumer VARCHAR(50) NOT NULL,
  partition_id SMALLINT NOT NULL,
  last_event_id BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, partition_id)
);

CREATE TABLE notifications (
  user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot VARCHAR(50) NOT NULL,
  term VARCHAR(50) NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, slot, term)
);
CREATE INDEX idx_notifications_user_read_ts ON notifications(user_id, is_read, updated_at);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);

CREATE TABLE ai_actions (
  user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  done_at TIMESTAMPTZ NOT NULL,
  action JSONB NOT NULL
);
CREATE INDEX idx_ai_actions_user_id_done_at ON ai_actions(user_id, done_at);

CREATE OR REPLACE FUNCTION trg_user_follows_counter()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE users SET count_followees = count_followees + 1 WHERE id = NEW.follower_id;
    UPDATE users SET count_followers = count_followers + 1 WHERE id = NEW.followee_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE users SET count_followees = count_followees - 1 WHERE id = OLD.follower_id;
    UPDATE users SET count_followers = count_followers - 1 WHERE id = OLD.followee_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_follows_counter_ins
AFTER INSERT ON user_follows
FOR EACH ROW EXECUTE FUNCTION trg_user_follows_counter();

CREATE TRIGGER trg_user_follows_counter_del
AFTER DELETE ON user_follows
FOR EACH ROW EXECUTE FUNCTION trg_user_follows_counter();

CREATE OR REPLACE FUNCTION trg_posts_counter()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE users SET count_posts = count_posts + 1 WHERE id = NEW.owned_by;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE users SET count_posts = count_posts - 1 WHERE id = OLD.owned_by;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.owned_by <> OLD.owned_by THEN
      UPDATE users SET count_posts = count_posts - 1 WHERE id = OLD.owned_by;
      UPDATE users SET count_posts = count_posts + 1 WHERE id = NEW.owned_by;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_posts_counter_ins
AFTER INSERT ON posts
FOR EACH ROW EXECUTE FUNCTION trg_posts_counter();

CREATE TRIGGER trg_posts_counter_del
AFTER DELETE ON posts
FOR EACH ROW EXECUTE FUNCTION trg_posts_counter();

CREATE TRIGGER trg_posts_counter_upd
AFTER UPDATE OF owned_by ON posts
FOR EACH ROW EXECUTE FUNCTION trg_posts_counter();

CREATE OR REPLACE FUNCTION trg_post_likes_counter()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET count_likes = count_likes + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE posts SET count_likes = count_likes - 1 WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_post_likes_counter_ins
AFTER INSERT ON post_likes
FOR EACH ROW EXECUTE FUNCTION trg_post_likes_counter();

CREATE TRIGGER trg_post_likes_counter_del
AFTER DELETE ON post_likes
FOR EACH ROW EXECUTE FUNCTION trg_post_likes_counter();

CREATE OR REPLACE FUNCTION trg_post_replies_counter()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.reply_to IS NOT NULL THEN
      UPDATE posts SET count_replies = count_replies + 1 WHERE id = NEW.reply_to;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.reply_to IS NOT NULL THEN
      UPDATE posts SET count_replies = count_replies - 1 WHERE id = OLD.reply_to;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.reply_to IS DISTINCT FROM OLD.reply_to THEN
      IF OLD.reply_to IS NOT NULL THEN
        UPDATE posts SET count_replies = count_replies - 1 WHERE id = OLD.reply_to;
      END IF;
      IF NEW.reply_to IS NOT NULL THEN
        UPDATE posts SET count_replies = count_replies + 1 WHERE id = NEW.reply_to;
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_post_replies_counter_ins
AFTER INSERT ON posts
FOR EACH ROW EXECUTE FUNCTION trg_post_replies_counter();

CREATE TRIGGER trg_post_replies_counter_del
AFTER DELETE ON posts
FOR EACH ROW EXECUTE FUNCTION trg_post_replies_counter();

CREATE TRIGGER trg_post_replies_counter_upd
AFTER UPDATE OF reply_to ON posts
FOR EACH ROW EXECUTE FUNCTION trg_post_replies_counter();
