#!/bin/sh
set -eu

export STORAGE_TEST_IMAGE=${STORAGE_TEST_IMAGE:-duo-test}
storage_dir=$(mktemp -d)
storage_project="duo-storage-$$"
compose() { docker compose -p "$storage_project" -f "$storage_dir/compose.yaml" "$@"; }
trap 'compose down -v >/dev/null 2>&1 || true; rm -rf "$storage_dir"' EXIT
cat > "$storage_dir/compose.yaml" <<'YAML'
services:
  store:
    image: ${STORAGE_TEST_IMAGE}
    user: '0:0'
    network_mode: none
    volumes:
      - '${DATA_VOLUME:-saved-data}:/data'
volumes:
  saved-data:
YAML

export DATA_VOLUME=saved-data
compose run --rm --no-deps -T store sh -c 'printf saved > /data/sentinel'
compose down
compose run --rm --no-deps -T store sh -c 'test "$(cat /data/sentinel)" = saved'
compose down -v
if docker volume inspect "${storage_project}_saved-data" >/dev/null 2>&1; then
  echo 'Named volume survived down -v unexpectedly' >&2
  exit 1
fi
echo 'PASS: named volume survives down and is removed by down -v'

mkdir "$storage_dir/data"
export DATA_VOLUME="$storage_dir/data"
compose run --rm --no-deps -T store sh -c 'printf saved > /data/sentinel'
compose down
test "$(cat "$storage_dir/data/sentinel")" = saved
compose down -v
test "$(cat "$storage_dir/data/sentinel")" = saved
echo 'PASS: bind directory survives both down and down -v'
