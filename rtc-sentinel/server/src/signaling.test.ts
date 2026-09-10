import { createServer, type Server as HttpServer } from 'node:http';
import { io as createClient, type Socket } from 'socket.io-client';
import { attachSignaling, type SignalingServer } from './signaling.js';

type Ack = { ok: boolean; roomId?: string; error?: string };

describe('Socket.IO signaling', () => {
  let httpServer: HttpServer;
  let signaling: SignalingServer;
  let url: string;
  const clients: Socket[] = [];

  beforeEach(async () => {
    httpServer = createServer();
    signaling = attachSignaling(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    url = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    clients.splice(0).forEach((client) => client.disconnect());
    await signaling.io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  async function connect(): Promise<Socket> {
    const client = createClient(url, { transports: ['websocket'], forceNew: true });
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

  function emitAck(client: Socket, event: string, payload: unknown): Promise<Ack> {
    return new Promise((resolve) => client.emit(event, payload, resolve));
  }

  async function joinedPair(): Promise<{ first: Socket; second: Socket; roomId: string }> {
    const first = await connect(); const second = await connect();
    const created = await createRoom(first); const roomId = created.roomId!;
    expect((await emitAck(second, 'join-room', { roomId })).ok).toBe(true);
    return { first, second, roomId };
  }

  it('connects two clients', async () => {
    const first = await connect(); const second = await connect();
    expect(first.connected).toBe(true); expect(second.connected).toBe(true);
  });

  it('creates a room', async () => {
    const client = await connect(); const result = await createRoom(client);
    expect(result).toMatchObject({ ok: true }); expect(result.roomId).toMatch(/^[A-F0-9]{6}$/);
    expect(await signaling.state.getRoomMembers(result.roomId!)).toContain(client.id);
    expect(await signaling.state.isSocketActive(client.id!)).toBe(true);
  });

  it('allows a second client to join', async () => {
    const { roomId } = await joinedPair(); expect(await signaling.state.getRoomMembers(roomId)).toHaveLength(2);
    expect(await signaling.state.getCallStatus(roomId)).toBe('RINGING');
  });

  it.each([
    ['offer', { type: 'offer', sdp: 'offer-sdp' }],
    ['answer', { type: 'answer', sdp: 'answer-sdp' }],
    ['ice-candidate', { candidate: 'candidate:1', sdpMid: '0' }],
  ])('relays %s to the peer', async (event, signal) => {
    const { first, second, roomId } = await joinedPair();
    const received = new Promise<Record<string, unknown>>((resolve) => second.once(event, resolve));
    expect((await emitAck(first, event, { roomId, signal })).ok).toBe(true);
    await expect(received).resolves.toMatchObject({ roomId, signal, from: first.id });
  });

  it('handles disconnect and notifies the peer', async () => {
    const { first, second, roomId } = await joinedPair();
    const left = new Promise<Record<string, unknown>>((resolve) => first.once('peer-left', resolve));
    const secondId = second.id; second.disconnect();
    await expect(left).resolves.toMatchObject({ roomId, socketId: secondId });
    expect(await signaling.state.getRoomMembers(roomId)).toHaveLength(1);
    expect(await signaling.state.isSocketActive(secondId!)).toBe(false);
  });

  it('rejects a third user when the room has two peers', async () => {
    const { roomId } = await joinedPair(); const third = await connect();
    await expect(emitAck(third, 'join-room', { roomId })).resolves.toEqual({ ok: false, error: 'ROOM_FULL' });
  });

  it('relays call lifecycle events', async () => {
    const { first, second, roomId } = await joinedPair();
    for (const event of ['call-start', 'call-end']) {
      const received = new Promise<Record<string, unknown>>((resolve) => second.once(event, resolve));
      expect((await emitAck(first, event, { roomId })).ok).toBe(true);
      await expect(received).resolves.toMatchObject({ roomId, from: first.id });
      expect(await signaling.state.getCallStatus(roomId)).toBe(event === 'call-start' ? 'CONNECTED' : 'ENDED');
    }
  });

  it('buffers and relays validated QoS metrics', async () => {
    const { first, second, roomId } = await joinedPair();
    const metric = {
      rtt: 82, jitter: 11, packetsSent: 120, packetsReceived: 115, packetsLost: 1,
      packetLoss: 0.86, bytesSent: 12000, bytesReceived: 11000, bitrate: 45000,
      codec: 'audio/opus', audioLevel: 0.42, candidateType: 'relay',
    };
    const received = new Promise<Record<string, unknown>>((resolve) => second.once('qos-metric', resolve));
    await expect(emitAck(first, 'qos-metric', { roomId, metric })).resolves.toMatchObject({ ok: true, persisted: false });
    await expect(received).resolves.toMatchObject({ roomId, metric });
    await expect(signaling.state.getRecentMetrics(roomId)).resolves.toEqual([expect.objectContaining(metric)]);
  });

  it('rejects invalid QoS metrics', async () => {
    const { first, roomId } = await joinedPair();
    await expect(emitAck(first, 'qos-metric', { roomId, metric: { packetLoss: 101 } }))
      .resolves.toEqual({ ok: false, error: 'INVALID_METRIC' });
  });
});
