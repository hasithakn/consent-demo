# Consent-Based KYC API Demo — Setup & Operations Guide

**Audience**: AI agents and developers who need to set up, test, and troubleshoot this demo from a fresh clone with minimal human intervention.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Pre-Startup Setup](#pre-startup-setup)
4. [Starting the System](#starting-the-system)
5. [What Auto-Configures (bank-portal setup)](#what-auto-configures)
6. [What Requires Pre-Publishing (APIM)](#what-requires-pre-publishing)
7. [End-to-End Test Procedure](#end-to-end-test-procedure)
8. [Component Details](#component-details)
9. [Troubleshooting](#troubleshooting)
10. [Pitfalls & Tips](#pitfalls--tips)

---

## Architecture Overview

8 Docker containers on a `consent-network` bridge:

| Container | Tech | Port | Purpose |
|-----------|------|------|---------|
| `consent-jwks` | nginx:alpine | 8899 | JWKS endpoint for JWT signature verification |
| `consent-mysql` | MySQL 8.0 | 3306 | Consent database (user: root/root123, db: consent_mgt) |
| `consent-openfgc` | Go | 3000 | Consent management server |
| `consent-mock-backend` | Node.js | 3002 | Mock KYC person data API |
| `consent-is` | WSO2 IS 7.1.0 | 9446 | Identity provider + CIBA authentication |
| `consent-apim` | WSO2 APIM 4.5.0 | 9443/8243 | API gateway with consent enforcement |
| `consent-bank-portal` | Node.js Express | 3010 | Bank officer interface (auto-configures APIM+IS) |
| `consent-citizen-app` | Node.js Express | 3011 | Citizen consent mobile app |

**Dependency chain**: mysql → openfgc → IS → APIM → bank-portal → citizen-app

**Flow**: Bank officer → creates KYC request → CIBA auth → citizen approves → gateway validates consent → filters response → bank sees data. Citizen can revoke → gateway blocks future access.

---

## Prerequisites

- **Docker & Docker Compose** (v2+)
- **~8 GB RAM** allocated to Docker
- **Ports free**: 3000-3011, 8243, 8280, 8899, 9443, 9446
- **Java 17 + Maven 3.8+** — only if rebuilding Java artifacts (pre-built JARs/WARs are included)

---

## Pre-Startup Setup

### 1. Generate CIBA Signing Keys

If `ciba-test-key.pem` and `ciba-test-key-pub.pem` don't exist in repo root:

```bash
openssl genrsa -out ciba-test-key.pem 2048
openssl rsa -in ciba-test-key.pem -pubout -out ciba-test-key-pub.pem
```

These are volume-mounted into bank-portal for PS256 JWT signing.

### 2. Generate JWKS JSON

If `jwks.json` doesn't exist, create it from the public key. The file must contain the RSA public key in JWKS format with `alg: PS256` and `use: sig`. The JWKS server (nginx) serves this at `http://consent-jwks:80/jwks.json` for IS to verify JWT request objects.

### 3. Verify Required Files Exist

```bash
[ -f ciba-test-key.pem ] && echo "✓ private key" || echo "✗ MISSING: run openssl genrsa"
[ -f ciba-test-key-pub.pem ] && echo "✓ public key" || echo "✗ MISSING: run openssl rsa -pubout"
[ -f jwks.json ] && echo "✓ jwks.json" || echo "✗ MISSING: generate from public key"
[ -f is-conditional-script.js ] && echo "✓ auth script" || echo "✗ MISSING (should be in repo)"
[ -f docker-compose.yml ] && echo "✓ docker-compose" || echo "✗ MISSING"
```

### 4. (Optional) Rebuild Java Artifacts

Pre-built artifacts exist in `docker/is/dropins/`, `docker/is/webapps/`, and `docker/apim/dropins/`. Only rebuild if modifying Java source:

```bash
cd consent-accelerator-v1
mvn clean install -DskipTests -q
cd ..
```

Outputs (Maven copies to Docker build dirs automatically):
- `docker/is/dropins/com.wso2.consent.accelerator.utils-1.0-SNAPSHOT.jar`
- `docker/is/dropins/com.wso2.consent.accelerator.ciba.authenticator-1.0-SNAPSHOT.jar`
- `docker/is/webapps/fs#authenticationendpoint.war`
- `docker/apim/dropins/consent-enforcement-payload-mediator-1.0.0-SNAPSHOT.jar`

---

## Starting the System

```bash
docker compose up -d
```

### Expected Timeline

| Time | What Happens |
|------|-------------|
| T+10s | jwks, mysql, mock-backend healthy |
| T+60s | openfgc healthy (DB init done) |
| T+120s | identity-server healthy (slow JVM startup) |
| T+180s | api-manager healthy |
| T+240s | bank-portal runs setup() — creates APIM app, IS config |
| T+300s | **All services ready** |

### Verify Readiness

```bash
# All 8 containers should be Up (7 healthy + citizen-app running)
docker compose ps

# Bank portal ready?
curl -s http://localhost:3010/api/status | grep '"ready":true'

# OpenFGC healthy?
curl -s http://localhost:3000/health

# Mock backend healthy?
curl -s http://localhost:3002/health
```

---

## What Auto-Configures

The bank-portal `setup()` function runs once at first API request and handles:

1. **Loads CIBA private key** from `/keys/ciba-test-key.pem`
2. **Finds KYCAPI** in APIM Publisher API (must already be published — see next section)
3. **Creates/reuses BankPortalApp** in APIM DevPortal
4. **Subscribes app** to KYCAPI
5. **Generates OAuth keys** via IS Key Manager (`keyManager: "WSO2 Identity Server"`, grants include `urn:openid:params:grant-type:ciba`)
6. **Configures IS application**:
   - Finds IS app matching the generated `CLIENT_ID` (created by APIM DCR)
   - Sets authentication sequence: Step 1 (BasicAuthenticator) + Step 2 (SampleLocalAuthenticator)
   - Applies conditional script from `is-conditional-script.js`
   - Sets JWKS certificate to `http://consent-jwks:80/jwks.json`
   - Renames app to "National Bank KYC Portal"
   - Cleans up stale IS apps from previous runs
7. **Creates test user** `john123`/`John@123` via SCIM2

**If setup() fails**: Check `docker logs consent-bank-portal`. Common causes:
- KYCAPI not published in APIM → bank-portal exits with error
- IS/APIM not healthy yet → setup hangs, retry after services are up
- Private key missing → process exits immediately

---

## What Requires Pre-Publishing

Three things must exist in APIM **before** bank-portal can run setup():

### 1. IS Key Manager Registered in APIM

**Check**:
```bash
curl -sk -u admin:admin https://localhost:9443/api/am/admin/v4/key-managers \
  | python3 -c "import sys,json; kms=json.load(sys.stdin).get('list',[]); print('Found' if any(k['name']=='WSO2 Identity Server' for k in kms) else 'MISSING')"
```

**Register if missing** (reference config in `scripts/is-key-manager.json`):
```bash
curl -sk -u admin:admin -X POST \
  https://localhost:9443/api/am/admin/v4/key-managers \
  -H 'Content-Type: application/json' \
  -d @scripts/is-key-manager.json
```

### 2. KYCAPI Published

**Check**:
```bash
curl -sk -u admin:admin https://localhost:9443/api/am/publisher/v4/apis?limit=50 \
  | python3 -c "import sys,json; apis=json.load(sys.stdin).get('list',[]); print('Found' if any(a['name']=='KYCAPI' for a in apis) else 'MISSING')"
```

**Create if missing** (reference in `scripts/update-api.json`):
```bash
curl -sk -u admin:admin -X POST \
  https://localhost:9443/api/am/publisher/v4/apis/import-openapi \
  -H 'Content-Type: multipart/form-data' \
  -F "additionalProperties=@scripts/update-api.json" \
  -F "file=@openfgc/api/consent-management-API.yaml"
```

The API needs:
- Backend URL: `http://mock-backend:3002`
- Operation: `GET /user/{nic}` with Application & Application User auth
- Consent enforcement policies attached (request + response)
- Published to Default gateway

### 3. Consent Enforcement Policies Deployed

Policy specs are in `scripts/consentEnforcementPolicy.yaml` and `scripts/consentResponseFilterPolicy.yaml`. These must be uploaded to APIM's policy library and attached to KYCAPI's `GET /user/{nic}` operation.

**Note**: If the APIM image already has these configured (from a prior `docker compose up` with persistent volumes), they persist across restarts. Only the first-time setup requires manual policy deployment.

---

## End-to-End Test Procedure

### Test 1: Happy Path (Consent Approval)

```bash
# 1. Create KYC request
RESPONSE=$(curl -s -X POST http://localhost:3010/api/kyc-request \
  -H 'Content-Type: application/json' \
  -d '{"nin":"CM19951234567890","customerName":"John Doe","accountType":"savings","requestedElements":["first_name","last_name","date_of_birth","gender","nationality"]}')

echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Request ID: {d[\"id\"]}\nConsent ID: {d[\"consentId\"]}\nWeb Auth Link: {d[\"webAuthLink\"]}')"

# 2. Extract the web auth link — citizen must open this in browser to approve
# (Cannot be automated without browser interaction — IS login page requires form submission)

# 3. After citizen approves, poll for data readiness
REQUEST_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
for i in $(seq 1 30); do
  STATUS=$(curl -s http://localhost:3010/api/requests/$REQUEST_ID | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','pending'))")
  echo "Attempt $i: $STATUS"
  [ "$STATUS" = "data_available" ] && echo "SUCCESS: KYC data retrieved" && break
  sleep 2
done

# 4. View the filtered KYC data
curl -s http://localhost:3010/api/requests/$REQUEST_ID | python3 -m json.tool
```

### Test 2: Consent Revocation

```bash
# After Test 1 succeeds, get the consent ID
CONSENT_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['consentId'])")

# Revoke consent via citizen-app API
curl -s -X PUT http://localhost:3011/api/consents/$CONSENT_ID/revoke | python3 -m json.tool

# Wait for revocation detection (background loop runs every 10s)
sleep 15

# Check request status — should now be 'revoked'
curl -s http://localhost:3010/api/requests/$REQUEST_ID | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Status: {d[\"status\"]}')"
```

### Test 3: Verify Gateway Enforcement

```bash
# Direct backend call (no consent enforcement)
curl -s http://localhost:3002/user/CM19951234567890 | python3 -c "import sys,json; print(f'Fields: {len(json.load(sys.stdin)[\"person\"])}')"
# Should show all ~15 fields

# Gateway call without token (should fail)
curl -sk https://localhost:8243/kyc/1.0.0/user/CM19951234567890
# Should return 401 (no auth)
```

### Browser-Based Test (Full CIBA Flow)

1. Open http://localhost:3010 (Bank Portal)
2. Enter NIN: `CM19951234567890`, name: `John Doe`, account: `Savings`
3. Click **Submit KYC Request**
4. Click the generated citizen approval link
5. Login: `john123` / `John@123`
6. Review consent elements, click **Approve**
7. Return to bank portal — should show "Data Available" with filtered KYC data
8. Open http://localhost:3011 (Citizen App)
9. Go to **History** tab, find the consent, click **Revoke**
10. Return to bank portal — status changes to "Revoked"

---

## Component Details

### Docker Compose Environment Variables

**bank-portal** (most complex):
```yaml
APIM_BASE: https://consent-apim:9443          # APIM admin (internal)
APIM_GW: https://consent-apim:8243            # APIM gateway (internal)
IS_BASE: https://consent-is:9446              # IS (internal, docker hostname)
IS_PUBLIC_BASE: https://localhost:9446         # IS (browser-facing, localhost)
OPENFGC_BASE: http://consent-openfgc:3000     # OpenFGC (internal)
JWKS_INTERNAL_URL: http://consent-jwks:80/jwks.json
REDIRECT_URI: http://localhost:3011/auth-callback.html
PRIVATE_KEY_PATH: /keys/ciba-test-key.pem
IS_SCRIPT_PATH: /keys/is-conditional-script.js
NODE_TLS_REJECT_UNAUTHORIZED: 0               # Accept self-signed certs
```

**citizen-app**:
```yaml
BANK_PORTAL_URL: http://consent-bank-portal:3010
OPENFGC_BASE: http://consent-openfgc:3000
```

**identity-server**:
```yaml
OPENFGC_BASE_URL: http://openfgc:3000
CONSENT_ORG_ID: DEMO-ORG-001
CONSENT_CLIENT_ID: YSZ6l_tcxc7wTtuGzaEyopAZ_SIa
IS_BASE_URL: https://localhost:9446
IS_ADMIN_AUTH: Basic YWRtaW46YWRtaW4=
```

### IS Configuration (deployment.toml)

Key settings in `docker/is/deployment.toml`:
- Port offset: 3 (→ port 9446)
- Custom CIBA response type: `cibaAuthCode` with `OBCibaResponseTypeHandler`
- Custom CIBA grant type: `urn:openid:params:grant-type:ciba` with `OBCibaGrantHandler`
- CIBA endpoint unsecured: `secure = "false"` on `/oauth2/ciba`
- All scopes allowed including `consent.*`

### IS Build Artifacts

Copied by `docker/is/Dockerfile`:
- `dropins/*.jar` — consent-accelerator-utils + CIBA authenticator
- `webapps/fs#authenticationendpoint.war` — custom consent approval JSP pages (blue government theme)
- `ciba.jsp` — CIBA authentication completion page with close button
- `deployment.toml` — IS configuration

### APIM Build Artifact

Copied by `docker/apim/Dockerfile`:
- `dropins/consent-enforcement-payload-mediator-1.0.0-SNAPSHOT.jar` — synapse mediator for consent validation

### OpenFGC Key API Endpoints

All require header `org-id: DEMO-ORG-001`.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v1/consent-elements` | Create consent element (with properties) |
| POST | `/api/v1/consent-purposes` | Create consent purpose |
| POST | `/api/v1/consents` | Create consent record |
| GET | `/api/v1/consents/{id}` | Get consent details |
| POST | `/api/v1/consents/validate` | Validate consent (called by gateway) |
| PUT | `/api/v1/consents/{id}/revoke` | Revoke consent |
| GET | `/api/v1/consents?status=ACTIVE` | List consents by filter |

### Mock Backend Test Data

| NIN | Name |
|-----|------|
| `CM19951234567890` | John Michael Doe |
| `CF19900722123456` | Jane Elizabeth Smith |
| `CF19781234567890` | Amal Kumara Perera |
| `NIN-1122334455` | Nimal Sanjeewa Fernando |
| Any other NIN | Default (John Doe with that NIC) |

### Credentials

| System | User | Password |
|--------|------|----------|
| IS / APIM admin | admin | admin |
| Test citizen | john123 | John@123 |
| MySQL | root | root123 |

---

## Troubleshooting

### Bank portal shows "Setting up..." indefinitely

- Check IS/APIM health: `docker compose ps` — both must be healthy
- Check bank-portal logs: `docker logs -f consent-bank-portal`
- If `[Setup] FATAL: KYCAPI not found` → KYCAPI not published in APIM (see [Pre-Publishing](#what-requires-pre-publishing))
- If `[Setup] FATAL: ciba-test-key.pem not found` → generate keys (see [Pre-Startup](#pre-startup-setup))

### API Error 403 after consent approval

Consent elements missing `properties` (jsonPath, resourcePath). The gateway enforcement checks `element.properties.resourcePath` — if undefined, it fails.

```bash
# Verify elements have properties
curl -s http://localhost:3000/api/v1/consent-elements -H 'org-id: DEMO-ORG-001' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); [print(e['name'], e.get('properties',{})) for e in d.get('data',[])]"

# Fix: purge and recreate
./purge-consents.sh
```

### API Error 401 — Consent Validation Failed

Consent was revoked or expired. The gateway returns this when OpenFGC validation fails. Create a new KYC request with fresh consent.

### Consent page shows default WSO2 theme

Custom WAR not deployed. Rebuild IS:
```bash
docker compose build identity-server --no-cache && docker compose up -d identity-server
```

### All elements show as "Optional" in citizen-app

Citizen-app not rebuilt after isMandatory fix:
```bash
docker compose build citizen-app && docker compose up -d citizen-app
```

### Container exits with "address already in use"

Port conflict. Check: `lsof -i :9443` (or whichever port). Stop conflicting process or change ports in docker-compose.yml.

### MySQL connection refused (openfgc fails)

MySQL not ready yet. Check `docker logs consent-mysql`. The health check in docker-compose.yml ensures openfgc waits, but if MySQL init takes long, restart openfgc:
```bash
docker compose restart openfgc
```

### `docker compose restart` doesn't pick up code changes

`restart` reuses existing containers/images. You must rebuild:
```bash
docker compose build <service-name> && docker compose up -d <service-name>
```

---

## Pitfalls & Tips

### Critical Pitfalls

1. **Consent elements MUST have `properties`**. When creating elements in OpenFGC, always include `properties: { jsonPath: "$.person.<field>", resourcePath: "/user/{nic}" }`. Without these, the gateway enforcement policy fails with 403.

2. **MySQL FK deletion order matters**. The schema uses RESTRICT (not CASCADE) on many FKs. Deletion order: `CONSENT_ELEMENT_APPROVAL` → `CONSENT_AUTH_RESOURCE` → `CONSENT_STATUS_AUDIT` → `CONSENT_ATTRIBUTE` → `PURPOSE_CONSENT_MAPPING` → `CONSENT` → `PURPOSE_ELEMENT_MAPPING` → `CONSENT_PURPOSE` → `CONSENT_ELEMENT` → `CONSENT_ELEMENT_PROPERTY`. Use `purge-consents.sh` instead of manual deletes.

3. **IS uses ephemeral H2 for its own data**. Recreating the IS container loses all IS-internal data (apps, users, configs). Bank-portal's `setup()` re-creates everything on next startup, but any manual IS configuration will be lost.

4. **`IS_BASE` vs `IS_PUBLIC_BASE`**. Bank-portal uses `IS_BASE` (docker hostname: `consent-is:9446`) for server-to-server calls, but `IS_PUBLIC_BASE` (`localhost:9446`) for URLs that the browser will open. Mixing these up causes CORS/network errors.

5. **APIM Key Manager must be "WSO2 Identity Server"**. Bank-portal's `generate-keys` call specifies `keyManager: "WSO2 Identity Server"` by exact name. If the KM is registered with a different name, key generation fails silently.

6. **Heredoc + pipe ordering in bash**. `docker exec ... <<SQL 2>&1 | grep` — the heredoc must attach to `docker exec`, not to `grep`. Wrong: `docker exec ... 2>&1 | grep <<SQL`. This is a common scripting mistake.

7. **JSP files in IS**. Custom JSP files (like ciba.jsp) go under `repository/deployment/server/webapps/authenticationendpoint/`. The WAR file `fs#authenticationendpoint.war` deploys to a different path — Tomcat maps `fs#` to `fs/` in the URL.

### Useful Tips

- **Watch bank-portal setup**: `docker logs -f consent-bank-portal | grep -E "Setup|ready|error"` — most useful single debug command.
- **Purge is your friend**: When in doubt, run `./purge-consents.sh` and retry. It's the fastest way to recover from data inconsistencies.
- **Check gateway enforcement directly**: `curl -sk https://localhost:8243/kyc/1.0.0/user/CM19951234567890` without a token should return 401, confirming enforcement is active.
- **OpenFGC validation endpoint**: `POST http://localhost:3000/api/v1/consents/validate` is what the gateway calls. You can test it manually with a JWT payload to debug consent issues.
- **Revocation detection**: Bank-portal checks via gateway every 10s. For immediate detection, call `GET /api/requests/:id` which does an on-demand gateway re-check.
- **NODE_TLS_REJECT_UNAUTHORIZED=0**: Required because IS and APIM use self-signed certs. Don't remove this in Docker env vars or all HTTPS calls between containers will fail.

### Recovery Procedures

**Complete reset** (nuclear option):
```bash
docker compose down -v    # destroys all data + volumes
docker compose up -d      # fresh start
```

**Soft reset** (keep images, clear data):
```bash
./purge-consents.sh       # clears consent data, restarts bank-portal
```

**Rebuild single service**:
```bash
docker compose build <service> --no-cache && docker compose up -d <service>
```

**Rebuild IS after Java changes**:
```bash
cd consent-accelerator-v1 && mvn clean install -DskipTests -q && cd ..
docker compose build identity-server --no-cache && docker compose up -d identity-server
```
