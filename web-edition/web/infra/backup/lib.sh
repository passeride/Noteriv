#!/bin/bash
# Shared helpers for backup.sh and restore.sh. Sourced, not executed.

log() { printf '%s [backup] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

require_env() {
  local missing=() v
  for v in "$@"; do [ -n "${!v:-}" ] || missing+=("$v"); done
  [ ${#missing[@]} -eq 0 ] || die "missing env: ${missing[*]}"
}

# libpq rejects Prisma's `?schema=public` query parameter, so strip any query string.
pg_url() { printf '%s' "${1%%\?*}"; }

# healthchecks.io ping. $1 = start|ok|fail, $2 = optional message (sent as body).
# Never fails the caller: monitoring trouble must not abort or mask a backup.
ping_hc() {
  [ -n "${BACKUP_HEALTHCHECK_URL:-}" ] || return 0
  local url="${BACKUP_HEALTHCHECK_URL%/}"
  case "$1" in
    start) url="$url/start" ;;
    fail) url="$url/fail" ;;
  esac
  curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "${2:-}" "$url" || log "healthcheck ping ($1) failed"
}

# Writes the deploy key into tmpfs and points git's ssh at it, with GitHub's
# host keys pinned from the image (no trust-on-first-use).
setup_git_ssh() {
  require_env BACKUP_DEPLOY_KEY_B64 BACKUP_REPO
  KEY_DIR="${BACKUP_KEY_DIR:-/run/backup}"
  mkdir -p "$KEY_DIR"
  chmod 700 "$KEY_DIR"
  KEY_FILE="$KEY_DIR/deploy_key"
  (umask 077 && printf '%s' "$BACKUP_DEPLOY_KEY_B64" | base64 -d > "$KEY_FILE") || die "BACKUP_DEPLOY_KEY_B64 is not valid base64"
  export GIT_SSH_COMMAND="ssh -i $KEY_FILE -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/etc/backup/known_hosts"
  export GIT_TERMINAL_PROMPT=0
}

cleanup_git_ssh() { [ -n "${KEY_FILE:-}" ] && rm -f "$KEY_FILE"; return 0; }

# rclone remote named $1 configured purely from env (no config file on disk).
# $2 = endpoint, $3 = access key id, $4 = secret, $5 = region
setup_rclone_remote() {
  local name; name=$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')
  export "RCLONE_CONFIG_${name}_TYPE=s3"
  export "RCLONE_CONFIG_${name}_PROVIDER=Other"
  export "RCLONE_CONFIG_${name}_ENDPOINT=$2"
  export "RCLONE_CONFIG_${name}_ACCESS_KEY_ID=$3"
  export "RCLONE_CONFIG_${name}_SECRET_ACCESS_KEY=$4"
  export "RCLONE_CONFIG_${name}_REGION=${5:-garage}"
  export "RCLONE_CONFIG_${name}_FORCE_PATH_STYLE=true"
  export RCLONE_S3_NO_CHECK_BUCKET=true
  export RCLONE_LOG_LEVEL=ERROR # hides the harmless "config file not found" notice
}

git_id() { git -c user.name=noteriv-backup -c user.email=backup@noteriv.invalid "$@"; }

# GitHub rejects files over 100MB. Splits $1 in place into $1.part-aa, -ab, ...
# when it is larger than 90MB; prints the resulting file names.
SPLIT_BYTES=$((90 * 1024 * 1024))
maybe_split() {
  local f="$1" size
  size=$(stat -c %s "$f")
  if [ "$size" -gt "$SPLIT_BYTES" ]; then
    split -b "$SPLIT_BYTES" "$f" "$f.part-"
    rm -f "$f"
    ls "$f".part-*
  else
    printf '%s\n' "$f"
  fi
}

# Prints the content of an object stored as either <path> or <path>.part-*.
cat_maybe_split() {
  local f="$1"
  if [ -f "$f" ]; then cat "$f"
  elif ls "$f".part-* >/dev/null 2>&1; then cat "$f".part-*
  else die "missing $f"
  fi
}
