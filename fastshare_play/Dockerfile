FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PLAY_DATA=/data
WORKDIR /app
COPY requirements.txt .
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir -r requirements.txt
COPY player_app ./player_app
COPY www ./www
COPY fastshare_app ./fastshare_app
COPY download_www ./download_www
COPY LICENSE NOTICE ./
COPY docs ./docs
EXPOSE 8099 8098 8096
CMD ["python", "-m", "player_app.service"]
