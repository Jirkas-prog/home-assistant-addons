FROM node:24-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81 AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81
ARG BUILD_VERSION=3.8.0
ARG BUILD_ARCH
LABEL io.hass.version="${BUILD_VERSION}" io.hass.type="app" io.hass.arch="${BUILD_ARCH}"
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=build /build/build/fakturocel/server.mjs /app/server.mjs
COPY --from=build /build/build/fakturocel/web /app/web
ENV NODE_ENV=production FAKTUROCEL_RUN=1
EXPOSE 8099 8443
CMD ["node", "/app/server.mjs"]
