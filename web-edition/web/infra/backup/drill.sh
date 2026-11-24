#!/bin/bash
# Throwaway restore target for a restore drill, run ON THE VPS HOST (needs docker):
# an empty Postgres + a fresh single-node Garage on their own network, NOT attached
# to dokploy-network, with RAM limits. Nothing here touches production containers.
#
#   bash drill.sh up     # creates everything, writes the target env to /dev/shm/noteriv-drill.env
#   bash drill.sh down   # removes containers, volumes, network and the env file
#
# Then restore into it with the backup image (see README.md, "Restore drill").
set -Eeuo pipefail

NET=noteriv-restore-drill
PG=noteriv-drill-pg
GA=noteriv-drill-garage
ENV_OUT=/dev/shm/noteriv-drill.env
CONF_DIR=/dev/shm/noteriv-drill-garage
HERE=$(cd "$(dirname "$0")" && pwd)

case "${1:-}" in
up)
  docker network inspect "$NET" >/dev/null 2>&1 && { echo "drill already up; run 'down' first" >&2; exit 1; }
  umask 077
  pg_pass=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')
  rpc_secret=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  admin_token=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')

  docker network create "$NET" >/dev/null
  # Named volume (not anonymous) so `down` removes exactly this one and nothing else.
  docker run -d --name "$PG" --network "$NET" --memory 256m -v noteriv-drill-pgdata:/var/lib/postgresql/data \
    -e POSTGRES_USER=noteriv -e POSTGRES_PASSWORD="$pg_pass" -e POSTGRES_DB=noteriv \
    postgres:16-alpine >/dev/null

  mkdir -p "$CONF_DIR"
  cat > "$CONF_DIR/garage.toml" <<EOF
metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "$rpc_secret"
[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:3900"
root_domain = ".s3.garage.localhost"
[admin]
api_bind_addr = "[::]:3903"
admin_token = "$admin_token"
EOF
  chmod 644 "$CONF_DIR/garage.toml"
  docker run -d --name "$GA" --network "$NET" --memory 192m \
    -v "$CONF_DIR/garage.toml:/etc/garage.toml:ro" -v noteriv-drill-garagedata:/var/lib/garage \
    dxflrs/garage:v1.0.1 /garage -c /etc/garage.toml server >/dev/null

  out=$(GARAGE_CONTAINER="$GA" GARAGE_CONFIG=/etc/garage.toml GARAGE_KEY_NAME=drill-key sh "$HERE/../garage-bootstrap.sh")
  key_id=$(printf '%s\n' "$out" | sed -n 's/^ *ATTACHMENTS_S3_ACCESS_KEY_ID=//p')
  secret=$(printf '%s\n' "$out" | sed -n 's/^ *ATTACHMENTS_S3_SECRET_ACCESS_KEY=//p')
  [ -n "$key_id" ] && [ -n "$secret" ] || { echo "garage bootstrap did not return a key" >&2; exit 1; }

  for _ in $(seq 30); do docker exec "$PG" pg_isready -U noteriv >/dev/null 2>&1 && break; sleep 2; done
  cat > "$ENV_OUT" <<EOF
TARGET_DATABASE_URL=postgresql://noteriv:$pg_pass@$PG:5432/noteriv
TARGET_S3_ENDPOINT=http://$GA:3900
TARGET_S3_ACCESS_KEY_ID=$key_id
TARGET_S3_SECRET_ACCESS_KEY=$secret
TARGET_S3_BUCKET=noteriv-attachments
TARGET_S3_REGION=garage
EOF
  echo "drill target up; env written to $ENV_OUT (network $NET)"
  ;;
down)
  docker rm -f "$PG" "$GA" >/dev/null 2>&1 || true
  docker volume rm noteriv-drill-garagedata noteriv-drill-pgdata >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$CONF_DIR" "$ENV_OUT"
  echo "drill target removed"
  ;;
*)
  echo "usage: drill.sh up|down" >&2
  exit 2
  ;;
esac
