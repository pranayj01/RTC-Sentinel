# Changelog

## Unreleased

- Add browser registration, sign-in, session restoration, automatic token refresh, and sign-out.
- Protect the calling workspace and Socket.IO signaling handshake with JWT authentication.
- Add restricted anonymous guest access for joining existing rooms without an account.
- Display authenticated live ML quality predictions beside the deterministic quality score with a plain-language confidence explanation.
- Add same-origin API proxies for the Vite development server and Docker Nginx client.

## 0.8.5

- Add a seeded, balanced QoS dataset generator with RTT, jitter, packet loss, bitrate, and audio-level features.
- Train and compare logistic regression, random forest, and gradient boosting classifiers.
- Select gradient boosting by macro F1 and report accuracy, macro precision, recall, F1, and confusion matrices.
- Serve ML probabilities through the existing FastAPI and authenticated Node analytics APIs.
- Train a reproducible model artifact during the Docker build and add a dedicated Linux test stage.
- Document dataset provenance, rule-based comparison, results, limitations, and the path to real-data evaluation.

## 0.8.0

- Add validated FastAPI `POST /predict-quality` and `GET /model/info` endpoints.
- Establish the Phase 8 deterministic classifier as the analytics-service baseline for later ML comparison.
- Add an authenticated Node analytics proxy with response validation and request timeouts.
- Return a stable `503 QUALITY_SERVICE_UNAVAILABLE` response when Python analytics cannot respond safely.
- Add Python, Node-client, proxy-route, and Docker integration coverage.

## 0.7.5

- Classify each WebRTC QoS sample as Excellent, Good, Fair, Poor, Critical, or Unknown.
- Use deterministic RTT, jitter, packet-loss, and bitrate thresholds with the worst dimension controlling the result.
- Display live quality, score, and limiting factors in the active-call dashboard.
- Persist authoritative quality labels and scores in PostgreSQL and buffer them in Redis.

## 0.7.0

- Sample WebRTC audio and network statistics every three seconds in the browser.
- Display live RTT, jitter, packet loss, bitrate, packet counts, codec, audio level, candidate type, duration, and RTT history.
- Validate and relay QoS samples through Socket.IO with a rolling Redis buffer.
- Persist metrics for matching calls in PostgreSQL and expose a participant-protected metrics API.

## 0.6.5

- Move active Socket.IO room membership and reverse socket mappings into Redis.
- Track active connections and real-time call state with configurable TTLs.
- Clean up socket and room state on disconnect and preserve two-peer room limits.
- Add state lifecycle, expiration, restart, and signaling integration tests.

## 0.6.0

- Add persisted calls and call participants with a Prisma migration.
- Add authenticated call creation, detail, history, status, and end endpoints.
- Enforce private participant access and validated call-state transitions.
- Add integration coverage for lifecycle, duration, authentication, and authorization.

## 0.5.0

- Configure authenticated Coturn service over UDP and TCP.
- Add browser STUN/TURN ICE configuration and forced-relay mode.
- Report the selected ICE candidate type using WebRTC statistics.
- Document local and public-network TURN deployment requirements.

## 0.4.0

- Add browser microphone capture and peer-to-peer WebRTC audio negotiation.
- Add create/join room UI, remote audio playback, mute, end-call, and status/error states.
- Queue ICE candidates until remote descriptions are ready and clean up media on disconnect.

## 0.3.0

- Add two-peer Socket.IO rooms and lifecycle handling.
- Relay SDP offers, SDP answers, ICE candidates, and call lifecycle events.
- Add signaling integration tests and protocol documentation.

## 0.2.0

- Add registration, login, refresh, and authenticated-user endpoints.
- Add bcrypt hashing, JWTs, validation, middleware, errors, and auth tests.
- Add the Prisma `User` model.

## 0.1.0

- Scaffold React, Express, and FastAPI services.
- Add PostgreSQL, Prisma, Redis, and Coturn infrastructure.
- Add health endpoints, unit tests, linting, formatting, CI, and Docker Compose.
