#!/bin/sh
# Entrypoint: start IS server then run one-time setup in the background.
# The IS process remains PID 1 (via exec) so Docker signals work correctly.

IS_HOME="/home/wso2carbon/wso2is-7.1.0"
SETUP_DONE_FLAG="/tmp/.is-setup-done"

# Run setup.sh in the background once IS is ready, but only on first start.
(
  if [ ! -f "$SETUP_DONE_FLAG" ]; then
    echo "[is-entrypoint] Waiting for IS to be ready before running setup..."
    until curl -sk -o /dev/null -w "%{http_code}" "https://localhost:9446/carbon/admin/login.jsp" | grep -q "200"; do
      sleep 5
    done
    echo "[is-entrypoint] IS is ready. Running setup.sh..."
    sh /setup.sh && touch "$SETUP_DONE_FLAG"
    echo "[is-entrypoint] setup.sh complete."
  else
    echo "[is-entrypoint] Setup already done, skipping."
  fi
) &

# Hand off to the real IS startup script as PID 1
exec "$IS_HOME/bin/wso2server.sh"
