# syntax=docker/dockerfile:1
# No dependencies, so a single stage is enough.
FROM node:22.23.3-alpine
# ↑ pinned to an exact Node version; bump deliberately

ENV NODE_ENV=production
WORKDIR /app
COPY package.json server.js ./

# The official image ships an unprivileged "node" user.
USER node
EXPOSE 3000
CMD ["node", "server.js"]
