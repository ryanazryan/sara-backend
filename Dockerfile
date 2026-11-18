# Node 24 matches the repository CI. Pin image digests before a controlled release.
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable
COPY tsconfig.json ./
COPY src ./src
RUN yarn build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production TZ=UTC PORT=3000
WORKDIR /app
# Yarn node-modules dependencies include build tools in this initial deployment slice.
# Build sources, test files and all environment/credential files are excluded.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./package.json
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node database/migrations ./database/migrations
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
