FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    RT_DATA_DIR=/data

WORKDIR /opt/reality-twins
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY run.sh /run.sh
RUN chmod 0755 /run.sh

EXPOSE 8099 8098
ENTRYPOINT ["/run.sh"]
