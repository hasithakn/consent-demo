#!/bin/sh
# Entrypoint: start APIM server then run one-time setup in the background.
# The APIM process remains PID 1 (via exec) so Docker signals work correctly.

APIM_HOME="/home/wso2carbon/wso2am-4.5.0"
SETUP_DONE_FLAG="/tmp/.apim-setup-done"

# Run setup.sh in the background once APIM is ready, but only on first start.
(
  if [ ! -f "$SETUP_DONE_FLAG" ]; then
    echo "[entrypoint] Waiting for APIM to be ready before running setup..."
    until curl -sk -o /dev/null -w "%{http_code}" "https://localhost:9443/carbon/admin/login.jsp" | grep -q "200"; do
      sleep 5
    done
    echo "[entrypoint] APIM is ready. Running setup.sh..."
    sh /setup.sh && touch "$SETUP_DONE_FLAG"
    echo "[entrypoint] setup.sh complete."
  else
    echo "[entrypoint] Setup already done, skipping."
  fi
) &

# Hand off to the real APIM startup script as PID 1
exec "$APIM_HOME/bin/wso2server.sh"
