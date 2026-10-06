#!/usr/bin/env bash
# Acceptance test for 010_candidate_profiles.sql against a DISPOSABLE local
# Supabase stack (`supabase start`). Never point this at a real project: it
# drops and recreates the public schema.
#
#   BASELINE=legacy|modern bash supabase/tests/010_acceptance.sh
set -uo pipefail

DB_URL=${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}
API_ROOT=${API_ROOT:-http://127.0.0.1:54321}
API=$API_ROOT/rest/v1
JWT_SECRET=${JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long}
BASELINE=${BASELINE:-legacy}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
MIG=$ROOT/supabase/migrations
U1=11111111-1111-1111-1111-111111111111
U2=22222222-2222-2222-2222-222222222222
HASH1=$(printf 'a%.0s' {1..64}); HASH2=$(printf 'b%.0s' {1..64})
PASS=0; FAIL=0
TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT

case "$DB_URL" in *127.0.0.1*|*localhost*) ;; *) echo "refusing non-local DB_URL"; exit 2;; esac

q() { psql "$DB_URL" -X -qAt -v ON_ERROR_STOP=1 -c "$1"; }
jwt() { python3 - "$JWT_SECRET" "$1" "${2:-}" <<'PY'
import base64,hmac,hashlib,json,sys,time
b=lambda d: base64.urlsafe_b64encode(d).rstrip(b'=').decode()
secret,role,sub=sys.argv[1:4]
claims={'role':role,'iss':'supabase-demo','exp':int(time.time())+3600}
if sub: claims.update(sub=sub, aud='authenticated')
h=b(json.dumps({'alg':'HS256','typ':'JWT'}).encode()); p=b(json.dumps(claims).encode())
print(f"{h}.{p}.{b(hmac.new(secret.encode(),f'{h}.{p}'.encode(),hashlib.sha256).digest())}")
PY
}
ANON=$(jwt anon); SVC=$(jwt service_role); A1=$(jwt authenticated $U1)
rest() {
  local args=(-s -o "$TMPD/body" -w '%{http_code}' -X "$1" "$API/$2" -H "apikey: $3" -H "Authorization: Bearer $3"
              -H 'Content-Type: application/json' -H 'Prefer: return=representation')
  [ $# -ge 4 ] && args+=(--data-raw "$4")
  curl "${args[@]}"; printf ' %s' "$(cut -c1-200 "$TMPD/body")"; }
check() { if [[ "$3" =~ $2 ]]; then PASS=$((PASS+1)); echo "PASS  $1  [$3]"; else FAIL=$((FAIL+1)); echo "FAIL  $1  expected /$2/ got [$3]"; fi; }
row() { echo '{"user_id":"'"$1"'","resume_sha256":"'"$2"'","schema_version":1,"extractor_version":"cip-deterministic-1","profile":{"identity":null,"note":"'"$3"'"}}'; }
acl() { q "select 'candidate_profiles '||coalesce(relacl::text,'<default>')||' rls='||relrowsecurity||' force='||relforcerowsecurity from pg_class where oid='public.candidate_profiles'::regclass"
        q "select 'policy '||policyname||' '||cmd||' '||array_to_string(roles,',')||' using '||coalesce(qual,'-')||' check '||coalesce(with_check,'-') from pg_policies where tablename='candidate_profiles'"; }

reset_db() {
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
delete from auth.users where id in ('$U1','$U2');
drop schema if exists public cascade;
create schema public;
grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to postgres;
$( if [ "$BASELINE" = legacy ]; then cat <<'L'
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
L
else cat <<'M'
alter default privileges for role postgres in schema public grant delete, truncate, references, trigger, maintain on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant update on sequences to anon, authenticated, service_role;
M
fi )
SQL
  for f in 001 002 003 004 005 006 007 008 20260910194017 009; do
    psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$MIG"/${f}_*.sql >/dev/null 2>&1 || { echo "setup failed at $f"; exit 2; }
  done
  q "insert into auth.users (id, email, aud, role, raw_user_meta_data) values ('$U1','u1@test.local','authenticated','authenticated','{}'), ('$U2','u2@test.local','authenticated','authenticated','{}')"
}
reload() { q "notify pgrst, 'reload schema'"; sleep 1; }

echo "################ BASELINE=$BASELINE"
reset_db

echo "--- atomic failure: 010 with an injected error before COMMIT"
sed 's/^commit;$/select 1\/0;\ncommit;/' "$MIG"/010_candidate_profiles.sql > "$TMPD/010broken.sql"
psql "$DB_URL" -X -q -c "$(cat "$TMPD/010broken.sql")" >/dev/null 2>&1
check "broken 010 leaves no table" '^$' "$(q "select to_regclass('public.candidate_profiles')")"

echo "--- apply 010"
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$MIG"/010_candidate_profiles.sql >/dev/null || { echo "010 apply failed"; exit 1; }
reload; acl

echo "--- service role writes (server-derived profiles)"
check "svc upsert U1" '^201' "$(rest POST 'candidate_profiles?on_conflict=user_id' "$SVC" "$(row $U1 $HASH1 u1-secret)")"
check "svc upsert U2" '^201' "$(rest POST 'candidate_profiles?on_conflict=user_id' "$SVC" "$(row $U2 $HASH1 u2-secret)")"
check "svc reads both" '^200 \[.*u1-secret.*u2-secret' "$(rest GET 'candidate_profiles?select=user_id,profile&order=user_id' "$SVC")"
check "invalid hash rejected" '^400 .*23514' "$(rest POST 'candidate_profiles?on_conflict=user_id' "$SVC" "$(row $U1 not-a-hash x)")"

echo "--- anon denied"
check "anon select denied" '^(401|403) .*42501' "$(rest GET 'candidate_profiles?select=user_id' "$ANON")"
check "anon insert denied" '^(401|403) .*42501' "$(rest POST candidate_profiles "$ANON" "$(row $U1 $HASH2 forged)")"

echo "--- authenticated: own read only, no writes"
check "U1 sees only own row" "^200 \\[\\{\"user_id\":\"$U1\"\\}\\]$" "$(rest GET 'candidate_profiles?select=user_id' "$A1")"
check "U1 cannot read U2 by filter" '^200 \[\]$' "$(rest GET "candidate_profiles?select=user_id&user_id=eq.$U2" "$A1")"
check "U1 insert own denied" '^(401|403) .*42501' "$(rest POST candidate_profiles "$A1" "$(row $U1 $HASH2 forged)")"
check "U1 upsert as U2 denied" '^(401|403) .*42501' "$(rest POST 'candidate_profiles?on_conflict=user_id' "$A1" "$(row $U2 $HASH2 forged)")"
check "U1 update own denied" '^(401|403) .*42501' "$(rest PATCH "candidate_profiles?user_id=eq.$U1" "$A1" '{"profile":{"identity":"executive"}}')"
check "U1 delete own denied" '^(401|403) .*42501' "$(rest DELETE "candidate_profiles?user_id=eq.$U1" "$A1")"
check "U1 profile unchanged" 'u1-secret' "$(q "select profile::text from public.candidate_profiles where user_id='$U1'")"
check "no forged rows" '^0$' "$(q "select count(*) from public.candidate_profiles where profile::text like '%forged%'")"

echo "--- once per resume version through the real store (service-role supabase-js)"
SERVICE_KEY=$SVC SUPABASE_URL=$API_ROOT USER_ID=$U1 node --experimental-strip-types --disable-warning=ExperimentalWarning \
  --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import "$ROOT/evals/recommendation/alias-hooks.mjs" "$ROOT/supabase/tests/010_store_check.mjs" > "$TMPD/store.txt" 2>&1
cat "$TMPD/store.txt"
check "store: build, reuse, rebuild on change" '^built reused reused built$' "$(grep '^statuses' "$TMPD/store.txt" | cut -d' ' -f2-)"
check "store: reuse does not rewrite the row" '^updated_at_unchanged=true$' "$(grep '^updated_at' "$TMPD/store.txt")"

echo "--- cascade on account deletion"
q "delete from auth.users where id='$U2'"
check "U2 profile removed with account" '^0$' "$(q "select count(*) from public.candidate_profiles where user_id='$U2'")"

echo "################ BASELINE=$BASELINE  PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
