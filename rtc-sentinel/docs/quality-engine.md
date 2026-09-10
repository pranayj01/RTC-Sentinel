# Deterministic call-quality engine

RTC Sentinel classifies every QoS sample before storing or relaying it. The engine uses the worst-performing network dimension so a single severe problem cannot be hidden by otherwise healthy measurements.

| Quality   | Score |       RTT |    Jitter | Packet loss |    Bitrate |
| --------- | ----: | --------: | --------: | ----------: | ---------: |
| Excellent |   100 |  < 150 ms |   < 20 ms |        < 1% | >= 32 kbps |
| Good      |    80 |  < 250 ms |   < 40 ms |      < 2.5% | >= 24 kbps |
| Fair      |    60 |  < 400 ms |   < 70 ms |        < 5% | >= 16 kbps |
| Poor      |    40 |  < 800 ms |  < 120 ms |       < 10% |  >= 8 kbps |
| Critical  |    20 | >= 800 ms | >= 120 ms |      >= 10% |   < 8 kbps |

If RTT or jitter has not yet appeared in WebRTC statistics, the result is `Unknown` with no score. This avoids treating incomplete samples as healthy.

The browser calculates the same result for immediate dashboard feedback. The server remains authoritative: it validates the raw sample, calculates the quality again, buffers the enriched sample in Redis, and persists the label and score in PostgreSQL for connected calls.

This rule-based engine is the baseline for the later ML classifier. Its behavior is explainable, repeatable, and covered at every quality boundary, which makes it possible to measure whether a learned model produces a genuine improvement.
