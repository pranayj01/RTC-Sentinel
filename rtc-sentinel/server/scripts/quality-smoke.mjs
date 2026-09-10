/* global fetch */
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const apiUrl = process.env.API_URL ?? 'http://localhost:3000';

async function request(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
  });
  const body = await response.json();
  return { response, body };
}

async function register(role, suffix) {
  const result = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name: `Quality ${role}`,
      email: `quality-${role}-${suffix}@example.com`,
      password: 'Phase8Pass1',
    }),
  });
  assert.equal(result.response.status, 201);
  return result.body;
}

function connectSocket() {
  return new Promise((resolve, reject) => {
    const socket = io(apiUrl, { transports: ['websocket'], forceNew: true });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function emit(socket, event, payload) {
  return new Promise((resolve) => {
    const args = payload === undefined ? [event] : [event, payload];
    socket.emit(...args, resolve);
  });
}

function nextMetric(socket) {
  return new Promise((resolve) => socket.once('qos-metric', resolve));
}

const excellent = {
  rtt: 80,
  jitter: 10,
  packetsSent: 120,
  packetsReceived: 119,
  packetsLost: 1,
  packetLoss: 0.84,
  bytesSent: 12000,
  bytesReceived: 11900,
  bitrate: 48000,
  codec: 'audio/opus',
  audioLevel: 0.4,
  candidateType: 'relay',
};

const critical = {
  ...excellent,
  rtt: 900,
  jitter: 135,
  packetsLost: 20,
  packetLoss: 12.5,
  bitrate: 6000,
};

const suffix = Date.now();
const callerAuth = await register('caller', suffix);
const receiverAuth = await register('receiver', suffix);
const outsiderAuth = await register('outsider', suffix);
const caller = await connectSocket();
const receiver = await connectSocket();

try {
  const roomAck = await emit(caller, 'create-room');
  assert.equal(roomAck.ok, true);
  const roomId = roomAck.roomId;

  const createResult = await request('/calls', {
    method: 'POST',
    headers: { authorization: `Bearer ${callerAuth.accessToken}` },
    body: JSON.stringify({ roomId, receiverId: receiverAuth.user.id }),
  });
  assert.equal(createResult.response.status, 201);
  const callId = createResult.body.call.id;

  for (const status of ['RINGING', 'CONNECTED']) {
    const transition = await request(`/calls/${callId}/status`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${callerAuth.accessToken}` },
      body: JSON.stringify({ status }),
    });
    assert.equal(transition.response.status, 200);
  }

  const joinAck = await emit(receiver, 'join-room', { roomId });
  assert.equal(joinAck.ok, true);

  for (const [metric, expectedQuality, expectedScore] of [
    [excellent, 'Excellent', 100],
    [critical, 'Critical', 20],
  ]) {
    const relayed = nextMetric(receiver);
    const metricAck = await emit(caller, 'qos-metric', { roomId, metric });
    assert.deepEqual(metricAck, { ok: true, roomId, persisted: true });
    const event = await relayed;
    assert.equal(event.metric.quality, expectedQuality);
    assert.equal(event.metric.qualityScore, expectedScore);
  }

  const metricsResult = await request(`/calls/${callId}/metrics`, {
    headers: { authorization: `Bearer ${receiverAuth.accessToken}` },
  });
  assert.equal(metricsResult.response.status, 200);
  assert.deepEqual(
    metricsResult.body.metrics.map(({ quality, qualityScore }) => ({
      quality,
      qualityScore,
    })),
    [
      { quality: 'Excellent', qualityScore: 100 },
      { quality: 'Critical', qualityScore: 20 },
    ],
  );

  const forbiddenResult = await request(`/calls/${callId}/metrics`, {
    headers: { authorization: `Bearer ${outsiderAuth.accessToken}` },
  });
  assert.equal(forbiddenResult.response.status, 403);

  console.log(
    JSON.stringify({ roomId, callId, qualities: ['Excellent', 'Critical'] }),
  );
} finally {
  caller.disconnect();
  receiver.disconnect();
}
