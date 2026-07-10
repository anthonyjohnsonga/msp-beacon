FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY public/ ./public/

RUN mkdir -p /data /data/config && chown -R node:node /data

VOLUME ["/data", "/data/config"]

EXPOSE 3000

USER node

# /api/me sits above the auth gate — /api/links would 401 (unhealthy) once a password is set
HEALTHCHECK CMD wget -qO- http://localhost:3000/api/me || exit 1
CMD ["node", "server.js"]
