#!/bin/bash
# Host watchdog for the shared Noteriv VPS. Run from cron every 10 minutes (see README.md).
# Pings healthchecks.io on success and <url>/fail on trouble, so a missing signal (VPS down,
# cron dead) and a bad reading both end up as an email.
#
# Config comes from /etc/noteriv/check-host.env (chmod 600, not in git):
#   CHECK_HOST_URL=https://hc-ping.com/<uuid>
# Optional overrides: DISK_MAX_PCT (default 90), MEM_MIN_MB (default 300),
# CHECK_HOST_ENV (alternate env file, used for tests).
# Test the failure path without breaking anything: CHECK_HOST_FORCE_FAIL=1 check-host.sh
set -u

ENV_FILE="${CHECK_HOST_ENV:-/etc/noteriv/check-host.env}"
# shellcheck disable=SC1090
[ -r "$ENV_FILE" ] && . "$ENV_FILE"

DISK_MAX_PCT="${DISK_MAX_PCT:-90}"
MEM_MIN_MB="${MEM_MIN_MB:-300}"
: "${CHECK_HOST_URL:?set CHECK_HOST_URL in $ENV_FILE}"

# Root filesystem use in percent. `df -P` is portable and keeps each filesystem on one line.
disk_pct=$(df -P / | awk 'NR==2 { gsub("%", "", $5); print $5 }')
# MemAvailable, not the `free` column: that one drops to ~150MB during every image build
# even though the machine is fine, and would page the owner for nothing.
mem_mb=$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo)

problems=""
[ -n "$disk_pct" ] && [ "$disk_pct" -gt "$DISK_MAX_PCT" ] && problems="disk ${disk_pct}% (max ${DISK_MAX_PCT}%)"
[ -n "$mem_mb" ] && [ "$mem_mb" -lt "$MEM_MIN_MB" ] && problems="${problems:+$problems; }mem ${mem_mb}MB available (min ${MEM_MIN_MB}MB)"
[ -z "$disk_pct" ] || [ -z "$mem_mb" ] && problems="${problems:+$problems; }could not read disk/mem"
[ "${CHECK_HOST_FORCE_FAIL:-}" = "1" ] && problems="${problems:+$problems; }forced failure (test)"

summary="disk=${disk_pct:-?}% mem_available=${mem_mb:-?}MB"
url="${CHECK_HOST_URL%/}"
if [ -n "$problems" ]; then
  curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "$problems | $summary" "$url/fail" || echo "check-host: could not reach $url/fail" >&2
  echo "check-host: FAIL: $problems" >&2
  exit 1
fi
curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "$summary" "$url" || { echo "check-host: could not reach healthcheck URL" >&2; exit 1; }
echo "check-host: ok ($summary)"
