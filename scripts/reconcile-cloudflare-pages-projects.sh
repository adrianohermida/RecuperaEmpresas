#!/usr/bin/env bash

set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"

PORTAL_PROJECT="${PORTAL_PROJECT:-recuperaempresas}"
LANDING_PROJECT="${LANDING_PROJECT:-recuperaempresas-landing}"
PAGES_PRODUCTION_BRANCH="${PAGES_PRODUCTION_BRANCH:-gh-pages}"
AUDIT_DIR="${AUDIT_DIR:-.cloudflare-pages-audit}"
CF_API="https://api.cloudflare.com/client/v4"

mkdir -p "$AUDIT_DIR"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for Cloudflare Pages project reconciliation" >&2
  exit 1
fi

cf_api() {
  local method="$1"
  local path="$2"
  local body="${3:-}"

  if [[ -n "$body" ]]; then
    curl --silent --show-error --request "$method" \
      --url "$CF_API$path" \
      --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      --header "Content-Type: application/json" \
      --data "$body"
  else
    curl --silent --show-error --request "$method" \
      --url "$CF_API$path" \
      --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
  fi
}

ensure_json_response() {
  local response="$1"
  local context="$2"

  if jq -e . >/dev/null 2>&1 <<<"$response"; then
    return 0
  fi

  printf '%s\n' "$response" > "$AUDIT_DIR/error-${context}-raw.txt"
  echo "Cloudflare API returned a non-JSON response during ${context}" >&2
  exit 1
}

require_success() {
  local response="$1"
  local context="$2"

  ensure_json_response "$response" "$context"

  if ! jq -e '.success == true' >/dev/null <<<"$response"; then
    printf '%s\n' "$response" > "$AUDIT_DIR/error-${context}.json"
    echo "Cloudflare API failure during ${context}" >&2
    jq . <<<"$response" >&2 || true
    exit 1
  fi
}

save_response() {
  local file_name="$1"
  local response="$2"

  printf '%s\n' "$response" > "$AUDIT_DIR/$file_name"
}

build_portal_env_vars() {
  jq -n \
    --arg reApiBase "${RE_API_BASE:-}" \
    --arg reApiWorkerBase "${RE_API_WORKER_BASE:-}" \
    --arg reApiWorkerRoutes "${RE_API_WORKER_ROUTES:-}" \
    --arg supabaseUrl "${VITE_SUPABASE_URL:-}" \
    --arg supabaseAnon "${VITE_SUPABASE_ANON_KEY:-}" \
    --arg enableFreshchat "${RE_ENABLE_FRESHCHAT:-false}" \
    --arg freshchatToken "${RE_FRESHCHAT_TOKEN:-}" \
    --arg freshchatSiteId "${RE_FRESHCHAT_SITE_ID:-}" \
    '{
      RE_API_BASE: { type: "plain_text", value: $reApiBase },
      RE_API_WORKER_BASE: { type: "plain_text", value: $reApiWorkerBase },
      RE_API_WORKER_ROUTES: { type: "plain_text", value: $reApiWorkerRoutes },
      VITE_SUPABASE_URL: { type: "plain_text", value: $supabaseUrl },
      VITE_SUPABASE_ANON_KEY: { type: "plain_text", value: $supabaseAnon },
      RE_ENABLE_FRESHCHAT: { type: "plain_text", value: $enableFreshchat },
      RE_FRESHCHAT_TOKEN: { type: "plain_text", value: $freshchatToken },
      RE_FRESHCHAT_SITE_ID: { type: "plain_text", value: $freshchatSiteId }
    }'
}

reconcile_project() {
  local project_name="$1"
  local env_vars_json="${2:-}"
  local has_env_vars=false
  local project_response
  local project_result
  local project_file
  local env_vars_file
  local payload
  local update_response

  echo "Reconciling Pages project ${project_name}"
  project_response=$(cf_api GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${project_name}")
  require_success "$project_response" "get-project-${project_name}"
  save_response "project-${project_name}-before.json" "$project_response"
  project_result=$(jq '.result' <<<"$project_response")

  project_file=$(mktemp)
  env_vars_file=$(mktemp)
  trap 'rm -f "$project_file" "$env_vars_file"' RETURN

  printf '%s\n' "$project_result" > "$project_file"
  if ! jq -e . "$project_file" >/dev/null; then
    echo "Invalid project JSON for ${project_name}" >&2
    exit 1
  fi

  if [[ -n "$env_vars_json" ]]; then
    has_env_vars=true
    printf '%s\n' "$env_vars_json" > "$env_vars_file"
  else
    printf '{}\n' > "$env_vars_file"
  fi

  if ! jq -e . "$env_vars_file" >/dev/null; then
    echo "Invalid env vars JSON for ${project_name}" >&2
    exit 1
  fi

  payload=$(jq -n \
    --arg branch "$PAGES_PRODUCTION_BRANCH" \
    --slurpfile project "$project_file" \
    --slurpfile envVars "$env_vars_file" \
    --argjson hasEnvVars "$has_env_vars" '
      ($project[0]) as $project
      | ($envVars[0]) as $envVars
      | 
      {
        production_branch: $branch
      }
      + (if ($project.source? != null) then {
          source: {
            type: $project.source.type,
            config: ($project.source.config + {
              production_branch: $branch,
              production_deployments_enabled: false,
              preview_deployment_setting: "none"
            })
          }
        } else {} end)
      + (if $hasEnvVars then {
          deployment_configs: {
            production: (($project.deployment_configs.production // {}) + {
              env_vars: (($project.deployment_configs.production.env_vars // {}) + $envVars)
            }),
            preview: (($project.deployment_configs.preview // {}) + {
              env_vars: (($project.deployment_configs.preview.env_vars // {}) + $envVars)
            })
          }
        } else {} end)')

  printf '%s\n' "$payload" > "$AUDIT_DIR/project-${project_name}-payload.json"
  update_response=$(cf_api PATCH "/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${project_name}" "$payload")
  require_success "$update_response" "patch-project-${project_name}"
  save_response "project-${project_name}-after.json" "$update_response"

  trap - RETURN
  rm -f "$project_file" "$env_vars_file"
}

portal_env_vars="$(build_portal_env_vars)"

reconcile_project "$PORTAL_PROJECT" "$portal_env_vars"
reconcile_project "$LANDING_PROJECT"

cat > "$AUDIT_DIR/summary.txt" <<EOF
Portal project: ${PORTAL_PROJECT}
Landing project: ${LANDING_PROJECT}
Production branch: ${PAGES_PRODUCTION_BRANCH}
Source-control deploys: disabled
Portal env vars synced: yes
EOF

echo "Cloudflare Pages project reconciliation completed"