# noteriv-backup

Nightly (02:00 Asia/Ho_Chi_Minh) encrypted backup of the production Postgres database and
Garage attachments to the private GitHub repo `covuaduongsinh/noteriv-backups`.
Runbook for the owner (Vietnamese, step by step): [`docs/ops/sao-luu-khoi-phuc.md`](../../../docs/ops/sao-luu-khoi-phuc.md).
Design: [`docs/plans/2026-10-14-phien-0-1-sao-luu.md`](../../../docs/plans/2026-10-14-phien-0-1-sao-luu.md).

## Repo layout

| Branch | Content | How it is written |
|---|---|---|
| `attachments` | `attachments/<storageKey>.age`, one file per Garage object | append-only, normal push. Storage keys are `<vaultId>/<uuid>-<name>` and never overwritten, so each object is encrypted and uploaded once. Objects deleted from Garage stay (older DB dumps still reference them). |
| `daily-mon` … `daily-sun`, `weekly-0` … `weekly-3` (Sundays, ISO week % 4), `monthly-01` … `monthly-12` (1st of month) | `db.dump.age` (`pg_dump -Fc`), `secrets.env.age`, `attachments.list.age` (storage keys at backup time), `manifest.json`, `README.txt` | one orphan commit, `push --force` into each slot of the day. At most 23 slots. |

Everything except `manifest.json` / `README.txt` is encrypted with age to `BACKUP_AGE_RECIPIENT`.
Only the **public** key is on the server; the owner keeps the secret key offline. Files over 90MB are
split into `<name>.part-aa`, `-ab`, … (GitHub's 100MB limit); the scripts join them.

`manifest.json` holds no user data: time, slots, source commit, latest Prisma migration, row counts
(users/notes/attachments), sizes, attachments branch + commit, sha256 of the key list, names of
secrets that were missing.

If attachments exceed `BACKUP_ATTACHMENTS_MAX_BYTES` (default 1.5GiB) they are skipped, the DB is still
backed up, and the run reports **fail** to healthchecks — time to move attachments to R2/B2.

## Environment

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | same as the API (the `?schema=` suffix is stripped for libpq) |
| `ATTACHMENTS_S3_ENDPOINT`, `_REGION`, `_BUCKET`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY` | Garage, same as the worker |
| `BACKUP_REPO` | `git@github.com:covuaduongsinh/noteriv-backups.git` |
| `BACKUP_DEPLOY_KEY_B64` | base64 of the repo's deploy key (write access). Written to tmpfs `/run/backup` per run and deleted after |
| `BACKUP_AGE_RECIPIENT` | age public key (`age1…`) |
| `BACKUP_HEALTHCHECK_URL` | healthchecks.io ping URL; `/start`, success, `/fail` are sent |
| `POSTGRES_PASSWORD`, `JWT_*`, `ENCRYPTION_KEY`, `GARAGE_*`, `PDF_SERVICE_TOKEN` | only stored, encrypted, in `secrets.env.age` (plaintext exists only in a pipe) |
| `BACKUP_ATTACHMENTS_BRANCH` | default `attachments`; override for test runs so they never touch the real branch |
| `SOURCE_COMMIT` | recorded in the manifest if Dokploy provides it, else `unknown` |

GitHub's SSH host keys are pinned in `known_hosts` (from GitHub's published fingerprints).

## Run by hand (on the VPS)

```sh
C=$(docker ps --format '{{.Names}}' | grep noteriv-backup)
docker exec "$C" /backup/backup.sh                 # today's slots
docker exec "$C" /backup/backup.sh --slot test-x   # a throwaway slot (delete it afterwards)
docker logs --tail 50 "$C"                         # nightly runs log here
```

## Restore drill (on the VPS)

`drill.sh up` creates an empty Postgres + Garage on an isolated network (`noteriv-restore-drill`,
not `dokploy-network`), with RAM limits, and writes their env to `/dev/shm/noteriv-drill.env`.
`restore.sh` refuses a non-empty target database.

```sh
cd <copy of web/infra>/backup && bash drill.sh up
# the owner's age secret key, copied temporarily: scp backup-age.key vps:/dev/shm/drill-age.key
C=$(docker ps --format '{{.Names}}' | grep noteriv-backup)
docker run --rm --network noteriv-restore-drill --memory 128m --tmpfs /run/backup:mode=700 \
  -e BACKUP_DEPLOY_KEY_B64="$(docker exec "$C" printenv BACKUP_DEPLOY_KEY_B64)" \
  -e BACKUP_REPO=git@github.com:covuaduongsinh/noteriv-backups.git \
  --env-file /dev/shm/noteriv-drill.env -e AGE_IDENTITY_FILE=/run/age.key \
  -v /dev/shm/drill-age.key:/run/age.key:ro "$(docker inspect -f '{{.Config.Image}}' "$C")" \
  /backup/restore.sh daily-mon
shred -u /dev/shm/drill-age.key && bash drill.sh down
```

`restore.sh` prints `OK`/`DIFF` for users, notes, attachments, latest migration, the key list hash and
the number of restored objects, and exits non-zero on any difference. `restore.sh <slot> --show-secrets`
only prints the decrypted `secrets.env` to stdout.

A real restore uses the same command with `TARGET_*` pointing at the fresh production database and
Garage (see the runbook); never at a database that still holds data.
