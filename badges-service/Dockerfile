# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Migrate stage ----
# Used only by the migration Job (deploy/charts/foc-service/templates/migrate-job.yaml,
# ADR-0011): drizzle-kit (a devDependency) plus the config and SQL migrations.
FROM build AS migrate
COPY drizzle.config.ts ./
COPY drizzle ./drizzle
USER node
CMD ["npm", "run", "db:migrate"]

# ---- Runtime stage ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8086
CMD ["node", "dist/server.js"]
