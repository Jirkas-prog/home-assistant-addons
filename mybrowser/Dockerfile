FROM node:24-bookworm-slim AS node-runtime

FROM oven/bun:1 AS bun-runtime

ARG BUILD_FROM
FROM ${BUILD_FROM}
ARG BUILD_VERSION=0.8.0
ARG BUILD_ARCH=amd64
LABEL io.hass.version="${BUILD_VERSION}" io.hass.type="app" io.hass.arch="${BUILD_ARCH}"

USER root
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && sed -i 's/listen 3000 default_server;/listen 127.0.0.1:3000 default_server;/' /defaults/default.conf \
 && sed -i '/listen \[::\]:3000 default_server;/d' /defaults/default.conf \
 && sed -i 's/listen 3001 ssl;/listen 127.0.0.1:3001 ssl;/' /defaults/default.conf \
 && sed -i '/listen \[::\]:3001 ssl;/d' /defaults/default.conf

WORKDIR /app
COPY package.json package-lock.json /app/
COPY server.js remote.js chromium.js brave.js locales.js ui.html viewer.html icon.png logo.png sidebar-icon.png /app/
COPY guide /app/guide
COPY rootfs/ /
RUN chmod +x /etc/s6-overlay/s6-rc.d/init-mybrowser/run /etc/s6-overlay/s6-rc.d/svc-mybrowser/run

ENV DATA_DIR=/data \
    UI_PORT=8099 \
    NODE_ENV=production \
    CUSTOM_PORT=6080 \
    CUSTOM_HTTPS_PORT=6081 \
    CUSTOM_WS_PORT=6082 \
    SUBFOLDER=/brave/ \
    TITLE="MyBrowser Brave" \
    FM_HOME=/share \
    START_DOCKER=false \
    PUID=0 \
    PGID=0 \
    HOME=/config \
    BRAVE_PORT=6080 \
    BRAVE_DEBUG_PORT=9221 \
    S6_CMD_WAIT_FOR_SERVICES=1 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
    BRAVE_CLI="--remote-debugging-address=127.0.0.1 --remote-debugging-port=9221"
