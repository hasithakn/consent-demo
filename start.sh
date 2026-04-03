#!/bin/bash
# start.sh — Full demo setup and start in one command.
#
# Usage:
#   bash start.sh            # first run or restart (skips steps already done)
#   bash start.sh --no-build # skip Maven build (artifacts already present)
#   bash start.sh --clean    # remove all generated/downloaded files, then exit
#
# What it does:
#   1. Downloads OpenFGC release (skipped if already done)
#   2. Builds Consent Accelerator with Maven (skipped with --no-build)
#   3. Starts all Docker services
#   4. Waits for APIM to finish its one-time setup
#   5. Cleans and populates OpenFGC with KYC data

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NO_BUILD=false
CLEAN=false
for arg in "$@"; do
  [ "$arg" = "--no-build" ] && NO_BUILD=true
  [ "$arg" = "--clean" ]    && CLEAN=true
done

# ── Clean mode ───────────────────────────────────────────────────────────────
if [ "$CLEAN" = "true" ]; then
  echo ""
  echo "════════════════════════════════════════════════════════════"
  echo "  Consent Demo — Clean"
  echo "════════════════════════════════════════════════════════════"
  echo ""

  echo "[clean] Stopping and removing Docker containers and volumes..."
  docker compose -f "$SCRIPT_DIR/docker-compose.yml" down -v 2>/dev/null || true

  echo "[clean] Removing OpenFGC release downloads..."
  rm -rf "$SCRIPT_DIR/openfgc/release"

  echo "[clean] Removing Maven build artifacts (is/build-artifacts)..."
  rm -rf "$SCRIPT_DIR/is/build-artifacts"

  echo "[clean] Running Maven clean on Consent Accelerator..."
  if [ -f "$SCRIPT_DIR/consent-accelerator/pom.xml" ]; then
    mvn clean -f "$SCRIPT_DIR/consent-accelerator/pom.xml" -q 2>/dev/null || true
  fi

  echo "[clean] Removing generated TLS certificates..."
  rm -f "$SCRIPT_DIR/is/wso2carbon.p12"
  rm -f "$SCRIPT_DIR/is/demo.crt"
  rm -f "$SCRIPT_DIR/apim/wso2carbon.p12"
  rm -f "$SCRIPT_DIR/apim/demo.crt"

  echo "[clean] Removing Docker build cache for demo images..."
  docker compose -f "$SCRIPT_DIR/docker-compose.yml" build --no-cache 2>/dev/null | head -0 || true
  docker image rm -f \
    "$(docker compose -f "$SCRIPT_DIR/docker-compose.yml" config --images 2>/dev/null)" \
    2>/dev/null || true

  echo ""
  echo "[clean] Done. Run 'bash start.sh' to rebuild from scratch."
  echo ""
  exit 0
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  Consent Demo — Full Start"
echo "════════════════════════════════════════════════════════════"
echo ""

# ── 1. Prepare OpenFGC release ───────────────────────────────────────────────
echo "[start] Step 1/5 — OpenFGC release"
bash "$SCRIPT_DIR/scripts/setup-openfgc.sh"

# ── 2. Build Consent Accelerator ────────────────────────────────────────────
if [ "$NO_BUILD" = "true" ]; then
  echo "[start] Step 2/5 — Skipping Maven build (--no-build)"
else
  echo "[start] Step 2/5 — Build Consent Accelerator"
  bash "$SCRIPT_DIR/scripts/build-consent-accelerator.sh"
fi

# ── 3. Generate TLS certificates ─────────────────────────────────────────────
echo "[start] Step 3/5 — TLS certificates"
if [ -f "$SCRIPT_DIR/is/wso2carbon.p12" ] && [ -f "$SCRIPT_DIR/apim/demo.crt" ]; then
  echo "[start] Certificates already present, skipping."
else
  bash "$SCRIPT_DIR/scripts/generate-certs.sh"
fi

# ── 4. Start Docker services ─────────────────────────────────────────────────
echo ""
echo "[start] Step 4/5 — Starting Docker services..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d --build

echo "[start] Waiting for WSO2 IS to be ready (this takes 2-3 min on first run)..."
until curl -sk -o /dev/null -w "%{http_code}" \
    "https://localhost:9446/carbon/admin/login.jsp" | grep -q "200"; do
  printf "."
  sleep 10
done
echo " IS ready."

echo "[start] Waiting for APIM one-time setup to complete..."
until curl -sk -o /dev/null -w "%{http_code}" \
    -u admin:admin "https://localhost:9443/api/am/publisher/v4/apis?limit=1" | grep -q "200"; do
  printf "."
  sleep 10
done
echo " APIM ready."

# ── Wait for IS background setup.sh to finish ────────────────────────────────
# setup.sh runs in the background after IS boots and logs credentials when done.
echo "[start] Waiting for IS app setup to complete..."
until docker logs consent-is 2>&1 | grep -q '\[is-setup\].*CLIENT_ID.*='; do
  printf "."
  sleep 5
done
echo " IS setup complete."

# ── Extract credentials from IS container logs ────────────────────────────────
CLIENT_ID=$(docker logs consent-is 2>&1 \
  | grep '\[is-setup\].*CLIENT_ID' | tail -1 \
  | sed 's/.*= *//' | tr -d '[:space:]')
CLIENT_SECRET=$(docker logs consent-is 2>&1 \
  | grep '\[is-setup\].*CLIENT_SECRET' | tail -1 \
  | sed 's/.*= *//' | tr -d '[:space:]')

if [ -n "$CLIENT_ID" ]; then
  echo "[start] Writing IS app credentials to .env..."
  cat > "$SCRIPT_DIR/.env" <<EOF
BANK_CLIENT_ID=${CLIENT_ID}
BANK_CLIENT_SECRET=${CLIENT_SECRET}
EOF
  echo "[start] Restarting demo-ui with updated credentials..."
  docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d --no-deps --no-build demo-ui
else
  echo "[start] WARNING: Could not extract credentials from IS logs — check 'docker logs consent-is'"
fi

# ── 5. Populate OpenFGC ──────────────────────────────────────────────────────
echo ""
echo "[start] Step 5/5 — Populate OpenFGC with KYC data"
bash "$SCRIPT_DIR/scripts/clean-and-populate-openfgc.sh"

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  Demo is ready!"
echo ""
echo "  WSO2 IS Console   https://localhost:9446/console  (admin/admin)"
echo "  WSO2 APIM Console https://localhost:9443/publisher (admin/admin)"
echo "  APIM Gateway      https://localhost:8243"
echo "  OpenFGC           http://localhost:3000/health"
echo "  Mock KYC Backend  http://localhost:3002/health"
echo "  Bank Portal       http://localhost:3010"
echo "  Citizen App       http://localhost:3010/citizen/"
echo ""
echo "  App: National Bank KYC Portal"
echo "  Client ID     : ${CLIENT_ID:-n/a (resolves at demo-ui startup)}"
echo "  Client Secret : ${CLIENT_SECRET:-n/a (resolves at demo-ui startup)}"
echo "════════════════════════════════════════════════════════════"
echo ""
