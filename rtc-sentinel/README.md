# RTC Sentinel

RTC Sentinel is a WebRTC monitoring platform. Phase 0 establishes the React client, Express API, FastAPI ML service, PostgreSQL, Redis, Coturn, automated tests, and containerized local environment.

## Prerequisites

- Node.js 22+
- Python 3.12+
- Docker with Compose v2

## Run everything with Docker

```bash
cp .env.example .env
docker compose up --build
```

Endpoints:

- Client: http://localhost:5173
- Node health: http://localhost:3000/health
- Python health: http://localhost:8000/health

Both health endpoints return `{"status":"ok"}`. The Node process verifies PostgreSQL and Redis connectivity before accepting traffic.

To verify the Compose stack:

```bash
docker compose ps
curl --fail http://localhost:3000/health
curl --fail http://localhost:8000/health
docker compose down
```

## Run locally

Start only the backing services:

```bash
docker compose up -d postgres redis
```

Then install and run the TypeScript applications:

```bash
npm install
npm run dev:client
npm run dev:server
```

In another terminal, run the Python service:

```bash
cd ml-service
python -m venv .venv
source .venv/bin/activate  # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
```

When the Node server runs outside Docker, set `DATABASE_URL=postgresql://rtc_sentinel:rtc_sentinel@localhost:5432/rtc_sentinel?schema=public` and `REDIS_URL=redis://localhost:6379`.

## Quality gates

```bash
npm run lint
npm run build
npm test
cd ml-service && pytest
docker compose config --quiet
```

The GitHub Actions workflow runs these gates and starts the complete Compose stack for integration smoke tests.

## Repository layout

- `client/` — React + TypeScript + Vite
- `server/` — Node.js + TypeScript + Express + Prisma
- `ml-service/` — Python + FastAPI
- `infrastructure/docker/` — production container definitions
- `infrastructure/coturn/` — TURN server configuration
- `docs/` — architecture and operating notes

Current release: **v0.2.0**
