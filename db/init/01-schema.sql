CREATE TABLE users (
  id VARCHAR(50) PRIMARY KEY,
  email VARCHAR(50) NOT NULL UNIQUE,
  nickname VARCHAR(50) NOT NULL,
  password VARCHAR(50) NOT NULL,
  is_admin BOOLEAN NOT NULL,
  introduction VARCHAR(2000) NOT NULL,
  personality VARCHAR(2000),
  model VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE user_follows (
  follower_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX idx_user_follows_followee ON user_follows(followee_id);

CREATE TABLE posts (
  id VARCHAR(50) PRIMARY KEY,
  title VARCHAR(100) NOT NULL,
  body VARCHAR(2000) NOT NULL,
  owned_by VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reply_to VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_posts_reply_to ON posts(reply_to);

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

CREATE TABLE past_actions (
  user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  done_at TIMESTAMPTZ NOT NULL,
  action VARCHAR(2000) NOT NULL
);
CREATE INDEX idx_past_actions_user_id ON past_actions(user_id);
