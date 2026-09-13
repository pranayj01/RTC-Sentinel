import { randomBytes, randomInt } from 'node:crypto';
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
import { configuredOrigins } from './security.js';
import { logEvent } from './logger.js';

const ROOM_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const roomIdSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6}$/);
const roomSchema = z.object({ roomId: roomIdSchema }).strict();
const resumeRoomSchema = roomSchema
  .extend({
    resumeToken: z
      .string()
      .min(32)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();
const sessionDescription = (type: 'offer' | 'answer') =>
  z
    .object({
      type: z.literal(type),
      sdp: z.string().min(1).max(32_768),
    })
    .strict();
const candidateSchema = z
  .object({
    candidate: z.string().min(1).max(4_096),
    sdpMid: z.string().max(255).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(65_535).nullable().optional(),
    usernameFragment: z.string().max(255).nullable().optional(),
  })
  .strict();
const signalSchemas = {
  offer: roomSchema.extend({ signal: sessionDescription('offer') }).strict(),
  answer: roomSchema.extend({ signal: sessionDescription('answer') }).strict(),
  'ice-candidate': roomSchema.extend({ signal: candidateSchema }).strict(),
};
const count = z.number().int().min(0).max(2_147_483_647);
const metricSchema = roomSchema
  .extend({
    metric: z
      .object({
        timestamp: z.string().datetime().optional(),
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
      })
      .strict(),
  })
  .strict();
type Ack = (response: {
  ok: boolean;
  roomId?: string;
  error?: string;
  persisted?: boolean;
  peerPresent?: boolean;
  resumeToken?: string;
}) => void;

export interface SignalingServer {
  io: Server;
  state: RealtimeStateStore;
}

export interface SignalingSecurityOptions {
  allowedOrigins?: string[];
  eventRateLimit?: number;
  rateLimitWindowMs?: number;
  disconnectGraceMs?: number;
}

class SocketEventLimiter {
  private readonly windows = new Map<
    string,
    { startedAt: number; count: number }
  >();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  consume(socketId: string): boolean {
    const now = Date.now();
    const current = this.windows.get(socketId);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.windows.set(socketId, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= this.limit;
  }

  remove(socketId: string): void {
    this.windows.delete(socketId);
  }
}

async function reserveRoom(
  state: RealtimeStateStore,
  socketId: string,
): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const roomId = Array.from(
      { length: 6 },
      () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)],
    ).join('');
    if (await state.createRoom(roomId, socketId)) return roomId;
  }
  throw new Error('Unable to allocate a room ID');
}

export function attachSignaling(
  httpServer: HttpServer,
  state: RealtimeStateStore = new MemoryRealtimeStateStore(),
  metrics: MetricRepository = new NullMetricRepository(),
  security: SignalingSecurityOptions = {},
): SignalingServer {
  const allowedOrigins = new Set(
    security.allowedOrigins ?? configuredOrigins(),
  );
  const configuredEventLimit = Number(process.env.SOCKET_RATE_LIMIT_MAX);
  const configuredWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS);
  const eventLimit =
    security.eventRateLimit ??
    (Number.isSafeInteger(configuredEventLimit) && configuredEventLimit > 0
      ? configuredEventLimit
      : 180);
  const eventWindowMs =
    security.rateLimitWindowMs ??
    (Number.isSafeInteger(configuredWindowMs) && configuredWindowMs > 0
      ? configuredWindowMs
      : 60_000);
  const eventLimiter = new SocketEventLimiter(eventLimit, eventWindowMs);
  const disconnectGraceMs =
    security.disconnectGraceMs ??
    (process.env.NODE_ENV === 'test'
      ? 0
      : Math.max(0, Number(process.env.SOCKET_DISCONNECT_GRACE_MS ?? 15_000)));
  const pendingDisconnects = new Map<string, NodeJS.Timeout>();
  const originAllowed = (origin: string | undefined) =>
    !origin || allowedOrigins.has(origin);
  const io = new Server(httpServer, {
    maxHttpBufferSize: 64 * 1_024,
    connectionStateRecovery: {
      maxDisconnectionDuration: disconnectGraceMs,
      skipMiddlewares: false,
    },
    cors: {
      origin: [...allowedOrigins],
      credentials: true,
      methods: ['GET', 'POST'],
    },
    allowRequest: (request, callback) =>
      callback(null, originAllowed(request.headers.origin)),
  });
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
    if (token.length > 4_096) {
      next(new Error('Invalid or expired token'));
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
    const pendingDisconnect = pendingDisconnects.get(socket.id);
    if (pendingDisconnect) {
      clearTimeout(pendingDisconnect);
      pendingDisconnects.delete(socket.id);
    }
    const ready = state.registerSocket(socket.id);
    logEvent(
      'info',
      socket.recovered ? 'socket_recovered' : 'socket_connected',
      {
        socketId: socket.id,
        userId: socket.data.userId as string | undefined,
        guest: socket.data.guest === true,
      },
    );

    const fail = (ack: Ack, error: unknown) => {
      logEvent(
        'error',
        'realtime_state_operation_failed',
        { socketId: socket.id },
        error,
      );
      if (typeof ack === 'function')
        ack({ ok: false, error: 'STATE_UNAVAILABLE' });
    };

    const run = (ack: Ack, operation: () => Promise<void>) => {
      if (!eventLimiter.consume(socket.id)) {
        if (typeof ack === 'function')
          ack({ ok: false, error: 'RATE_LIMITED' });
        return;
      }
      void operation().catch((error: unknown) => fail(ack, error));
    };

    const notifyLeft = async (socketId: string, roomIds: string[]) => {
      for (const roomId of roomIds) {
        await socket.leave(roomId);
        io.to(roomId).emit('peer-left', { roomId, socketId });
        logEvent('info', 'room_left', { socketId, roomId });
      }
    };

    const leaveAllRooms = async () => {
      await ready;
      await notifyLeft(socket.id, await state.leaveAllRooms(socket.id));
    };

    const issueResumeToken = async (roomId: string): Promise<string> => {
      const token = randomBytes(32).toString('base64url');
      await state.setRoomResumeToken(roomId, socket.id, token);
      return token;
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
        const resumeToken = await issueResumeToken(roomId);
        logEvent('info', 'room_created', { socketId: socket.id, roomId });
        ack({ ok: true, roomId, resumeToken });
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
        const resumeToken = await issueResumeToken(roomId);
        socket.to(roomId).emit('peer-joined', { roomId, socketId: socket.id });
        logEvent('info', 'room_joined', { socketId: socket.id, roomId });
        ack({ ok: true, roomId, resumeToken });
      }),
    );

    socket.on('resume-room', (payload: unknown, ack: Ack) =>
      run(ack, async () => {
        const parsed = resumeRoomSchema.safeParse(payload);
        if (!parsed.success) {
          ack({ ok: false, error: 'INVALID_ROOM' });
          return;
        }
        await ready;
        const { resumeToken: previousResumeToken } = parsed.data;
        const roomId = parsed.data.roomId.toUpperCase();
        const resumed = await state.resumeRoom(
          roomId,
          previousResumeToken,
          socket.id,
        );
        if (resumed.result !== 'JOINED' || !resumed.previousSocketId) {
          ack({ ok: false, error: resumed.result });
          return;
        }
        const { previousSocketId } = resumed;
        const pending = pendingDisconnects.get(previousSocketId);
        if (pending) {
          clearTimeout(pending);
          pendingDisconnects.delete(previousSocketId);
        }
        await socket.join(roomId);
        const resumeToken = await issueResumeToken(roomId);
        const peerPresent = (await state.getRoomMembers(roomId)).length > 1;
        socket.to(roomId).emit('peer-reconnected', {
          roomId,
          socketId: socket.id,
        });
        logEvent('info', 'room_resumed', {
          socketId: socket.id,
          previousSocketId,
          roomId,
          peerPresent,
        });
        ack({ ok: true, roomId, peerPresent, resumeToken });
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
          const parsed = signalSchemas[event].safeParse(payload);
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
          logEvent('debug', 'signal_relayed', {
            socketId: socket.id,
            roomId,
            signalType: event,
          });
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

    socket.on('disconnect', (reason) => {
      eventLimiter.remove(socket.id);
      const cleanup = () => {
        pendingDisconnects.delete(socket.id);
        void ready
          .then(() => state.unregisterSocket(socket.id))
          .then((roomIds) => notifyLeft(socket.id, roomIds))
          .catch((error: unknown) =>
            logEvent(
              'error',
              'realtime_disconnect_cleanup_failed',
              { socketId: socket.id },
              error,
            ),
          );
      };
      if (disconnectGraceMs > 0) {
        const timer = setTimeout(cleanup, disconnectGraceMs);
        timer.unref();
        pendingDisconnects.set(socket.id, timer);
      } else cleanup();
      logEvent('info', 'socket_disconnected', {
        socketId: socket.id,
        reason,
        cleanupDelayMs: disconnectGraceMs,
      });
    });
  });

  return { io, state };
}
