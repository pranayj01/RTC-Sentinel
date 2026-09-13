import { createServer, type Server as HttpServer } from 'node:http';
import { io as createClient, type Socket } from 'socket.io-client';
import { attachSignaling, type SignalingServer } from './signaling.js';
import { createAccessToken } from './auth/tokens.js';
import type { RealtimeCallLifecycle } from './calls/realtimeLifecycle.js';

type Ack = {
  ok: boolean;
  roomId?: string;
  error?: string;
  resumeToken?: string;
  peerPresent?: boolean;
};

describe('Socket.IO signaling', () => {
  let httpServer: HttpServer;
  let signaling: SignalingServer;
  let callLifecycle: jest.Mocked<RealtimeCallLifecycle>;
  let url: string;
  const clients: Socket[] = [];

  beforeEach(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.SOCKET_RATE_LIMIT_MAX = '3';
    httpServer = createServer();
    callLifecycle = {
      peerJoined: jest.fn().mockResolvedValue(undefined),
      connected: jest.fn().mockResolvedValue(undefined),
      ended: jest.fn().mockResolvedValue(undefined),
    };
    signaling = attachSignaling(
      httpServer,
      undefined,
      undefined,
      {},
      callLifecycle,
    );
    await new Promise<void>((resolve) =>
      httpServer.listen(0, '127.0.0.1', resolve),
    );
    const address = httpServer.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing test server address');
    url = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    clients.splice(0).forEach((client) => client.disconnect());
    await signaling.io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  async function connect(
    token = createAccessToken(`user-${clients.length + 1}`),
  ): Promise<Socket> {
    const client = createClient(url, {
      transports: ['websocket'],
      forceNew: true,
      auth: { token },
    });
    clients.push(client);
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });
    return client;
  }

  async function connectGuest(): Promise<Socket> {
    const client = createClient(url, {
      transports: ['websocket'],
      forceNew: true,
      auth: { guest: true },
    });
    clients.push(client);
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });
    return client;
  }

  function createRoom(client: Socket): Promise<Ack> {
    return new Promise((resolve) => client.emit('create-room', resolve));
  }

  function emitAck(
    client: Socket,
    event: string,
    payload: unknown,
  ): Promise<Ack> {
    return new Promise((resolve) => client.emit(event, payload, resolve));
  }

  async function joinedPair(): Promise<{
    first: Socket;
    second: Socket;
    roomId: string;
  }> {
    const first = await connect();
    const second = await connect();
    const created = await createRoom(first);
    const roomId = created.roomId!;
    expect((await emitAck(second, 'join-room', { roomId })).ok).toBe(true);
    return { first, second, roomId };
  }

  it('connects two clients', async () => {
    const first = await connect();
    const second = await connect();
    expect(first.connected).toBe(true);
    expect(second.connected).toBe(true);
  });

  it('rejects clients without a valid access token', async () => {
    const client = createClient(url, {
      transports: ['websocket'],
      forceNew: true,
    });
    clients.push(client);
    await expect(
      new Promise<void>((resolve, reject) => {
        client.once('connect', resolve);
        client.once('connect_error', reject);
      }),
    ).rejects.toThrow('Authentication required');
  });

  it('rejects invalid access tokens and disallowed browser origins', async () => {
    await expect(connect('not-a-jwt')).rejects.toThrow(
      'Invalid or expired token',
    );

    const wrongOrigin = createClient(url, {
      transports: ['websocket'],
      forceNew: true,
      auth: { token: createAccessToken('origin-test') },
      extraHeaders: { Origin: 'https://attacker.example' },
    });
    clients.push(wrongOrigin);
    await expect(
      new Promise<void>((resolve, reject) => {
        wrongOrigin.once('connect', resolve);
        wrongOrigin.once('connect_error', reject);
      }),
    ).rejects.toThrow();
  });

  it('allows guests to join an existing room but not create one', async () => {
    const host = await connect();
    const guest = await connectGuest();
    const created = await createRoom(host);

    await expect(createRoom(guest)).resolves.toEqual({
      ok: false,
      error: 'AUTHENTICATION_REQUIRED',
    });
    await expect(
      emitAck(guest, 'join-room', { roomId: created.roomId }),
    ).resolves.toMatchObject({ ok: true, roomId: created.roomId });
  });

  it('resumes a room with a rotating single-use token', async () => {
    const original = await connect();
    const replacement = await connect();
    const created = await createRoom(original);

    const resumed = await emitAck(replacement, 'resume-room', {
      roomId: created.roomId,
      resumeToken: created.resumeToken,
    });

    expect(resumed.ok).toBe(true);
    expect(resumed.resumeToken).toEqual(expect.any(String));
    expect(resumed.resumeToken).not.toBe(created.resumeToken);
    await expect(
      signaling.state.getRoomMembers(created.roomId!),
    ).resolves.toEqual([replacement.id]);
    await expect(
      emitAck(original, 'resume-room', {
        roomId: created.roomId,
        resumeToken: created.resumeToken,
      }),
    ).resolves.toEqual({ ok: false, error: 'RESUME_INVALID' });
  });

  it('creates a room', async () => {
    const client = await connect();
    const result = await createRoom(client);
    expect(result).toMatchObject({ ok: true });
    expect(result.roomId).toMatch(/^[A-Z0-9]{6}$/);
    expect(await signaling.state.getRoomMembers(result.roomId!)).toContain(
      client.id,
    );
    expect(await signaling.state.isSocketActive(client.id!)).toBe(true);
  });

  it('allows a second client to join', async () => {
    const { roomId } = await joinedPair();
    expect(await signaling.state.getRoomMembers(roomId)).toHaveLength(2);
    expect(await signaling.state.getCallStatus(roomId)).toBe('RINGING');
  });

  it.each([
    ['offer', { type: 'offer', sdp: 'offer-sdp' }],
    ['answer', { type: 'answer', sdp: 'answer-sdp' }],
    ['ice-candidate', { candidate: 'candidate:1', sdpMid: '0' }],
  ])('relays %s to the peer', async (event, signal) => {
    const { first, second, roomId } = await joinedPair();
    const received = new Promise<Record<string, unknown>>((resolve) =>
      second.once(event, resolve),
    );
    expect((await emitAck(first, event, { roomId, signal })).ok).toBe(true);
    await expect(received).resolves.toMatchObject({
      roomId,
      signal,
      from: first.id,
    });
  });

  it('rejects malformed SDP and signaling from a non-member', async () => {
    const { first, roomId } = await joinedPair();
    await expect(
      emitAck(first, 'offer', {
        roomId,
        signal: { type: 'answer', sdp: 'wrong type' },
      }),
    ).resolves.toEqual({ ok: false, error: 'INVALID_SIGNAL' });

    const outsider = await connect();
    await expect(
      emitAck(outsider, 'offer', {
        roomId,
        signal: { type: 'offer', sdp: 'unauthorized' },
      }),
    ).resolves.toEqual({ ok: false, error: 'NOT_IN_ROOM' });
  });

  it('rate limits excessive signaling events per socket', async () => {
    const client = await connect();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        emitAck(client, 'join-room', { roomId: 'BAD' }),
      ).resolves.toEqual({ ok: false, error: 'INVALID_ROOM' });
    }
    await expect(
      emitAck(client, 'join-room', { roomId: 'BAD' }),
    ).resolves.toEqual({ ok: false, error: 'RATE_LIMITED' });
  });

  it('handles disconnect and notifies the peer', async () => {
    const { first, second, roomId } = await joinedPair();
    const left = new Promise<Record<string, unknown>>((resolve) =>
      first.once('peer-left', resolve),
    );
    const secondId = second.id;
    second.disconnect();
    await expect(left).resolves.toMatchObject({ roomId, socketId: secondId });
    expect(await signaling.state.getRoomMembers(roomId)).toHaveLength(1);
    expect(await signaling.state.isSocketActive(secondId!)).toBe(false);
  });

  it('rejects a third user when the room has two peers', async () => {
    const { roomId } = await joinedPair();
    const third = await connect();
    await expect(emitAck(third, 'join-room', { roomId })).resolves.toEqual({
      ok: false,
      error: 'ROOM_FULL',
    });
  });

  it('relays call lifecycle events', async () => {
    const { first, second, roomId } = await joinedPair();
    expect(callLifecycle.peerJoined).toHaveBeenCalledWith(
      roomId,
      'user-1',
      'user-2',
    );
    for (const event of ['call-start', 'call-end']) {
      const received = new Promise<Record<string, unknown>>((resolve) =>
        second.once(event, resolve),
      );
      expect((await emitAck(first, event, { roomId })).ok).toBe(true);
      await expect(received).resolves.toMatchObject({ roomId, from: first.id });
      expect(await signaling.state.getCallStatus(roomId)).toBe(
        event === 'call-start' ? 'CONNECTED' : 'ENDED',
      );
    }
    expect(callLifecycle.connected).toHaveBeenCalledWith(roomId);
    expect(callLifecycle.ended).toHaveBeenCalledWith(roomId, 'ENDED');
  });

  it('buffers and relays validated QoS metrics', async () => {
    const { first, second, roomId } = await joinedPair();
    const metric = {
      timestamp: '2026-09-13T14:00:00.000Z',
      rtt: 82,
      jitter: 11,
      packetsSent: 120,
      packetsReceived: 115,
      packetsLost: 1,
      packetLoss: 0.86,
      bytesSent: 12000,
      bytesReceived: 11000,
      bitrate: 45000,
      codec: 'audio/opus',
      audioLevel: 0.42,
      candidateType: 'relay',
    };
    const received = new Promise<Record<string, unknown>>((resolve) =>
      second.once('qos-metric', resolve),
    );
    await expect(
      emitAck(first, 'qos-metric', { roomId, metric }),
    ).resolves.toMatchObject({ ok: true, persisted: false });
    await expect(received).resolves.toMatchObject({
      roomId,
      metric: {
        ...metric,
        timestamp: expect.not.stringMatching(metric.timestamp),
      },
    });
    const { timestamp: _clientTimestamp, ...measurements } = metric;
    await expect(signaling.state.getRecentMetrics(roomId)).resolves.toEqual([
      expect.objectContaining({ ...measurements, timestamp: expect.any(Date) }),
    ]);
  });

  it('rejects invalid QoS metrics', async () => {
    const { first, roomId } = await joinedPair();
    await expect(
      emitAck(first, 'qos-metric', { roomId, metric: { packetLoss: 101 } }),
    ).resolves.toEqual({ ok: false, error: 'INVALID_METRIC' });
  });
});
