#!/bin/sh
set -eu

if ! grep -q '^postlog[[:space:]]' /etc/postfix/master.cf; then
  printf '\npostlog   unix-dgram n  -       n       -       1       postlogd\n' >> /etc/postfix/master.cf
fi

postfix check
exec postfix start-fg
