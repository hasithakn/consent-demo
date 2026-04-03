#!/bin/bash
# Cleans the MySQL database and re-populates OpenFGC with KYC consent elements and a sample purpose.
#
# Clean steps:
#   1. Stop mysql and openfgc containers
#   2. Remove the mysql-data volume (wipes all DB data)
#   3. Restart mysql and openfgc, wait for them to be healthy
#
# Populate steps:
#   4. Create 13 KYC consent elements
#   5. Create kyc_verification_purpose with all elements (first_name & last_name mandatory)
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

ELEMENTS_URL="${OPENFGC_URL}/api/v1/consent-elements"
PURPOSES_URL="${OPENFGC_URL}/api/v1/consent-purposes"

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

# ═════════════════════════════════════════════════════════════════════════════
# CONSENT ELEMENTS
# ═════════════════════════════════════════════════════════════════════════════

echo ""
echo "[populate] Creating KYC consent elements (org: ${ORG_ID})..."

create_element() {
  local NAME="$1"
  local DESCRIPTION="$2"
  local JSON_PATH="$3"

  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${ELEMENTS_URL}" \
    -H "Content-Type: application/json" \
    -H "org-id: ${ORG_ID}" \
    -d "[{
      \"name\": \"${NAME}\",
      \"type\": \"resource-field\",
      \"description\": \"${DESCRIPTION}\",
      \"properties\": {
        \"jsonPath\": \"${JSON_PATH}\",
        \"resourcePath\": \"/user/{nic}\"
      }
    }]")

  if [ "$HTTP_STATUS" = "201" ]; then
    echo "[populate]   created $NAME"
  else
    echo "[populate]   ERROR creating element $NAME (HTTP $HTTP_STATUS)"
    exit 1
  fi
}

#          NAME               DESCRIPTION              JSON_PATH
create_element "first_name"      "First Name"             '$.person.first_name'
create_element "last_name"       "Last Name"              '$.person.last_name'
create_element "date_of_birth"   "Date of Birth"          '$.person.date_of_birth'
create_element "gender"          "Gender"                 '$.person.gender'
create_element "nationality"     "Nationality"            '$.person.nationality'
create_element "middle_name"     "Middle Name"            '$.person.middle_name'
create_element "place_of_birth"  "Place of Birth"         '$.person.place_of_birth'
create_element "marital_status"  "Marital Status"         '$.person.marital_status'
create_element "tax_id"          "Tax ID"                 '$.person.tax_id'
create_element "source_of_funds" "Source of Funds"        '$.person.source_of_funds'
create_element "contact"         "Contact Details"        '$.person.contact'
create_element "identifiers"     "Identity Documents"     '$.person.identifiers'
create_element "employment"      "Employment Details"     '$.person.employment'

# ═════════════════════════════════════════════════════════════════════════════
# PURPOSE
# ═════════════════════════════════════════════════════════════════════════════

echo ""
echo "[populate] Creating KYC purpose (org: ${ORG_ID})..."

PURPOSE_NAME="kyc_verification_purpose"

HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${PURPOSES_URL}" \
  -H "Content-Type: application/json" \
  -H "org-id: ${ORG_ID}" \
  -H "TPP-client-id: ${TPP_CLIENT_ID}" \
  -d "{
    \"name\": \"${PURPOSE_NAME}\",
    \"description\": \"Identity verification for KYC compliance\",
    \"elements\": [
      { \"name\": \"first_name\",      \"isMandatory\": true  },
      { \"name\": \"last_name\",       \"isMandatory\": true  },
      { \"name\": \"date_of_birth\",   \"isMandatory\": false },
      { \"name\": \"gender\",          \"isMandatory\": false },
      { \"name\": \"nationality\",     \"isMandatory\": false },
      { \"name\": \"middle_name\",     \"isMandatory\": false },
      { \"name\": \"place_of_birth\",  \"isMandatory\": false },
      { \"name\": \"marital_status\",  \"isMandatory\": false },
      { \"name\": \"tax_id\",          \"isMandatory\": false },
      { \"name\": \"source_of_funds\", \"isMandatory\": false },
      { \"name\": \"contact\",         \"isMandatory\": false },
      { \"name\": \"identifiers\",     \"isMandatory\": false },
      { \"name\": \"employment\",      \"isMandatory\": false }
    ]
  }")

if [ "$HTTP_STATUS" = "201" ]; then
  echo "[populate]   created $PURPOSE_NAME"
else
  echo "[populate]   ERROR creating purpose $PURPOSE_NAME (HTTP $HTTP_STATUS)"
  exit 1
fi

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
echo "[populate] Done. OpenFGC is clean and populated."
echo ""
echo "  Org ID      : ${ORG_ID}"
echo "  TPP Client  : ${TPP_CLIENT_ID}"
echo "  Consent ID  : ${CONSENT_ID}"
