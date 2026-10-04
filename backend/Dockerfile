# Production Dockerfile
# Usage: docker build -t aifom-backend .

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY pyproject.toml ./
RUN pip install --no-cache-dir . \
    && adduser --disabled-password --gecos "" appuser \
    && mkdir -p /workspace/ml/models \
    && chown -R appuser:appuser /workspace

COPY app ./app
COPY alembic.ini ./
COPY alembic ./alembic

USER appuser

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
