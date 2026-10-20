# AI Assistance Disclosure
# Tool: Claude Code (Claude Opus 5), date: 2026-09-22
# Scope: Generated the multi-stage build: Vite build, then nginx serving static files.
# Reviewed by Ngooi Jun Sen.

# --- build stage ---------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN npm run build

# --- runtime stage -------------------------------------------------------
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY proxy_headers.conf /etc/nginx/proxy_headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost/ >/dev/null || exit 1
