# Phase 0 architecture

The browser loads the static React application and communicates with the Express API. Express owns PostgreSQL persistence through Prisma and uses Redis for transient data. The FastAPI service is isolated so later ML workloads can scale independently. Coturn provides the WebRTC relay plane.

All containers share the private `rtc-network`; only development-facing ports are published. Persistent named volumes protect PostgreSQL and Redis data between restarts.

## Service readiness

The Express process does not listen until both Prisma can query PostgreSQL and Redis responds to `PING`. Failure during initialization terminates the process so Docker can restart it. `/health` is a liveness endpoint and intentionally returns the required stable payload.

