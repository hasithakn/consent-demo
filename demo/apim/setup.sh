#!/bin/sh
# APIM one-time setup: import IS cert, register IS KM, import/publish/deploy KYCAPI, upload and attach policies
set -e

APIM_BASE="https://consent-apim:9443"
IS_HOST="identity-server"
IS_PORT="9446"
TRUSTSTORE="/home/wso2carbon/wso2am-4.5.0/repository/resources/security/client-truststore.jks"
TRUSTSTORE_PASS="wso2carbon"

echo "[setup] Waiting for APIM to be ready..."
until curl -sk -o /dev/null -w "%{http_code}" "${APIM_BASE}/carbon/admin/login.jsp" | grep -q "200"; do
  sleep 5
done
echo "[setup] APIM is ready."

# ── 1. Import IS TLS cert into APIM truststore ──────────────────────────────
echo "[setup] Importing IS TLS certificate into APIM truststore..."
keytool -printcert -rfc -sslserver "${IS_HOST}:${IS_PORT}" > /tmp/is-cert.pem 2>/dev/null || true
if [ -s /tmp/is-cert.pem ]; then
  keytool -import -alias consent-is -file /tmp/is-cert.pem \
    -keystore "$TRUSTSTORE" -storepass "$TRUSTSTORE_PASS" -noprompt 2>/dev/null || true
  echo "[setup] IS cert imported (or already present)."
else
  echo "[setup] WARNING: could not fetch IS cert, skipping."
fi

# ── 2. Register IS as Key Manager ────────────────────────────────────────────
echo "[setup] Checking IS Key Manager..."
KM_FOUND=$(curl -sk -u admin:admin "${APIM_BASE}/api/am/admin/v4/key-managers" \
  | python3 -c "import sys,json; kms=json.load(sys.stdin).get('list',[]); print('yes' if any(k['name']=='WSO2 Identity Server' for k in kms) else 'no')" 2>/dev/null)

if [ "$KM_FOUND" = "no" ]; then
  echo "[setup] Registering IS as Key Manager..."
  curl -sk -u admin:admin -X POST "${APIM_BASE}/api/am/admin/v4/key-managers" \
    -H "Content-Type: application/json" \
    -d @/setup/is-key-manager.json > /dev/null
  echo "[setup] IS Key Manager registered."
else
  echo "[setup] IS Key Manager already registered."
fi

# ── 3. Import and publish KYCAPI ─────────────────────────────────────────────
echo "[setup] Checking KYCAPI..."
API_ID=$(curl -sk -u admin:admin "${APIM_BASE}/api/am/publisher/v4/apis?limit=50" \
  | python3 -c "import sys,json; apis=json.load(sys.stdin).get('list',[]); ids=[a['id'] for a in apis if a['name']=='KYCAPI']; print(ids[0] if ids else '')" 2>/dev/null)

if [ -z "$API_ID" ]; then
  echo "[setup] Importing KYCAPI..."
  API_ID=$(curl -sk -u admin:admin -X POST \
    "${APIM_BASE}/api/am/publisher/v4/apis/import-openapi" \
    -F "additionalProperties=@/setup/update-api.json" \
    -F "file=@/setup/consent-management-API.yaml" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
  echo "[setup] KYCAPI created: $API_ID"
fi

# Publish if not already published
STATUS=$(curl -sk -u admin:admin "${APIM_BASE}/api/am/publisher/v4/apis/${API_ID}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('lifeCycleStatus',''))" 2>/dev/null)
if [ "$STATUS" != "PUBLISHED" ]; then
  echo "[setup] Publishing KYCAPI..."
  curl -sk -u admin:admin -X POST \
    "${APIM_BASE}/api/am/publisher/v4/apis/change-lifecycle?apiId=${API_ID}&action=Publish" > /dev/null
  echo "[setup] KYCAPI published."
fi

# ── 4. Upload consent policies ───────────────────────────────────────────────
echo "[setup] Uploading consent enforcement policies..."

ENFT_ID=$(curl -sk -u admin:admin "${APIM_BASE}/api/am/publisher/v4/operation-policies?limit=50" \
  | python3 -c "import sys,json; ps=json.load(sys.stdin).get('list',[]); ids=[p['id'] for p in ps if p['name']=='consentEnforcementPolicy']; print(ids[0] if ids else '')" 2>/dev/null)
if [ -z "$ENFT_ID" ]; then
  ENFT_ID=$(curl -sk -u admin:admin -X POST "${APIM_BASE}/api/am/publisher/v4/operation-policies" \
    -F "policySpecFile=@/setup/consentEnforcementPolicy.yaml" \
    -F "synapsePolicyDefinitionFile=@/setup/consentEnforcementPolicy.j2" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
  echo "[setup] Enforcement policy uploaded: $ENFT_ID"
else
  echo "[setup] Enforcement policy already exists: $ENFT_ID"
fi

FILTER_ID=$(curl -sk -u admin:admin "${APIM_BASE}/api/am/publisher/v4/operation-policies?limit=50" \
  | python3 -c "import sys,json; ps=json.load(sys.stdin).get('list',[]); ids=[p['id'] for p in ps if p['name']=='consentResponseFilterPolicy']; print(ids[0] if ids else '')" 2>/dev/null)
if [ -z "$FILTER_ID" ]; then
  FILTER_ID=$(curl -sk -u admin:admin -X POST "${APIM_BASE}/api/am/publisher/v4/operation-policies" \
    -F "policySpecFile=@/setup/consentResponseFilterPolicy.yaml" \
    -F "synapsePolicyDefinitionFile=@/setup/consentResponseFilterPolicy.j2" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
  echo "[setup] Response filter policy uploaded: $FILTER_ID"
else
  echo "[setup] Response filter policy already exists: $FILTER_ID"
fi

# ── 5. Attach policies to GET /user/{nic} and create+deploy revision ─────────
echo "[setup] Attaching policies to KYCAPI operations..."
curl -sk -u admin:admin "${APIM_BASE}/api/am/publisher/v4/apis/${API_ID}" \
  | python3 -c "
import sys, json
api = json.load(sys.stdin)
for op in api.get('operations', []):
    if op.get('verb') == 'GET' and op.get('target') == '/user/{nic}':
        current = op.get('operationPolicies', {})
        req = current.get('request', [])
        res = current.get('response', [])
        if not any(p.get('policyName') == 'consentEnforcementPolicy' for p in req):
            req.append({'policyName': 'consentEnforcementPolicy', 'policyVersion': 'v1', 'policyId': '${ENFT_ID}', 'parameters': {}})
        if not any(p.get('policyName') == 'consentResponseFilterPolicy' for p in res):
            res.append({'policyName': 'consentResponseFilterPolicy', 'policyVersion': 'v1', 'policyId': '${FILTER_ID}', 'parameters': {}})
        op['operationPolicies'] = {'request': req, 'response': res, 'fault': current.get('fault', [])}
print(json.dumps(api))
" > /tmp/api-updated.json

curl -sk -u admin:admin -X PUT \
  "${APIM_BASE}/api/am/publisher/v4/apis/${API_ID}" \
  -H "Content-Type: application/json" \
  -d @/tmp/api-updated.json > /dev/null

echo "[setup] Deploying KYCAPI revision to gateway..."
REV_ID=$(curl -sk -u admin:admin -X POST \
  "${APIM_BASE}/api/am/publisher/v4/apis/${API_ID}/revisions" \
  -H "Content-Type: application/json" \
  -d '{"description":"Auto-deployed by setup"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)

curl -sk -u admin:admin -X POST \
  "${APIM_BASE}/api/am/publisher/v4/apis/${API_ID}/deploy-revision?revisionId=${REV_ID}" \
  -H "Content-Type: application/json" \
  -d '[{"name":"Default","vhost":"localhost","displayOnDevportal":true}]' > /dev/null

echo "[setup] APIM setup complete. API deployed with consent enforcement policies."
