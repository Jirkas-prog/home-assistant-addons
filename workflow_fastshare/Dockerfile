FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 FASTSHARE_DATA=/data
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY fastshare_app ./fastshare_app
COPY www ./www
EXPOSE 8099
CMD ["python", "-m", "fastshare_app.app"]
