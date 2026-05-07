FROM node:20-alpine
WORKDIR /app
COPY demo-ui-internal-data-share-usecase/package*.json ./
RUN npm install --production
COPY demo-ui-internal-data-share-usecase/server.js ./
COPY demo-ui-internal-data-share-usecase/config.json ./
COPY demo-ui-internal-data-share-usecase/public ./public
EXPOSE 3020
CMD ["node", "server.js"]
