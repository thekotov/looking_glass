FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* .npmrc* ./
RUN npm ci

# Dev: Vite dev server with HMR (used by deploy/docker-compose.server.yml).
FROM deps AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]

# Build: produces /app/dist for the prod nginx image to copy out.
FROM deps AS build
COPY . .
RUN npm run build
