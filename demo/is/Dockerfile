# Stage 1: generate the IS app JSON payload at build time using python3.
# This embeds the conditional script so no python3 is needed inside the container.
FROM python:3-slim AS payload-builder
COPY is/is-conditional-script.js /src/is-conditional-script.js
COPY is/setup/generate-payload.py /generate-payload.py
RUN python3 /generate-payload.py > /is-app-payload.json

# Stage 2: actual IS image
FROM registry.wso2.com/wso2-is/is:7.1.0

# Copy OSGi bundles built by scripts/build-consent-accelerator.sh
COPY is/build-artifacts/dropins/*.jar /home/wso2carbon/wso2is-7.1.0/repository/components/dropins/

# Copy webapp built by scripts/build-consent-accelerator.sh
COPY is/build-artifacts/webapps/*.war /home/wso2carbon/wso2is-7.1.0/repository/deployment/server/webapps/

# Copy CIBA completion page into default authenticationendpoint webapp
COPY is/ciba.jsp /home/wso2carbon/wso2is-7.1.0/repository/deployment/server/webapps/authenticationendpoint/ciba.jsp

# Copy custom deployment.toml
COPY is/deployment.toml /home/wso2carbon/wso2is-7.1.0/repository/conf/deployment.toml

# Copy one-time setup script and its pre-generated JSON payload
COPY --chmod=755 is/entrypoint.sh /entrypoint.sh
COPY --chmod=755 is/setup.sh /setup.sh
COPY --from=payload-builder /is-app-payload.json /setup/is-app-payload.json

# Import shared demo cert (covers all service hostnames) into keystore and truststore
# Run: bash scripts/generate-certs.sh to create these files first
COPY is/wso2carbon.p12 /home/wso2carbon/demo-keystore.p12
COPY is/demo.crt /home/wso2carbon/demo.crt
RUN SEC=/home/wso2carbon/wso2is-7.1.0/repository/resources/security && \
    cp /home/wso2carbon/demo-keystore.p12 $SEC/wso2carbon.p12 && \
    keytool -delete -alias demo-shared \
      -keystore $SEC/client-truststore.p12 -storepass wso2carbon 2>/dev/null || true && \
    keytool -import -alias demo-shared -file /home/wso2carbon/demo.crt \
      -keystore $SEC/client-truststore.p12 -storepass wso2carbon -noprompt && \
    rm /home/wso2carbon/demo-keystore.p12 /home/wso2carbon/demo.crt

# Import OB root/issuer CA certificates into the truststore
COPY --chmod=644 ob_root_issuer_certs/ /home/wso2carbon/ob-certs/
RUN SEC=/home/wso2carbon/wso2is-7.1.0/repository/resources/security && \
    for cert in /home/wso2carbon/ob-certs/*.cer; do \
      alias=$(basename "$cert" .cer | tr '[:upper:]' '[:lower:]'); \
      keytool -delete -alias "$alias" -keystore $SEC/client-truststore.p12 -storepass wso2carbon 2>/dev/null || true; \
      keytool -import -alias "$alias" -file "$cert" \
        -keystore $SEC/client-truststore.p12 -storepass wso2carbon -noprompt; \
    done && \
    rm -rf /home/wso2carbon/ob-certs 2>/dev/null || true

ENTRYPOINT ["/entrypoint.sh"]
