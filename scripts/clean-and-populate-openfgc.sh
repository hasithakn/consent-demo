#!/bin/bash
# Resets OpenFGC by wiping the MySQL database and restarting the containers.
# Consent elements and purposes are NOT auto-created here — create them via
# Postman as part of the demo flow (Data Fiduciary onboarding step).
#
# Steps:
#   1. Stop mysql and openfgc containers
#   2. Remove the mysql-data volume (wipes all DB data)
#   3. Restart mysql and openfgc, wait for them to be healthy
#
# Usage:
#   bash scripts/clean-and-populate-openfgc.sh
#
# Environment variables (all optional):
#   OPENFGC_URL      — base URL of the OpenFGC server (default: http://localhost:3000)
#   ORG_ID           — organisation ID header value  (default: DEMO-ORG-001)
#   TPP_CLIENT_ID    — TPP client ID header value    (default: DEMO-TPP-001)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

OPENFGC_URL="${OPENFGC_URL:-http://localhost:3000}"
ORG_ID="${ORG_ID:-DEMO-ORG-001}"
TPP_CLIENT_ID="${TPP_CLIENT_ID:-DEMO-TPP-001}"


# ═════════════════════════════════════════════════════════════════════════════
# CLEAN
# ═════════════════════════════════════════════════════════════════════════════

echo "[clean] Stopping mysql and openfgc..."
docker compose -f "$COMPOSE_DIR/docker-compose.yml" rm -sf openfgc mysql

echo "[clean] Removing mysql data volume..."
VOLUME=$(docker compose -f "$COMPOSE_DIR/docker-compose.yml" config --volumes | grep mysql | head -1)
PROJECT=$(basename "$COMPOSE_DIR")
VOLUME_NAME="${PROJECT}_${VOLUME}"
if ! docker volume rm "$VOLUME_NAME" 2>&1; then
  echo "[clean] ERROR: failed to remove volume $VOLUME_NAME. Aborting."
  exit 1
fi

echo "[clean] Starting mysql and openfgc..."
docker compose -f "$COMPOSE_DIR/docker-compose.yml" up -d --no-deps mysql openfgc

# ═════════════════════════════════════════════════════════════════════════════
# WAIT FOR OPENFGC
# ═════════════════════════════════════════════════════════════════════════════

echo ""
echo "[populate] Waiting for OpenFGC at ${OPENFGC_URL}/health ..."
for i in $(seq 1 40); do
  if curl -sf "${OPENFGC_URL}/health" > /dev/null 2>&1; then
    echo "[populate] OpenFGC is ready."
    break
  fi
  if [ "$i" -eq 40 ]; then
    echo "[populate] ERROR: OpenFGC did not become ready after 40 attempts. Aborting."
    exit 1
  fi
  sleep 3
done

# Consent elements and purposes are created via Postman as part of the demo flow.

# # ═════════════════════════════════════════════════════════════════════════════
# # SAMPLE CONSENT
# # ═════════════════════════════════════════════════════════════════════════════

# echo ""
# echo "[populate] Creating sample KYC consent (org: ${ORG_ID})..."

# CONSENT_RESPONSE=$(curl -s -w "\n%{http_code}" \
#   -X POST "${OPENFGC_URL}/api/v1/consents" \
#   -H "Content-Type: application/json" \
#   -H "org-id: ${ORG_ID}" \
#   -H "TPP-client-id: ${TPP_CLIENT_ID}" \
#   -d "{
#     \"type\": \"kyc\",
#     \"validityTime\": 1893456000,
#     \"recurringIndicator\": false,
#     \"dataAccessValidityDuration\": 0,
#     \"frequency\": 0,
#     \"purposes\": [
#       {
#         \"name\": \"${PURPOSE_NAME}\",
#         \"elements\": [
#           { \"name\": \"first_name\",      \"isUserApproved\": false,  \"value\": {} },
#           { \"name\": \"last_name\",       \"isUserApproved\": false,  \"value\": {} },
#           { \"name\": \"date_of_birth\",   \"isUserApproved\": false,  \"value\": {} },
#           { \"name\": \"gender\",          \"isUserApproved\": false,  \"value\": {} },
#           { \"name\": \"nationality\",     \"isUserApproved\": false,  \"value\": {} },
#           { \"name\": \"middle_name\",     \"isUserApproved\": false, \"value\": {} },
#           { \"name\": \"place_of_birth\",  \"isUserApproved\": false, \"value\": {} },
#           { \"name\": \"marital_status\",  \"isUserApproved\": false, \"value\": {} },
#           { \"name\": \"tax_id\",          \"isUserApproved\": false, \"value\": {} },
#           { \"name\": \"source_of_funds\", \"isUserApproved\": false, \"value\": {} },
#           { \"name\": \"contact\",         \"isUserApproved\": false,  \"value\": {} },
#           { \"name\": \"identifiers\",     \"isUserApproved\": false,  \"value\": {} },
#           { \"name\": \"employment\",      \"isUserApproved\": false,  \"value\": {} }
#         ]
#       }
#     ],
#     \"attributes\": {
#       \"userId\": \"demo-user@example.com\"
#     },
#     \"authorizations\": []
#   }")

# HTTP_STATUS=$(echo "$CONSENT_RESPONSE" | tail -1)
# CONSENT_BODY=$(echo "$CONSENT_RESPONSE" | awk 'NR>1{print prev} {prev=$0}')

# if [ "$HTTP_STATUS" = "201" ]; then
#   CONSENT_ID=$(echo "$CONSENT_BODY" | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"//')
#   echo "[populate]   created consent: $CONSENT_ID"
# else
#   echo "[populate]   ERROR creating consent (HTTP $HTTP_STATUS)"
#   echo "$CONSENT_BODY"
#   exit 1
# fi

echo ""
echo "[reset] Done. OpenFGC is clean and ready."
echo "  Next: use Postman to create consent elements and purposes."
echo ""
echo "  Org ID      : ${ORG_ID}"
echo "  TPP Client  : ${TPP_CLIENT_ID}"
