FROM wso2/wso2am:4.5.0

# Copy consent enforcement mediator bundle to dropins
COPY dropins/*.jar /home/wso2carbon/wso2am-4.5.0/repository/components/dropins/

# Copy setup script and all assets it needs
COPY setup.sh /setup.sh
COPY setup/ /setup/
RUN chmod +x /setup.sh
