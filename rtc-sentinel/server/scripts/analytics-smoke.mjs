/* global fetch */
import assert from 'node:assert/strict';

const apiUrl = process.env.API_URL ?? 'http://localhost:3000';
const analyticsUrl = process.env.ML_SERVICE_URL ?? 'http://localhost:8000';
const expectUnavailable = process.env.EXPECT_UNAVAILABLE === '1';

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
  });
  const body = await response.json();
  return { response, body };
}

const suffix = Date.now();
const registration = await jsonRequest(`${apiUrl}/auth/register`, {
  method: 'POST',
  body: JSON.stringify({
    name: 'Analytics Smoke',
    email: `analytics-${suffix}@example.com`,
    password: 'Phase9Pass1',
  }),
});
assert.equal(registration.response.status, 201);

const prediction = await jsonRequest(`${apiUrl}/analytics/predict-quality`, {
  method: 'POST',
  headers: { authorization: `Bearer ${registration.body.accessToken}` },
  body: JSON.stringify({
    rtt: 155,
    jitter: 34,
    packetLoss: 4.1,
    bitrate: 22000,
    audioLevel: 0.42,
  }),
});
if (expectUnavailable) {
  assert.equal(prediction.response.status, 503);
  assert.equal(prediction.body.error.code, 'QUALITY_SERVICE_UNAVAILABLE');
  console.log(
    JSON.stringify({ unavailable: true, error: prediction.body.error }),
  );
} else {
  const info = await jsonRequest(`${analyticsUrl}/model/info`);
  assert.equal(info.response.status, 200);
  assert.equal(info.body.type, 'machine-learning');
  assert.equal(prediction.response.status, 200);
  assert.ok(info.body.algorithm);
  assert.ok(
    ['excellent', 'good', 'fair', 'poor', 'critical'].includes(
      prediction.body.prediction.quality,
    ),
  );
  assert.ok(
    prediction.body.prediction.confidence >= 0 &&
      prediction.body.prediction.confidence <= 1,
  );
  console.log(
    JSON.stringify({
      model: info.body,
      prediction: prediction.body.prediction,
    }),
  );
}
