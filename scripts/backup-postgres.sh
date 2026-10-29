#!/bin/sh
set -eu
umask 077
env_file=${1:-.env.docker}
backup_directory=${BACKUP_DIR:-backups}
mkdir -p "$backup_directory"
partial_path=$(mktemp "$backup_directory/zhu-jia-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
backup_path="$partial_path.dump"
trap 'rm -f "$partial_path"' EXIT HUP INT TERM
docker compose --env-file "$env_file" -f compose.yaml -f compose.postgres.yaml exec -T db \
  sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$partial_path"
test -s "$partial_path"
mv "$partial_path" "$backup_path"
printf 'Backup saved: %s\n' "$backup_path"
