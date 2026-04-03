#!/bin/bash
# Generates a shared TLS keypair covering all demo service hostnames,
# placed directly in the is/ and apim/ Docker build contexts.
#
# Usage:
#   bash scripts/generate-certs.sh
#
# Run once before 'docker compose build' whenever certs are missing or expired.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "[certs] Generating shared demo keypair with SANs (keytool)..."

keytool -genkeypair -alias wso2carbon \
  -keyalg RSA -keysize 2048 -validity 3650 \
  -storetype PKCS12 \
  -keystore "$REPO_ROOT/is/wso2carbon.p12" -storepass wso2carbon \
  -dname "CN=identity-server, O=WSO2Demo, C=LK" \
  -ext "SAN=DNS:localhost,DNS:identity-server,DNS:api-manager,DNS:consent-is,DNS:consent-apim"

echo "[certs] Exporting public certificate..."
keytool -export -alias wso2carbon \
  -keystore "$REPO_ROOT/is/wso2carbon.p12" -storepass wso2carbon \
  -file "$REPO_ROOT/is/demo.crt" -rfc

echo "[certs] Copying to apim/ build context..."
cp "$REPO_ROOT/is/wso2carbon.p12" "$REPO_ROOT/apim/wso2carbon.p12"
cp "$REPO_ROOT/is/demo.crt"       "$REPO_ROOT/apim/demo.crt"

echo "[certs] Done. Run 'docker compose build is apim' to rebuild the images."
