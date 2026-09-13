/* global fetch, setTimeout, clearTimeout */
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const browserOrigin =
  process.env.SMOKE_BROWSER_ORIGIN ?? 'http://localhost:5173';
const waitForBackendRestart = process.env.WAIT_FOR_BACKEND_RESTART === '1';

function withTimeout(operation, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function connect(token) {
  return withTimeout(
    new Promise((resolve, reject) => {
      const socket = io(browserOrigin, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 100,
        reconnectionDelayMax: 500,
        auth: { token },
        extraHeaders: { origin: browserOrigin },
      });
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    }),
    5_000,
    'Initial socket connection timed out',
  );
}

function emitWithAck(socket, event, payload) {
  return withTimeout(
    new Promise((resolve) => {
      const acknowledge = (response) => resolve(response);
      if (payload === undefined) socket.emit(event, acknowledge);
      else socket.emit(event, payload, acknowledge);
    }),
    5_000,
    `${event} acknowledgement timed out`,
  );
}

const registration = await fetch(`${browserOrigin}/api/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    name: 'Reliability Smoke',
    email: `reliability-smoke-${Date.now()}@example.com`,
    password: 'StrongPass1',
  }),
});
assert.equal(registration.status, 201);
const { accessToken } = await registration.json();

const socket = await connect(accessToken);
try {
  const created = await emitWithAck(socket, 'create-room');
  assert.equal(created.ok, true);
  assert.equal(typeof created.resumeToken, 'string');

  const reconnected = withTimeout(
    new Promise((resolve) => socket.once('connect', resolve)),
    waitForBackendRestart ? 90_000 : 5_000,
    'Socket did not reconnect after signaling interruption',
  );
  if (waitForBackendRestart) {
    console.log('Ready for backend restart');
  } else {
    socket.io.engine.close();
  }
  await reconnected;
  assert.equal(socket.connected, true);
  let resumeToken = created.resumeToken;
  if (!socket.recovered) {
    const resumed = await emitWithAck(socket, 'resume-room', {
      roomId: created.roomId,
      resumeToken,
    });
    assert.equal(resumed.ok, true);
    resumeToken = resumed.resumeToken;
  }

  const afterRecovery = await emitWithAck(socket, 'call-start', {
    roomId: created.roomId,
  });
  assert.equal(afterRecovery.ok, true);

  const replacement = await connect(accessToken);
  try {
    const resumed = await emitWithAck(replacement, 'resume-room', {
      roomId: created.roomId,
      resumeToken,
    });
    assert.equal(resumed.ok, true);
    assert.equal(typeof resumed.resumeToken, 'string');
    assert.notEqual(resumed.resumeToken, resumeToken);
  } finally {
    replacement.disconnect();
  }
} finally {
  socket.disconnect();
}

console.log('Reliability integration smoke test passed');
