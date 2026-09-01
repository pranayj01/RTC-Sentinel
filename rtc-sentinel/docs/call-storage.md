# Call storage

Phase 5 persists private call history in PostgreSQL. Every call has a caller, a
receiver, two participant records, timestamps, duration, and a lifecycle status.

## Authenticated endpoints

- `POST /calls` creates a call in `INITIATED` state. The body requires `roomId`
  and `receiverId`.
- `GET /calls` lists calls in which the authenticated user participates.
- `GET /calls/:id` returns one call when the authenticated user is a participant.
- `PATCH /calls/:id/status` advances a call to a valid lifecycle state. The body
  requires `status`.
- `POST /calls/:id/end` ends a connected call and calculates its duration in
  whole seconds.

All endpoints require `Authorization: Bearer <access-token>`. A non-participant
receives `403 Forbidden`, and invalid lifecycle transitions receive `409 Conflict`.

## Lifecycle

The normal lifecycle is:

```text
INITIATED -> RINGING -> CONNECTED -> ENDED
```

Before connection, calls can terminate as `REJECTED`, `FAILED`, or `MISSED`.
Connected calls can terminate as `ENDED` or `FAILED`.
