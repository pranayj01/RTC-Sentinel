# Changelog

## Unreleased

- Synchronize authenticated WebRTC room joins, connections, explicit endings, and unexpected departures with durable PostgreSQL call and participant records.
- Sequence the browser's call-end acknowledgement before leaving the signaling room so terminal call state is recorded deterministically.
- Verify automatic call/QoS persistence and authenticated-host-to-anonymous-guest Coturn relay with real Playwright browser calls.

## 0.9.5

- Add Playwright and managed Chromium configuration for deterministic WebRTC browser testing with fake microphones.
- Exercise two isolated signed-in browser sessions through room creation, joining, SDP/ICE negotiation, connection, QoS generation, and call termination.
- Verify the E2E call lifecycle and generated QoS metrics are persisted in PostgreSQL and visible to both authorized participants.
- Fix the live browser QoS contract so client capture timestamps pass strict validation while the server retains authoritative persistence timestamps.
- Retain screenshots, video, traces, and an HTML report for failed browser tests.
- Run the browser-to-browser WebRTC test against the complete Docker Compose stack in GitHub Actions.

## 0.9.4

- Recover active rooms after temporary WebSocket loss or browser refresh using short-lived, rotating room-resume tokens.
- Retry Socket.IO connections with bounded acknowledgement timeouts and visible reconnecting states.
- Detect disconnected or failed ICE connections, retry ICE negotiation, and report terminal relay failures clearly.
- Delay peer cleanup during brief disconnects and notify the remaining peer when a participant resumes.
- Add bounded startup retries for PostgreSQL and Redis and per-attempt timeouts and retries for ML requests.
- Continue signaling with a mirrored in-memory state store when Redis becomes unavailable.
- Return stable `503` responses when ML analytics is unavailable without interrupting calls or local quality scoring.
- Add structured JSON request, lifecycle, dependency, call, room, and retry logs with request IDs.
- Add reliability unit and integration coverage, including live transport, Redis, and ML outage checks.

## 0.9.2

- Move refresh tokens into HttpOnly, SameSite cookies and keep access tokens out of browser storage.
- Enforce JWT algorithm, issuer, audience, expiry, and strict bearer-token validation.
- Add logout, cookie-based session restoration, secure cookie-path rewriting, and authentication no-store responses.
- Add Helmet response headers, exact-origin CORS, bounded JSON requests, and global and authentication rate limits.
- Validate Socket.IO origins, authentication size, event rate, SDP, ICE, QoS, room IDs, and room membership.
- Generate room codes cryptographically and retain restricted anonymous guest joining.
- Bind PostgreSQL, Redis, and FastAPI host ports to loopback and require production secrets in Compose.
- Override vulnerable transitive query-parser and Prisma configuration dependencies with patched releases.
- Add adversarial HTTP, authentication, signaling, input, oversized-body, and production-configuration tests.
- Document the security model, environment controls, deployment requirements, and remaining limitations.

## 0.9.0

- Add browser registration, sign-in, session restoration, automatic token refresh, and sign-out.
- Protect the calling workspace and Socket.IO signaling handshake with JWT authentication.
- Add restricted anonymous guest access for joining existing rooms without an account.
- Display authenticated live ML quality predictions beside the deterministic quality score with a plain-language confidence explanation.
- Add same-origin API proxies for the Vite development server and Docker Nginx client.
- Add opt-in Web Audio microphone sampling with little-endian PCM encoding.
- Extract RMS energy, zero-crossing rate, spectral centroid, MFCCs, and Mel spectrogram features with Librosa.
- Train and compare logistic-regression and random-forest speech, silence, and noise classifiers.
- Add protected Node and FastAPI audio-analysis endpoints with input limits and graceful failure behavior.
- Display live audio classifications and interpretable signal features without retaining raw audio.
- Document the synthetic dataset, candidate results, confusion matrix, privacy behavior, and real-data limitations.

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
