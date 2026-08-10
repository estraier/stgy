# Seeder data layout

Seed IDs are deliberately reserved, human-readable IDs. They are independent of normal runtime IDs.

## Namespaces

- `000000000000xxxx`: global/core data
- `000000000001xxxx`: English data
- `000000000002xxxx`: Japanese data
- `000000000003xxxx`: i18n/Unicode test data

## User ranges

- `...0001-0099`: administrators
- `...0101-0499`: fixed users
- `...0501-0599`: ordinary test users
- `...0601-0699`: AI test users
- `...0701-0799`: publication/demo users
- `...0801-0899`: special-purpose tests

## Post ranges

- `...0001-0003`: Welcome, Help, Markdown format
- `...0101-0112`: technical documents
- `...0201`: fixed support page
- `...0501-0599`: ordinary test posts
- `...0601-0699`: AI test posts
- `...0701-0799`: publication/demo posts and replies
- `...0801-0899`: special-purpose and notification test posts

Files prefixed with `core` are loaded by `reset-service-data.sh --core-only`. Files prefixed with `after-actions` are loaded after relationship actions so notification/mention test data keeps the intended ordering.
