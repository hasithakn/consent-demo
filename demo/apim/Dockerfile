FROM registry.wso2.com/wso2-apim/am:4.5.0

# Copy setup script and all assets it needs
COPY --chmod=755 apim/setup.sh /setup.sh
COPY apim/setup/ /setup/

# Copy entrypoint wrapper that starts APIM then triggers setup.sh on first boot
COPY --chmod=755 apim/entrypoint.sh /entrypoint.sh

# Import shared demo cert (covers all service hostnames) into keystore and truststore
# Run: bash scripts/generate-certs.sh to create these files first
COPY apim/wso2carbon.p12 /home/wso2carbon/demo-keystore.p12
COPY apim/demo.crt /home/wso2carbon/demo.crt
RUN SEC=/home/wso2carbon/wso2am-4.5.0/repository/resources/security && \
    keytool -delete -alias wso2carbon \
      -keystore $SEC/wso2carbon.jks -storepass wso2carbon 2>/dev/null || true && \
    keytool -importkeystore \
      -srckeystore /home/wso2carbon/demo-keystore.p12 -srcstoretype PKCS12 -srcstorepass wso2carbon -srcalias wso2carbon \
      -destkeystore $SEC/wso2carbon.jks -deststoretype JKS -deststorepass wso2carbon -destalias wso2carbon -noprompt && \
    keytool -delete -alias demo-shared \
      -keystore $SEC/client-truststore.jks -storepass wso2carbon 2>/dev/null || true && \
    keytool -import -alias demo-shared -file /home/wso2carbon/demo.crt \
      -keystore $SEC/client-truststore.jks -storepass wso2carbon -noprompt && \
    rm /home/wso2carbon/demo-keystore.p12 /home/wso2carbon/demo.crt

# Import OB root/issuer CA certificates into the truststore
COPY --chmod=644 ob_root_issuer_certs/ /home/wso2carbon/ob-certs/
RUN SEC=/home/wso2carbon/wso2am-4.5.0/repository/resources/security && \
    for cert in /home/wso2carbon/ob-certs/*.cer; do \
      alias=$(basename "$cert" .cer | tr '[:upper:]' '[:lower:]'); \
      keytool -delete -alias "$alias" -keystore $SEC/client-truststore.jks -storepass wso2carbon 2>/dev/null || true; \
      keytool -import -alias "$alias" -file "$cert" \
        -keystore $SEC/client-truststore.jks -storepass wso2carbon -noprompt; \
    done && \
    rm -rf /home/wso2carbon/ob-certs 2>/dev/null || true

ENTRYPOINT ["/entrypoint.sh"]
