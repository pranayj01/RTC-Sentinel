# WebRTC audio flow

RTC Sentinel captures audio only after the user chooses **Create Call** or **Join Call**. Each peer adds its microphone track to an `RTCPeerConnection`; media then travels peer-to-peer rather than through the Node server.

## Caller

1. Acquire the microphone with `getUserMedia({ audio: true, video: false })`.
2. Create a signaling room and wait for `peer-joined`.
3. Create an `RTCPeerConnection`, add the local audio track, create an SDP offer, and set it as the local description.
4. Relay the offer through Socket.IO.
5. Apply the SDP answer and exchanged ICE candidates.

## Callee

1. Acquire the microphone and join the supplied room ID.
2. Apply the incoming SDP offer as the remote description.
3. Create an SDP answer, set it locally, and relay it through Socket.IO.
4. Apply exchanged ICE candidates.

ICE messages that arrive before a remote description are queued and applied afterward. Remote tracks are attached to an autoplay audio element. Mute toggles the local audio track's `enabled` flag without renegotiating. End call, peer departure, refresh, and component unmount close the peer connection and stop all microphone tracks.

Phase 3 uses default browser ICE configuration, which is suitable for local and some direct connections. Phase 4 adds explicit STUN/TURN servers for NAT traversal and relay verification.
