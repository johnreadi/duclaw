# Étape de build
FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Étape de production avec nginx
FROM nginx:alpine

# Copie du build React
COPY --from=builder /app/build /usr/share/nginx/html

# Configuration nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
