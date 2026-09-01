import type { PrismaClient } from '@prisma/client';
import type { CallRecord, CallRepository, CallStatus } from './types.js';

const participants = { participants: true } as const;

export class PrismaCallRepository implements CallRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(input: { roomId: string; callerId: string; receiverId: string; startedAt: Date }): Promise<CallRecord> {
    return this.prisma.call.create({
      data: {
        ...input,
        participants: {
          create: [{ userId: input.callerId, joinedAt: input.startedAt }, { userId: input.receiverId }],
        },
      },
      include: participants,
    }) as Promise<CallRecord>;
  }

  findById(id: string): Promise<CallRecord | null> {
    return this.prisma.call.findUnique({ where: { id }, include: participants }) as Promise<CallRecord | null>;
  }

  findForUser(userId: string): Promise<CallRecord[]> {
    return this.prisma.call.findMany({
      where: { OR: [{ callerId: userId }, { receiverId: userId }] },
      include: participants,
      orderBy: { createdAt: 'desc' },
    }) as Promise<CallRecord[]>;
  }

  update(id: string, input: { status: CallStatus; endedAt?: Date; duration?: number }): Promise<CallRecord> {
    return this.prisma.call.update({ where: { id }, data: input, include: participants }) as Promise<CallRecord>;
  }
}
