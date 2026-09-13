# Security model

RTC Sentinel applies security controls at the browser proxy, Express API, Socket.IO signaling server, and service-network boundaries. These controls reduce common abuse and injection risks, but production deployment still requires TLS, private secrets, monitoring, and routine dependency updates.

## Authentication and tokens

- Access tokens are short-lived JWTs signed with HS256 and restricted to the `rtc-sentinel` issuer and `rtc-sentinel-api` audience.
- Refresh tokens are stored only in an `HttpOnly`, `SameSite=Strict` cookie. They are not returned in JSON or persisted in browser storage.
- The React client keeps the access token in memory, restores a session through `POST /auth/refresh`, and removes the legacy local-storage session key.
- `POST /auth/logout` expires the refresh cookie.
- Socket.IO accepts signed-in users through an access token. Anonymous guests may join an existing room using its six-character room code, but they cannot create rooms or call protected REST endpoints.

The refresh cookie uses the server path `/auth`. The Vite development proxy and production Nginx proxy rewrite that path to `/api/auth`, matching the browser-visible same-origin API route.

## HTTP protections

- Helmet supplies defensive response headers and Express does not disclose `X-Powered-By`.
- CORS reflects only exact origins from `CORS_ORIGINS`; wildcard origins are rejected in production.
- JSON requests default to a 64 KiB maximum and oversized requests return `413 PAYLOAD_TOO_LARGE`.
- Zod schemas reject unknown fields and malformed authentication, call, signaling, QoS, and analytics payloads.
- A global IP rate limit defaults to 300 requests per minute. Failed login and registration attempts have a separate default limit of 20 per minute.
- Authentication responses use `Cache-Control: no-store`.
- Prisma uses parameterized queries; invalid input is rejected before database access.

## Signaling protections

- Browser WebSocket handshakes must have an allowed origin.
- Socket access tokens have a fixed maximum length and the server rejects invalid or expired tokens.
- Engine.IO payloads are limited to 64 KiB.
- Each socket defaults to 180 application events per minute.
- SDP offers and answers, ICE candidates, QoS samples, room IDs, and acknowledgements are validated before use.
- A socket must belong to the target room before it can relay SDP, ICE, call-state, or QoS events.
- Room codes are generated with a cryptographically secure random source and contain six uppercase alphanumeric characters.

## Service and proxy boundaries

- The Express API, PostgreSQL, Redis, and FastAPI bind to loopback on the Docker host. Browser API and Socket.IO traffic uses the Nginx same-origin proxy; containers use private Compose service names.
- Nginx limits request bodies and sets a Content Security Policy, microphone Permissions Policy, frame denial, referrer policy, and content-type protection.
- Compose requires database, JWT, and TURN secrets rather than silently using fallback credentials.

## Configuration

Copy `.env.example` to `.env` and replace every example secret before starting the production Compose profile. Relevant settings are:

| Setting                 | Purpose                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `JWT_ACCESS_SECRET`     | Access-token signing secret; unique and at least 32 characters                                                                                   |
| `JWT_REFRESH_SECRET`    | Refresh-token signing secret; different and at least 32 characters                                                                               |
| `CORS_ORIGINS`          | Comma-separated exact browser origins                                                                                                            |
| `COOKIE_SECURE`         | Set to `true` behind production HTTPS                                                                                                            |
| `REQUEST_BODY_LIMIT`    | Express JSON request limit; default `64kb`                                                                                                       |
| `API_RATE_LIMIT_MAX`    | Requests per IP and rate-limit window                                                                                                            |
| `AUTH_RATE_LIMIT_MAX`   | Failed registrations/logins per IP and window                                                                                                    |
| `SOCKET_RATE_LIMIT_MAX` | Application events per socket and window                                                                                                         |
| `RATE_LIMIT_WINDOW_MS`  | Shared HTTP and socket rate-limit window                                                                                                         |
| `TRUST_PROXY_HOPS`      | Trusted reverse-proxy hops; Compose uses `1` for its single Nginx proxy, while direct deployments should keep `0` unless their topology is known |

Production startup fails when JWT secrets are missing, too short, placeholders, or identical, or when CORS configuration is absent or unsafe.

## Known limitations and next hardening steps

- HTTP and socket rate limits are process-local. A multi-instance deployment should use Redis-backed shared limiters.
- A room code is a bearer capability for anonymous guests. A public deployment should consider expiring, one-time, or host-approved invitations.
- Logout clears the browser cookie but does not revoke a refresh token already copied by an attacker. Server-side token rotation and revocation would close that gap.
- Coturn currently uses a static shared credential. Short-lived TURN credentials are preferred for an internet deployment.
- Secure cookies protect transport only when TLS is configured and `COOKIE_SECURE=true`.
