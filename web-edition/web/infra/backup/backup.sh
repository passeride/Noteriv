#!/bin/bash
# Nightly encrypted backup of Noteriv to a private GitHub repo. See README.md.
#
# Repo layout:
#   branch `attachments`        append-only; one age-encrypted file per Garage object,
#                               attachments/<storageKey>.age (keys are immutable UUID paths,
#                               so each object is uploaded exactly once)
#   branches daily-*/weekly-*/monthly-*
#                               one orphan commit each, force-pushed ("rotating slots"):
#                               db.dump.age, secrets.env.age, attachments.list.age, manifest.json
#
# Usage: backup.sh [--slot NAME]   (--slot overrides the date-based slots, e.g. for a test run)
set -Eeuo pipefail

. /backup/lib.sh
export LC_ALL=C # stable sort order for comm

exec 9>/tmp/noteriv-backup.lock
flock -n 9 || die "another backup is already running"

FORCED_SLOT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --slot) FORCED_SLOT="${2:?--slot needs a name}"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

WORK=""
on_exit() {
  local rc=$?
  cleanup_git_ssh
  [ -n "$WORK" ] && rm -rf "$WORK"
  if [ $rc -ne 0 ]; then ping_hc fail "backup failed (exit $rc), see container logs"; fi
}
trap on_exit EXIT
trap 'log "failed at line $LINENO: $BASH_COMMAND"' ERR

ping_hc start
require_env DATABASE_URL BACKUP_AGE_RECIPIENT BACKUP_REPO BACKUP_DEPLOY_KEY_B64 \
  ATTACHMENTS_S3_ENDPOINT ATTACHMENTS_S3_ACCESS_KEY_ID ATTACHMENTS_S3_SECRET_ACCESS_KEY

BUCKET="${ATTACHMENTS_S3_BUCKET:-noteriv-attachments}"
MAX_ATTACH_BYTES="${BACKUP_ATTACHMENTS_MAX_BYTES:-1610612736}" # 1.5GiB
ATT_BRANCH="${BACKUP_ATTACHMENTS_BRANCH:-attachments}" # overridable so test runs never touch the real branch
PGURL=$(pg_url "$DATABASE_URL")
encrypt() { age -r "$BACKUP_AGE_RECIPIENT"; }

setup_git_ssh
setup_rclone_remote garage "$ATTACHMENTS_S3_ENDPOINT" "$ATTACHMENTS_S3_ACCESS_KEY_ID" \
  "$ATTACHMENTS_S3_SECRET_ACCESS_KEY" "${ATTACHMENTS_S3_REGION:-garage}"

WORK=$(mktemp -d /tmp/noteriv-backup.XXXXXX)

# ---- slots ---------------------------------------------------------------
if [ -n "$FORCED_SLOT" ]; then
  SLOTS=("$FORCED_SLOT")
else
  SLOTS=("daily-$(date +%a | tr '[:upper:]' '[:lower:]')")
  [ "$(date +%u)" = 7 ] && SLOTS+=("weekly-$((10#$(date +%V) % 4))")
  [ "$(date +%d)" = 01 ] && SLOTS+=("monthly-$(date +%m)")
fi
log "slots: ${SLOTS[*]}"

# ---- attachments (append-only branch) ------------------------------------
log "listing bucket $BUCKET"
rclone lsf -R --files-only --format sp --separator ' ' "garage:$BUCKET" > "$WORK/objects.txt"
cut -d' ' -f2 "$WORK/objects.txt" | sort -u > "$WORK/attachments.list"
ATTACH_COUNT=$(wc -l < "$WORK/attachments.list" | tr -d ' ')
ATTACH_BYTES=$(awk '{s+=$1} END {printf "%d", s}' "$WORK/objects.txt")
ATTACH_SKIPPED=false
ATTACH_NEW=0
ATTACH_COMMIT=""

if [ "$ATTACH_BYTES" -gt "$MAX_ATTACH_BYTES" ]; then
  ATTACH_SKIPPED=true
  log "attachments total $ATTACH_BYTES bytes exceeds $MAX_ATTACH_BYTES: skipping (move attachments to R2/B2)"
else
  ATT="$WORK/att"
  if git ls-remote --exit-code --heads "$BACKUP_REPO" "$ATT_BRANCH" >/dev/null 2>&1; then
    git clone -q --depth 1 --filter=blob:none --no-checkout --single-branch --branch "$ATT_BRANCH" "$BACKUP_REPO" "$ATT"
    git -C "$ATT" read-tree HEAD
    HAVE_PARENT=1
  else
    git init -q "$ATT"
    git -C "$ATT" remote add origin "$BACKUP_REPO"
    HAVE_PARENT=0
  fi
  git -C "$ATT" ls-files | sed -e 's#^attachments/##' -e 's#\.age\(\.part-..\)\{0,1\}$##' | sort -u > "$WORK/have.txt"
  comm -23 "$WORK/attachments.list" "$WORK/have.txt" > "$WORK/new.txt"
  ATTACH_NEW=$(wc -l < "$WORK/new.txt" | tr -d ' ')
  log "attachments: $ATTACH_COUNT objects ($ATTACH_BYTES bytes), $ATTACH_NEW new"

  if [ "$ATTACH_NEW" -gt 0 ]; then
    mkdir -p "$WORK/enc"
    while IFS= read -r key; do
      tmp="$WORK/enc/obj.age"
      rclone cat "garage:$BUCKET/$key" | encrypt > "$tmp"
      for part in $(maybe_split "$tmp"); do
        sha=$(git -C "$ATT" hash-object -w "$part")
        git -C "$ATT" update-index --add --cacheinfo "100644,$sha,attachments/$key.age${part#"$tmp"}"
        rm -f "$part"
      done
    done < "$WORK/new.txt"
    tree=$(git -C "$ATT" write-tree)
    if [ "$HAVE_PARENT" = 1 ]; then
      commit=$(git_id -C "$ATT" commit-tree "$tree" -p HEAD -m "attachments: +$ATTACH_NEW")
    else
      commit=$(git_id -C "$ATT" commit-tree "$tree" -m "attachments: +$ATTACH_NEW")
    fi
    git -C "$ATT" push -q origin "$commit:refs/heads/$ATT_BRANCH"
    ATTACH_COMMIT="$commit"
  else
    ATTACH_COMMIT=$( [ "$HAVE_PARENT" = 1 ] && git -C "$ATT" rev-parse HEAD || echo "")
  fi
fi

# ---- database, secrets, manifest -------------------------------------------
SLOT_DIR="$WORK/slot"
mkdir -p "$SLOT_DIR"
log "dumping database"
pg_dump -Fc "$PGURL" | encrypt > "$SLOT_DIR/db.dump.age"
DB_DUMP_BYTES=$(stat -c %s "$SLOT_DIR/db.dump.age")
maybe_split "$SLOT_DIR/db.dump.age" > /dev/null

SECRET_VARS="POSTGRES_PASSWORD JWT_ACCESS_SECRET JWT_REFRESH_SECRET ENCRYPTION_KEY GARAGE_RPC_SECRET GARAGE_ADMIN_TOKEN ATTACHMENTS_S3_ACCESS_KEY_ID ATTACHMENTS_S3_SECRET_ACCESS_KEY PDF_SERVICE_TOKEN"
SECRETS_MISSING=()
for v in $SECRET_VARS; do [ -n "${!v:-}" ] || SECRETS_MISSING+=("$v"); done
# Plaintext only ever exists in this pipe.
for v in $SECRET_VARS; do if [ -n "${!v:-}" ]; then printf '%s=%s\n' "$v" "${!v}"; fi; done | encrypt > "$SLOT_DIR/secrets.env.age"

encrypt < "$WORK/attachments.list" > "$SLOT_DIR/attachments.list.age"

q() { psql "$PGURL" -tAX -c "$1"; }
USERS=$(q "select count(*) from users")
NOTES=$(q "select count(*) from notes")
ATTACH_ROWS=$(q "select count(*) from attachments")
MIGRATION=$(q "select migration_name from _prisma_migrations where finished_at is not null order by finished_at desc limit 1")
LIST_SHA=$(sha256sum < "$WORK/attachments.list" | cut -d' ' -f1)

jq -n \
  --arg createdAt "$(date -Iseconds)" \
  --arg slots "${SLOTS[*]}" \
  --arg sourceCommit "${SOURCE_COMMIT:-unknown}" \
  --arg migration "$MIGRATION" \
  --argjson users "$USERS" --argjson notes "$NOTES" --argjson attachmentRows "$ATTACH_ROWS" \
  --argjson dbDumpBytes "$DB_DUMP_BYTES" \
  --argjson attCount "$ATTACH_COUNT" --argjson attBytes "$ATTACH_BYTES" --argjson attNew "$ATTACH_NEW" \
  --argjson attSkipped "$ATTACH_SKIPPED" --arg attBranch "$ATT_BRANCH" --arg attCommit "$ATTACH_COMMIT" --arg listSha "$LIST_SHA" \
  --arg secretsMissing "${SECRETS_MISSING[*]:-}" \
  '{
    format: 1,
    createdAt: $createdAt,
    slots: ($slots | split(" ")),
    sourceCommit: $sourceCommit,
    latestMigration: $migration,
    counts: { users: $users, notes: $notes, attachments: $attachmentRows },
    db: { file: "db.dump.age", encryptedBytes: $dbDumpBytes },
    attachments: { objects: $attCount, bytes: $attBytes, newThisRun: $attNew, skipped: $attSkipped,
                   branch: $attBranch, branchCommit: $attCommit, listSha256: $listSha },
    secrets: { missing: ($secretsMissing | split(" ") | map(select(. != ""))) }
  }' > "$SLOT_DIR/manifest.json"

cat > "$SLOT_DIR/README.txt" <<'EOF'
Noteriv backup slot. Everything except manifest.json and this file is encrypted with age.
Restore with web/infra/backup/restore.sh (runbook: docs/ops/sao-luu-khoi-phuc.md).
EOF

# ---- push slots -------------------------------------------------------------
git init -q "$SLOT_DIR"
git -C "$SLOT_DIR" remote add origin "$BACKUP_REPO"
git -C "$SLOT_DIR" checkout -q --orphan backup
git -C "$SLOT_DIR" add -A
git_id -C "$SLOT_DIR" commit -q -m "backup $(date -Iseconds) (${SLOTS[*]})"
SLOT_SHA=$(git -C "$SLOT_DIR" rev-parse HEAD)
for s in "${SLOTS[@]}"; do
  git -C "$SLOT_DIR" push -q --force origin "HEAD:refs/heads/$s"
  remote_sha=$(git ls-remote "$BACKUP_REPO" "refs/heads/$s" | cut -f1)
  [ "$remote_sha" = "$SLOT_SHA" ] || die "slot $s: remote has $remote_sha, expected $SLOT_SHA"
  log "pushed slot $s ($SLOT_SHA)"
done

if [ "$ATTACH_SKIPPED" = true ]; then
  ping_hc fail "database backed up, but attachments ($ATTACH_BYTES bytes) exceed the limit and were skipped"
  log "done (attachments skipped)"
else
  ping_hc ok "slots ${SLOTS[*]}; db $DB_DUMP_BYTES B; attachments +$ATTACH_NEW/$ATTACH_COUNT"
  log "done"
fi
