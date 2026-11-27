#!/usr/bin/env bash
set -euo pipefail

ENDPOINT="https://vureiymqoosubwubhvdu.supabase.co/functions/v1/nexora-push-register"
BODY='{"token":"not-a-real-fcm-token","app_version":"v2.6.39","install_id":"00000000-0000-4000-8000-000000000000"}'

check_unauthorized() {
  local auth_header="${1:-}"
  local output status
  output="$(mktemp)"
  local args=(--silent --show-error --max-time 25 --output "$output" --write-out "%{http_code}"
    --request POST "$ENDPOINT"
    --header "Content-Type: application/json"
    --header "x-nexora-app-id: com.devcedrick.nexoraaidrama"
    --data "$BODY")
  if [[ -n "$auth_header" ]]; then args+=(--header "Authorization: $auth_header"); fi
  status="$(curl "${args[@]}")"
  if [[ "$status" != "401" ]]; then
    echo "::error::Push registration accepted an unauthenticated or invalid Firebase token (HTTP $status)."
    cat "$output"
    rm -f "$output"
    return 1
  fi
  rm -f "$output"
}

check_unauthorized
check_unauthorized "Bearer not.a.valid.firebase.token"
echo "PASS: push registration rejects missing and invalid Firebase ID tokens."
