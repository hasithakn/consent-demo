FROM wso2/wso2is:7.1.0

# Copy OSGi bundles built by scripts/build-consent-accelerator.sh
COPY build-artifacts/dropins/*.jar /home/wso2carbon/wso2is-7.1.0/repository/components/dropins/

# Copy webapp built by scripts/build-consent-accelerator.sh
COPY build-artifacts/webapps/*.war /home/wso2carbon/wso2is-7.1.0/repository/deployment/server/webapps/

# Copy CIBA completion page into default authenticationendpoint webapp
COPY ciba.jsp /home/wso2carbon/wso2is-7.1.0/repository/deployment/server/webapps/authenticationendpoint/ciba.jsp

# Copy custom deployment.toml
COPY deployment.toml /home/wso2carbon/wso2is-7.1.0/repository/conf/deployment.toml
