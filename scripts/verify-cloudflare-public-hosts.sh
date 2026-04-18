#!/usr/bin/env bash

set -euo pipefail

PORTAL_URL="${PORTAL_URL:-https://portal.recuperaempresas.com.br/}"
LANDING_URL="${LANDING_URL:-https://recuperaempresas.com.br/}"
WORKER_HEALTH_URL="${WORKER_HEALTH_URL:-https://api-edge.recuperaempresas.com.br/api/health}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-12}"
SLEEP_SECONDS="${SLEEP_SECONDS:-15}"
AUDIT_DIR="${AUDIT_DIR:-.cloudflare-public-check}"

mkdir -p "$AUDIT_DIR"

portal_ok=0
landing_ok=0
worker_ok=0

check_portal() {
  local body="$1"

  grep -Fq 'Portal do Cliente' <<<"$body"
}

check_landing() {
  local body="$1"

  grep -Fq 'href="https://portal.recuperaempresas.com.br/login"' <<<"$body"
}

check_worker() {
  local body="$1"

  jq -e '.status == "ok" and .runtime == "cloudflare-worker"' >/dev/null <<<"$body"
}

for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  echo "Public host verification attempt ${attempt}/${MAX_ATTEMPTS}"

  portal_body=$(curl --silent --show-error --location "$PORTAL_URL")
  printf '%s\n' "$portal_body" > "$AUDIT_DIR/portal-body.html"
  if check_portal "$portal_body"; then
    portal_ok=1
  else
    portal_ok=0
  fi

  landing_body=$(curl --silent --show-error --location "$LANDING_URL")
  printf '%s\n' "$landing_body" > "$AUDIT_DIR/landing-body.html"
  if check_landing "$landing_body"; then
    landing_ok=1
  else
    landing_ok=0
  fi

  worker_body=$(curl --silent --show-error --location "$WORKER_HEALTH_URL")
  printf '%s\n' "$worker_body" > "$AUDIT_DIR/worker-health.json"
  if check_worker "$worker_body"; then
    worker_ok=1
  else
    worker_ok=0
  fi

  echo "portal_ok=${portal_ok} landing_ok=${landing_ok} worker_ok=${worker_ok}" | tee "$AUDIT_DIR/status.txt"

  if [[ "$portal_ok" == "1" && "$landing_ok" == "1" && "$worker_ok" == "1" ]]; then
    echo "Public host verification completed successfully"
    exit 0
  fi

  if [[ "$attempt" -lt "$MAX_ATTEMPTS" ]]; then
    sleep "$SLEEP_SECONDS"
  fi
done

echo "Public host verification failed" >&2
exit 1