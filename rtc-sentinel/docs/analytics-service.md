# Python analytics service

The FastAPI service owns the analytics boundary for the trained QoS classifier. Phase 10 preserves the Phase 9 HTTP contract while replacing its deterministic implementation with a selected classical-ML model.

## API

### `POST /predict-quality`

Request:

```json
{
  "rtt": 155,
  "jitter": 34,
  "packetLoss": 4.1,
  "bitrate": 22000,
  "audioLevel": 0.42
}
```

Response:

```json
{
  "quality": "fair",
  "confidence": 0.93
}
```

The four network measurements are required, numeric, finite, and non-negative. Packet loss must be between 0 and 100. Audio level is optional, must be between 0 and 1, and defaults to `0.5`. Confidence is the selected classifier's highest `predict_proba` value and is always within 0–1.

### `GET /model/info`

Returns the active model name, version, selected algorithm, feature list, output labels, training-data provenance, candidate metrics, deterministic baseline metrics, and confusion matrices. See [the ML model report](ml-model.md).

### `GET /health`

Returns `{"status":"ok"}` while the service is available.

## Node integration

Authenticated clients call `POST /analytics/predict-quality` on the Node API. Node validates the request, sends it to FastAPI using `ML_SERVICE_URL`, validates the response, and returns it to the caller. The HTTP call has a configurable `ML_SERVICE_TIMEOUT_MS` timeout.

If FastAPI is unavailable, times out, returns an error, or sends an invalid response, Node returns HTTP `503` with error code `QUALITY_SERVICE_UNAVAILABLE`. WebRTC calling and signaling remain independent of the analytics request.
