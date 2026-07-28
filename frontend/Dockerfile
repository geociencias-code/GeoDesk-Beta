FROM node:25-alpine AS builder
LABEL authors="alexander"

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci
# Install react-globe.gl explicitly as requested to avoid issues with package.json
RUN npm install react-globe.gl three recharts

COPY . .

RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html/geo-desk

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]