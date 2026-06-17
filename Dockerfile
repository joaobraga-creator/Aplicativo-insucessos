FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js query_insucessos_nex_mlb.sql ./
COPY public ./public

ENV NODE_ENV=production
ENV PORT=8080

CMD ["node", "server.js"]
