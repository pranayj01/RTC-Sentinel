import type { PrismaClient } from '@prisma/client';
import { logEvent } from '../logger.js';

type ActiveStatus = 'INITIATED' | 'RINGING' | 'CONNECTED';
type TerminalStatus = 'ENDED' | 'FAILED';

export interface RealtimeCallLifecycle {
  peerJoined(
    roomId: string,
    callerId: string,
    receiverId: string,
  ): Promise<void>;
  connected(roomId: string): Promise<void>;
  ended(roomId: string, status: TerminalStatus): Promise<void>;
}

export class NullRealtimeCallLifecycle implements RealtimeCallLifecycle {
  async peerJoined(): Promise<void> {}
  async connected(): Promise<void> {}
  async ended(): Promise<void> {}
}

const activeStatuses: ActiveStatus[] = ['INITIATED', 'RINGING', 'CONNECTED'];

export class PrismaRealtimeCallLifecycle implements RealtimeCallLifecycle {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now = () => new Date(),
  ) {}

  async peerJoined(
    roomId: string,
    callerId: string,
    receiverId: string,
  ): Promise<void> {
    if (callerId === receiverId) return;
    const existing = await this.prisma.call.findFirst({
      where: { roomId, status: { in: activeStatuses } },
      select: { id: true },
    });
    if (existing) return;
    const joinedAt = this.now();
    const call = await this.prisma.call.create({
      data: {
        roomId,
        callerId,
        receiverId,
        startedAt: joinedAt,
        status: 'RINGING',
        participants: {
          create: [
            { userId: callerId, joinedAt },
            { userId: receiverId, joinedAt },
          ],
        },
      },
      select: { id: true },
    });
    logEvent('info', 'realtime_call_created', {
      callId: call.id,
      roomId,
      userId: callerId,
      receiverId,
    });
  }

  async connected(roomId: string): Promise<void> {
    const call = await this.prisma.call.findFirst({
      where: { roomId, status: { in: ['INITIATED', 'RINGING'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!call) return;
    const updated = await this.prisma.call.updateMany({
      where: { id: call.id, status: { in: ['INITIATED', 'RINGING'] } },
      data: { status: 'CONNECTED' },
    });
    if (updated.count > 0)
      logEvent('info', 'realtime_call_connected', {
        callId: call.id,
        roomId,
      });
  }

  async ended(roomId: string, status: TerminalStatus): Promise<void> {
    const call = await this.prisma.call.findFirst({
      where: { roomId, status: { in: activeStatuses } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, startedAt: true },
    });
    if (!call) return;
    const endedAt = this.now();
    const duration = Math.max(
      0,
      Math.floor((endedAt.getTime() - call.startedAt.getTime()) / 1000),
    );
    const updated = await this.prisma.call.updateMany({
      where: { id: call.id, status: { in: activeStatuses } },
      data: { status, endedAt, duration },
    });
    if (updated.count === 0) return;
    await this.prisma.callParticipant.updateMany({
      where: { callId: call.id, leftAt: null },
      data: { leftAt: endedAt },
    });
    logEvent('info', 'realtime_call_ended', {
      callId: call.id,
      roomId,
      status,
      duration,
    });
  }
}
