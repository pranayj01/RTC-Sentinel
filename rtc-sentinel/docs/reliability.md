# Reliability and recovery

RTC Sentinel keeps the real-time call path usable through short-lived browser, network, Redis, and analytics failures. Recovery is bounded and visible: the UI reports when it is reconnecting and surfaces a clear error if automatic recovery cannot restore the call.

## Browser and signaling recovery

- Socket.IO reconnects indefinitely with exponential delays between 500 ms and 5 seconds. Each room command has a 5-second acknowledgement timeout so the interface cannot wait forever on a lost request.
- Creating or joining a room returns a cryptographically random resume token. The browser stores only the active room, role, token, and timestamp in `sessionStorage`; it never stores an access or refresh token there.
- A refreshed tab can resume a room for up to two minutes. Resume tokens are single-use and rotate after every successful recovery.
- The server delays disconnect cleanup for 15 seconds by default. A peer that returns in that interval keeps the room alive and triggers a `peer-reconnected` event instead of a terminal departure.
- Socket.IO connection-state recovery is enabled, with application-level resume tokens as the fallback when a new socket ID is assigned or the Node process restarts.
- An explicit hang-up clears the saved room and cannot be mistaken for an interrupted connection.

## WebRTC recovery

When `RTCPeerConnection.connectionState` becomes `disconnected` or `failed`, the client enters `reconnecting` rather than immediately ending the call. A transient disconnect gets a four-second settling period. The client then makes at most two ICE-restart attempts, seven seconds apart; the host sends a new offer with ICE restart enabled. If recovery still fails, the call ends with an actionable message. Forced TURN-relay calls identify relay failure specifically.

The peer-leave and server call-end events remain terminal. Local media tracks, timers, and peer connections are closed during final cleanup.

## Service dependencies

PostgreSQL remains the durable source of user, call, and metric data and is required before the API begins listening. Startup database checks retry five times with exponential backoff.

Redis startup checks retry three times with a two-second connection timeout. If Redis is unavailable at startup, signaling uses an in-memory state store. If Redis fails while the API is running, successful real-time mutations already mirrored in memory remain available and subsequent signaling uses that mirror. This fallback keeps one API process working, but it is not shared across replicas and is lost if that process restarts. Once runtime failover occurs, restart the API after Redis recovers to restore Redis-backed operation.

ML quality and audio requests use a timeout for every attempt and retry transient failures once by default. If all attempts fail, the Node API returns `503 QUALITY_SERVICE_UNAVAILABLE` or `503 AUDIO_ANALYSIS_UNAVAILABLE`. Calls, local WebRTC metrics, and the deterministic quality classifier continue without the ML result.

## Structured logs

The Node service writes one-line JSON events containing `timestamp`, `level`, and `event`. HTTP completion entries also include `requestId`, method, path, status, duration, and authenticated user ID when available. Dependency, retry, room, call, relay, disconnect, and shutdown events include identifiers and bounded error names/messages. Credentials, JWTs, refresh cookies, SDP bodies, ICE candidates, audio frames, and resume tokens are not logged.

Every non-health HTTP response includes `X-Request-Id`, which can be matched with the `http_request_completed` entry.

## Configuration

| Variable                     | Default | Purpose                                                   |
| ---------------------------- | ------: | --------------------------------------------------------- |
| `RESUME_TOKEN_TTL_SECONDS`   |   `120` | Lifetime of each single-use room-resume token             |
| `SOCKET_DISCONNECT_GRACE_MS` | `15000` | Delay before removing a disconnected socket from its room |
| `DATABASE_CONNECT_ATTEMPTS`  |     `5` | PostgreSQL startup attempts                               |
| `REDIS_CONNECT_ATTEMPTS`     |     `3` | Redis startup attempts before memory fallback             |
| `REDIS_CONNECT_TIMEOUT_MS`   |  `2000` | Timeout for each Redis connection attempt                 |
| `ML_SERVICE_TIMEOUT_MS`      |  `2000` | Timeout for each ML HTTP attempt                          |
| `ML_SERVICE_RETRY_ATTEMPTS`  |     `2` | Total attempts for each ML request                        |
| `ML_SERVICE_RETRY_DELAY_MS`  |   `150` | Initial ML retry delay                                    |

## Verification

Run the automated gates:

```bash
npm run lint
npm run build
npm test
npm run smoke:reliability --workspace server
```

The reliability smoke test creates an authenticated room, forcibly closes the WebSocket transport, verifies automatic reconnection or token-based resumption, and confirms signaling still acknowledges events. During Phase 13 validation, the same test passed with Redis stopped. With FastAPI stopped, both analytics proxies returned their documented `503` errors while Node health and signaling recovery remained successful.

To validate recovery across an API process restart, run `WAIT_FOR_BACKEND_RESTART=1 npm run smoke:reliability --workspace server`, wait for `Ready for backend restart`, and restart only the server container from another terminal. The test verifies the room can be resumed from Redis after the new API process becomes healthy.

For a production deployment, alert on `redis_startup_degraded`, `realtime_state_degraded`, repeated ML retry events, `api_shutdown_forced`, and elevated HTTP `5xx` counts. Run more than one API replica only after replacing the process-local failover limitation with a shared recovery store or routing a room consistently to one replica.
