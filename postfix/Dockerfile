FROM ubuntu:26.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates debconf \
    && echo "postfix postfix/mailname string stgy.jp" | debconf-set-selections \
    && echo "postfix postfix/main_mailer_type select No configuration" | debconf-set-selections \
    && apt-get install -y --no-install-recommends postfix \
    && rm -rf /var/lib/apt/lists/*

COPY postfix/main.cf /etc/postfix/main.cf
COPY postfix/aliases /etc/aliases
COPY postfix/entrypoint.sh /usr/local/bin/postfix-entrypoint

RUN newaliases \
    && chmod 755 /usr/local/bin/postfix-entrypoint

EXPOSE 25

ENTRYPOINT ["/usr/local/bin/postfix-entrypoint"]
