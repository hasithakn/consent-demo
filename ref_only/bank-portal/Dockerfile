FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
COPY server.js ./
COPY public/ ./public/
EXPOSE 3010
CMD ["node", "server.js"]
