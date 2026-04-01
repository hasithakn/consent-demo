#!/bin/bash
# Builds the Consent Accelerator Maven project and copies the resulting artifacts
# into is/build-artifacts/ so the IS Docker image can COPY them in.
#
# Usage:
#   bash scripts/build-consent-accelerator.sh
#
# Prerequisites:
#   - Java 11+ and Maven 3.6+ on PATH
#
# Artifacts produced:
#   is/build-artifacts/dropins/
#     com.wso2.consent.accelerator.utils-1.0-SNAPSHOT.jar
#     com.wso2.consent.accelerator.ciba.authenticator-1.0-SNAPSHOT.jar
#   is/build-artifacts/webapps/
#     fs#authenticationendpoint.war

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ACCELERATOR_DIR="$REPO_ROOT/consent-accelerator"
BUILD_ARTIFACTS_DIR="$REPO_ROOT/is/build-artifacts"
DROPINS_DIR="$BUILD_ARTIFACTS_DIR/dropins"
WEBAPPS_DIR="$BUILD_ARTIFACTS_DIR/webapps"

echo "[consent-accelerator] Building Maven project..."
mvn clean install -f "$ACCELERATOR_DIR/pom.xml" -DskipTests

echo "[consent-accelerator] Copying artifacts to is/build-artifacts/..."
mkdir -p "$DROPINS_DIR" "$WEBAPPS_DIR"

# JARs → dropins
cp "$ACCELERATOR_DIR/consent-accelerator-utils/target/com.wso2.consent.accelerator.utils-1.0-SNAPSHOT.jar" \
   "$DROPINS_DIR/"

cp "$ACCELERATOR_DIR/ciba-authenticator/target/com.wso2.consent.accelerator.ciba.authenticator-1.0-SNAPSHOT.jar" \
   "$DROPINS_DIR/"

# WAR → webapps
cp "$ACCELERATOR_DIR/consent-authentication-webapp/target/fs#authenticationendpoint.war" \
   "$WEBAPPS_DIR/"

echo ""
echo "[consent-accelerator] Done. Artifacts staged at:"
echo "  Dropins : $DROPINS_DIR"
ls "$DROPINS_DIR"
echo "  Webapps : $WEBAPPS_DIR"
ls "$WEBAPPS_DIR"
echo ""
echo "  You can now build the IS Docker image:"
echo "    docker compose build is"
