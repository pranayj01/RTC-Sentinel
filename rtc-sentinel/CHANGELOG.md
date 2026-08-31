# Changelog

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
