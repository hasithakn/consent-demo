#!/bin/bash
# Downloads the OpenFGC release binary and prepares the openfgc/ directory.
# Extracts the schema SQL from the release zip (used by docker-compose MySQL init).
# Does NOT start the server.
#
# Usage:
#   bash scripts/setup-openfgc.sh
#
# Environment variables (all optional):
#   OPENFGC_VERSION      — release version (default: 0.2.0)
#   OPENFGC_DB_HOSTNAME  — MySQL host     (default: 127.0.0.1)
#   OPENFGC_DB_PORT      — MySQL port     (default: 3306)
#   OPENFGC_DB_NAME      — database name  (default: consent_mgt)
#   OPENFGC_DB_USER      — MySQL user     (default: root)
#   OPENFGC_DB_PASSWORD  — MySQL password (default: root123)
#
# After running:
#   docker compose -f openfgc/docker-compose.yml up -d   # start MySQL + server
#   # or run locally:
#   cd openfgc && ./bin/consent-server

set -e

OPENFGC_VERSION="${OPENFGC_VERSION:-0.2.0}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OPENFGC_DIR="$REPO_ROOT/openfgc"

# ── Detect platform ───────────────────────────────────────────────────────────
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  darwin) OS_NAME="macos" ;;
  linux)  OS_NAME="linux" ;;
  *)      echo "Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  arm64|aarch64) ARCH_NAME="arm64" ;;
  x86_64)        ARCH_NAME="x64" ;;
  *)             echo "Unsupported arch: $ARCH"; exit 1 ;;
esac

RELEASE_DIR="$OPENFGC_DIR/release"
FILENAME="consent-server-${OPENFGC_VERSION}-${OS_NAME}-${ARCH_NAME}.zip"
DOWNLOAD_URL="https://github.com/wso2/openfgc/releases/download/v${OPENFGC_VERSION}/${FILENAME}"

# ── Download & extract into release/server/ ──────────────────────────────────
if [ ! -f "$RELEASE_DIR/server/consent-server" ]; then
  mkdir -p "$RELEASE_DIR"

  echo "[openfgc] Downloading OpenFGC v${OPENFGC_VERSION} (${OS_NAME}-${ARCH_NAME})..."
  curl -L --progress-bar -o "$RELEASE_DIR/${FILENAME}" "$DOWNLOAD_URL"

  echo "[openfgc] Extracting into openfgc/release/server/..."
  rm -rf "$RELEASE_DIR/server"
  unzip -q "$RELEASE_DIR/${FILENAME}" -d "$RELEASE_DIR/server"
  # Move contents out of the versioned sub-directory the zip creates
  VERSIONED_DIR=$(find "$RELEASE_DIR/server" -mindepth 1 -maxdepth 1 -type d | head -1)
  if [ -n "$VERSIONED_DIR" ]; then
    mv "$VERSIONED_DIR"/* "$RELEASE_DIR/server/"
    rmdir "$VERSIONED_DIR"
  fi

  chmod -R 755 "$RELEASE_DIR/server"
  echo "[openfgc] Done."
else
  echo "[openfgc] Release already extracted — skipping download."
fi

echo ""
echo "[openfgc] Setup complete."
echo "  Release   : $RELEASE_DIR/server/"
echo "  Binary    : $(find $RELEASE_DIR/server -name consent-server | head -1)"
echo "  Schema    : $(find $RELEASE_DIR/server -name db_schema_mysql.sql | head -1)"
echo ""
echo "  To start with Docker (MySQL + server):"
echo "    docker compose up -d"
echo ""
echo "  To start locally (set env vars, then run):"
echo "    export OPENFGC_DB_HOSTNAME=127.0.0.1 OPENFGC_DB_PORT=3306"
echo "    export OPENFGC_DB_NAME=consent_mgt OPENFGC_DB_USER=root OPENFGC_DB_PASSWORD=root123"
echo "    cd openfgc/release/server && ./consent-server"
