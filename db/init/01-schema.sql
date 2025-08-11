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
  icon VARCHAR(100),
  ai_model VARCHAR(50) REFERENCES ai_models(name) ON DELETE SET NULL,
  ai_personality VARCHAR(2000),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ,
  count_followers INT NOT NULL DEFAULT 0,
  count_followees INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_nickname ON users(nickname);
CREATE INDEX idx_users_created_at ON users(created_at);

CREATE TABLE user_follows (
  follower_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX idx_user_follows_followee ON user_follows(followee_id);
CREATE INDEX idx_user_follows_followee_created_at ON user_follows (followee_id, created_at DESC);
CREATE INDEX idx_user_follows_follower_created_at ON user_follows (follower_id, created_at DESC);

CREATE TABLE posts (
  id VARCHAR(50) PRIMARY KEY,
  content VARCHAR(5000) NOT NULL,
  owned_by VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reply_to VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ
);
CREATE INDEX idx_posts_owned_by ON posts(owned_by);
CREATE INDEX idx_posts_reply_to ON posts(reply_to);
CREATE INDEX idx_posts_created_at ON posts(created_at);

CREATE TABLE post_tags (
  post_id VARCHAR(50) NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  PRIMARY KEY (post_id, name)
);
CREATE INDEX idx_post_tags_name ON post_tags(name);

CREATE TABLE post_likes (
  post_id VARCHAR(50) NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  liked_by VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (post_id, liked_by)
);
CREATE INDEX idx_post_likes_liked_by ON post_likes(liked_by);
CREATE INDEX idx_post_likes_post_id_created_at ON post_likes (post_id, created_at);

CREATE TABLE past_actions (
  user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  done_at TIMESTAMPTZ NOT NULL,
  action VARCHAR(2000) NOT NULL
);
CREATE INDEX idx_past_actions_user_id ON past_actions(user_id);

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
