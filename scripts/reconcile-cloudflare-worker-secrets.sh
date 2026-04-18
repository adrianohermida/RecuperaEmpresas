#!/usr/bin/env bash

set -euo pipefail

CONFIG_PATH="${WORKER_WRANGLER_CONFIG:-workers/portal-api/wrangler.toml}"
AUDIT_DIR="${AUDIT_DIR:-.cloudflare-worker-secrets-audit}"

mkdir -p "$AUDIT_DIR"

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required for Worker secret reconciliation" >&2
  exit 1
fi

put_secret() {
  local name="$1"
  local value="${2:-}"

  if [[ -z "$value" ]]; then
    echo "Skipping empty Worker secret ${name}"
    return 0
  fi

  echo "Reconciling Worker secret ${name}"
  if ! printf '%s' "$value" | npx --yes wrangler@4.12.0 secret put "$name" -c "$CONFIG_PATH" >"$AUDIT_DIR/${name}.log" 2>&1; then
    echo "Failed to reconcile Worker secret ${name}" >&2
    cat "$AUDIT_DIR/${name}.log" >&2 || true
    exit 1
  fi
}

put_secret "VITE_SUPABASE_URL" "${VITE_SUPABASE_URL:-}"
put_secret "VITE_SUPABASE_ANON_KEY" "${VITE_SUPABASE_ANON_KEY:-}"
put_secret "SUPABASE_SERVICE_ROLE_KEY" "${SUPABASE_SERVICE_ROLE_KEY:-${VITE_SUPABASE_SERVICE_ROLE:-}}"
put_secret "JWT_SECRET" "${JWT_SECRET:-}"
put_secret "OAUTH_CLIENT_ID" "${OAUTH_CLIENT_ID:-}"
put_secret "OAUTH_CLIENT_SECRET" "${OAUTH_CLIENT_SECRET:-}"

if [[ -n "${RESEND_API_KEY:-}" ]]; then
  put_secret "RESEND_API_KEY" "${RESEND_API_KEY:-}"
fi

cat > "$AUDIT_DIR/summary.txt" <<EOF
Worker config: ${CONFIG_PATH}
Secrets reconciled: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET${RESEND_API_KEY:+, RESEND_API_KEY}
EOF

echo "Cloudflare Worker secret reconciliation completed"