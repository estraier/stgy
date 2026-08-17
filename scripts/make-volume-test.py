#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import os
from pathlib import Path
import subprocess
import sys
import textwrap

NUM_DUMMY_USERS = 30000
NUM_INACTIVE_USERS = 12000
NUM_LIGHT_USERS = 12000
NUM_REGULAR_USERS = 4500
NUM_HEAVY_USERS = 1350
NUM_CREATOR_USERS = 150
NUM_ORDINARY_VOLUME_POSTS = 46500
NUM_DENSE_ROOT_POSTS = 20000
NUM_DENSE_REPLY_POSTS = 15000
NUM_VOLUME_POSTS = (
  NUM_ORDINARY_VOLUME_POSTS + NUM_DENSE_ROOT_POSTS + NUM_DENSE_REPLY_POSTS
)
BENCHMARK_FOLLOWEE_COUNT = 5000
BENCHMARK_FOLLOWER_COUNT = 20000
REGULAR_POPULAR_FOLLOWS = 4
REGULAR_PEER_FOLLOWS = 8
VIRAL_POST_LIKE_COUNT = 20000
SEARCH_USER_TASK_COUNT = 30000
SEARCH_POST_TASK_COUNT = 1000
AI_USER_INTERVAL = 5
AI_USER_COUNT = NUM_DUMMY_USERS // AI_USER_INTERVAL
AI_OFFSET = AI_USER_COUNT // 2
AI_AFTER_ORDINAL = AI_OFFSET * AI_USER_INTERVAL
LIST_USERS_OFFSET = 10000
LIST_USERS_AFTER_ORDINAL = NUM_DUMMY_USERS - LIST_USERS_OFFSET + 1
LIST_POSTS_OFFSET = 10000
LIST_POSTS_AFTER_DENSE_ORDINAL = NUM_DENSE_ROOT_POSTS - LIST_POSTS_OFFSET + 1
NOTIFICATION_COUNT = 30000
NOTIFICATION_UNREAD_COUNT = NOTIFICATION_COUNT // 2

ADMIN_USER_ID = 1  # 0000000000000001
BENCHMARK_USER_ID = 1853070350746583040  # 19B76DAA800F0000
BENCHMARK_POST1_ID = 1855878856704991232  # 19C167FCC00F2000
BENCHMARK_POST2_ID = 1855878856706039808  # 19C167FCC01F2000

DUMMY_USER_BASE_MS = 1767312000000  # 2026-01-02 00:00:00+00
DUMMY_USER_WORKER_ID = 241
DUMMY_POST_BASE_MS = 1769990400000  # 2026-02-02 00:00:00+00
DUMMY_POST_WORKER_ID = 243
DENSE_POST_BASE_MS = 1768435200000  # 2026-01-15 00:00:00+00
DENSE_ROOT_POST_WORKER_ID = 245
DENSE_REPLY_POST_WORKER_ID = 246
SEARCH_TASK_BASE_MS = 1784073600000  # 2026-07-15 00:00:00+00
SEARCH_TASK_WORKER_ID = 247

EVENT_LOG_PARTITIONS = 256
EVENT_PARTITION_ID = BENCHMARK_USER_ID % EVENT_LOG_PARTITIONS
EVENT_BASE_MS = 1782864000000  # 2026-07-01 00:00:00+00
EVENT_WORKER_ID = 244
EVENT_COUNT = 1000
EVENT_AFTER_ORDINAL = 400
EVENT_AFTER_ID = 1869468402083381248  # event number 400
NOTIFICATION_NEWER_THAN = "2026-07-01 03:00:00+00"
NICKNAME_PREFIX = "user00"

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def parse_args(argv: list[str]) -> argparse.Namespace:
  parser = argparse.ArgumentParser(
    description="Populate the STGY database with deterministic volume-test data and run ANALYZE.",
  )
  parser.add_argument(
    "--mode",
    choices=("docker", "native"),
    default="docker",
    help="PostgreSQL execution mode (default: docker)",
  )
  return parser.parse_args(argv)


def snowflake_id(timestamp_ms: int, worker_id: int, sequence: int = 0) -> int:
  return (timestamp_ms << 20) | (worker_id << 12) | sequence


def build_sql() -> str:
  first_dummy_user_id = snowflake_id(DUMMY_USER_BASE_MS, DUMMY_USER_WORKER_ID)
  last_dummy_user_id = snowflake_id(
    DUMMY_USER_BASE_MS + NUM_DUMMY_USERS - 1,
    DUMMY_USER_WORKER_ID,
  )
  first_event_id = snowflake_id(EVENT_BASE_MS, EVENT_WORKER_ID)
  last_event_id = snowflake_id(EVENT_BASE_MS + EVENT_COUNT - 1, EVENT_WORKER_ID)
  first_search_task_id = snowflake_id(SEARCH_TASK_BASE_MS, SEARCH_TASK_WORKER_ID)
  last_search_task_id = snowflake_id(
    SEARCH_TASK_BASE_MS + SEARCH_USER_TASK_COUNT + SEARCH_POST_TASK_COUNT - 1,
    SEARCH_TASK_WORKER_ID,
  )
  first_dense_owner_id = first_dummy_user_id
  dense_reply_owner_id = snowflake_id(
    DUMMY_USER_BASE_MS + 1,
    DUMMY_USER_WORKER_ID,
  )
  ai_after_id = snowflake_id(
    DUMMY_USER_BASE_MS + AI_AFTER_ORDINAL - 1,
    DUMMY_USER_WORKER_ID,
  )
  list_users_after_id = snowflake_id(
    DUMMY_USER_BASE_MS + LIST_USERS_AFTER_ORDINAL - 1,
    DUMMY_USER_WORKER_ID,
  )
  list_posts_after_id = snowflake_id(
    DENSE_POST_BASE_MS + LIST_POSTS_AFTER_DENSE_ORDINAL - 1,
    DENSE_ROOT_POST_WORKER_ID,
  )

  user_class_total = (
    NUM_INACTIVE_USERS
    + NUM_LIGHT_USERS
    + NUM_REGULAR_USERS
    + NUM_HEAVY_USERS
    + NUM_CREATOR_USERS
  )
  if user_class_total != NUM_DUMMY_USERS:
    raise RuntimeError("user activity classes do not add up to NUM_DUMMY_USERS")

  ordinary_posts = (
    NUM_LIGHT_USERS
    + NUM_REGULAR_USERS * 3
    + NUM_HEAVY_USERS * 10
    + NUM_CREATOR_USERS * 50
  )
  if ordinary_posts != NUM_ORDINARY_VOLUME_POSTS:
    raise RuntimeError("ordinary post distribution does not match configured total")
  if NUM_VOLUME_POSTS != 81500:
    raise RuntimeError("volume post total changed unexpectedly")
  if AI_AFTER_ORDINAL % AI_USER_INTERVAL != 0:
    raise RuntimeError("AI cursor must point to an AI user")
  if LIST_POSTS_AFTER_DENSE_ORDINAL <= 0:
    raise RuntimeError("listPosts cursor ordinal must be positive")

  if EVENT_AFTER_ID != snowflake_id(
    EVENT_BASE_MS + EVENT_AFTER_ORDINAL - 1,
    EVENT_WORKER_ID,
  ):
    raise RuntimeError("EVENT_AFTER_ID does not match the configured event series")

  return textwrap.dedent(
    f"""
    \\set ON_ERROR_STOP on
    \\timing on

    BEGIN;
    SET LOCAL statement_timeout = 0;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM user_secrets WHERE user_id = {ADMIN_USER_ID}
      ) THEN
        RAISE EXCEPTION 'admin user secret is required before running make-volume-test.py';
      END IF;
    END
    $$;

    ALTER TABLE user_follows DISABLE TRIGGER trg_user_follows_counts_ins;
    ALTER TABLE user_follows DISABLE TRIGGER trg_user_follows_counts_del;
    ALTER TABLE posts DISABLE TRIGGER trg_user_post_counts_ins;
    ALTER TABLE posts DISABLE TRIGGER trg_user_post_counts_del;
    ALTER TABLE posts DISABLE TRIGGER trg_post_reply_counts_ins;
    ALTER TABLE posts DISABLE TRIGGER trg_post_reply_counts_del;
    ALTER TABLE post_likes DISABLE TRIGGER trg_post_like_counts_ins;
    ALTER TABLE post_likes DISABLE TRIGGER trg_post_like_counts_del;

    DELETE FROM event_logs
    WHERE partition_id = {EVENT_PARTITION_ID}
      AND event_id BETWEEN {first_event_id} AND {last_event_id};
    DELETE FROM event_log_cursors
    WHERE consumer = 'notification'
      AND partition_id = {EVENT_PARTITION_ID};
    DELETE FROM users
    WHERE id = {BENCHMARK_USER_ID}
       OR id BETWEEN {first_dummy_user_id} AND {last_dummy_user_id};

    CREATE TEMP TABLE volume_users (
      ordinal INT PRIMARY KEY,
      id BIGINT NOT NULL UNIQUE,
      nickname VARCHAR(50) NOT NULL,
      locale VARCHAR(50) NOT NULL,
      timezone VARCHAR(50) NOT NULL
    ) ON COMMIT DROP;

    INSERT INTO volume_users (ordinal, id, nickname, locale, timezone)
    SELECT
      i,
      ((({DUMMY_USER_BASE_MS} + i - 1)::bigint << 20)
        | ({DUMMY_USER_WORKER_ID}::bigint << 12)),
      'user' || lpad(i::text, 5, '0'),
      CASE WHEN i % 5 = 0 THEN 'ja-JP' ELSE 'en-US' END,
      CASE WHEN i % 5 = 0 THEN 'Asia/Tokyo' ELSE 'America/New_York' END
    FROM generate_series(1, {NUM_DUMMY_USERS}) AS g(i);

    INSERT INTO users (
      id, updated_at, snippet, nickname, avatar, locale, timezone,
      ai_model, is_admin, is_frozen, block_strangers
    ) VALUES (
      {BENCHMARK_USER_ID},
      TIMESTAMPTZ '2026-01-01 00:00:00+00',
      '[{{"T":"p","X":"Volume-test benchmark user."}}]',
      'user00000',
      NULL,
      'en-US',
      'Asia/Tokyo',
      NULL,
      FALSE,
      FALSE,
      FALSE
    );

    INSERT INTO users (
      id, updated_at, snippet, nickname, avatar, locale, timezone,
      ai_model, is_admin, is_frozen, block_strangers
    )
    SELECT
      vu.id,
      TIMESTAMPTZ '2026-01-02 00:00:00+00'
        + (vu.ordinal - 1) * INTERVAL '1 millisecond',
      '[{{"T":"p","X":"Volume-test user ' || vu.nickname || '."}}]',
      vu.nickname,
      NULL,
      vu.locale,
      vu.timezone,
      CASE WHEN vu.ordinal % {AI_USER_INTERVAL} = 0 THEN 'basic' ELSE NULL END,
      FALSE,
      FALSE,
      vu.ordinal % 3 = 0
    FROM volume_users vu;

    INSERT INTO user_secrets (user_id, email, password)
    SELECT
      {BENCHMARK_USER_ID},
      'volume-benchmark@stgy.invalid',
      us.password
    FROM user_secrets us
    WHERE us.user_id = {ADMIN_USER_ID};

    INSERT INTO user_secrets (user_id, email, password)
    SELECT
      vu.id,
      vu.nickname || '@volume.stgy.invalid',
      us.password
    FROM volume_users vu
    CROSS JOIN LATERAL (
      SELECT password FROM user_secrets WHERE user_id = {ADMIN_USER_ID}
    ) us;

    INSERT INTO user_details (user_id, introduction, ai_personality)
    VALUES (
      {BENCHMARK_USER_ID},
      'Benchmark user for STGY database volume tests.',
      NULL
    );

    INSERT INTO user_details (user_id, introduction, ai_personality)
    SELECT
      vu.id,
      'Volume-test profile for ' || vu.nickname || '.',
      NULL
    FROM volume_users vu;

    INSERT INTO user_follows (follower_id, followee_id, created_at)
    SELECT
      {BENCHMARK_USER_ID},
      vu.id,
      TIMESTAMPTZ '2026-03-01 00:00:00+00'
        + (vu.ordinal - 1) * INTERVAL '1 millisecond'
    FROM volume_users vu
    WHERE vu.ordinal <= {BENCHMARK_FOLLOWEE_COUNT // 2}
       OR vu.ordinal > {NUM_DUMMY_USERS - BENCHMARK_FOLLOWEE_COUNT // 2}

    UNION ALL

    SELECT
      vu.id,
      {BENCHMARK_USER_ID},
      TIMESTAMPTZ '2026-03-02 00:00:00+00'
        + (vu.ordinal - 1) * INTERVAL '1 millisecond'
    FROM volume_users vu
    WHERE vu.ordinal <= {BENCHMARK_FOLLOWER_COUNT}

    UNION ALL

    SELECT
      follower.id,
      popular.id,
      TIMESTAMPTZ '2026-03-03 00:00:00+00'
        + ((follower.ordinal - 1)::bigint * {REGULAR_POPULAR_FOLLOWS} + j.n)
          * INTERVAL '1 millisecond'
    FROM volume_users follower
    CROSS JOIN generate_series(1, {REGULAR_POPULAR_FOLLOWS}) AS j(n)
    JOIN volume_users popular
      ON popular.ordinal = ((follower.ordinal + j.n * 17 - 1) % 100) + 1
    WHERE follower.id <> popular.id

    UNION ALL

    SELECT
      follower.id,
      peer.id,
      TIMESTAMPTZ '2026-03-04 00:00:00+00'
        + ((follower.ordinal - 1)::bigint * {REGULAR_PEER_FOLLOWS} + offsets.n)
          * INTERVAL '1 millisecond'
    FROM volume_users follower
    CROSS JOIN (
      VALUES (1), (2), (4), (8), (16), (32), (64), (128)
    ) AS offsets(n)
    JOIN volume_users peer
      ON peer.ordinal = ((follower.ordinal - 1 + offsets.n) % {NUM_DUMMY_USERS}) + 1
    WHERE follower.id <> peer.id
    ON CONFLICT (follower_id, followee_id) DO NOTHING;

    INSERT INTO posts (
      id, owned_by, reply_to, published_at, updated_at, snippet, locale,
      allow_likes, allow_replies
    ) VALUES
    (
      {BENCHMARK_POST1_ID},
      {BENCHMARK_USER_ID},
      NULL,
      TIMESTAMPTZ '2026-02-01 00:00:00+00',
      TIMESTAMPTZ '2026-02-01 00:00:00+00',
      '[{{"T":"p","X":"Benchmark root post one."}}]',
      'en-US',
      TRUE,
      TRUE
    ),
    (
      {BENCHMARK_POST2_ID},
      {BENCHMARK_USER_ID},
      NULL,
      TIMESTAMPTZ '2026-02-01 00:00:00.001+00',
      TIMESTAMPTZ '2026-02-01 00:00:00.001+00',
      '[{{"T":"p","X":"Benchmark root post two."}}]',
      'en-US',
      TRUE,
      TRUE
    );

    INSERT INTO post_details (post_id, content) VALUES
      ({BENCHMARK_POST1_ID}, 'Benchmark root post one.'),
      ({BENCHMARK_POST2_ID}, 'Benchmark root post two.');

    INSERT INTO post_tags (post_id, name, is_root) VALUES
      ({BENCHMARK_POST1_ID}, 'bulk', TRUE),
      ({BENCHMARK_POST1_ID}, 'benchmark', TRUE),
      ({BENCHMARK_POST2_ID}, 'bulk', TRUE),
      ({BENCHMARK_POST2_ID}, 'benchmark', TRUE);

    CREATE TEMP TABLE volume_posts (
      ordinal BIGINT PRIMARY KEY,
      owner_ordinal INT NOT NULL,
      post_number INT NOT NULL,
      id BIGINT NOT NULL UNIQUE,
      owned_by BIGINT NOT NULL,
      reply_to BIGINT,
      published_at TIMESTAMPTZ NOT NULL,
      content TEXT NOT NULL,
      snippet TEXT NOT NULL,
      locale VARCHAR(50)
    ) ON COMMIT DROP;

    INSERT INTO volume_posts (
      ordinal, owner_ordinal, post_number, id, owned_by, reply_to,
      published_at, content, snippet, locale
    )
    SELECT
      ((vu.ordinal - 1)::bigint * 100 + p.post_number),
      vu.ordinal,
      p.post_number,
      ((({DUMMY_POST_BASE_MS}
          + (vu.ordinal - 1)::bigint * 100
          + p.post_number - 1) << 20)
        | ({DUMMY_POST_WORKER_ID}::bigint << 12)),
      vu.id,
      CASE
        WHEN p.post_number > 1
         AND (vu.ordinal + p.post_number) % 7 = 0
          THEN {BENCHMARK_POST2_ID}
        ELSE NULL
      END,
      TIMESTAMPTZ '2026-02-02 00:00:00+00'
        + (((vu.ordinal - 1)::bigint * 100 + p.post_number - 1)
          * INTERVAL '1 millisecond'),
      CASE
        WHEN p.post_number > 1
         AND (vu.ordinal + p.post_number) % 7 = 0
          THEN 'Reply ' || p.post_number || ' by ' || vu.nickname || '.'
        ELSE 'Post ' || p.post_number || ' by ' || vu.nickname || '.'
      END,
      CASE
        WHEN p.post_number > 1
         AND (vu.ordinal + p.post_number) % 7 = 0
          THEN '[{{"T":"p","X":"Reply ' || p.post_number
            || ' by ' || vu.nickname || '."}}]'
        ELSE '[{{"T":"p","X":"Post ' || p.post_number
          || ' by ' || vu.nickname || '."}}]'
      END,
      CASE WHEN vu.ordinal % 4 = 0 THEN NULL ELSE vu.locale END
    FROM volume_users vu
    CROSS JOIN LATERAL generate_series(
      1,
      CASE
        WHEN vu.ordinal <= {NUM_INACTIVE_USERS} THEN 0
        WHEN vu.ordinal <= {NUM_INACTIVE_USERS + NUM_LIGHT_USERS} THEN 1
        WHEN vu.ordinal <= {NUM_INACTIVE_USERS + NUM_LIGHT_USERS + NUM_REGULAR_USERS} THEN 3
        WHEN vu.ordinal <= {NUM_INACTIVE_USERS + NUM_LIGHT_USERS + NUM_REGULAR_USERS + NUM_HEAVY_USERS} THEN 10
        ELSE 50
      END
    ) AS p(post_number)

    UNION ALL

    SELECT
      10000000::bigint + g.i,
      1,
      100000 + g.i,
      ((({DENSE_POST_BASE_MS} + g.i - 1)::bigint << 20)
        | ({DENSE_ROOT_POST_WORKER_ID}::bigint << 12)),
      {first_dense_owner_id},
      NULL,
      TIMESTAMPTZ '2026-01-15 00:00:00+00'
        + (g.i - 1) * INTERVAL '1 millisecond',
      'Dense root post ' || g.i || ' by user00001.',
      '[{{"T":"p","X":"Dense root post ' || g.i
        || ' by user00001."}}]',
      'en-US'
    FROM generate_series(1, {NUM_DENSE_ROOT_POSTS}) AS g(i)

    UNION ALL

    SELECT
      20000000::bigint + g.i,
      2,
      200000 + g.i,
      ((({DENSE_POST_BASE_MS} + g.i - 1)::bigint << 20)
        | ({DENSE_REPLY_POST_WORKER_ID}::bigint << 12)),
      {dense_reply_owner_id},
      {BENCHMARK_POST1_ID},
      TIMESTAMPTZ '2026-01-15 00:00:00+00'
        + (g.i - 1) * INTERVAL '1 millisecond',
      'Dense reply ' || g.i || ' by user00002.',
      '[{{"T":"p","X":"Dense reply ' || g.i
        || ' by user00002."}}]',
      'en-US'
    FROM generate_series(1, {NUM_DENSE_REPLY_POSTS}) AS g(i);

    INSERT INTO posts (
      id, owned_by, reply_to, published_at, updated_at, snippet, locale,
      allow_likes, allow_replies
    )
    SELECT
      vp.id,
      vp.owned_by,
      vp.reply_to,
      vp.published_at,
      vp.published_at,
      vp.snippet,
      vp.locale,
      TRUE,
      TRUE
    FROM volume_posts vp;

    INSERT INTO post_details (post_id, content)
    SELECT id, content FROM volume_posts;

    INSERT INTO post_tags (post_id, name, is_root)
    SELECT id, 'bulk', reply_to IS NULL FROM volume_posts
    UNION ALL
    SELECT
      id,
      'tagA' || lpad((owner_ordinal / 10)::text, 5, '0'),
      reply_to IS NULL
    FROM volume_posts
    UNION ALL
    SELECT
      id,
      'tagB' || lpad((owner_ordinal % 10)::text, 5, '0'),
      reply_to IS NULL
    FROM volume_posts;

    INSERT INTO post_likes (post_id, liked_by, created_at)
    SELECT
      {BENCHMARK_POST1_ID},
      vu.id,
      TIMESTAMPTZ '2026-04-01 00:00:00+00'
        + (vu.ordinal - 1) * INTERVAL '1 millisecond'
    FROM volume_users vu
    WHERE vu.ordinal <= {VIRAL_POST_LIKE_COUNT};

    INSERT INTO post_likes (post_id, liked_by, created_at)
    SELECT
      latest.id,
      {BENCHMARK_USER_ID},
      TIMESTAMPTZ '2026-04-02 00:00:00+00'
        + (latest.owner_ordinal - 1) * INTERVAL '1 millisecond'
    FROM (
      SELECT DISTINCT ON (vp.owned_by)
        vp.owned_by, vp.owner_ordinal, vp.id
      FROM volume_posts vp
      JOIN user_follows uf
        ON uf.follower_id = {BENCHMARK_USER_ID}
       AND uf.followee_id = vp.owned_by
      ORDER BY vp.owned_by, vp.id DESC
    ) latest;

    TRUNCATE user_counts;
    WITH
    follower_counts AS (
      SELECT followee_id AS user_id, count(*)::int AS follower_count
      FROM user_follows
      GROUP BY followee_id
    ),
    followee_counts AS (
      SELECT follower_id AS user_id, count(*)::int AS followee_count
      FROM user_follows
      GROUP BY follower_id
    ),
    post_owner_counts AS (
      SELECT owned_by AS user_id, count(*)::int AS post_count
      FROM posts
      GROUP BY owned_by
    )
    INSERT INTO user_counts (
      user_id, follower_count, followee_count, post_count
    )
    SELECT
      u.id,
      COALESCE(fc.follower_count, 0),
      COALESCE(fec.followee_count, 0),
      COALESCE(pc.post_count, 0)
    FROM users u
    LEFT JOIN follower_counts fc ON fc.user_id = u.id
    LEFT JOIN followee_counts fec ON fec.user_id = u.id
    LEFT JOIN post_owner_counts pc ON pc.user_id = u.id
    WHERE fc.user_id IS NOT NULL
       OR fec.user_id IS NOT NULL
       OR pc.user_id IS NOT NULL;

    TRUNCATE post_counts;
    WITH
    like_counts AS (
      SELECT post_id, count(*)::int AS like_count
      FROM post_likes
      GROUP BY post_id
    ),
    reply_counts AS (
      SELECT reply_to AS post_id, count(*)::int AS reply_count
      FROM posts
      WHERE reply_to IS NOT NULL
      GROUP BY reply_to
    )
    INSERT INTO post_counts (post_id, like_count, reply_count)
    SELECT
      p.id,
      COALESCE(lc.like_count, 0),
      COALESCE(rc.reply_count, 0)
    FROM posts p
    LEFT JOIN like_counts lc ON lc.post_id = p.id
    LEFT JOIN reply_counts rc ON rc.post_id = p.id
    WHERE lc.post_id IS NOT NULL OR rc.post_id IS NOT NULL;

    ALTER TABLE user_follows ENABLE TRIGGER trg_user_follows_counts_ins;
    ALTER TABLE user_follows ENABLE TRIGGER trg_user_follows_counts_del;
    ALTER TABLE posts ENABLE TRIGGER trg_user_post_counts_ins;
    ALTER TABLE posts ENABLE TRIGGER trg_user_post_counts_del;
    ALTER TABLE posts ENABLE TRIGGER trg_post_reply_counts_ins;
    ALTER TABLE posts ENABLE TRIGGER trg_post_reply_counts_del;
    ALTER TABLE post_likes ENABLE TRIGGER trg_post_like_counts_ins;
    ALTER TABLE post_likes ENABLE TRIGGER trg_post_like_counts_del;

    INSERT INTO notifications (
      user_id, slot, term, is_read, payload, updated_at, created_at
    )
    SELECT
      {BENCHMARK_USER_ID},
      CASE
        WHEN n <= {NOTIFICATION_UNREAD_COUNT}
          THEN 'volume-unread'
        ELSE 'volume-read'
      END,
      lpad(n::text, 8, '0'),
      n > {NOTIFICATION_UNREAD_COUNT},
      json_build_object(
        'countUsers', 1,
        'records', json_build_array(
          json_build_object(
            'userId', upper(lpad(to_hex(vu.id), 16, '0')),
            'userNickname', vu.nickname,
            'ts', extract(epoch FROM (
              TIMESTAMPTZ '2026-07-01 00:00:00+00'
              + (n - 1) * INTERVAL '1 second'
            ))::bigint
          )
        )
      )::text,
      TIMESTAMPTZ '2026-07-01 00:00:00+00'
        + (n - 1) * INTERVAL '1 second',
      TIMESTAMPTZ '2026-07-01 00:00:00+00'
        + (n - 1) * INTERVAL '1 second'
    FROM generate_series(1, {NOTIFICATION_COUNT}) AS g(n)
    JOIN volume_users vu ON vu.ordinal = ((n - 1) % {NUM_DUMMY_USERS}) + 1;

    INSERT INTO event_logs (partition_id, event_id, payload)
    SELECT
      {EVENT_PARTITION_ID},
      ((({EVENT_BASE_MS} + n - 1)::bigint << 20)
        | ({EVENT_WORKER_ID}::bigint << 12)),
      json_build_object(
        'type', 'follow',
        'followerId', upper(lpad(to_hex(vu.id), 16, '0')),
        'followeeId', upper(lpad(to_hex({BENCHMARK_USER_ID}::bigint), 16, '0'))
      )::text
    FROM generate_series(1, {EVENT_COUNT}) AS g(n)
    JOIN volume_users vu ON vu.ordinal = ((n - 1) % {NUM_DUMMY_USERS}) + 1;

    INSERT INTO event_log_cursors (
      consumer, partition_id, last_event_id, updated_at
    ) VALUES (
      'notification',
      {EVENT_PARTITION_ID},
      {last_event_id},
      now()
    )
    ON CONFLICT (consumer, partition_id)
    DO UPDATE SET
      last_event_id = EXCLUDED.last_event_id,
      updated_at = EXCLUDED.updated_at;

    TRUNCATE search_indexing_tasks;

    INSERT INTO search_indexing_tasks (
      id, name_prefix, doc_id, doc_timestamp, body_text, locale
    )
    SELECT
      ((({SEARCH_TASK_BASE_MS} + n - 1)::bigint << 20)
        | ({SEARCH_TASK_WORKER_ID}::bigint << 12)),
      'users',
      'volume-user-' || n,
      ((({DUMMY_USER_BASE_MS} + n - 1)::bigint << 20)
        | ({DUMMY_USER_WORKER_ID}::bigint << 12)),
      'Profile update for volume user ' || n,
      CASE WHEN n % 5 = 0 THEN 'ja-JP' ELSE 'en-US' END
    FROM generate_series(1, {SEARCH_USER_TASK_COUNT}) AS g(n);

    INSERT INTO search_indexing_tasks (
      id, name_prefix, doc_id, doc_timestamp, body_text, locale
    )
    SELECT
      ((({SEARCH_TASK_BASE_MS} + {SEARCH_USER_TASK_COUNT} + n - 1)::bigint << 20)
        | ({SEARCH_TASK_WORKER_ID}::bigint << 12)),
      'posts',
      'volume-post-' || n,
      ((({DUMMY_POST_BASE_MS} + n - 1)::bigint << 20)
        | ({DUMMY_POST_WORKER_ID}::bigint << 12)),
      'Post update for volume post ' || n,
      CASE WHEN n % 5 = 0 THEN 'ja-JP' ELSE 'en-US' END
    FROM generate_series(1, {SEARCH_POST_TASK_COUNT}) AS g(n);

    COMMIT;

    ANALYZE;

    SELECT 'benchmark_user_id' AS name, '{BENCHMARK_USER_ID}' AS value
    UNION ALL SELECT 'benchmark_user_hex', upper(lpad(to_hex({BENCHMARK_USER_ID}::bigint), 16, '0'))
    UNION ALL SELECT 'nickname_prefix', '{NICKNAME_PREFIX}%'
    UNION ALL SELECT 'ai_user_count', '{AI_USER_COUNT}'
    UNION ALL SELECT 'ai_offset', '{AI_OFFSET}'
    UNION ALL SELECT 'ai_after_id', '{ai_after_id}'
    UNION ALL SELECT 'list_users_offset', '{LIST_USERS_OFFSET}'
    UNION ALL SELECT 'list_users_after_id', '{list_users_after_id}'
    UNION ALL SELECT 'list_posts_owner_id', '{first_dense_owner_id}'
    UNION ALL SELECT 'list_posts_offset', '{LIST_POSTS_OFFSET}'
    UNION ALL SELECT 'list_posts_after_id', '{list_posts_after_id}'
    UNION ALL SELECT 'reply_state_focus_user_id', '{first_dense_owner_id}'
    UNION ALL SELECT 'reply_state_other_user_id', '{dense_reply_owner_id}'
    UNION ALL SELECT 'reply_state_target_post_id', '{BENCHMARK_POST1_ID}'
    UNION ALL SELECT 'search_task_first_id', '{first_search_task_id}'
    UNION ALL SELECT 'search_task_last_id', '{last_search_task_id}'
    UNION ALL SELECT 'event_partition_id', '{EVENT_PARTITION_ID}'
    UNION ALL SELECT 'event_after_id', '{EVENT_AFTER_ID}'
    UNION ALL SELECT 'notification_newer_than', '{NOTIFICATION_NEWER_THAN}';

    SELECT 'users' AS name, count(*)::bigint AS records FROM users
    UNION ALL SELECT 'ai_users', count(*) FROM users WHERE ai_model IS NOT NULL
    UNION ALL SELECT 'posts', count(*) FROM posts
    UNION ALL SELECT 'user_follows', count(*) FROM user_follows
    UNION ALL SELECT 'benchmark_followees', count(*) FROM user_follows WHERE follower_id = {BENCHMARK_USER_ID}
    UNION ALL SELECT 'benchmark_followers', count(*) FROM user_follows WHERE followee_id = {BENCHMARK_USER_ID}
    UNION ALL SELECT 'post_likes', count(*) FROM post_likes
    UNION ALL SELECT 'post_tags', count(*) FROM post_tags
    UNION ALL SELECT 'search_indexing_tasks', count(*) FROM search_indexing_tasks
    UNION ALL SELECT 'search_user_tasks', count(*) FROM search_indexing_tasks WHERE name_prefix = 'users'
    UNION ALL SELECT 'search_post_tasks', count(*) FROM search_indexing_tasks WHERE name_prefix = 'posts'
    UNION ALL SELECT 'event_logs_partition_{EVENT_PARTITION_ID}', count(*) FROM event_logs WHERE partition_id = {EVENT_PARTITION_ID}
    UNION ALL SELECT 'benchmark_notifications', count(*) FROM notifications WHERE user_id = {BENCHMARK_USER_ID}
    UNION ALL SELECT 'reply_state_focus_posts', count(*) FROM posts WHERE owned_by = {first_dense_owner_id}
    UNION ALL SELECT 'reply_state_target_replies', count(*) FROM posts WHERE reply_to = {BENCHMARK_POST1_ID}
    ORDER BY name;
    """
  ).lstrip()


def run_psql(sql: str, mode: str) -> None:
  shell = r"""
set -euo pipefail
set -a
source .env
set +a

if [ "$STGY_VOLUME_TEST_MODE" = docker ]; then
  docker compose exec -T postgres psql \
    -v ON_ERROR_STOP=1 \
    -U "$STGY_DATABASE_USER" \
    "$STGY_DATABASE_NAME"
else
  PGPASSWORD="$STGY_DATABASE_PASSWORD" psql \
    -h 127.0.0.1 \
    -p "${STGY_DATABASE_PORT:-5432}" \
    -v ON_ERROR_STOP=1 \
    -U "$STGY_DATABASE_USER" \
    "$STGY_DATABASE_NAME"
fi
"""
  env = os.environ.copy()
  env["STGY_VOLUME_TEST_MODE"] = mode
  subprocess.run(
    ["bash", "-lc", shell],
    cwd=PROJECT_ROOT,
    env=env,
    input=sql,
    text=True,
    check=True,
  )


def main(argv: list[str]) -> int:
  args = parse_args(argv)
  sql = build_sql()

  print(f"[volume-test] mode={args.mode}")
  print(f"[volume-test] dummy users={NUM_DUMMY_USERS}")
  print(f"[volume-test] volume posts={NUM_VOLUME_POSTS}")
  print(f"[volume-test] AI users={AI_USER_COUNT}")
  print(f"[volume-test] benchmark followees={BENCHMARK_FOLLOWEE_COUNT}")
  print(f"[volume-test] benchmark followers={BENCHMARK_FOLLOWER_COUNT}")
  print(f"[volume-test] search tasks={SEARCH_USER_TASK_COUNT + SEARCH_POST_TASK_COUNT}")
  print(f"[volume-test] notifications={NOTIFICATION_COUNT}")
  print(f"[volume-test] benchmark user={BENCHMARK_USER_ID}")
  print("[volume-test] loading deterministic rows and running ANALYZE")
  run_psql(sql, args.mode)
  print("[volume-test] done")
  return 0


if __name__ == "__main__":
  try:
    sys.exit(main(sys.argv[1:]))
  except subprocess.CalledProcessError as exc:
    print(f"[volume-test] psql failed with exit code {exc.returncode}", file=sys.stderr)
    sys.exit(exc.returncode or 1)
