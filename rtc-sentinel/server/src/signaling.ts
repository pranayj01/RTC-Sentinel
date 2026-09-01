import { randomBytes } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { z } from 'zod';
import { MemoryRealtimeStateStore, type RealtimeStateStore } from './realtimeState.js';

const roomSchema = z.object({ roomId: z.string().trim().min(1).max(32) });
const signalSchema = roomSchema.extend({ signal: z.unknown() });
type Ack = (response: { ok: boolean; roomId?: string; error?: string }) => void;

export interface SignalingServer {
  io: Server;
  state: RealtimeStateStore;
}

async function reserveRoom(state: RealtimeStateStore, socketId: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const roomId = randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
    if (await state.createRoom(roomId, socketId)) return roomId;
  }
  throw new Error('Unable to allocate a room ID');
}

export function attachSignaling(
  httpServer: HttpServer,
  state: RealtimeStateStore = new MemoryRealtimeStateStore(),
): SignalingServer {
  const io = new Server(httpServer, { cors: { origin: '*' } });

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

    socket.on('create-room', (ack: Ack) => run(ack, async () => {
      await leaveAllRooms();
      const roomId = await reserveRoom(state, socket.id);
      await socket.join(roomId);
      console.log(`${socket.id} joined ${roomId}`);
      ack({ ok: true, roomId });
    }));

    socket.on('join-room', (payload: unknown, ack: Ack) => run(ack, async () => {
      const parsed = roomSchema.safeParse(payload);
      if (!parsed.success) { ack({ ok: false, error: 'INVALID_ROOM' }); return; }
      await ready;
      const roomId = parsed.data.roomId.toUpperCase();
      const members = await state.getRoomMembers(roomId);
      if (members.length === 0) { ack({ ok: false, error: 'ROOM_NOT_FOUND' }); return; }
      if (!members.includes(socket.id) && members.length >= 2) { ack({ ok: false, error: 'ROOM_FULL' }); return; }
      if (!members.includes(socket.id)) await leaveAllRooms();
      const result = await state.joinRoom(roomId, socket.id);
      if (result !== 'JOINED') { ack({ ok: false, error: result }); return; }
      await state.setCallStatus(roomId, 'RINGING');
      await socket.join(roomId);
      socket.to(roomId).emit('peer-joined', { roomId, socketId: socket.id });
      console.log(`${socket.id} joined ${roomId}`);
      ack({ ok: true, roomId });
    }));

    socket.on('leave-room', (payload: unknown, ack: Ack) => run(ack, async () => {
      const parsed = roomSchema.safeParse(payload);
      if (!parsed.success) { ack({ ok: false, error: 'INVALID_ROOM' }); return; }
      await ready;
      const roomId = parsed.data.roomId.toUpperCase();
      if (!(await state.leaveRoom(roomId, socket.id))) { ack({ ok: false, error: 'NOT_IN_ROOM' }); return; }
      await notifyLeft(socket.id, [roomId]);
      ack({ ok: true, roomId });
    }));

    const relay = (event: 'offer' | 'answer' | 'ice-candidate') => {
      socket.on(event, (payload: unknown, ack: Ack) => run(ack, async () => {
        const parsed = signalSchema.safeParse(payload);
        if (!parsed.success) { ack({ ok: false, error: 'INVALID_SIGNAL' }); return; }
        await ready;
        const roomId = parsed.data.roomId.toUpperCase();
        if (!(await state.isRoomMember(roomId, socket.id))) { ack({ ok: false, error: 'NOT_IN_ROOM' }); return; }
        socket.to(roomId).emit(event, { roomId, signal: parsed.data.signal, from: socket.id });
        console.log(`${event} relayed in ${roomId}`);
        ack({ ok: true, roomId });
      }));
    };
    relay('offer'); relay('answer'); relay('ice-candidate');

    for (const event of ['call-start', 'call-end'] as const) {
      socket.on(event, (payload: unknown, ack: Ack) => run(ack, async () => {
        const parsed = roomSchema.safeParse(payload);
        if (!parsed.success) { ack({ ok: false, error: 'INVALID_ROOM' }); return; }
        await ready;
        const roomId = parsed.data.roomId.toUpperCase();
        if (!(await state.isRoomMember(roomId, socket.id))) { ack({ ok: false, error: 'NOT_IN_ROOM' }); return; }
        await state.setCallStatus(roomId, event === 'call-start' ? 'CONNECTED' : 'ENDED');
        socket.to(roomId).emit(event, { roomId, from: socket.id });
        ack({ ok: true, roomId });
      }));
    }

    socket.on('disconnect', () => {
      void ready
        .then(() => state.unregisterSocket(socket.id))
        .then((roomIds) => notifyLeft(socket.id, roomIds))
        .catch((error: unknown) => console.error('Realtime disconnect cleanup failed', error));
      console.log(`${socket.id} disconnected`);
    });
  });

  return { io, state };
}
