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
  introduction VARCHAR(2000) NOT NULL,
  avatar VARCHAR(100),
  ai_model VARCHAR(50) REFERENCES ai_models(name) ON DELETE SET NULL,
  ai_personality VARCHAR(2000),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ,
  count_followers INT NOT NULL DEFAULT 0,
  count_followees INT NOT NULL DEFAULT 0,
  count_posts INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_users_nickname_id ON users(nickname, id);

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
  content VARCHAR(10000) NOT NULL,
  owned_by VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reply_to VARCHAR(50) REFERENCES posts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ
);
CREATE INDEX idx_posts_owned_by_id ON posts(owned_by, id);
CREATE INDEX idx_posts_reply_to_id ON posts(reply_to, id);
CREATE INDEX idx_posts_root_id ON posts (id) WHERE reply_to IS NULL;

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
CREATE INDEX idx_post_likes_liked_by_created_at ON post_likes(liked_by, created_at);
CREATE INDEX idx_post_likes_post_id_created_at ON post_likes (post_id, created_at);

CREATE TABLE past_actions (
  user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  done_at TIMESTAMPTZ NOT NULL,
  action VARCHAR(2000) NOT NULL
);
CREATE INDEX idx_past_actions_user_id_done_at ON past_actions(user_id, done_at);

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
