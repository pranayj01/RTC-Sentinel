FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY ml-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM base AS trained
COPY ml-service/app app
RUN python -m app.train_model
RUN python -m app.train_audio_model

FROM trained AS test
COPY ml-service/requirements-dev.txt .
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY ml-service/pyproject.toml .
COPY ml-service/tests tests
RUN ruff check app tests && pytest

FROM trained AS runtime
RUN useradd --create-home appuser
USER appuser
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
