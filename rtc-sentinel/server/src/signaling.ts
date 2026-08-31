import { randomBytes } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { z } from 'zod';

const roomSchema = z.object({ roomId: z.string().trim().min(1).max(32) });
const signalSchema = roomSchema.extend({ signal: z.unknown() });
type Ack = (response: { ok: boolean; roomId?: string; error?: string }) => void;

export interface SignalingServer {
  io: Server;
  rooms: Map<string, Set<string>>;
}

function createRoomId(rooms: Map<string, Set<string>>): string {
  let id: string;
  do id = randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
  while (rooms.has(id));
  return id;
}

export function attachSignaling(httpServer: HttpServer): SignalingServer {
  const io = new Server(httpServer, { cors: { origin: '*' } });
  const rooms = new Map<string, Set<string>>();

  const leaveRoom = (socketId: string, roomId: string) => {
    const members = rooms.get(roomId);
    if (!members?.delete(socketId)) return;
    io.sockets.sockets.get(socketId)?.leave(roomId);
    io.to(roomId).emit('peer-left', { roomId, socketId });
    if (members.size === 0) rooms.delete(roomId);
    console.log(`${socketId} left ${roomId}`);
  };

  const leaveAllRooms = (socketId: string) => {
    for (const [roomId, members] of rooms) if (members.has(socketId)) leaveRoom(socketId, roomId);
  };

  io.on('connection', (socket) => {
    console.log(`${socket.id} connected`);

    socket.on('create-room', (ack: Ack) => {
      leaveAllRooms(socket.id);
      const roomId = createRoomId(rooms);
      rooms.set(roomId, new Set([socket.id]));
      void socket.join(roomId);
      console.log(`${socket.id} joined ${roomId}`);
      ack({ ok: true, roomId });
    });

    socket.on('join-room', (payload: unknown, ack: Ack) => {
      const parsed = roomSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, error: 'INVALID_ROOM' });
      const roomId = parsed.data.roomId.toUpperCase();
      const members = rooms.get(roomId);
      if (!members) return ack({ ok: false, error: 'ROOM_NOT_FOUND' });
      if (members.size >= 2) return ack({ ok: false, error: 'ROOM_FULL' });
      leaveAllRooms(socket.id);
      members.add(socket.id);
      void socket.join(roomId);
      socket.to(roomId).emit('peer-joined', { roomId, socketId: socket.id });
      console.log(`${socket.id} joined ${roomId}`);
      ack({ ok: true, roomId });
    });

    socket.on('leave-room', (payload: unknown, ack: Ack) => {
      const parsed = roomSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, error: 'INVALID_ROOM' });
      const roomId = parsed.data.roomId.toUpperCase();
      if (!rooms.get(roomId)?.has(socket.id)) return ack({ ok: false, error: 'NOT_IN_ROOM' });
      leaveRoom(socket.id, roomId);
      ack({ ok: true, roomId });
    });

    const relay = (event: 'offer' | 'answer' | 'ice-candidate') => {
      socket.on(event, (payload: unknown, ack: Ack) => {
        const parsed = signalSchema.safeParse(payload);
        if (!parsed.success) return ack({ ok: false, error: 'INVALID_SIGNAL' });
        const roomId = parsed.data.roomId.toUpperCase();
        if (!rooms.get(roomId)?.has(socket.id)) return ack({ ok: false, error: 'NOT_IN_ROOM' });
        socket.to(roomId).emit(event, { roomId, signal: parsed.data.signal, from: socket.id });
        console.log(`${event} relayed in ${roomId}`);
        ack({ ok: true, roomId });
      });
    };
    relay('offer'); relay('answer'); relay('ice-candidate');

    for (const event of ['call-start', 'call-end'] as const) {
      socket.on(event, (payload: unknown, ack: Ack) => {
        const parsed = roomSchema.safeParse(payload);
        if (!parsed.success) return ack({ ok: false, error: 'INVALID_ROOM' });
        const roomId = parsed.data.roomId.toUpperCase();
        if (!rooms.get(roomId)?.has(socket.id)) return ack({ ok: false, error: 'NOT_IN_ROOM' });
        socket.to(roomId).emit(event, { roomId, from: socket.id });
        ack({ ok: true, roomId });
      });
    }

    socket.on('disconnect', () => {
      leaveAllRooms(socket.id);
      console.log(`${socket.id} disconnected`);
    });
  });

  return { io, rooms };
}
