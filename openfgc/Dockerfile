FROM alpine:3.19

ARG OPENFGC_VERSION=0.2.0
ARG TARGETARCH

RUN apk add --no-cache ca-certificates tzdata curl unzip

WORKDIR /app

# Download the Linux binary for the target arch at build time (separate from host binary in release/)
RUN ARCH=$([ "$TARGETARCH" = "arm64" ] && echo "arm64" || echo "x64") && \
    curl -L -o /tmp/openfgc.zip \
      "https://github.com/wso2/openfgc/releases/download/v${OPENFGC_VERSION}/consent-server-${OPENFGC_VERSION}-linux-${ARCH}.zip" && \
    unzip -q /tmp/openfgc.zip -d /tmp/openfgc && \
    find /tmp/openfgc -name "consent-server" | head -1 | xargs -I{} cp {} ./consent-server && \
    chmod +x ./consent-server && \
    rm -rf /tmp/openfgc /tmp/openfgc.zip

# Config — ${VAR} placeholders are resolved from docker-compose environment at runtime
COPY deployment.yaml ./repository/conf/deployment.yaml

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=10 \
  CMD wget -q --spider http://localhost:3000/health || exit 1

CMD ["./consent-server"]
