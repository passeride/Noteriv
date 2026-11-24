#!/bin/sh
# Idempotent first-time setup for a Garage cluster used by Noteriv attachments:
# assigns the single-node layout, creates the bucket and the access key, grants
# the key access. Safe to re-run: every step checks state first and skips if done.
#
# Usage:
#   GARAGE_CONTAINER=<container> [GARAGE_CONFIG=<path>] sh web/infra/garage-bootstrap.sh
#
#   dev  : GARAGE_CONTAINER=noteriv-garage GARAGE_CONFIG=/etc/garage.toml
#   prod : GARAGE_CONTAINER=<dokploy-slug>-noteriv-garage-1 (find with `docker ps | grep garage`)
#          GARAGE_CONFIG defaults to /etc/garage-conf/garage.toml (prod layout)
#
# Optional: GARAGE_BUCKET (default noteriv-attachments), GARAGE_KEY_NAME
# (default noteriv-attachments-key), GARAGE_CAPACITY (default 1G), GARAGE_ZONE (default dc1).
#
# The secret key is printed ONCE, only when the key is created by this run:
# Garage cannot show it again. Put it in the Dokploy compose env as
# ATTACHMENTS_S3_ACCESS_KEY_ID / ATTACHMENTS_S3_SECRET_ACCESS_KEY.
#
# Do NOT run against a production cluster that already serves data unless you
# are deliberately rebuilding it.

set -eu

: "${GARAGE_CONTAINER:?set GARAGE_CONTAINER to the Garage container name}"
GARAGE_CONFIG="${GARAGE_CONFIG:-/etc/garage-conf/garage.toml}"
GARAGE_BUCKET="${GARAGE_BUCKET:-noteriv-attachments}"
GARAGE_KEY_NAME="${GARAGE_KEY_NAME:-noteriv-attachments-key}"
GARAGE_CAPACITY="${GARAGE_CAPACITY:-1G}"
GARAGE_ZONE="${GARAGE_ZONE:-dc1}"

# The dxflrs/garage image has no shell, so exec the binary directly.
garage() {
  docker exec -e RUST_LOG=warn "$GARAGE_CONTAINER" /garage -c "$GARAGE_CONFIG" "$@"
}

echo "==> Chờ Garage sẵn sàng (container: $GARAGE_CONTAINER)"
i=0
until garage status >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "Garage không phản hồi sau 30 lần thử" >&2
    exit 1
  fi
  sleep 2
done

echo "==> Layout"
node_id=$(garage node id -q 2>/dev/null | sed 's/@.*//' | head -n 1)
if [ -z "$node_id" ]; then
  # Older/newer builds may not support -q; fall back to parsing the full output.
  node_id=$(garage node id 2>/dev/null | grep -o '^[0-9a-f]\{64\}' | head -n 1)
fi
[ -n "$node_id" ] || { echo "Không lấy được node id" >&2; exit 1; }

layout_out=$(garage layout show)
if echo "$layout_out" | grep -q "$(echo "$node_id" | cut -c1-16)"; then
  echo "    node đã có trong layout, bỏ qua"
else
  cur_version=$(echo "$layout_out" | sed -n 's/.*[Cc]urrent cluster layout version: *\([0-9][0-9]*\).*/\1/p' | head -n 1)
  next_version=$(( ${cur_version:-0} + 1 ))
  garage layout assign -z "$GARAGE_ZONE" -c "$GARAGE_CAPACITY" "$node_id"
  garage layout apply --version "$next_version"
  echo "    đã gán layout (version $next_version)"
fi

echo "==> Bucket $GARAGE_BUCKET"
if garage bucket info "$GARAGE_BUCKET" >/dev/null 2>&1; then
  echo "    đã tồn tại, bỏ qua"
else
  garage bucket create "$GARAGE_BUCKET"
fi

echo "==> Access key $GARAGE_KEY_NAME"
if garage key info "$GARAGE_KEY_NAME" >/dev/null 2>&1; then
  echo "    đã tồn tại, bỏ qua (secret không thể xem lại)"
else
  key_out=$(garage key create "$GARAGE_KEY_NAME")
  key_id=$(echo "$key_out" | sed -n 's/^Key ID: *//p' | head -n 1)
  secret=$(echo "$key_out" | sed -n 's/^Secret key: *//p' | head -n 1)
  echo "    ĐÃ TẠO KEY — lưu ngay, sẽ không hiện lại:"
  echo "    ATTACHMENTS_S3_ACCESS_KEY_ID=$key_id"
  echo "    ATTACHMENTS_S3_SECRET_ACCESS_KEY=$secret"
fi

echo "==> Cấp quyền key trên bucket"
garage bucket allow --read --write --owner "$GARAGE_BUCKET" --key "$GARAGE_KEY_NAME"

echo "Hoàn tất."
