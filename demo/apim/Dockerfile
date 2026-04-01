FROM wso2/wso2am:4.5.0

# Copy setup script and all assets it needs
COPY setup.sh /setup.sh
COPY setup/ /setup/
RUN chmod +x /setup.sh

# Copy entrypoint wrapper that starts APIM then triggers setup.sh on first boot
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
