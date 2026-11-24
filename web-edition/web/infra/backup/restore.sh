#!/bin/bash
# Restores one backup slot into an EMPTY Postgres database and an S3 bucket, then
# checks the restored counts against the slot's manifest.json. See README.md and
# docs/ops/sao-luu-khoi-phuc.md.
#
# Usage: restore.sh <slot> [--force-nonempty] [--skip-attachments] [--show-secrets]
#
# Env:
#   AGE_IDENTITY_FILE     age secret key (provided temporarily by the owner; delete afterwards)
#   BACKUP_REPO, BACKUP_DEPLOY_KEY_B64
#   TARGET_DATABASE_URL   database to restore INTO (deliberately not DATABASE_URL)
#   TARGET_S3_ENDPOINT, TARGET_S3_ACCESS_KEY_ID, TARGET_S3_SECRET_ACCESS_KEY,
#   TARGET_S3_BUCKET (default noteriv-attachments), TARGET_S3_REGION (default garage)
#
# --show-secrets only decrypts secrets.env.age to stdout and exits (nothing restored).
set -Eeuo pipefail

. /backup/lib.sh
export LC_ALL=C

SLOT="${1:?usage: restore.sh <slot> [--force-nonempty] [--skip-attachments] [--show-secrets]}"
shift
FORCE_NONEMPTY=0 SKIP_ATT=0 SHOW_SECRETS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --force-nonempty) FORCE_NONEMPTY=1 ;;
    --skip-attachments) SKIP_ATT=1 ;;
    --show-secrets) SHOW_SECRETS=1 ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

WORK=""
trap 'cleanup_git_ssh; [ -n "$WORK" ] && rm -rf "$WORK"' EXIT
trap 'log "failed at line $LINENO: $BASH_COMMAND"' ERR

require_env AGE_IDENTITY_FILE
[ -r "$AGE_IDENTITY_FILE" ] || die "cannot read AGE_IDENTITY_FILE"
decrypt() { age -d -i "$AGE_IDENTITY_FILE"; }

setup_git_ssh
WORK=$(mktemp -d /tmp/noteriv-restore.XXXXXX)
S="$WORK/slot"

log "fetching slot $SLOT"
git clone -q --depth 1 --single-branch --branch "$SLOT" "$BACKUP_REPO" "$S"

if [ "$SHOW_SECRETS" = 1 ]; then
  decrypt < "$S/secrets.env.age"
  exit 0
fi

require_env TARGET_DATABASE_URL
M="$S/manifest.json"
log "manifest: $(jq -c '{createdAt, sourceCommit, latestMigration, counts, attachments: {objects: .attachments.objects, skipped: .attachments.skipped}}' "$M")"
PGURL=$(pg_url "$TARGET_DATABASE_URL")

TABLES=$(psql "$PGURL" -tAX -c "select count(*) from information_schema.tables where table_schema = 'public'")
if [ "$TABLES" != 0 ] && [ "$FORCE_NONEMPTY" != 1 ]; then
  die "target database already has $TABLES tables; refusing (use an empty database, or --force-nonempty)"
fi

log "restoring database"
# Streamed: the plaintext dump never touches the disk.
cat_maybe_split "$S/db.dump.age" | decrypt | pg_restore --clean --if-exists --no-owner --no-privileges -d "$PGURL"

FAIL=0
q() { psql "$PGURL" -tAX -c "$1"; }
check() { # name, expected, actual
  if [ "$2" = "$3" ]; then log "OK   $1: $3"; else log "DIFF $1: manifest $2, restored $3"; FAIL=1; fi
}
check users "$(jq -r .counts.users "$M")" "$(q 'select count(*) from users')"
check notes "$(jq -r .counts.notes "$M")" "$(q 'select count(*) from notes')"
check attachments "$(jq -r .counts.attachments "$M")" "$(q 'select count(*) from attachments')"
check migration "$(jq -r .latestMigration "$M")" \
  "$(q 'select migration_name from _prisma_migrations where finished_at is not null order by finished_at desc limit 1')"

if [ "$SKIP_ATT" = 1 ]; then
  log "attachments skipped (--skip-attachments)"
elif [ "$(jq -r .attachments.skipped "$M")" = true ]; then
  log "WARNING: this backup did not include attachments (over the size limit)"
  FAIL=1
else
  require_env TARGET_S3_ENDPOINT TARGET_S3_ACCESS_KEY_ID TARGET_S3_SECRET_ACCESS_KEY
  BUCKET="${TARGET_S3_BUCKET:-noteriv-attachments}"
  setup_rclone_remote target "$TARGET_S3_ENDPOINT" "$TARGET_S3_ACCESS_KEY_ID" \
    "$TARGET_S3_SECRET_ACCESS_KEY" "${TARGET_S3_REGION:-garage}"

  decrypt < "$S/attachments.list.age" > "$WORK/attachments.list"
  check "attachment list sha256" "$(jq -r .attachments.listSha256 "$M")" "$(sha256sum < "$WORK/attachments.list" | cut -d' ' -f1)"
  COMMIT=$(jq -r .attachments.branchCommit "$M")
  N=$(wc -l < "$WORK/attachments.list" | tr -d ' ')
  if [ "$N" -gt 0 ]; then
    BRANCH=$(jq -r '.attachments.branch // "attachments"' "$M")
    log "fetching $BRANCH at $COMMIT"
    A="$WORK/att"
    git clone -q --no-checkout --single-branch --branch "$BRANCH" "$BACKUP_REPO" "$A"
    git -C "$A" -c advice.detachedHead=false checkout -q "$COMMIT"
    i=0
    while IFS= read -r key; do
      cat_maybe_split "$A/attachments/$key.age" | decrypt | rclone rcat "target:$BUCKET/$key"
      i=$((i + 1))
      if [ $((i % 50)) = 0 ]; then log "  $i/$N attachments"; fi
    done < "$WORK/attachments.list"
  fi
  check "attachment objects" "$N" "$(rclone lsf -R --files-only "target:$BUCKET" | wc -l | tr -d ' ')"
fi

if [ "$FAIL" = 0 ]; then
  log "restore of $SLOT finished: all checks match the manifest"
else
  die "restore of $SLOT finished WITH DIFFERENCES (see DIFF lines above)"
fi
