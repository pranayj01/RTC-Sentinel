# Python analytics service

The FastAPI service owns the analytics boundary that later phases will use for trained ML models. Phase 9 deliberately serves the deterministic quality baseline from Phase 8; Phase 10 can replace the implementation without changing its HTTP contract.

## API

### `POST /predict-quality`

Request:

```json
{
  "rtt": 155,
  "jitter": 34,
  "packetLoss": 4.1,
  "bitrate": 22000
}
```

Response:

```json
{
  "quality": "fair",
  "confidence": 1.0
}
```

All four measurements are required, numeric, finite, and non-negative. Packet loss must be between 0 and 100. Confidence is always within 0–1; the deterministic baseline reports `1.0` because its output is not probabilistic.

### `GET /model/info`

Returns the active model name, version, implementation type, feature list, and output labels.

### `GET /health`

Returns `{"status":"ok"}` while the service is available.

## Node integration

Authenticated clients call `POST /analytics/predict-quality` on the Node API. Node validates the request, sends it to FastAPI using `ML_SERVICE_URL`, validates the response, and returns it to the caller. The HTTP call has a configurable `ML_SERVICE_TIMEOUT_MS` timeout.

If FastAPI is unavailable, times out, returns an error, or sends an invalid response, Node returns HTTP `503` with error code `QUALITY_SERVICE_UNAVAILABLE`. WebRTC calling and signaling remain independent of the analytics request.
