FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    RT_DATA_DIR=/data \
    RT_CHROMIUM_EXECUTABLE=/usr/bin/chromium

# Debian provides native Chromium packages for both supported HA architectures.
# The browser is private to this app; no debugging or desktop port is exposed.
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/reality-twins
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY run.sh /run.sh
RUN chmod 0755 /run.sh

EXPOSE 8099 8098
ENTRYPOINT ["/run.sh"]
