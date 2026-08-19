#!/usr/bin/env bash
# F8 Subscription Enforcement — Backend Test Matrix (10 cases)
# Uses psql + curl only (no npm packages needed).
# Run: bash scripts/f8-test-matrix.sh
set -euo pipefail

BASE="http://localhost:8080/api"
# Load .env vars
set -a
# shellcheck disable=SC1091
source artifacts/api-server/.env
set +a

PASS="Test1234!"
# bcrypt hash of Test1234! (cost 10) — pre-computed
HASH='$2b$10$HSxokEucSxnSCyfokDMzSObX3ziiJjwr4w6WsTRbL3lHYgPEHeU7a'
TS=$(date +%s%N | head -c 13)

PASS_=0
FAIL_=0

assert() {
  local label="$1" actual="$2" expected="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "  ✅ $label: $actual"
    PASS_=$((PASS_+1))
  else
    echo "  ❌ $label: expected '$expected', got '$actual'"
    FAIL_=$((FAIL_+1))
  fi
}

api_get() {
  local path="$1" token="${2:-}"
  local auth_header=""
  [[ -n "$token" ]] && auth_header="-H \"Authorization: Bearer $token\""
  eval "curl -s -o /tmp/f8_body -w '%{http_code}' $auth_header \"$BASE$path\""
}

api_post() {
  local path="$1" body="$2" token="${3:-}"
  local auth_header=""
  [[ -n "$token" ]] && auth_header="-H \"Authorization: Bearer $token\""
  eval "curl -s -o /tmp/f8_body -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '$body' $auth_header \"$BASE$path\""
}

db() {
  psql "$DATABASE_URL" -t -c "$1" 2>/dev/null | tr -d ' '
}

get_field() {
  # get_field <json_key> from /tmp/f8_body
  python3 -c "import json,sys; d=json.load(open('/tmp/f8_body')); print(d.get('$1',''))" 2>/dev/null || true
}

# ── Get Trial plan id ─────────────────────────────────────────────────────────
PLAN_ID=$(db "SELECT id FROM plans WHERE name='Trial' LIMIT 1")
echo "Trial plan id: $PLAN_ID"

# ── Helper: create user + creche + (optional) subscription ────────────────────
create_scenario() {
  local label="$1" sub_status="$2" trial_expires="$3"
  local email="f8-${label}-${TS}@test.invalid"

  local user_id
  user_id=$(db "INSERT INTO users (name,email,password_hash,role,is_active,must_change_password)
    VALUES ('F8 ${label}','${email}','${HASH}','creche_admin',true,false)
    RETURNING id")

  local creche_id
  creche_id=$(db "INSERT INTO creches (name,address,phone,email,admin_id,status)
    VALUES ('F8 ${label}','Rua Teste','11999999','${email}',${user_id},'active')
    RETURNING id")

  db "UPDATE users SET creche_id=${creche_id} WHERE id=${user_id}" >/dev/null

  if [[ "$sub_status" != "NONE" ]]; then
    local trial_clause="NULL"
    [[ -n "$trial_expires" ]] && trial_clause="'${trial_expires}'"
    db "INSERT INTO subscriptions (creche_id,plan_id,status,trial_ends_at,current_period_end)
      VALUES (${creche_id},${PLAN_ID},'${sub_status}',${trial_clause},NOW()+INTERVAL '30 days')" >/dev/null
  fi

  echo "${creche_id}:${email}"
}

# ── Create all scenarios ──────────────────────────────────────────────────────
echo ""
echo "── Creating test scenarios ──────────────────────────────────────────────"

ACTIVE_INFO=$(create_scenario "active"     "active"    "")
ACTIVE_CID="${ACTIVE_INFO%%:*}"; ACTIVE_EMAIL="${ACTIVE_INFO##*:}"

TRIAL_INFO=$(create_scenario "trialvld"   "trial"     "2099-12-31 23:59:59")
TRIAL_CID="${TRIAL_INFO%%:*}"; TRIAL_EMAIL="${TRIAL_INFO##*:}"

EXPIRED_INFO=$(create_scenario "trialexp"  "trial"     "2026-07-01 00:00:00")
EXPIRED_CID="${EXPIRED_INFO%%:*}"; EXPIRED_EMAIL="${EXPIRED_INFO##*:}"

SUSP_INFO=$(create_scenario "suspended"  "suspended" "")
SUSP_CID="${SUSP_INFO%%:*}"; SUSP_EMAIL="${SUSP_INFO##*:}"

CANC_INFO=$(create_scenario "cancelled"  "cancelled" "")
CANC_CID="${CANC_INFO%%:*}"; CANC_EMAIL="${CANC_INFO##*:}"

PAST_INFO=$(create_scenario "pastdue"    "past_due"  "")
PAST_CID="${PAST_INFO%%:*}"; PAST_EMAIL="${PAST_INFO##*:}"

# Missing subscription: user + creche, NO subscription row
MISSING_EMAIL="f8-missing-${TS}@test.invalid"
MISSING_UID=$(db "INSERT INTO users (name,email,password_hash,role,is_active,must_change_password)
  VALUES ('F8 missing','${MISSING_EMAIL}','${HASH}','creche_admin',true,false) RETURNING id")
MISSING_CID=$(db "INSERT INTO creches (name,address,phone,email,admin_id,status)
  VALUES ('F8 missing','Rua Teste','11999999','${MISSING_EMAIL}',${MISSING_UID},'active') RETURNING id")
db "UPDATE users SET creche_id=${MISSING_CID} WHERE id=${MISSING_UID}" >/dev/null

# Tutor for crecheActive
TUTOR_EMAIL="f8-tutor-${TS}@test.invalid"
TUTOR_UID=$(db "INSERT INTO users (name,email,password_hash,role,is_active,must_change_password)
  VALUES ('F8 tutor','${TUTOR_EMAIL}','${HASH}','tutor',true,false) RETURNING id")
db "UPDATE users SET creche_id=${ACTIVE_CID} WHERE id=${TUTOR_UID}" >/dev/null

echo "Scenarios: active=$ACTIVE_CID trial=$TRIAL_CID expired=$EXPIRED_CID suspended=$SUSP_CID cancelled=$CANC_CID pastdue=$PAST_CID missing=$MISSING_CID"

# ── Login helper ──────────────────────────────────────────────────────────────
get_token() {
  local email="$1"
  api_post "/auth/login" "{\"email\":\"${email}\",\"password\":\"${PASS}\"}" "" >/dev/null
  python3 -c "import json; print(json.load(open('/tmp/f8_body')).get('token',''))" 2>/dev/null
}

echo ""
echo "── Obtaining tokens ─────────────────────────────────────────────────────"
TK_ACTIVE=$(get_token "$ACTIVE_EMAIL")
TK_TRIAL=$(get_token "$TRIAL_EMAIL")
TK_EXPIRED=$(get_token "$EXPIRED_EMAIL")
TK_SUSP=$(get_token "$SUSP_EMAIL")
TK_CANC=$(get_token "$CANC_EMAIL")
TK_PAST=$(get_token "$PAST_EMAIL")
TK_MISSING=$(get_token "$MISSING_EMAIL")
TK_TUTOR=$(get_token "$TUTOR_EMAIL")

# master_admin
MASTER_EMAIL=$(db "SELECT email FROM users WHERE role='master_admin' LIMIT 1")
STATUS_CODE=$(api_post "/auth/login" "{\"email\":\"${MASTER_EMAIL}\",\"password\":\"@618033Arc*#\"}" "")
TK_MASTER=""
if [[ "$STATUS_CODE" == "200" ]]; then
  TK_MASTER=$(python3 -c "import json; print(json.load(open('/tmp/f8_body')).get('token',''))" 2>/dev/null)
  echo "  master_admin login OK"
else
  echo "  master_admin login SKIPPED (status $STATUS_CODE)"
fi

# ── Test Matrix ───────────────────────────────────────────────────────────────
echo ""
echo "── F8 Test Matrix ───────────────────────────────────────────────────────"

# Case 1: active → 200
echo ""
echo "Case 1: active subscription → GET /pets → 200"
SC=$(api_get "/creches/${ACTIVE_CID}/pets" "$TK_ACTIVE")
assert "status" "$SC" "200"

# Case 2: trial valid → 200
echo ""
echo "Case 2: trial (valid) → GET /pets → 200"
SC=$(api_get "/creches/${TRIAL_CID}/pets" "$TK_TRIAL")
assert "status" "$SC" "200"

# Case 3: trial expired → 402 trial_expired
echo ""
echo "Case 3: expired trial → GET /pets → 402 trial_expired"
SC=$(api_get "/creches/${EXPIRED_CID}/pets" "$TK_EXPIRED")
ERR=$(get_field "error")
assert "status" "$SC" "402"
assert "error"  "$ERR" "trial_expired"

# Case 4: suspended → 402 subscription_inactive
echo ""
echo "Case 4: suspended → GET /pets → 402 subscription_inactive"
SC=$(api_get "/creches/${SUSP_CID}/pets" "$TK_SUSP")
ERR=$(get_field "error")
assert "status" "$SC" "402"
assert "error"  "$ERR" "subscription_inactive"

# Case 5: cancelled → 402 subscription_inactive
echo ""
echo "Case 5: cancelled → GET /pets → 402 subscription_inactive"
SC=$(api_get "/creches/${CANC_CID}/pets" "$TK_CANC")
ERR=$(get_field "error")
assert "status" "$SC" "402"
assert "error"  "$ERR" "subscription_inactive"

# Case 6: missing subscription → 402 subscription_missing
echo ""
echo "Case 6: no subscription row → GET /pets → 402 subscription_missing"
SC=$(api_get "/creches/${MISSING_CID}/pets" "$TK_MISSING")
ERR=$(get_field "error")
assert "status" "$SC" "402"
assert "error"  "$ERR" "subscription_missing"

# Case 7: master_admin → bypass even for blocked creche
echo ""
echo "Case 7: master_admin → GET /creches (expired-trial creche) /pets → 200 bypass"
if [[ -n "$TK_MASTER" ]]; then
  SC=$(api_get "/creches/${EXPIRED_CID}/pets" "$TK_MASTER")
  assert "status" "$SC" "200"
else
  echo "  SKIPPED (master_admin token not available)"
fi

# Case 8: tutor → subscription gate must not block (no 402)
echo ""
echo "Case 8: tutor → GET /creches/:id/pets → not 402 (tutor bypass)"
SC=$(api_get "/creches/${ACTIVE_CID}/pets" "$TK_TUTOR")
assert "not-402" "$([[ "$SC" != "402" ]] && echo "ok" || echo "blocked")" "ok"
echo "       (actual status: $SC)"

# Case 9: past_due → 200 (grace period, banner only)
echo ""
echo "Case 9: past_due → GET /pets → 200"
SC=$(api_get "/creches/${PAST_CID}/pets" "$TK_PAST")
assert "status" "$SC" "200"

# Case 10: blocked user (suspended) → recovery route /billing/plans → 200
echo ""
echo "Case 10: suspended → GET /billing/plans → 200 (recovery route)"
SC=$(api_get "/billing/plans" "$TK_SUSP")
assert "status" "$SC" "200"

# Bonus A: expired trial → /billing/subscription → 200 (recovery)
echo ""
echo "Bonus A: expired trial → GET /billing/subscription → 200"
SC=$(api_get "/billing/subscription" "$TK_EXPIRED")
assert "status" "$SC" "200"

# Bonus B: expired trial → financial route → 402 (central gate covers all tenant routes)
echo ""
echo "Bonus B: expired trial → GET /financial/invoices → 402"
SC=$(api_get "/creches/${EXPIRED_CID}/financial/invoices" "$TK_EXPIRED")
ERR=$(get_field "error")
assert "status" "$SC" "402"
assert "error"  "$ERR" "trial_expired"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "── Results: $PASS_ passed / $FAIL_ failed ────────────────────────────────"
if [[ $FAIL_ -eq 0 ]]; then
  echo "✅ All assertions passed — F8 enforcement verified"
  exit 0
else
  echo "❌ $FAIL_ assertion(s) failed"
  exit 1
fi
