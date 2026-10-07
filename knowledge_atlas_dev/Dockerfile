ARG BUILD_VERSION=5.0.1-dev.24
ARG BUILD_ARCH=amd64

FROM node:24.15.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json release.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY src ./src
COPY shared ./shared
COPY public ./public
RUN npm run build && npm prune --omit=dev

FROM node:24.15.0-alpine
ARG BUILD_VERSION
ARG BUILD_ARCH
LABEL io.hass.name="Knowledge Atlas Dev" \
      io.hass.description="Markdown knowledge, project and inventory atlas" \
      io.hass.type="app" \
      io.hass.version="${BUILD_VERSION}" \
      io.hass.arch="${BUILD_ARCH}" \
      org.opencontainers.image.source="https://github.com/Jirkas-prog/home-assistant-addons"
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8099 \
    DATA_DIR=/config/knowledge DOCUMENT_ROOT=/config/documents HA_INGRESS=1
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json release.json ./
COPY server ./server
COPY shared ./shared
COPY src/atlas-model.js ./src/atlas-model.js
COPY seed ./seed
EXPOSE 8099
CMD ["node", "server/bootstrap.js"]
