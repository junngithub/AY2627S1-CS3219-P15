# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:20-slim AS build
WORKDIR /app

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

# Generate the Prisma client (needs the prisma CLI, a devDependency)
COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage ----
# Same base image as the build stage: the generated Prisma query engine is
# compiled for this OS / OpenSSL version.
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Must come after npm ci, which would otherwise wipe it
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist

USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
