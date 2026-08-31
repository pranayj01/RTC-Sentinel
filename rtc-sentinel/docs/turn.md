# STUN and TURN

WebRTC peers often sit behind NAT and firewalls. ICE gathers possible paths:

- `host` — a local interface address.
- `srflx` — a server-reflexive public mapping discovered through STUN.
- `relay` — an address allocated by TURN; media is relayed when direct paths fail.

RTC Sentinel points the browser at Coturn on port 3478. TURN uses long-term username/password authentication and accepts both UDP and TCP. The relay UDP range is 49160–49200. TLS/DTLS is intentionally deferred; production deployments should add a certificate and port 5349.

## Local setup

Defaults work for two browser tabs on the Docker host:

```env
TURN_EXTERNAL_IP=127.0.0.1
TURN_USERNAME=rtc-sentinel
TURN_CREDENTIAL=local-development-turn-secret
```

Open `http://localhost:5173/?relay=1` in both tabs to set `iceTransportPolicy` to `relay`. A successful call displays `Network Path: RELAY`, derived from `RTCPeerConnection.getStats()`.

## Real network deployment

Set `TURN_EXTERNAL_IP` to the server's public IPv4 address, choose a strong credential, and allow/forward:

- 3478/UDP
- 3478/TCP
- 49160–49200/UDP

TURN credentials embedded in a browser client are visible to users. Static credentials are acceptable only for local development; production should issue short-lived TURN credentials from an authenticated backend.

Test on same Wi-Fi, a mobile hotspot, and separate internet connections. In each environment, use normal ICE first and forced relay second. The forced test passes only when the call connects and both peers report `RELAY`.
