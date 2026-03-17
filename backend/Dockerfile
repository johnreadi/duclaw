FROM node:18-alpine

WORKDIR /app

# Installation des dépendances système et création du groupe docker
RUN apk add --no-cache postgresql-client iptables docker && \
    addgroup -g 999 docker 2>/dev/null || true && \
    adduser node docker 2>/dev/null || true

# Installation des dépendances
COPY package*.json ./
RUN npm install

# Copie du code
COPY . .

# Exposition du port
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/api/health || exit 1

# Démarrage
CMD ["node", "server.js"]
