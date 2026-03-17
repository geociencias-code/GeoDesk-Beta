FROM node:25-alpine AS builder
LABEL authors="alexander"

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci
# Install react-globe.gl explicitly as requested to avoid issues with package.json
RUN npm install react-globe.gl three

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]