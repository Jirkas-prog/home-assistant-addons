FROM oven/bun:1-alpine AS bun-runtime

FROM node:24-alpine
ARG BUILD_VERSION=0.6.0
ARG BUILD_ARCH=amd64
LABEL io.hass.version="${BUILD_VERSION}" io.hass.type="app" io.hass.arch="${BUILD_ARCH}"

RUN apk add --no-cache tini chromium
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app
COPY package.json package-lock.json /app/
COPY server.js remote.js chromium.js ui.html viewer.html icon.png logo.png sidebar-icon.png /app/
COPY guide /app/guide

ENV DATA_DIR=/data \
    UI_PORT=8099 \
    CHROMIUM_BIN=/usr/bin/chromium-browser \
    NODE_ENV=production

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "/app/server.js"]
