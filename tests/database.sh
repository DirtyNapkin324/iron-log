#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
container="iron-log-postgres-$$"
docker run --rm -d --name "$container" -e POSTGRES_PASSWORD=iron-log-test postgres:17 -c wal_level=logical >/dev/null
trap 'docker rm -f "$container" >/dev/null' EXIT
for attempt in {1..30}; do
  if docker exec "$container" pg_isready -h localhost -q; then break; fi
  sleep 1
done
sql() { docker exec -i "$container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres "$@"; }

sql < tests/bootstrap.sql >/dev/null
for migration in supabase/migrations/00*.sql; do sql -1 < "$migration" >/dev/null; done
sql < tests/legacy.sql >/dev/null
for migration in supabase/migrations/2*.sql; do sql -1 < "$migration" >/dev/null; done
sql < tests/regression.sql >/dev/null

# Run concurrent first writes from two sessions at the same expected revision.
actor="set role authenticated; set request.jwt.claim.sub='10000000-0000-0000-0000-000000000004';"
first=$(mktemp)
second=$(mktemp)
trap 'docker rm -f "$container" >/dev/null; rm -f "$first" "$second"' EXIT
sql -c "$actor begin; select public.save_workout_backup('{\"winner\":1}',null); select pg_sleep(1); commit;" >"$first" 2>&1 &
one=$!
sql -c "$actor select public.save_workout_backup('{\"winner\":2}',null);" >"$second" 2>&1 &
two=$!
one_status=0
two_status=0
wait "$one" || one_status=$?
wait "$two" || two_status=$?
if [[ "$one_status" = 0 && "$two_status" != 0 ]]; then
  grep -q 'Cloud backup changed elsewhere' "$second"
  winner=1
elif [[ "$one_status" != 0 && "$two_status" = 0 ]]; then
  grep -q 'Cloud backup changed elsewhere' "$first"
  winner=2
else
  cat "$first" "$second"
  exit 1
fi
[[ "$(sql -c "$actor select payload->>'winner' from public.workout_backups")" = "$winner" ]]

# Concurrent deltas both apply to the same personal record and group projection.
sql -c "$actor select public.log_water(current_date,8)" >/dev/null &
one=$!
sql -c "$actor select public.log_water(current_date,16)" >/dev/null &
two=$!
wait "$one"
wait "$two"
[[ "$(sql -c "$actor select oz from public.hydration_personal where day=current_date")" = 60 ]]
[[ "$(sql -c "$actor select oz from public.hydration_daily where day=current_date")" = 60 ]]
echo 'Database regression and concurrency checks passed.'
