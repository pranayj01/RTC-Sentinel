import { randomBytes } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { z } from 'zod';
import {
  MemoryRealtimeStateStore,
  type RealtimeStateStore,
} from './realtimeState.js';
import { NullMetricRepository } from './metrics/metricRepository.js';
import type { MetricRepository } from './metrics/types.js';
import { assessCallQuality } from './metrics/quality.js';
import { verifyAccessToken } from './auth/tokens.js';

const roomSchema = z.object({ roomId: z.string().trim().min(1).max(32) });
const signalSchema = roomSchema.extend({ signal: z.unknown() });
const count = z.number().int().min(0).max(2_147_483_647);
const metricSchema = roomSchema.extend({
  metric: z.object({
    rtt: z.number().finite().min(0).nullable(),
    jitter: z.number().finite().min(0).nullable(),
    packetsSent: count,
    packetsReceived: count,
    packetsLost: count,
    packetLoss: z.number().finite().min(0).max(100),
    bytesSent: count,
    bytesReceived: count,
    bitrate: z.number().finite().min(0),
    codec: z.string().max(100).nullable(),
    audioLevel: z.number().finite().min(0).max(1).nullable(),
    candidateType: z.string().max(20).nullable(),
  }),
});
type Ack = (response: {
  ok: boolean;
  roomId?: string;
  error?: string;
  persisted?: boolean;
}) => void;

export interface SignalingServer {
  io: Server;
  state: RealtimeStateStore;
}

async function reserveRoom(
  state: RealtimeStateStore,
  socketId: string,
): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const roomId = randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
    if (await state.createRoom(roomId, socketId)) return roomId;
  }
  throw new Error('Unable to allocate a room ID');
}

export function attachSignaling(
  httpServer: HttpServer,
  state: RealtimeStateStore = new MemoryRealtimeStateStore(),
  metrics: MetricRepository = new NullMetricRepository(),
): SignalingServer {
  const io = new Server(httpServer, { cors: { origin: '*' } });
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (typeof token !== 'string' || token.length === 0) {
      if (socket.handshake.auth.guest === true) {
        socket.data.guest = true;
        next();
        return;
      }
      next(new Error('Authentication required'));
      return;
    }
    try {
      socket.data.userId = verifyAccessToken(token);
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const ready = state.registerSocket(socket.id);
    console.log(`${socket.id} connected`);

    const fail = (ack: Ack, error: unknown) => {
      console.error('Realtime state operation failed', error);
      ack({ ok: false, error: 'STATE_UNAVAILABLE' });
    };

    const run = (ack: Ack, operation: () => Promise<void>) => {
      void operation().catch((error: unknown) => fail(ack, error));
    };

    const notifyLeft = async (socketId: string, roomIds: string[]) => {
      for (const roomId of roomIds) {
        await socket.leave(roomId);
        io.to(roomId).emit('peer-left', { roomId, socketId });
        console.log(`${socketId} left ${roomId}`);
      }
    };

    const leaveAllRooms = async () => {
      await ready;
      await notifyLeft(socket.id, await state.leaveAllRooms(socket.id));
    };

    socket.on('create-room', (ack: Ack) =>
      run(ack, async () => {
        if (socket.data.guest === true) {
          ack({ ok: false, error: 'AUTHENTICATION_REQUIRED' });
          return;
        }
        await leaveAllRooms();
        const roomId = await reserveRoom(state, socket.id);
        await socket.join(roomId);
        console.log(`${socket.id} joined ${roomId}`);
        ack({ ok: true, roomId });
      }),
    );

    socket.on('join-room', (payload: unknown, ack: Ack) =>
      run(ack, async () => {
        const parsed = roomSchema.safeParse(payload);
        if (!parsed.success) {
          ack({ ok: false, error: 'INVALID_ROOM' });
          return;
        }
        await ready;
        const roomId = parsed.data.roomId.toUpperCase();
        const members = await state.getRoomMembers(roomId);
        if (members.length === 0) {
          ack({ ok: false, error: 'ROOM_NOT_FOUND' });
          return;
        }
        if (!members.includes(socket.id) && members.length >= 2) {
          ack({ ok: false, error: 'ROOM_FULL' });
          return;
        }
        if (!members.includes(socket.id)) await leaveAllRooms();
        const result = await state.joinRoom(roomId, socket.id);
        if (result !== 'JOINED') {
          ack({ ok: false, error: result });
          return;
        }
        await state.setCallStatus(roomId, 'RINGING');
        await socket.join(roomId);
        socket.to(roomId).emit('peer-joined', { roomId, socketId: socket.id });
        console.log(`${socket.id} joined ${roomId}`);
        ack({ ok: true, roomId });
      }),
    );

    socket.on('leave-room', (payload: unknown, ack: Ack) =>
      run(ack, async () => {
        const parsed = roomSchema.safeParse(payload);
        if (!parsed.success) {
          ack({ ok: false, error: 'INVALID_ROOM' });
          return;
        }
        await ready;
        const roomId = parsed.data.roomId.toUpperCase();
        if (!(await state.leaveRoom(roomId, socket.id))) {
          ack({ ok: false, error: 'NOT_IN_ROOM' });
          return;
        }
        await notifyLeft(socket.id, [roomId]);
        ack({ ok: true, roomId });
      }),
    );

    const relay = (event: 'offer' | 'answer' | 'ice-candidate') => {
      socket.on(event, (payload: unknown, ack: Ack) =>
        run(ack, async () => {
          const parsed = signalSchema.safeParse(payload);
          if (!parsed.success) {
            ack({ ok: false, error: 'INVALID_SIGNAL' });
            return;
          }
          await ready;
          const roomId = parsed.data.roomId.toUpperCase();
          if (!(await state.isRoomMember(roomId, socket.id))) {
            ack({ ok: false, error: 'NOT_IN_ROOM' });
            return;
          }
          socket.to(roomId).emit(event, {
            roomId,
            signal: parsed.data.signal,
            from: socket.id,
          });
          console.log(`${event} relayed in ${roomId}`);
          ack({ ok: true, roomId });
        }),
      );
    };
    relay('offer');
    relay('answer');
    relay('ice-candidate');

    for (const event of ['call-start', 'call-end'] as const) {
      socket.on(event, (payload: unknown, ack: Ack) =>
        run(ack, async () => {
          const parsed = roomSchema.safeParse(payload);
          if (!parsed.success) {
            ack({ ok: false, error: 'INVALID_ROOM' });
            return;
          }
          await ready;
          const roomId = parsed.data.roomId.toUpperCase();
          if (!(await state.isRoomMember(roomId, socket.id))) {
            ack({ ok: false, error: 'NOT_IN_ROOM' });
            return;
          }
          await state.setCallStatus(
            roomId,
            event === 'call-start' ? 'CONNECTED' : 'ENDED',
          );
          socket.to(roomId).emit(event, { roomId, from: socket.id });
          ack({ ok: true, roomId });
        }),
      );
    }

    socket.on('qos-metric', (payload: unknown, ack: Ack) =>
      run(ack, async () => {
        const parsed = metricSchema.safeParse(payload);
        if (!parsed.success) {
          ack({ ok: false, error: 'INVALID_METRIC' });
          return;
        }
        await ready;
        const roomId = parsed.data.roomId.toUpperCase();
        if (!(await state.isRoomMember(roomId, socket.id))) {
          ack({ ok: false, error: 'NOT_IN_ROOM' });
          return;
        }
        const assessment = assessCallQuality(parsed.data.metric);
        const sample = {
          ...parsed.data.metric,
          timestamp: new Date(),
          quality: assessment.quality,
          qualityScore: assessment.score,
        };
        await state.appendMetric(roomId, sample);
        const record = await metrics.recordForRoom(roomId, sample);
        socket.to(roomId).emit('qos-metric', { roomId, metric: sample });
        ack({ ok: true, roomId, persisted: record !== null });
      }),
    );

    socket.on('disconnect', () => {
      void ready
        .then(() => state.unregisterSocket(socket.id))
        .then((roomIds) => notifyLeft(socket.id, roomIds))
        .catch((error: unknown) =>
          console.error('Realtime disconnect cleanup failed', error),
        );
      console.log(`${socket.id} disconnected`);
    });
  });

  return { io, state };
}
