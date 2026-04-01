FROM registry.wso2.com/wso2-is/is:7.1.0

# Copy OSGi bundles built by scripts/build-consent-accelerator.sh
COPY build-artifacts/dropins/*.jar /home/wso2carbon/wso2is-7.1.0/repository/components/dropins/

# Copy webapp built by scripts/build-consent-accelerator.sh
COPY build-artifacts/webapps/*.war /home/wso2carbon/wso2is-7.1.0/repository/deployment/server/webapps/

# Copy CIBA completion page into default authenticationendpoint webapp
COPY ciba.jsp /home/wso2carbon/wso2is-7.1.0/repository/deployment/server/webapps/authenticationendpoint/ciba.jsp

# Copy custom deployment.toml
COPY deployment.toml /home/wso2carbon/wso2is-7.1.0/repository/conf/deployment.toml

# Import shared demo cert (covers all service hostnames) into keystore and truststore
# Run: bash scripts/generate-certs.sh to create these files first
COPY wso2carbon.p12 /home/wso2carbon/demo-keystore.p12
COPY demo.crt /home/wso2carbon/demo.crt
RUN SEC=/home/wso2carbon/wso2is-7.1.0/repository/resources/security && \
    cp /home/wso2carbon/demo-keystore.p12 $SEC/wso2carbon.p12 && \
    keytool -delete -alias demo-shared \
      -keystore $SEC/client-truststore.p12 -storepass wso2carbon 2>/dev/null || true && \
    keytool -import -alias demo-shared -file /home/wso2carbon/demo.crt \
      -keystore $SEC/client-truststore.p12 -storepass wso2carbon -noprompt && \
    rm /home/wso2carbon/demo-keystore.p12 /home/wso2carbon/demo.crt
