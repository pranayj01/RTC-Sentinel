# WebRTC QoS monitoring

Phase 7 samples `RTCPeerConnection.getStats()` every three seconds while a peer
connection is connected.

## Metrics

- Round-trip time and jitter are shown in milliseconds.
- Packet loss is calculated as `lost / (received + lost) * 100`.
- Bitrate is calculated from the change in sent and received bytes between samples.
  The selected candidate pair's available outgoing bitrate is used for the first sample.
- Packets sent, packets received, packets lost, bytes sent, bytes received, codec,
  audio level, and the selected local candidate type are also collected.

The active-call dashboard keeps the latest 20 browser samples and plots RTT history.

## Pipeline

```text
RTCPeerConnection.getStats()
  -> React dashboard
  -> Socket.IO qos-metric event
  -> Redis rolling room buffer (latest 120 samples)
  -> PostgreSQL CallMetric rows
```

The signaling server validates every sample and requires the sender to be a member
of the room. Redis samples inherit the real-time state TTL. PostgreSQL persistence
occurs when a connected `Call` row exists with the same room ID; ad-hoc demo rooms remain
available in the live Redis buffer without creating orphaned database rows.

Authenticated call participants can retrieve stored samples with:

```http
GET /calls/:id/metrics
Authorization: Bearer <access-token>
```

## Manual network testing

Use the browser developer tools to apply latency, bandwidth throttling, or packet
loss while a call is connected. Verify that dashboard samples respond and that the
RTT chart reflects changes. Forced TURN relay mode remains available by opening the
client with `?relay=1`.
