/* global fetch */
import assert from 'node:assert/strict';
import { clearTimeout, setTimeout } from 'node:timers';
import { io } from 'socket.io-client';

const browserOrigin =
  process.env.SMOKE_BROWSER_ORIGIN ?? 'http://localhost:5173';
const apiOrigin = process.env.SMOKE_API_ORIGIN ?? 'http://localhost:3000';

function connectSocket(url, options) {
  return new Promise((resolve, reject) => {
    const socket = io(url, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 5_000,
      ...options,
    });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Socket connection timed out'));
    }, 6_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      socket.disconnect();
      reject(error);
    });
  });
}

function expectRejectedSocket(url, options) {
  return new Promise((resolve, reject) => {
    const socket = io(url, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 3_000,
      ...options,
    });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Invalid-origin socket was not rejected in time'));
    }, 4_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.disconnect();
      reject(new Error('Invalid-origin socket unexpectedly connected'));
    });
    socket.once('connect_error', () => {
      clearTimeout(timer);
      socket.disconnect();
      resolve();
    });
  });
}

function emitWithAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const acknowledge = (error, response) => {
      if (error) reject(error);
      else resolve(response);
    };
    if (payload === undefined) socket.timeout(5_000).emit(event, acknowledge);
    else socket.timeout(5_000).emit(event, payload, acknowledge);
  });
}

const email = `security-smoke-${Date.now()}@example.com`;
const registration = await fetch(`${browserOrigin}/api/auth/register`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    origin: browserOrigin,
  },
  body: JSON.stringify({
    name: 'Security Smoke',
    email,
    password: 'StrongPass1',
  }),
});
assert.equal(registration.status, 201);
assert.equal(registration.headers.get('x-content-type-options'), 'nosniff');
const registrationBody = await registration.json();
assert.equal(typeof registrationBody.accessToken, 'string');
assert.equal('refreshToken' in registrationBody, false);

const setCookie = registration.headers.get('set-cookie') ?? '';
assert.match(setCookie, /rtc_sentinel_refresh=/);
assert.match(setCookie, /HttpOnly/i);
assert.match(setCookie, /SameSite=Strict/i);
assert.match(setCookie, /Path=\/api\/auth/i);
const refreshCookie = setCookie.split(';', 1)[0];

const profile = await fetch(`${browserOrigin}/api/users/me`, {
  headers: { authorization: `Bearer ${registrationBody.accessToken}` },
});
assert.equal(profile.status, 200);
assert.equal((await profile.json()).user.email, email);

const refresh = await fetch(`${browserOrigin}/api/auth/refresh`, {
  method: 'POST',
  headers: { cookie: refreshCookie },
});
assert.equal(refresh.status, 200);
const refreshBody = await refresh.json();
assert.equal(typeof refreshBody.accessToken, 'string');
assert.equal('refreshToken' in refreshBody, false);

const socket = await connectSocket(browserOrigin, {
  auth: { token: registrationBody.accessToken },
  extraHeaders: { origin: browserOrigin },
});
try {
  const created = await emitWithAck(socket, 'create-room');
  assert.equal(created.ok, true);
  assert.match(created.roomId, /^[A-Z0-9]{6}$/);
} finally {
  socket.disconnect();
}

await expectRejectedSocket(apiOrigin, {
  auth: { guest: true },
  extraHeaders: { origin: 'https://attacker.example' },
});

const deniedCors = await fetch(`${apiOrigin}/health`, {
  headers: { origin: 'https://attacker.example' },
});
assert.equal(deniedCors.status, 200);
assert.equal(deniedCors.headers.has('access-control-allow-origin'), false);

const oversized = await fetch(`${apiOrigin}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: 'valid@example.com',
    password: 'x'.repeat(70_000),
  }),
});
assert.equal(oversized.status, 413);
assert.equal((await oversized.json()).error.code, 'PAYLOAD_TOO_LARGE');

const logout = await fetch(`${browserOrigin}/api/auth/logout`, {
  method: 'POST',
  headers: { cookie: refreshCookie },
});
assert.equal(logout.status, 204);
assert.match(logout.headers.get('set-cookie') ?? '', /Path=\/api\/auth/i);

console.log('Security integration smoke test passed');
