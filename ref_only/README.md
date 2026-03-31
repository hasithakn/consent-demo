# Consent-Based KYC API Demo

A full-stack demo of consent-managed citizen KYC data access. A **bank officer** requests KYC data, the **citizen** approves or denies via a mobile app (CIBA flow), and the **API gateway** enforces consent in real-time — filtering API responses to only approved fields and blocking access when consent is revoked.

## Architecture

```
┌────────────────┐     ┌────────────────┐     ┌────────────────┐
│  Bank Portal   │────▶│  WSO2 APIM     │────▶│  Mock KYC      │
│  (Officer UI)  │     │  (Gateway +    │     │  Backend       │
│  :3010         │     │   Enforcement) │     │  :3002         │
└───────┬────────┘     │  :9443/:8243   │     └────────────────┘
        │              └───────┬────────┘
        │                      │ validates consent
        │              ┌───────▼────────┐
        │              │   OpenFGC      │◀───── MySQL 8.0
        │              │   (Consent     │       :3306
        │ CIBA         │    Server)     │
        │ flow         │   :3000        │
        │              └───────▲────────┘
        │                      │ revoke / history
┌───────▼────────┐     ┌──────┴─────────┐
│  WSO2 IS 7.1   │     │  Citizen App   │
│  (Auth + CIBA) │◀────│  (Mobile UI)   │
│  :9446         │     │  :3011         │
└────────────────┘     └────────────────┘
        │
   ┌────▼────┐
   │  JWKS   │  nginx serving public keys
   │  :8899  │  for JWT signature verification
   └─────────┘
```

### Components

| Container | Technology | Port | Purpose |
|-----------|-----------|------|---------|
| `consent-jwks` | nginx:alpine | 8899 | JWKS endpoint for JWT signature verification |
| `consent-mysql` | MySQL 8.0 | 3306 | Consent database (OpenFGC) |
| `consent-openfgc` | Go | 3000 | Consent management server |
| `consent-mock-backend` | Node.js | 3002 | Mock KYC person data API |
| `consent-is` | WSO2 IS 7.1.0 | 9446 | Identity provider + CIBA authentication |
| `consent-apim` | WSO2 APIM 4.5.0 | 9443/8243 | API gateway with consent enforcement |
| `consent-bank-portal` | Node.js Express | 3010 | Bank branch officer interface |
| `consent-citizen-app` | Node.js Express | 3011 | Citizen mobile consent app |

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Java 17 + Maven 3.8+ (only if rebuilding Java artifacts)
- ~8 GB RAM allocated to Docker

### 1. Generate CIBA signing keys (if not present)

```bash
openssl genrsa -out ciba-test-key.pem 2048
openssl rsa -in ciba-test-key.pem -pubout -out ciba-test-key-pub.pem
```

### 2. Start everything

```bash
docker compose up -d
```

Wait ~3–4 minutes for IS and APIM to become healthy:
```bash
docker compose ps   # all 8 should show "healthy" or "Up"
```

### 3. Use it

1. Open **Bank Portal** at [http://localhost:3010](http://localhost:3010)
2. Fill in a NIN (e.g. `CM19951234567890`) and click **Submit KYC Request**
3. Click the **citizen approval link** (opens WSO2 IS consent page)
4. Log in as `john123` / `John@123`
5. Review and **approve** (or deny) the consent
6. Bank portal auto-detects the approval and shows verified KYC data

**Citizen App** at [http://localhost:3011](http://localhost:3011):
- View pending consent notifications
- Browse consent history (filter by Active/Revoked/Rejected)
- Revoke active consents — bank portal detects revocation via gateway enforcement

### 4. Reset data

```bash
./purge-consents.sh   # wipes all consent data, restarts bank-portal
```

## How It Works

### CIBA (Client Initiated Backchannel Authentication) Flow

1. Bank officer submits KYC request → bank portal creates a **consent** in OpenFGC and initiates a **CIBA authorization** with WSO2 IS
2. IS generates an `auth_req_id` and the bank portal constructs a **web auth link** for the citizen
3. Citizen opens the link, logs in, reviews consent elements (mandatory/optional), and approves or denies
4. IS issues an access token (with `consent_id` in scope) → bank portal calls the KYC API through the APIM gateway
5. Gateway **validates consent** with OpenFGC on every request and **filters the response** to only approved fields

### Consent Enforcement

The APIM gateway enforces consent via a Synapse mediation policy:
- **Request flow**: Extracts `consent_id` from JWT, calls OpenFGC `/validate`, checks consent status + approved elements + resource permissions
- **Response flow**: Filters the backend response using JSON paths from approved elements

When consent is **revoked**, the gateway returns HTTP 401 (`Consent Validation Failed`) — the bank portal detects this and clears the cached KYC data.

## Project Structure

```
consent-demo/
├── docker-compose.yml          # 8 containers
├── purge-consents.sh           # DB cleanup script
├── bank-portal/                # Branch officer portal (Express + static HTML)
├── citizen-app/                # Mobile consent app (Express + static HTML)
├── mock-backend/               # Mock KYC person data API
├── docker/
│   ├── is/                     # IS Dockerfile, JARs, WAR, ciba.jsp, deployment.toml
│   ├── apim/                   # APIM Dockerfile, consent enforcement mediator JAR
│   ├── mysql/                  # DB init
│   └── openfgc/                # OpenFGC config
├── consent-accelerator-v1/     # Java source (Maven, 4 modules)
│   ├── consent-accelerator-utils/      # Consent ID ↔ scope mapping
│   ├── consent-authentication-webapp/  # Custom consent page (JSPs)
│   └── consent-mediation/              # APIM policy + mediator
├── openfgc/                    # OpenFGC Go source (built via Dockerfile)
├── scripts/                    # Reference configs (IS app, KM, policies, API definition)
├── demo.py                     # Interactive CLI demo (Python)
├── PROGRESS.md                 # Complete build log with issues and resolutions
└── SKILL.md                    # Automated setup guide for AI agents
```

## Building Java Artifacts

Pre-built artifacts are included in `docker/is/` and `docker/apim/`. To rebuild:

```bash
cd consent-accelerator-v1
mvn clean install -DskipTests -q
```

Outputs (auto-copied by Maven to Docker build directories):
- `docker/is/dropins/com.wso2.consent.accelerator.utils-1.0-SNAPSHOT.jar`
- `docker/is/dropins/com.wso2.consent.accelerator.ciba.authenticator-1.0-SNAPSHOT.jar`
- `docker/is/webapps/fs#authenticationendpoint.war`
- `docker/apim/dropins/consent-enforcement-payload-mediator-1.0.0-SNAPSHOT.jar`

## Configuration

### Key Environment Variables (auto-configured in docker-compose.yml)

| Variable | Value | Purpose |
|----------|-------|---------|
| `CONSENT_CLIENT_ID` | `YSZ6l_tcxc7wTtuGzaEyopAZ_SIa` | TPP client ID in IS (consent correlation) |
| `CONSENT_ORG_ID` | `DEMO-ORG-001` | Tenant/org ID used across all components |
| `IS_PUBLIC_BASE` | `https://localhost:9446` | Browser-facing IS URL |
| `REDIRECT_URI` | `http://localhost:3011/auth-callback.html` | Post-consent redirect |

### Test Data

| NIN | Name | Notes |
|-----|------|-------|
| `CM19951234567890` | John Michael Doe | Default test citizen |
| `CF19900722123456` | Jane Elizabeth Smith | |
| `CF19781234567890` | Amal Kumara Perera | |
| `NIN-1122334455` | Nimal Sanjeewa Fernando | |

### Credentials

| System | Username | Password |
|--------|----------|----------|
| IS / APIM admin | `admin` | `admin` |
| Test citizen | `john123` | `John@123` |

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Bank portal shows "Setting up..." | IS or APIM not healthy yet | Wait for `docker compose ps` to show all healthy |
| `API Error: 403` after approval | Consent elements missing `properties` | Run `./purge-consents.sh`, then retry |
| `API Error: 401` after approval | Consent was revoked or expired | Create a new KYC request |
| Consent page shows WSO2 default style | WAR not deployed correctly | Rebuild IS: `docker compose build identity-server && docker compose up -d identity-server` |
| All elements show as "Optional" | citizen-app not rebuilt | `docker compose build citizen-app && docker compose up -d citizen-app` |
| `docker compose restart` doesn't pick up code changes | Docker restart reuses existing image | Use `docker compose build <service>` first |

## License

Internal demonstration project.
