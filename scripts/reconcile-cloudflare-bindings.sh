#!/usr/bin/env bash

set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"

PORTAL_PROJECT="${PORTAL_PROJECT:-recuperaempresas}"
LANDING_PROJECT="${LANDING_PROJECT:-recuperaempresas-landing}"
PORTAL_DOMAIN="${PORTAL_DOMAIN:-portal.recuperaempresas.com.br}"
LANDING_DOMAIN="${LANDING_DOMAIN:-recuperaempresas.com.br}"
WORKER_DOMAIN="${WORKER_DOMAIN:-api-edge.recuperaempresas.com.br}"
WORKER_SERVICE="${WORKER_SERVICE:-recuperaempresas-api}"
ZONE_NAME="${CLOUDFLARE_ZONE_NAME:-recuperaempresas.com.br}"
AUDIT_DIR="${AUDIT_DIR:-.cloudflare-audit}"
CF_API="https://api.cloudflare.com/client/v4"

mkdir -p "$AUDIT_DIR"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for Cloudflare reconciliation" >&2
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

require_success() {
  local response="$1"
  local context="$2"

  if ! jq -e '.success == true' >/dev/null <<<"$response"; then
    echo "$response" > "$AUDIT_DIR/error-${context}.json"
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

delete_pages_domain_if_present() {
  local project="$1"
  local domain="$2"
  local domains_json="$3"

  if jq -e --arg domain "$domain" '.result[]? | select(.name == $domain)' >/dev/null <<<"$domains_json"; then
    echo "Removing ${domain} from Pages project ${project}"
    local response
    response=$(cf_api DELETE "/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${project}/domains/${domain}")
    require_success "$response" "delete-pages-${project}-${domain}"
  fi
}

ensure_pages_domain() {
  local project="$1"
  local domain="$2"
  local domains_json="$3"

  if jq -e --arg domain "$domain" '.result[]? | select(.name == $domain)' >/dev/null <<<"$domains_json"; then
    echo "Pages project ${project} already owns ${domain}"
    return
  fi

  echo "Attaching ${domain} to Pages project ${project}"
  local response
  response=$(cf_api POST "/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${project}/domains" "{\"name\":\"${domain}\"}")
  require_success "$response" "add-pages-${project}-${domain}"
}

detach_worker_domain_ids() {
  local domains_json="$1"
  local jq_filter="$2"
  local label="$3"
  local ids

  ids=$(jq -r "$jq_filter | .id" <<<"$domains_json")

  if [[ -z "$ids" ]]; then
    return
  fi

  while IFS= read -r domain_id; do
    [[ -z "$domain_id" ]] && continue
    echo "Detaching Worker domain ${domain_id} (${label})"
    local response
    response=$(cf_api DELETE "/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/domains/${domain_id}")
    require_success "$response" "delete-worker-${domain_id}"
  done <<<"$ids"
}

echo "Auditing Pages projects"
portal_domains=$(cf_api GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PORTAL_PROJECT}/domains")
require_success "$portal_domains" "list-pages-${PORTAL_PROJECT}"
save_response "pages-${PORTAL_PROJECT}-domains-before.json" "$portal_domains"

landing_domains=$(cf_api GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${LANDING_PROJECT}/domains")
require_success "$landing_domains" "list-pages-${LANDING_PROJECT}"
save_response "pages-${LANDING_PROJECT}-domains-before.json" "$landing_domains"

delete_pages_domain_if_present "$PORTAL_PROJECT" "$LANDING_DOMAIN" "$portal_domains"
delete_pages_domain_if_present "$LANDING_PROJECT" "$PORTAL_DOMAIN" "$landing_domains"

echo "Auditing Worker domains"
worker_domains=$(cf_api GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/domains?zone_name=${ZONE_NAME}")
require_success "$worker_domains" "list-worker-domains"
save_response "worker-domains-before.json" "$worker_domains"

detach_worker_domain_ids "$worker_domains" --argjson_dummy 'not_used' ".result[]? | select(.hostname == \"${PORTAL_DOMAIN}\" or .hostname == \"${LANDING_DOMAIN}\")" "pages-host-conflict"
detach_worker_domain_ids "$worker_domains" ".result[]? | select(.hostname == \"${WORKER_DOMAIN}\" and .service != \"${WORKER_SERVICE}\")" "worker-host-conflict"

portal_domains=$(cf_api GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PORTAL_PROJECT}/domains")
require_success "$portal_domains" "refresh-pages-${PORTAL_PROJECT}"
landing_domains=$(cf_api GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${LANDING_PROJECT}/domains")
require_success "$landing_domains" "refresh-pages-${LANDING_PROJECT}"

ensure_pages_domain "$PORTAL_PROJECT" "$PORTAL_DOMAIN" "$portal_domains"
ensure_pages_domain "$LANDING_PROJECT" "$LANDING_DOMAIN" "$landing_domains"

worker_domains=$(cf_api GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/domains?zone_name=${ZONE_NAME}")
require_success "$worker_domains" "refresh-worker-domains"

if jq -e --arg hostname "$WORKER_DOMAIN" --arg service "$WORKER_SERVICE" '.result[]? | select(.hostname == $hostname and .service == $service)' >/dev/null <<<"$worker_domains"; then
  echo "Worker ${WORKER_SERVICE} already owns ${WORKER_DOMAIN}"
else
  echo "Attaching ${WORKER_DOMAIN} to Worker ${WORKER_SERVICE}"
  attach_worker=$(cf_api PUT "/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/domains" "{\"hostname\":\"${WORKER_DOMAIN}\",\"service\":\"${WORKER_SERVICE}\",\"environment\":\"production\",\"zone_name\":\"${ZONE_NAME}\"}")
  require_success "$attach_worker" "attach-worker-domain"
fi

portal_domains_after=$(cf_api GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PORTAL_PROJECT}/domains")
require_success "$portal_domains_after" "pages-${PORTAL_PROJECT}-after"
save_response "pages-${PORTAL_PROJECT}-domains-after.json" "$portal_domains_after"

landing_domains_after=$(cf_api GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${LANDING_PROJECT}/domains")
require_success "$landing_domains_after" "pages-${LANDING_PROJECT}-after"
save_response "pages-${LANDING_PROJECT}-domains-after.json" "$landing_domains_after"

worker_domains_after=$(cf_api GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/domains?zone_name=${ZONE_NAME}")
require_success "$worker_domains_after" "worker-domains-after"
save_response "worker-domains-after.json" "$worker_domains_after"

cat > "$AUDIT_DIR/summary.txt" <<EOF
Portal project: ${PORTAL_PROJECT}
Portal domain: ${PORTAL_DOMAIN}
Landing project: ${LANDING_PROJECT}
Landing domain: ${LANDING_DOMAIN}
Worker service: ${WORKER_SERVICE}
Worker domain: ${WORKER_DOMAIN}
Zone: ${ZONE_NAME}
EOF

echo "Cloudflare binding reconciliation completed"