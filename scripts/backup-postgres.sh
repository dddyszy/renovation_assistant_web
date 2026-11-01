#!/bin/sh
set -eu
umask 077
env_file=${1:-.env}
database_version=${2:-18}
case "$database_version" in
  17) compose_database=compose.postgres17.yaml ;;
  18) compose_database=compose.postgres.yaml ;;
  *) printf 'Unsupported PostgreSQL version: %s (use 17 or 18)\n' "$database_version" >&2; exit 2 ;;
esac
backup_directory=${BACKUP_DIR:-backups}
mkdir -p "$backup_directory"
partial_path=$(mktemp "$backup_directory/zhu-jia-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
backup_path="$partial_path.dump"
trap 'rm -f "$partial_path"' EXIT HUP INT TERM
docker compose --env-file "$env_file" -f compose.yaml -f "$compose_database" exec -T db \
  sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$partial_path"
test -s "$partial_path"
mv "$partial_path" "$backup_path"
printf 'Backup saved: %s\n' "$backup_path"
