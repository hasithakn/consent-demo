#!/bin/sh
# APIM one-time setup: import IS cert, register IS KM, disable Resident KM,
# import/publish/deploy KYCAPI, upload and attach policies

APIM_BASE="https://api-manager:9443"
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
  RESP=$(curl -sk -u admin:admin -X POST "${APIM_BASE}/api/am/admin/v4/key-managers" \
    -H "Content-Type: application/json" \
    -d @/setup/is-key-manager.json)
  echo "[setup] IS Key Manager response: $RESP"
else
  echo "[setup] IS Key Manager already registered — updating issuer..."
  KM_ID=$(curl -sk -u admin:admin "${APIM_BASE}/api/am/admin/v4/key-managers" \
    | python3 -c "import sys,json; kms=json.load(sys.stdin).get('list',[]); ids=[k['id'] for k in kms if k['name']=='ISKM']; print(ids[0] if ids else '')" 2>/dev/null)
  if [ -n "$KM_ID" ]; then
    curl -sk -u admin:admin -X PUT "${APIM_BASE}/api/am/admin/v4/key-managers/${KM_ID}" \
      -H "Content-Type: application/json" \
      -d @/setup/is-key-manager.json > /dev/null
    echo "[setup] IS Key Manager updated."
  fi
fi

# ── 2b. Disable Resident Key Manager ─────────────────────────────────────────
echo "[setup] Disabling Resident Key Manager..."
RESIDENT_KM_ID=$(curl -sk -u admin:admin "${APIM_BASE}/api/am/admin/v4/key-managers" \
  | python3 -c "import sys,json; kms=json.load(sys.stdin).get('list',[]); ids=[k['id'] for k in kms if k['name']=='Resident Key Manager']; print(ids[0] if ids else '')" 2>/dev/null)

if [ -n "$RESIDENT_KM_ID" ]; then
  RESIDENT_KM=$(curl -sk -u admin:admin "${APIM_BASE}/api/am/admin/v4/key-managers/${RESIDENT_KM_ID}")
  UPDATED=$(echo "$RESIDENT_KM" | python3 -c "import sys,json; km=json.load(sys.stdin); km['enabled']=False; print(json.dumps(km))")
  curl -sk -u admin:admin -X PUT "${APIM_BASE}/api/am/admin/v4/key-managers/${RESIDENT_KM_ID}" \
    -H "Content-Type: application/json" -d "$UPDATED" > /dev/null
  echo "[setup] Resident Key Manager disabled."
else
  echo "[setup] Resident Key Manager not found, skipping."
fi

# ── 3. Import and publish KYCAPI ─────────────────────────────────────────────
echo "[setup] Waiting for publisher API to be ready..."
until curl -sk -o /dev/null -w "%{http_code}" -u admin:admin "${APIM_BASE}/api/am/publisher/v4/apis?limit=1" | grep -q "200"; do
  sleep 5
done
echo "[setup] Publisher API ready."

echo "[setup] Checking KYCAPI..."
API_ID=$(curl -sk -u admin:admin "${APIM_BASE}/api/am/publisher/v4/apis?limit=50" \
  | python3 -c "import sys,json; apis=json.load(sys.stdin).get('list',[]); ids=[a['id'] for a in apis if a['name']=='KYCAPI']; print(ids[0] if ids else '')" 2>/dev/null)

if [ -z "$API_ID" ]; then
  echo "[setup] Creating KYCAPI..."
  RESP=$(curl -sk -u admin:admin -X POST \
    "${APIM_BASE}/api/am/publisher/v4/apis" \
    -H "Content-Type: application/json" \
    -d @/setup/create-api.json)
  echo "[setup] Create response: $RESP"
  API_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
  echo "[setup] KYCAPI created: $API_ID"
else
  echo "[setup] KYCAPI exists ($API_ID) — updating subscription settings..."
  CURRENT_API=$(curl -sk -u admin:admin "${APIM_BASE}/api/am/publisher/v4/apis/${API_ID}")
  UPDATED_API=$(echo "$CURRENT_API" | python3 -c "
import sys, json
api = json.load(sys.stdin)
api['policies'] = []
api['subscriptionAvailability'] = 'NONE'
print(json.dumps(api))
")
  curl -sk -u admin:admin -X PUT "${APIM_BASE}/api/am/publisher/v4/apis/${API_ID}" \
    -H "Content-Type: application/json" \
    -d "$UPDATED_API" > /dev/null
  echo "[setup] Subscription validation disabled."
fi

if [ -z "$API_ID" ]; then
  echo "[setup] ERROR: API_ID is empty, cannot continue."
  exit 1
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
  RESP=$(curl -sk -u admin:admin -X POST "${APIM_BASE}/api/am/publisher/v4/operation-policies" \
    -F "policySpecFile=@/setup/consentEnforcementPolicy.yaml" \
    -F "synapsePolicyDefinitionFile=@/setup/consentEnforcementPolicy.j2")
  echo "[setup] Enforcement policy response: $RESP"
  ENFT_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
  echo "[setup] Enforcement policy uploaded: $ENFT_ID"
else
  echo "[setup] Enforcement policy already exists: $ENFT_ID"
fi

FILTER_ID=$(curl -sk -u admin:admin "${APIM_BASE}/api/am/publisher/v4/operation-policies?limit=50" \
  | python3 -c "import sys,json; ps=json.load(sys.stdin).get('list',[]); ids=[p['id'] for p in ps if p['name']=='consentResponseFilterPolicy']; print(ids[0] if ids else '')" 2>/dev/null)
if [ -z "$FILTER_ID" ]; then
  RESP=$(curl -sk -u admin:admin -X POST "${APIM_BASE}/api/am/publisher/v4/operation-policies" \
    -F "policySpecFile=@/setup/consentResponseFilterPolicy.yaml" \
    -F "synapsePolicyDefinitionFile=@/setup/consentResponseFilterPolicy.j2")
  echo "[setup] Response filter policy response: $RESP"
  FILTER_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
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
