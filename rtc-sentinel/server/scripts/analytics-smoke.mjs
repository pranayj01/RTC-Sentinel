/* global fetch */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

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
const audio = await jsonRequest(`${apiUrl}/analytics/analyze-audio`, {
  method: 'POST',
  headers: { authorization: `Bearer ${registration.body.accessToken}` },
  body: JSON.stringify({
    encoding: 'pcm_s16le',
    sampleRate: 16000,
    pcmBase64: Buffer.alloc(8192).toString('base64'),
  }),
});
if (expectUnavailable) {
  assert.equal(prediction.response.status, 503);
  assert.equal(prediction.body.error.code, 'QUALITY_SERVICE_UNAVAILABLE');
  assert.equal(audio.response.status, 503);
  assert.equal(audio.body.error.code, 'AUDIO_ANALYSIS_UNAVAILABLE');
  console.log(
    JSON.stringify({
      unavailable: true,
      qualityError: prediction.body.error,
      audioError: audio.body.error,
    }),
  );
} else {
  const info = await jsonRequest(`${analyticsUrl}/model/info`);
  const audioInfo = await jsonRequest(`${analyticsUrl}/audio/model/info`);
  assert.equal(info.response.status, 200);
  assert.equal(audioInfo.response.status, 200);
  assert.equal(info.body.type, 'machine-learning');
  assert.equal(audioInfo.body.type, 'machine-learning');
  assert.equal(prediction.response.status, 200);
  assert.equal(audio.response.status, 200);
  assert.ok(info.body.algorithm);
  assert.ok(audioInfo.body.algorithm);
  assert.ok(
    ['excellent', 'good', 'fair', 'poor', 'critical'].includes(
      prediction.body.prediction.quality,
    ),
  );
  assert.ok(
    prediction.body.prediction.confidence >= 0 &&
      prediction.body.prediction.confidence <= 1,
  );
  assert.equal(audio.body.analysis.label, 'silence');
  assert.ok(
    audio.body.analysis.confidence >= 0 && audio.body.analysis.confidence <= 1,
  );
  assert.equal(audio.body.analysis.features.mfcc.length, 13);
  assert.equal(audio.body.analysis.features.melSpectrogram.length, 16);
  console.log(
    JSON.stringify({
      model: info.body,
      prediction: prediction.body.prediction,
      audioModel: audioInfo.body,
      audioAnalysis: audio.body.analysis,
    }),
  );
}
