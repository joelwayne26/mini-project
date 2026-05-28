FROM python:3.11-slim

WORKDIR /app

# System deps for OpenCV, EasyOCR, and curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 curl && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Create models directory for volume mount
RUN mkdir -p /app/models /app/image_cache

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
