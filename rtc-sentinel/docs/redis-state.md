# Redis real-time state

Phase 6 separates ephemeral signaling state from persistent call history. PostgreSQL
continues to store users and calls, while Redis stores state that is only useful
during an active signaling session.

## Key layout

Keys use the `rtc:realtime` prefix:

- `rtc:realtime:active:sockets` is a sorted set of active socket IDs and expiry times.
- `rtc:realtime:socket:<socketId>` marks an active connection.
- `rtc:realtime:socket:<socketId>:rooms` maps a socket back to its rooms.
- `rtc:realtime:room:<roomId>` marks an active room.
- `rtc:realtime:room:<roomId>:members` contains up to two socket IDs.
- `rtc:realtime:call:<roomId>:status` stores `INITIATED`, `RINGING`, `CONNECTED`,
  or `ENDED`.

Socket identity remains connection-based until authenticated Socket.IO sessions are
added in the security phase.

## Expiration and cleanup

`REALTIME_TTL_SECONDS` controls the TTL and defaults to 3600 seconds. Membership
operations refresh relevant room and socket TTLs. Normal disconnects immediately
remove the active socket and its reverse mappings, update room membership, and
notify the remaining peer. Expired or restarted Redis state is treated as ephemeral;
clients create or join a new room after reconnecting.

Redis uses append-only persistence in the local Docker stack, but TTLs still prevent
abandoned signaling state from living indefinitely. PostgreSQL remains the source of
truth for completed call history.
