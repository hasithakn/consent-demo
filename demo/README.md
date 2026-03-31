
## Setup

### 1. Prepare OpenFGC

Downloads the release binary from GitHub and extracts the MySQL schema.

```bash
bash scripts/setup-openfgc.sh
```

### 2. Start Services

Starts MySQL (initialises schema on first run) and builds + starts the OpenFGC server.

```bash
docker compose up -d
```

Verify OpenFGC is running:

```bash
curl http://localhost:3000/api/v1/consent-elements -H "org-id: DEMO-ORG-001"
```

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
