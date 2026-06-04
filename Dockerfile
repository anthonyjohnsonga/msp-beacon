FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY public/ ./public/

RUN mkdir -p /data && chown node:node /data

VOLUME ["/data"]

EXPOSE 3000

USER node

HEALTHCHECK CMD wget -qO- http://localhost:3000/api/links || exit 1
CMD ["node", "server.js"]
