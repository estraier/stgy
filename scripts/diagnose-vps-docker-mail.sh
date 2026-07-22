#!/bin/bash

set -u -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
cd "$PROJECT_ROOT"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.vps.yml)

section() {
  printf '\n===== %s =====\n' "$1"
}

redact_email() {
  sed -E 's/[[:alnum:]._%+\-]+@[[:alnum:].\-]+/[redacted-email]/g'
}

run_report() {
  "$@" 2>&1 | redact_email || true
}

section "Docker services"
run_report "${COMPOSE[@]}" ps

section "Backend health"
run_report "${COMPOSE[@]}" exec -T backend node -e '
fetch("http://127.0.0.1:3100/health")
  .then(async (response) => {
    console.log(`HTTP ${response.status} ${await response.text()}`);
    if (!response.ok) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(`FAILED: ${error}`);
    process.exitCode = 1;
  });
'

section "Runtime mail configuration"
run_report "${COMPOSE[@]}" exec -T backend node -e '
const code = process.env.STGY_TEST_SIGNUP_CODE || "";
console.log(`backend STGY_TEST_SIGNUP_CODE: ${code.length === 0 ? "empty (mail enabled)" : "SET (mail disabled)"}`);
'
run_report "${COMPOSE[@]}" exec -T worker node -e '
console.log(`worker SMTP: ${process.env.STGY_SMTP_HOST}:${process.env.STGY_SMTP_PORT}`);
console.log(`worker sender: ${process.env.STGY_MAIL_SENDER_ADDRESS}`);
'

section "Redis mail queues"
run_report "${COMPOSE[@]}" exec -T worker node <<'NODE'
const Redis = require("ioredis");
const redis = new Redis({
  host: process.env.STGY_REDIS_HOST,
  port: Number(process.env.STGY_REDIS_PORT),
  password: process.env.STGY_REDIS_PASSWORD,
  lazyConnect: true,
});

(async () => {
  try {
    await redis.connect();
    const names = ["mail-queue", "mail-queue:processing"];
    for (const name of names) {
      const count = await redis.llen(name);
      const payloads = await redis.lrange(name, 0, 99);
      const types = {};
      for (const payload of payloads) {
        try {
          const type = JSON.parse(payload).type || "unknown";
          types[type] = (types[type] || 0) + 1;
        } catch {
          types.invalid = (types.invalid || 0) + 1;
        }
      }
      console.log(`${name}: ${count} task(s), sampled types=${JSON.stringify(types)}`);
    }
  } finally {
    redis.disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
NODE

section "Worker to Postfix SMTP"
run_report "${COMPOSE[@]}" exec -T worker node <<'NODE'
const nodemailer = require("nodemailer");
const transport = nodemailer.createTransport({
  host: process.env.STGY_SMTP_HOST,
  port: Number(process.env.STGY_SMTP_PORT),
  secure: false,
  tls: { rejectUnauthorized: false },
});

transport.verify()
  .then(() => console.log("OK: worker can connect to Postfix and complete SMTP handshake"))
  .catch((error) => {
    console.error(`FAILED: ${error}`);
    process.exitCode = 1;
  })
  .finally(() => transport.close());
NODE

section "Postfix configuration and resolver"
run_report "${COMPOSE[@]}" exec -T postfix sh -c '
for name in myhostname myorigin inet_protocols relayhost; do
  printf "%s=" "$name"
  postconf -h "$name"
done
printf "chroot resolv.conf: "
if test -s /var/spool/postfix/etc/resolv.conf; then echo OK; else echo MISSING; fi
printf "recipient MX lookup: "
if getent ahostsv4 gmail-smtp-in.l.google.com >/dev/null 2>&1; then echo OK; else echo FAILED; fi
'

section "Postfix outbound TCP 25 probe"
run_report "${COMPOSE[@]}" exec -T postfix sh -c '
if command -v posttls-finger >/dev/null 2>&1; then
  timeout 15 posttls-finger -a ipv4 -c -l may -L summary gmail.com
else
  echo "posttls-finger is unavailable"
fi
'

section "Postfix delivery queue"
run_report "${COMPOSE[@]}" exec -T postfix postqueue -p

section "Recent Caddy log"
run_report "${COMPOSE[@]}" logs --tail=80 caddy

section "Recent backend log"
run_report "${COMPOSE[@]}" logs --tail=80 backend

section "Recent worker log"
run_report "${COMPOSE[@]}" logs --tail=120 worker

section "Recent Postfix log"
run_report "${COMPOSE[@]}" logs --tail=160 postfix
