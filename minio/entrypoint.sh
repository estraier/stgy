#! /bin/sh

set -eu

pid=""

stop_child() {
  signal="${1:-TERM}"
  trap - INT TERM HUP
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "-$signal" "$pid" 2>/dev/null || true
  fi
  wait "$pid" 2>/dev/null || true
}

trap 'stop_child TERM; exit 143' TERM
trap 'stop_child INT; exit 130' INT
trap 'stop_child HUP; exit 129' HUP

"$@" &
pid=$!

echo "==> waiting for MinIO to be ready..."
i=0
until curl -fsS http://localhost:9000/minio/health/ready >/dev/null 2>&1; do
  if ! kill -0 "$pid" 2>/dev/null; then
    if wait "$pid"; then
      status=0
    else
      status=$?
    fi
    if [ "$status" -eq 0 ]; then
      status=1
    fi
    echo "MinIO exited before becoming ready (status=$status)" >&2
    exit "$status"
  fi

  i=$((i+1))
  if [ "$i" -gt 180 ]; then
    echo "MinIO not ready (timeout)" >&2
    stop_child TERM
    exit 1
  fi
  sleep 1
done

if /init.sh; then
  :
else
  status=$?
  echo "MinIO initialization failed (status=$status)" >&2
  stop_child TERM
  exit "$status"
fi

wait "$pid"
