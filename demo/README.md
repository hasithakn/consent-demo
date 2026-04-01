
## Prerequisites

- Docker & Docker Compose
- Java 11+ and Maven 3.6+ (for building the Consent Accelerator)
- `curl`, `unzip` (for the OpenFGC setup script)

---

## Setup

### 1. Prepare OpenFGC

Downloads the OpenFGC release binary from GitHub and extracts it (including the MySQL schema) into `openfgc/release/server/`.

```bash
bash scripts/setup-openfgc.sh
```

### 2. Build the Consent Accelerator

Compiles the Maven project and stages the build artifacts for the IS Docker image.

```bash
bash scripts/build-consent-accelerator.sh
```

Artifacts are placed in `is/build-artifacts/` and picked up by the IS Dockerfile at build time.

### 3. Start All Services

Builds and starts MySQL, OpenFGC, Mock Backend, WSO2 IS, and WSO2 API Manager.

```bash
docker compose up -d
```

> **First run:** IS and APIM take 2–3 minutes to fully start. APIM will not start until IS is healthy. The `setup.sh` inside APIM runs automatically on first start — it imports the IS TLS certificate, registers IS as the Key Manager, imports and publishes the KYC API, and attaches the consent enforcement policies.

### 4. Verify Services

| Service | URL | Notes |
|---------|-----|-------|
| OpenFGC | `http://localhost:3000/health` | Consent management server |
| Mock KYC Backend | `http://localhost:3002/health` | Mock bank data API |
| WSO2 IS | `https://localhost:9446/carbon` | Identity Server (admin/admin) |
| WSO2 APIM | `https://localhost:9443/carbon` | API Manager (admin/admin) |
| APIM Gateway | `https://localhost:8243` | API invocation endpoint |

```bash
# OpenFGC health
curl http://localhost:3000/health

# Mock backend health
curl http://localhost:3002/health

# List consent elements (OpenFGC)
curl http://localhost:3000/api/v1/consent-elements -H "org-id: DEMO-ORG-001"
```

### 5. Tear Down

```bash
docker compose down

# To also remove the MySQL data volume:
docker compose down -v
```

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENFGC_VERSION` | `0.2.0` | Release version to download |
| `OPENFGC_DB_HOSTNAME` | `127.0.0.1` | MySQL host (local run only) |
| `OPENFGC_DB_PORT` | `3306` | MySQL port |
| `OPENFGC_DB_NAME` | `consent_mgt` | Database name |
| `OPENFGC_DB_USER` | `root` | MySQL user |
| `OPENFGC_DB_PASSWORD` | `root123` | MySQL password |
| `MYSQL_ROOT_PASSWORD` | `root123` | MySQL root password (Docker) |

