#!/usr/bin/env bash
# Acceptance test for 009_security_hardening.sql against a DISPOSABLE local
# Supabase stack (`supabase start`). Never point this at a real project: it
# drops and recreates the public schema.
#
#   BASELINE=legacy|modern bash supabase/tests/009_acceptance.sh
#
# legacy = public-schema defaults that grant anon/authenticated/service_role
#          full table privileges + function EXECUTE (older Supabase projects)
# modern = defaults shipped by current Supabase CLI images (no anon/
#          authenticated table writes; functions only EXECUTE via PUBLIC)
set -uo pipefail

DB_URL=${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}
API=${API:-http://127.0.0.1:54321/rest/v1}
JWT_SECRET=${JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long}
BASELINE=${BASELINE:-legacy}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
MIG=$ROOT/supabase/migrations
U1=11111111-1111-1111-1111-111111111111
U2=22222222-2222-2222-2222-222222222222
PASS=0; FAIL=0
TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT

case "$DB_URL" in *127.0.0.1*|*localhost*) ;; *) echo "refusing non-local DB_URL"; exit 2;; esac

q()  { psql "$DB_URL" -X -qAt -v ON_ERROR_STOP=1 -c "$1"; }
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
# rest METHOD PATH TOKEN [BODY] -> prints "<http status> <body>"
rest() {
  local args=(-s -o "$TMPD/body" -w '%{http_code}' -X "$1" "$API/$2" -H "apikey: $3" -H "Authorization: Bearer $3"
              -H 'Content-Type: application/json' -H 'Prefer: return=representation')
  [ $# -ge 4 ] && args+=(--data-raw "$4")
  curl "${args[@]}"; printf ' %s' "$(cat "$TMPD/body")"; }
check() { # name expected-regex actual
  if [[ "$3" =~ $2 ]]; then PASS=$((PASS+1)); echo "PASS  $1  [$3]"
  else FAIL=$((FAIL+1)); echo "FAIL  $1  expected /$2/ got [$3]"; fi; }
counters() { q "select id||' total='||screens_used_total||' week='||screens_used_this_week||' bonus='||referral_bonus_screens||' tier='||tier||' invites='||invite_attempt_count from public.profiles order by id"; }
acl() { q "select p.oid::regprocedure||' '||coalesce(p.proacl::text,'<default: PUBLIC+owner>')||' cfg='||coalesce(p.proconfig::text,'-') from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('reserve_screens','refund_screens','increment_referral_bonus','check_and_increment_invite_attempts') order by 1";
        q "select 'profiles '||relacl::text from pg_class where oid='public.profiles'::regclass";
        q "select 'profiles col-grants '||grantee||' '||privilege_type||': '||string_agg(column_name,',' order by column_name) from information_schema.column_privileges where table_schema='public' and table_name='profiles' and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE') group by grantee,privilege_type order by 1"; }
fn_digest() { q "select md5(string_agg(pg_get_functiondef(p.oid)||coalesce((select string_agg(a::text,',' order by a::text) from unnest(p.proacl) a),'<null>'),'|' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('reserve_screens','refund_screens','increment_referral_bonus','check_and_increment_invite_attempts')"; }
fn_body_digest() { q "select md5(string_agg(pg_get_functiondef(p.oid),'|' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('reserve_screens','refund_screens','increment_referral_bonus','check_and_increment_invite_attempts')"; }
tbl_digest() { q "select md5((select string_agg(a::text,',' order by a::text) from unnest(relacl) a)||coalesce((select string_agg(attname||coalesce(attacl::text,''),',' order by attnum) from pg_attribute where attrelid='public.profiles'::regclass and attnum>0),'')) from pg_class where oid='public.profiles'::regclass"; }

reset_db() {
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
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
  for f in 001 002 003 004 005 006 007 008 20260910194017; do
    psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$MIG"/${f}_*.sql >/dev/null 2>&1 || { echo "setup failed at $f"; exit 2; }
  done
  q "insert into auth.users (id, email, aud, role, raw_user_meta_data) values ('$U1','u1@test.local','authenticated','authenticated','{}'), ('$U2','u2@test.local','authenticated','authenticated','{}')"
  q "update public.profiles set is_beta_user=false, tier='free', screens_used_total=2, screens_used_this_week=2, referral_bonus_screens=0, invite_attempt_count=0"
  q "notify pgrst, 'reload schema'"; sleep 1
}

echo "################ BASELINE=$BASELINE"
reset_db
PRE_FN=$(fn_digest); PRE_BODY=$(fn_body_digest); PRE_TBL=$(tbl_digest)
echo "--- ACL before 009"; acl
echo "--- counters before"; counters

echo "--- pre-009 exploits (documented, not asserted)"
echo "auth PATCH own tier=paid: $(rest PATCH "profiles?id=eq.$U1" "$A1" '{"tier":"paid"}' | cut -c1-90)"
echo "auth refund_screens(50) : $(rest POST rpc/refund_screens "$A1" '{"p_user_id":"'"$U1"'","p_amount":50,"p_use_weekly":true}' | cut -c1-90)"
echo "anon increment_referral : $(rest POST rpc/increment_referral_bonus "$ANON" '{"target_user_id":"'"$U1"'","amount":999}' | cut -c1-90)"
echo "svc  increment_referral : $(rest POST rpc/increment_referral_bonus "$SVC" '{"target_user_id":"'"$U2"'","amount":10}' | cut -c1-90)"
counters
reset_db

echo "--- atomic failure: 009 with an injected error before COMMIT"
sed 's/^commit;$/select 1\/0;\ncommit;/' "$MIG"/009_security_hardening.sql > $TMPD/009broken.sql
out=$(psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f $TMPD/009broken.sql 2>&1); rc=$?
check "broken 009 (psql -f) exits non-zero" '^[1-9]' "$rc $(echo "$out" | grep -o 'division by zero' | head -1)"
check "broken 009 (psql -f) leaves functions+ACL unchanged" "^$PRE_FN$" "$(fn_digest)"
check "broken 009 (psql -f) leaves profiles ACL unchanged" "^$PRE_TBL$" "$(tbl_digest)"
# SQL-editor style: whole file as one simple-query message
psql "$DB_URL" -X -q -c "$(cat $TMPD/009broken.sql)" >/dev/null 2>&1
check "broken 009 (single message) leaves functions+ACL unchanged" "^$PRE_FN$" "$(fn_digest)"
check "broken 009 (single message) leaves profiles ACL unchanged" "^$PRE_TBL$" "$(tbl_digest)"
rm -f $TMPD/009broken.sql

echo "--- apply 009"
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$MIG"/009_security_hardening.sql >/dev/null || { echo "009 apply failed"; exit 1; }
q "notify pgrst, 'reload schema'"; sleep 1
echo "--- ACL after 009"; acl
echo "--- counters before tests"; counters

echo "--- anon denied"
for body in "reserve_screens {\"p_user_id\":\"$U1\",\"p_amount\":1,\"p_use_weekly\":true,\"p_limit\":99}" \
            "refund_screens {\"p_user_id\":\"$U1\",\"p_amount\":1,\"p_use_weekly\":true}" \
            "increment_referral_bonus {\"target_user_id\":\"$U1\",\"amount\":999}" \
            "check_and_increment_invite_attempts {\"p_user_id\":\"$U1\",\"p_max_attempts\":999,\"p_window_ms\":0}"; do
  check "anon rpc ${body%% *} denied" '^(401|403) .*42501' "$(rest POST rpc/${body%% *} "$ANON" "${body#* }")"
done
check "anon PATCH profiles denied" '^(401|403) .*42501' "$(rest PATCH "profiles?id=eq.$U1" "$ANON" '{"full_name":"x"}')"

echo "--- authenticated (U1) denied on server-only RPCs"
check "auth reserve_screens denied" '^(401|403) .*42501' "$(rest POST rpc/reserve_screens "$A1" '{"p_user_id":"'"$U1"'","p_amount":1,"p_use_weekly":true,"p_limit":99}')"
for i in 1 2 3; do
  check "auth refund_screens #$i denied" '^(401|403) .*42501' "$(rest POST rpc/refund_screens "$A1" '{"p_user_id":"'"$U1"'","p_amount":1,"p_use_weekly":true}')"
done
check "auth refund_screens other user denied" '^(401|403) .*42501' "$(rest POST rpc/refund_screens "$A1" '{"p_user_id":"'"$U2"'","p_amount":1,"p_use_weekly":true}')"
check "auth increment_referral_bonus denied" '^(401|403) .*42501' "$(rest POST rpc/increment_referral_bonus "$A1" '{"target_user_id":"'"$U1"'","amount":999}')"
check "U1 usage unchanged by refund attempts (2/2)" "^$U1 total=2 week=2 bonus=0" "$(counters | grep $U1)"

echo "--- profile column privileges"
for col in '"tier":"paid"' '"pending_order_id":null' '"screens_used_this_week":0' '"referral_bonus_screens":999' '"is_beta_user":true' '"invite_attempt_count":0'; do
  check "auth PATCH own {$col} denied" '^(401|403) .*42501' "$(rest PATCH "profiles?id=eq.$U1" "$A1" "{$col}")"
done
check "auth POST insert profile denied" '^(401|403) .*42501' "$(rest POST profiles "$A1" '{"id":"'"$U1"'","email":"x","tier":"paid"}')"
if [ "$BASELINE" = legacy ]; then
  check "auth PATCH own full_name allowed" '^200 .*"full_name":"Edited"' "$(rest PATCH "profiles?id=eq.$U1&select=full_name" "$A1" '{"full_name":"Edited"}')"
  check "auth PATCH own preferences allowed" '^200 \[\{' "$(rest PATCH "profiles?id=eq.$U1&select=id" "$A1" '{"preferences":{"a":1}}')"
  check "auth PATCH other user's full_name affects 0 rows" '^200 \[\]$' "$(rest PATCH "profiles?id=eq.$U2&select=id" "$A1" '{"full_name":"pwned"}')"
else
  check "modern: authenticated has no SELECT on profiles (pre-existing), so editable-column PATCH is denied" '^403 .*42501' "$(rest PATCH "profiles?id=eq.$U1&select=full_name" "$A1" '{"full_name":"Edited"}')"
fi
check "U2 full_name untouched" '^$' "$(q "select full_name from public.profiles where id='$U2' and full_name='pwned'")"
check "U1 tier still free" "tier=free" "$(counters | grep $U1)"

echo "--- service_role reserve/refund (legit server flow, weekly limit 3, U1 starts week=2)"
check "svc reserve 1 (week 2->3)" '^200 true' "$(rest POST rpc/reserve_screens "$SVC" '{"p_user_id":"'"$U1"'","p_amount":1,"p_use_weekly":true,"p_limit":3}')"
check "svc reserve over limit refused" '^200 false' "$(rest POST rpc/reserve_screens "$SVC" '{"p_user_id":"'"$U1"'","p_amount":1,"p_use_weekly":true,"p_limit":3}')"
for a in 0 -5 51 null; do
  check "svc reserve p_amount=$a rejected" '^400 .*22023' "$(rest POST rpc/reserve_screens "$SVC" '{"p_user_id":"'"$U1"'","p_amount":'"$a"',"p_use_weekly":true,"p_limit":999999}')"
  check "svc refund p_amount=$a rejected" '^400 .*22023' "$(rest POST rpc/refund_screens "$SVC" '{"p_user_id":"'"$U1"'","p_amount":'"$a"',"p_use_weekly":true}')"
done
check "svc reserve p_limit=null rejected" '^400 .*22023' "$(rest POST rpc/reserve_screens "$SVC" '{"p_user_id":"'"$U1"'","p_amount":1,"p_use_weekly":true,"p_limit":null}')"
check "U1 counters after reserve (3/3)" "total=3 week=3" "$(counters | grep $U1)"
check "svc refund 1 (failed item)" '^204' "$(rest POST rpc/refund_screens "$SVC" '{"p_user_id":"'"$U1"'","p_amount":1,"p_use_weekly":true}')"
check "U1 counters after refund (2/2)" "total=2 week=2" "$(counters | grep $U1)"
check "svc reserve beta allotment (total-based)" '^200 true' "$(rest POST rpc/reserve_screens "$SVC" '{"p_user_id":"'"$U2"'","p_amount":1,"p_use_weekly":false,"p_limit":25}')"
check "U2 total 2->3, week unchanged" "^$U2 total=3 week=2" "$(counters | grep $U2)"

echo "--- service_role referral bonus"
check "svc increment_referral_bonus" '^204' "$(rest POST rpc/increment_referral_bonus "$SVC" '{"target_user_id":"'"$U2"'","amount":10}')"
check "U2 bonus 0->10" "^$U2 .*bonus=10" "$(counters | grep $U2)"

echo "--- invite limiter: fixed 5/15min despite adversarial params"
for i in 1 2 3 4 5; do
  check "auth invite attempt $i allowed" '^200 true' "$(rest POST rpc/check_and_increment_invite_attempts "$A1" '{"p_user_id":"'"$U1"'","p_max_attempts":100000,"p_window_ms":0}')"
done
check "auth invite attempt 6 refused (window_ms=0 ignored)" '^200 false' "$(rest POST rpc/check_and_increment_invite_attempts "$A1" '{"p_user_id":"'"$U1"'","p_max_attempts":100000,"p_window_ms":0}')"
check "auth invite against other user's row refused" '^200 false' "$(rest POST rpc/check_and_increment_invite_attempts "$A1" '{"p_user_id":"'"$U2"'","p_max_attempts":5,"p_window_ms":900000}')"
check "U2 invite counter untouched" "^$U2 .*invites=0" "$(counters | grep $U2)"
check "U1 invite counter = 5" "^$U1 .*invites=5" "$(counters | grep $U1)"
q "update public.profiles set invite_attempt_window_started_at = now() - interval '16 minutes' where id='$U1'"
check "auth invite allowed after real 15min window" '^200 true' "$(rest POST rpc/check_and_increment_invite_attempts "$A1" '{"p_user_id":"'"$U1"'","p_max_attempts":0,"p_window_ms":999999999}')"

echo "--- counters after tests"; counters

echo "--- recovery script"
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$ROOT"/supabase/rollbacks/009_security_hardening_rollback.sql >/dev/null; rc=$?
check "rollback applies cleanly" '^0$' "$rc"
q "notify pgrst, 'reload schema'"; sleep 1
echo "--- ACL after rollback"; acl
if [ "$BASELINE" = legacy ]; then
  check "rollback restores exact pre-009 function defs+ACLs" "^$PRE_FN$" "$(fn_digest)"
  check "rollback restores exact pre-009 profiles ACL" "^$PRE_TBL$" "$(tbl_digest)"
else
  check "rollback restores exact pre-009 function bodies" "^$PRE_BODY$" "$(fn_body_digest)"
  echo "NOTE  modern baseline: pre-009 function ACLs were NULL (PUBLIC+owner); rollback grants are explicit but equivalent-or-wider,"
  echo "NOTE  and rollback section 1 grants anon/authenticated INSERT/UPDATE on profiles that did not exist before (documented)"
fi
check "rollback reopens: auth refund_screens callable" '^204' "$(rest POST rpc/refund_screens "$A1" '{"p_user_id":"'"$U1"'","p_amount":1,"p_use_weekly":true}')"
check "rollback keeps svc reserve working" '^200 (true|false)' "$(rest POST rpc/reserve_screens "$SVC" '{"p_user_id":"'"$U1"'","p_amount":1,"p_use_weekly":true,"p_limit":99}')"

echo "--- re-apply 009 after rollback (forward again)"
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$MIG"/009_security_hardening.sql >/dev/null; rc=$?
check "009 re-applies after rollback" '^0$' "$rc"

rm -f $TMPD/body
echo "################ BASELINE=$BASELINE  PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
