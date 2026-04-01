FROM registry.wso2.com/wso2-apim/am:4.5.0

# Copy setup script and all assets it needs
COPY --chmod=755 setup.sh /setup.sh
COPY setup/ /setup/

# Copy entrypoint wrapper that starts APIM then triggers setup.sh on first boot
COPY --chmod=755 entrypoint.sh /entrypoint.sh

# Import shared demo cert (covers all service hostnames) into keystore and truststore
# Run: bash scripts/generate-certs.sh to create these files first
COPY wso2carbon.p12 /home/wso2carbon/demo-keystore.p12
COPY demo.crt /home/wso2carbon/demo.crt
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

ENTRYPOINT ["/entrypoint.sh"]
