#!/usr/bin/env bash
# Acceptance test for 011_role_profiles.sql against a DISPOSABLE local
# Supabase stack (`supabase start`). Never point this at a real project: it
# drops and recreates the public schema.
#
#   BASELINE=legacy|modern bash supabase/tests/011_acceptance.sh
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
row() { echo '{"content_sha256":"'"$1"'","schema_version":1,"extractor_version":"rip-deterministic-1","page_kind":"'"${3:-job_page}"'","source_kind":"pasted","source_text":"'"$2"'","raw_sha256":"'"$1"'","profile":{"note":"'"$2"'"}}'; }
acl() { q "select 'role_profiles '||coalesce(relacl::text,'<default>')||' rls='||relrowsecurity from pg_class where oid='public.role_profiles'::regclass"
        q "select 'policies: '||count(*) from pg_policies where tablename='role_profiles'"; }

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
  for f in 001 002 003 004 005 006 007 008 20260910194017 009 010; do
    psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$MIG"/${f}_*.sql >/dev/null 2>&1 || { echo "setup failed at $f"; exit 2; }
  done
  q "insert into auth.users (id, email, aud, role, raw_user_meta_data) values ('$U1','u1@test.local','authenticated','authenticated','{}'), ('$U2','u2@test.local','authenticated','authenticated','{}')"
}
reload() { q "notify pgrst, 'reload schema'"; sleep 1; }

echo "################ BASELINE=$BASELINE"
reset_db

echo "--- atomic failure: 011 with an injected error before COMMIT"
sed 's/^commit;$/select 1\/0;\ncommit;/' "$MIG"/011_role_profiles.sql > "$TMPD/011broken.sql"
psql "$DB_URL" -X -q -c "$(cat "$TMPD/011broken.sql")" >/dev/null 2>&1
check "broken 011 leaves no table" '^$' "$(q "select to_regclass('public.role_profiles')")"

echo "--- apply 011"
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$MIG"/011_role_profiles.sql >/dev/null || { echo "011 apply failed"; exit 1; }
reload; acl

echo "--- service role reads and writes the cache"
check "svc insert" '^201' "$(rest POST 'role_profiles?on_conflict=content_sha256' "$SVC" "$(row $HASH1 job-one)")"
check "svc read" '^200 .*job-one' "$(rest GET 'role_profiles?select=content_sha256,source_text' "$SVC")"
check "inaccessible pages cannot be cached" '^400 .*23514' "$(rest POST 'role_profiles?on_conflict=content_sha256' "$SVC" "$(row $HASH2 blocked inaccessible)")"
check "invalid hash rejected" '^400 .*23514' "$(rest POST role_profiles "$SVC" "$(row nothex x)")"

echo "--- no client access at all"
for who in ANON A1; do tok=${!who}
  check "$who select denied" '^(401|403) .*42501' "$(rest GET 'role_profiles?select=content_sha256' "$tok")"
  check "$who insert denied" '^(401|403) .*42501' "$(rest POST role_profiles "$tok" "$(row $HASH2 forged)")"
  check "$who update denied" '^(401|403) .*42501' "$(rest PATCH "role_profiles?content_sha256=eq.$HASH1" "$tok" '{"source_text":"tampered"}')"
  check "$who delete denied" '^(401|403) .*42501' "$(rest DELETE "role_profiles?content_sha256=eq.$HASH1" "$tok")"
done
check "cache row untouched" '^job-one$' "$(q "select source_text from public.role_profiles where content_sha256='$HASH1'")"

echo "--- identical content reuses the cache through the real store (service-role supabase-js)"
SERVICE_KEY=$SVC SUPABASE_URL=$API_ROOT node --experimental-strip-types --disable-warning=ExperimentalWarning \
  --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import "$ROOT/evals/recommendation/alias-hooks.mjs" "$ROOT/supabase/tests/011_store_check.mjs" > "$TMPD/store.txt" 2>&1
cat "$TMPD/store.txt"
check "first batch: built, duplicate shares, listing cached, blocked page not cached" '^built built built not_cached$' "$(grep '^batch1' "$TMPD/store.txt" | cut -d' ' -f2-)"
check "second request (same job pasted with page chrome): reused" '^reused reused$' "$(grep '^batch2' "$TMPD/store.txt" | cut -d' ' -f2-)"
check "extractions: 3 in batch 1 (job, listing, blocked page), 0 in batch 2" '^extractions 3 3$' "$(grep '^extractions' "$TMPD/store.txt")"
check "reuse does not rewrite rows" '^updated_at_unchanged=true$' "$(grep '^updated_at' "$TMPD/store.txt")"
check "stored rows: seeded + job + other job + listing, nothing for the blocked page" '^rows 4 job_page,job_page,job_page,listing_page$' "$(grep '^rows' "$TMPD/store.txt")"

echo "################ BASELINE=$BASELINE  PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
