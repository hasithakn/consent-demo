## Prerequisites

- Docker & Docker Compose
- Java 11+ and Maven 3.6+ (for building the Consent Accelerator)
- `curl`, `unzip`

---

## Quick Start

One command to build and start the full demo:

```bash
bash start.sh
```

On first run this takes **3–5 minutes** (IS and APIM startup). Subsequent runs with images already built are faster.

| Flag | Effect |
|------|--------|
| _(none)_ | Full setup — downloads, builds, starts, seeds |
| `--no-build` | Skip Maven build (use existing `is/build-artifacts/`) |
| `--clean` | Remove all generated files, stop containers, delete volumes — then exit |

**Clean everything and start fresh:**

```bash
bash start.sh --clean && bash start.sh
```

---

## Manual Steps (what `start.sh` does)

If you prefer to run each step individually:

### 1. Download OpenFGC release

Downloads the OpenFGC binary and extracts the MySQL schema needed by Docker Compose.

```bash
bash scripts/setup-openfgc.sh
```

### 2. Build Consent Accelerator

Compiles the Maven project and stages JARs + WAR into `is/build-artifacts/` for the IS Docker image.

```bash
bash scripts/build-consent-accelerator.sh
```

### 3. Generate TLS certificates

Generates a shared keypair covering all service hostnames and places `wso2carbon.p12` + `demo.crt` into `is/` and `apim/` build contexts. Required before `docker compose build`.

```bash
bash scripts/generate-certs.sh
```

> Skip this step if `is/wso2carbon.p12` already exists — `start.sh` does this automatically.

### 4. Start all Docker services

```bash
docker compose up -d --build
```

> IS and APIM take 2–3 minutes to fully start. The `setup.sh` inside each container runs automatically on first start — it configures IS as the Key Manager, imports and publishes the KYC API, and attaches the consent enforcement policies.

### 5. Populate OpenFGC

Once the stack is running, populate OpenFGC with the 13 KYC consent elements and sample purpose:

```bash
bash scripts/clean-and-populate-openfgc.sh
```

This wipes the database and recreates all seed data. Run it any time you want a clean slate.

---

## Service URLs

| Service | URL | Credentials |
|---------|-----|-------------|
| **Bank Portal** | `http://localhost:3010` | — |
| **Citizen App** | `http://localhost:3010/citizen/` | — |
| WSO2 IS Console | `https://localhost:9446/console` | admin / admin |
| WSO2 APIM Console | `https://localhost:9443/publisher` | admin / admin |
| APIM Gateway | `https://localhost:8243` | — |
| OpenFGC | `http://localhost:3000/health` | — |
| Mock KYC Backend | `http://localhost:3002/health` | — |

---

## Repository Structure

```
.
├── start.sh                  # One-command demo launcher
├── docker-compose.yml
├── scripts/                  # Setup and seed scripts
├── demo-ui/                  # Bank Portal + Citizen App (single Node.js server)
├── is/                       # WSO2 Identity Server Docker build context
├── apim/                     # WSO2 API Manager Docker build context
├── openfgc/                  # OpenFGC consent engine Docker build context
├── mock-backend/             # Mock KYC data API
├── consent-accelerator/      # WSO2 Consent Accelerator Maven project
└── ob_root_issuer_certs/     # Signing keys for CIBA JWT
```

---

## Tear Down

```bash
docker compose down          # stop and remove containers
docker compose down -v       # also remove MySQL data volume
```

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENFGC_VERSION` | `0.2.0` | OpenFGC release version to download |
| `MYSQL_ROOT_PASSWORD` | `root123` | MySQL root password |
| `MYSQL_DATABASE` | `consent_mgt` | Database name |
