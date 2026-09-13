# Call storage

Phase 5 persists private call history in PostgreSQL. Every call has a caller, a
receiver, two participant records, timestamps, duration, and a lifecycle status.

When two different authenticated users join the same WebRTC room, Socket.IO now
creates the call automatically in `RINGING` state. The negotiated `call-start`
event advances it to `CONNECTED`; an explicit end records `ENDED`, while an
unexpected departure records `FAILED`. Participant join/leave timestamps and the
whole-second duration are updated by the same signaling lifecycle, so normal UI
calls do not require separate REST calls to be durable.

Guest calls and two-tab calls made with the same account remain ephemeral. A
guest has no `User` row to own a private history record, and the schema requires
the caller and receiver to be distinct participants.

## Authenticated endpoints

These endpoints expose and administer the same records maintained automatically
by signaling. They remain useful for integrations and history views.

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
