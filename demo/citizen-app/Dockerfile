FROM node:20-alpine
WORKDIR /app
COPY citizen-app/package*.json ./
RUN npm install --production
COPY citizen-app/server.js ./
COPY citizen-app/public ./public
EXPOSE 3011
CMD ["node", "server.js"]
