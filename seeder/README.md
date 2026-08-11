# Seeder data layout

`seeder/` is intentionally flat. Descriptive names such as post titles or user nicknames are not encoded in filenames, because those values can change independently of the stable seed ID.

## Filename rules

- `users-core-<user-id>.txt`: users loaded by every reset
- `users-test-<user-id>.txt`: additional users loaded by test resets
- `posts-core-<post-id>.txt`: posts loaded by every reset
- `posts-test-<post-id>.txt`: additional posts loaded by test resets
- `posts-after-actions-<post-id>.txt`: posts loaded after follow/block/like actions
- `agreements-core-<agreement-id>.json`: agreement terms loaded by every reset
- `actions-core.txt`: relationship actions loaded by every reset
- `actions-test.txt`: additional relationship actions loaded by test resets

For an entity with a stable ID, the part after the type/loading-phase prefix is exactly that ID. Titles, nicknames, locales, and other descriptive text must not be added to the filename.

If a reply intentionally has no stable ID and its ID is generated at import time, use the reply target ID plus a suffix. For example, a test reply to post `0000000000020702` is named `posts-test-0000000000020702-r01.txt`. Replies that have an explicit stable `id` use that ID like any other post.

## ID namespaces

- `000000000000xxxx`: global/core data
- `000000000001xxxx`: English data
- `000000000002xxxx`: Japanese data
- `000000000003xxxx`: i18n/Unicode test data

## User ranges

- `...0001-0099`: administrators
- `...0101-0499`: fixed users
- `...0501-0599`: ordinary test users
- `...0601-0699`: AI users (core or test depending on the persona)
- `...0701-0799`: publication/demo users
- `...0801-0899`: special-purpose tests

## Post ranges

- `...0001-0003`: Welcome, Help, Markdown format
- `...0101-0113`: technical documents
- `...0201`: fixed support page
- `...0501-0599`: ordinary test posts
- `...0601-0699`: AI test posts
- `...0701-0799`: publication/demo posts and replies
- `...0801-0899`: special-purpose and notification test posts
