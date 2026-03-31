#!/bin/bash
# purge-consents.sh — Delete all consent data and consent element definitions from MySQL.
#
# Usage: ./purge-consents.sh
#
# IMPORTANT: After running this, restart the bank-portal container so it
# recreates consent elements with the correct properties:
#   docker compose restart bank-portal
#
# This fixes the API Error: 403 issue (elements recreated with resourcePath/jsonPath).

set -e

CONTAINER="consent-mysql"
DB="consent_mgt"
ORG="DEMO-ORG-001"

echo "==> Purging all consent data for org: $ORG"

docker exec -i "$CONTAINER" mysql -uroot -proot123 "$DB" <<SQL 2>&1 | grep -v Warning
-- Delete in FK-safe order (most-dependent tables first)
DELETE FROM CONSENT_ELEMENT_APPROVAL WHERE ORG_ID = '$ORG';
DELETE FROM CONSENT_AUTH_RESOURCE    WHERE ORG_ID = '$ORG';
DELETE FROM CONSENT_STATUS_AUDIT     WHERE ORG_ID = '$ORG';
DELETE FROM CONSENT_ATTRIBUTE        WHERE ORG_ID = '$ORG';
DELETE FROM PURPOSE_CONSENT_MAPPING  WHERE ORG_ID = '$ORG';
DELETE FROM PURPOSE_ELEMENT_MAPPING  WHERE ORG_ID = '$ORG';
DELETE FROM CONSENT                  WHERE ORG_ID = '$ORG';
DELETE FROM CONSENT_PURPOSE          WHERE ORG_ID = '$ORG';
DELETE FROM CONSENT_ELEMENT_PROPERTY WHERE ORG_ID = '$ORG';
DELETE FROM CONSENT_ELEMENT          WHERE ORG_ID = '$ORG';
SELECT 'Done.' AS status;
SQL

echo "==> Consent data purged."
echo ""
echo "==> Restarting bank-portal to recreate consent elements with properties..."
docker compose -f "$(dirname "$0")/docker-compose.yml" restart bank-portal
echo ""
echo "==> Done. Bank-portal is reinitialising. Watch logs with:"
echo "    docker logs -f consent-bank-portal"
