#!/bin/bash
# Downloads and sets up the OpenFGC consent server binary
set -e

OPENFGC_VERSION="${OPENFGC_VERSION:-0.2.0}"
DEST_DIR="$(cd "$(dirname "$0")/.." && pwd)/openfgc"

# Detect OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  darwin)  OS_NAME="macos" ;;
  linux)   OS_NAME="linux" ;;
  *)       echo "Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  arm64|aarch64) ARCH_NAME="arm64" ;;
  x86_64)        ARCH_NAME="x64" ;;
  *)             echo "Unsupported arch: $ARCH"; exit 1 ;;
esac

FILENAME="consent-server-${OPENFGC_VERSION}-${OS_NAME}-${ARCH_NAME}.zip"
DOWNLOAD_URL="https://github.com/wso2/openfgc/releases/download/v${OPENFGC_VERSION}/${FILENAME}"

if [ -f "$DEST_DIR/bin/consent-server" ]; then
  echo "[openfgc] Binary already present at $DEST_DIR/bin/consent-server — skipping download."
  exit 0
fi

echo "[openfgc] Downloading OpenFGC v${OPENFGC_VERSION} (${OS_NAME}-${ARCH_NAME})..."
curl -L --progress-bar -o "/tmp/${FILENAME}" "$DOWNLOAD_URL"

echo "[openfgc] Extracting..."
mkdir -p "$DEST_DIR/bin"
unzip -o "/tmp/${FILENAME}" -d "/tmp/openfgc-extract" > /dev/null

# Move server binary
find "/tmp/openfgc-extract" -name "consent-server" | head -1 | xargs -I{} cp {} "$DEST_DIR/bin/consent-server"
chmod +x "$DEST_DIR/bin/consent-server"

# Copy dbscripts
if find "/tmp/openfgc-extract" -name "*.sql" | grep -q .; then
  mkdir -p "$DEST_DIR/dbscripts"
  find "/tmp/openfgc-extract" -name "*.sql" -exec cp {} "$DEST_DIR/dbscripts/" \;
  echo "[openfgc] DB scripts copied to $DEST_DIR/dbscripts/"
fi

# Copy default config if present
if find "/tmp/openfgc-extract" -name "deployment.yaml" | grep -q .; then
  mkdir -p "$DEST_DIR/repository/conf"
  find "/tmp/openfgc-extract" -name "deployment.yaml" | head -1 | xargs -I{} cp {} "$DEST_DIR/repository/conf/deployment.yaml"
  echo "[openfgc] Default config copied to $DEST_DIR/repository/conf/deployment.yaml"
fi

rm -rf "/tmp/openfgc-extract" "/tmp/${FILENAME}"
echo "[openfgc] Done. Run: $DEST_DIR/bin/consent-server"
