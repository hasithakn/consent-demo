FROM node:20-alpine
WORKDIR /app
COPY demo-ui/package*.json ./
RUN npm install --production
COPY demo-ui/server.js ./
COPY demo-ui/public ./public
# Copy signing key from Open Banking test keystore
COPY ob_root_issuer_certs/oQ4KoaavpOuoE7rvQsZEOV_Expire-29_06_2026/signing-keystore/signing.key ./signing.key
EXPOSE 3010
CMD ["node", "server.js"]
