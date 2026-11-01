#!/bin/sh
set -eu
umask 077
env_file=${1:-.env}
database_url=${DATABASE_URL:-}
if [ -z "$database_url" ] && [ -f "$env_file" ]; then
  database_url=$(grep -E '^DATABASE_URL=' "$env_file" | tail -n 1 | cut -d= -f2- | sed -e "s/^'//" -e "s/'$//" -e 's/^"//' -e 's/"$//')
fi
if [ -z "$database_url" ]; then
  printf 'Set DATABASE_URL in %s or the environment before backing up.\n' "$env_file" >&2
  exit 2
fi
client_image=${PG_CLIENT_IMAGE:-postgres:18-alpine}
backup_directory=${BACKUP_DIR:-backups}
mkdir -p "$backup_directory"
partial_path=$(mktemp "$backup_directory/zhu-jia-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
trap 'rm -f "$partial_path"' EXIT HUP INT TERM
docker run --rm --add-host host.docker.internal:host-gateway \
  -e DATABASE_URL="$database_url" "$client_image" \
  sh -c 'exec pg_dump "$DATABASE_URL" --format=custom' > "$partial_path"
test -s "$partial_path"
backup_path="$partial_path.dump"
mv "$partial_path" "$backup_path"
printf 'Backup saved: %s\n' "$backup_path"
