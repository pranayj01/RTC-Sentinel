# RTC Sentinel

RTC Sentinel is a WebRTC monitoring platform with browser-to-browser audio, Socket.IO signaling, authenticated call storage, Redis real-time state, live WebRTC QoS metrics, deterministic call-quality scoring, and Python ML analytics for network quality and audio conditions. The React, Express, FastAPI, PostgreSQL, Redis, and Coturn services run together through Docker Compose.

## Prerequisites

- Node.js 22+
- Python 3.12+
- Docker with Compose v2

## Run everything with Docker

```bash
cp .env.example .env
# Replace the example PostgreSQL, JWT, and TURN secrets in .env.
docker compose up --build
```

Endpoints:

- Client: http://localhost:5173
- Node health: http://localhost:3000/health
- Python health: http://localhost:8000/health
- Socket.IO signaling: ws://localhost:5173/socket.io

Both health endpoints return `{"status":"ok"}`. PostgreSQL is required at startup; Redis is retried and then safely falls back to process-local real-time state if it remains unavailable.

Analytics endpoints:

- FastAPI prediction: `POST http://localhost:8000/predict-quality`
- FastAPI model metadata: `GET http://localhost:8000/model/info`
- FastAPI audio analysis: `POST http://localhost:8000/analyze-audio`
- FastAPI audio model metadata: `GET http://localhost:8000/audio/model/info`
- Authenticated Node proxy: `POST http://localhost:3000/analytics/predict-quality`
- Authenticated audio proxy: `POST http://localhost:3000/analytics/analyze-audio`

See [the Python analytics service contract](docs/analytics-service.md) for payloads and failure behavior.

The ML pipeline evaluates logistic regression, random forest, and gradient boosting against the deterministic baseline, selects by macro F1, and exposes its metrics and confusion matrix. The current release uses reproducible synthetic labels and makes no claim of improving on the rule baseline; see [the ML model report](docs/ml-model.md) for results and limitations.

Create an account or sign in to host calls and use protected ML analytics. The client keeps its short-lived access token in memory, stores the refresh token in an HttpOnly cookie, and sends the access token during the Socket.IO handshake. A guest can instead choose **Join a call as guest** and enter an existing room ID without creating an account; guests cannot create rooms or call the protected ML endpoint.

See [the security model](docs/security.md) for authentication, CORS, rate limiting, validation, proxy behavior, deployment settings, and known limitations.

Temporary WebSocket loss, page refreshes, and recoverable ICE failures automatically enter a visible reconnecting state. The client retries signaling, can resume an active room with a rotating short-lived token, and attempts ICE restart before ending the call. Redis and ML outages degrade independently so signaling and local deterministic quality monitoring remain available. See [the reliability guide](docs/reliability.md) for behavior, controls, and operational limitations.

Open the client in two browser tabs, sign in (the same test account is sufficient), create a call in the first, then join its room ID in the second to establish a peer-to-peer audio call.
Once connected, the dashboard samples `RTCPeerConnection.getStats()` every three seconds and displays RTT, jitter, packet loss, bitrate, packets, codec, audio level, candidate type, and an explainable `Excellent` through `Critical` quality rating. See [the quality-engine rules](docs/quality-engine.md).

For signed-in users, the call dashboard also sends complete live samples through the authenticated Node analytics endpoint and displays the ML class with its probability confidence beside the deterministic score. Confidence represents the classifier's certainty about its label; it is not a percentage score for the call. Guest calls retain the local deterministic score without sending samples to the ML API.

Signed-in callers can separately opt in to audio signal analysis. While enabled, the browser submits a short local-microphone PCM frame every three seconds and displays whether it resembles speech, silence, or noise along with RMS energy, zero-crossing rate, and spectral centroid. This feature does not recognize words, does not transcribe speech, and does not persist raw audio. See [the audio analysis design and model report](docs/audio-analysis.md).

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
npm audit --omit=dev
cd ml-service && pytest
docker compose config --quiet
npx playwright install chromium
npm run test:e2e
```

The Playwright gate expects the Compose stack to be running. It launches two isolated Chromium sessions with fake microphones, completes a real WebRTC call, and verifies QoS and call persistence. See [the E2E testing guide](docs/e2e-testing.md).

The GitHub Actions workflow runs these gates and starts the complete Compose stack for analytics, security, signaling-recovery, and browser-to-browser WebRTC integration tests.

## Repository layout

- `client/` — React + TypeScript + Vite
- `server/` — Node.js + TypeScript + Express + Prisma
- `ml-service/` — Python + FastAPI
- `infrastructure/docker/` — production container definitions
- `infrastructure/coturn/` — TURN server configuration
- `docs/` — architecture and operating notes

Current release: **v0.9.5**
