# WebRTC signaling

WebRTC standardizes peer media transport, encryption, codecs, connectivity checks, and negotiation semantics. It deliberately does not prescribe how peers find each other or exchange negotiation messages. RTC Sentinel uses Socket.IO as that application-defined signaling channel.

## Negotiation flow

1. Peer A creates a room and receives a six-character room ID.
2. Peer B joins that room; rooms accept at most two sockets.
3. Peer A creates an SDP offer describing its media capabilities and proposed session, then sends it through `offer`.
4. Peer B applies the offer, creates an SDP answer describing the compatible session, and sends it through `answer`.
5. Both peers send ICE candidates as network paths are discovered. The signaling server only relays these opaque payloads; WebRTC performs connectivity checks itself.
6. Either peer emits `call-end`, leaves, disconnects, or refreshes. Remaining peers receive `peer-left` when membership changes.

## Socket lifecycle and events

`connection` creates no room membership. `create-room`, `join-room`, and `leave-room` mutate the in-memory room map. `disconnect` removes every membership owned by that socket and deletes empty rooms.

Client-to-server events acknowledge with `{ ok, roomId? , error? }`:

- `create-room(ack)`
- `join-room({ roomId }, ack)`
- `leave-room({ roomId }, ack)`
- `offer|answer|ice-candidate({ roomId, signal }, ack)`
- `call-start|call-end({ roomId }, ack)`

Server-to-client events are `peer-joined`, `peer-left`, `offer`, `answer`, `ice-candidate`, `call-start`, and `call-end`. Relayed messages include the sender socket ID as `from`.

Room state is process-local for Phase 2. A restart clears rooms, and multiple API instances do not share membership; Phase 6 moves this state into Redis.
