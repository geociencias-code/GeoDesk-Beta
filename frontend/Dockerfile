FROM node:25-alpine AS builder
LABEL authors="alexander"

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci
# Install react-globe.gl explicitly as requested to avoid issues with package.json
RUN npm install react-globe.gl three recharts

COPY . .

# VITE_API_URL se embebe en el bundle JS en tiempo de build.
# El default es /geo-desk para que todas las llamadas pasen por
# el prefijo que Traefik enruta al nginx de este contenedor.
ARG VITE_API_URL=/geo-desk
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

FROM nginx:1.27-alpine

ENV BACKEND_UPSTREAM=backend:8000

COPY default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]