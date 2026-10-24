FROM python:3.13-alpine
ARG BUILD_VERSION=1.0.2
ARG BUILD_ARCH
LABEL io.hass.name="WorkFlow Timers" \
      io.hass.description="Scheduler integration and WorkFlow timer panel installer" \
      io.hass.type="addon" \
      io.hass.version="${BUILD_VERSION}" \
      io.hass.arch="${BUILD_ARCH}" \
      org.opencontainers.image.source="https://github.com/Jirkas-prog/home-assistant-addons"
WORKDIR /app
COPY custom_components ./custom_components
COPY www ./www
COPY install.py LICENSE THIRD_PARTY.md ./
CMD ["python", "-u", "install.py"]
