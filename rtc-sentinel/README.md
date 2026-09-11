# RTC Sentinel

RTC Sentinel is a WebRTC monitoring platform with browser-to-browser audio, Socket.IO signaling, authenticated call storage, Redis real-time state, live WebRTC QoS metrics, deterministic call-quality scoring, and a Python ML analytics API. The React, Express, FastAPI, PostgreSQL, Redis, and Coturn services run together through Docker Compose.

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
- Socket.IO signaling: ws://localhost:3000

Both health endpoints return `{"status":"ok"}`. The Node process verifies PostgreSQL and Redis connectivity before accepting traffic.

Analytics endpoints:

- FastAPI prediction: `POST http://localhost:8000/predict-quality`
- FastAPI model metadata: `GET http://localhost:8000/model/info`
- Authenticated Node proxy: `POST http://localhost:3000/analytics/predict-quality`

See [the Python analytics service contract](docs/analytics-service.md) for payloads and failure behavior.

The ML pipeline evaluates logistic regression, random forest, and gradient boosting against the deterministic baseline, selects by macro F1, and exposes its metrics and confusion matrix. The current release uses reproducible synthetic labels and makes no claim of improving on the rule baseline; see [the ML model report](docs/ml-model.md) for results and limitations.

Open the client in two browser tabs, create a call in the first, then join its room ID in the second to establish a peer-to-peer audio call.
Once connected, the dashboard samples `RTCPeerConnection.getStats()` every three seconds and displays RTT, jitter, packet loss, bitrate, packets, codec, audio level, candidate type, and an explainable `Excellent` through `Critical` quality rating. See [the quality-engine rules](docs/quality-engine.md).

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

When the Node server runs outside Docker, set `DATABASE_URL=postgresql://rtc_sentinel:rtc_sentinel@localhost:5432/rtc_sentinel?schema=public`, `REDIS_URL=redis://localhost:6379`, and `ML_SERVICE_URL=http://localhost:8000`.

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

Current release: **v0.8.5**
