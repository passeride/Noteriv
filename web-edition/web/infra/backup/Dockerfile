# Nightly encrypted backup of Noteriv (Postgres + Garage attachments) to a private
# GitHub repo. See README.md in this directory.
FROM alpine:3.20

RUN apk add --no-cache bash coreutils postgresql16-client git openssh-client age rclone curl jq tzdata

# GitHub's published SSH host keys (https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints),
# pinned so the container never trusts a host key on first use.
COPY known_hosts /etc/backup/known_hosts
COPY lib.sh backup.sh restore.sh /backup/
COPY crontab /etc/crontabs/root
RUN chmod 755 /backup/*.sh && chmod 644 /etc/backup/known_hosts

WORKDIR /backup
# busybox crond in the foreground; jobs log to PID 1's stdout (see crontab).
CMD ["crond", "-f", "-l", "8"]
