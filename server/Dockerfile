FROM node:22-alpine
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY src/data/ /app/src/data/
USER node
EXPOSE 3000
CMD ["node", "index.js"]
