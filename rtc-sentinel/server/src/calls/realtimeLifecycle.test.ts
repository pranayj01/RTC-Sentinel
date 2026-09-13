import type { PrismaClient } from '@prisma/client';
import { PrismaRealtimeCallLifecycle } from './realtimeLifecycle.js';

function prismaWith(overrides: Record<string, jest.Mock> = {}) {
  return {
    call: {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      ...overrides,
    },
    callParticipant: { updateMany: jest.fn() },
  } as unknown as PrismaClient;
}

describe('real-time PostgreSQL call lifecycle', () => {
  const startedAt = new Date('2026-09-14T10:00:00.000Z');
  const endedAt = new Date('2026-09-14T10:01:05.000Z');

  it('creates one ringing call for two different authenticated users', async () => {
    const prisma = prismaWith();
    jest.mocked(prisma.call.findFirst).mockResolvedValue(null);
    jest
      .mocked(prisma.call.create)
      .mockResolvedValue({ id: 'call-1' } as never);
    const lifecycle = new PrismaRealtimeCallLifecycle(prisma, () => startedAt);

    await lifecycle.peerJoined('ABC123', 'host-1', 'participant-1');

    expect(prisma.call.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roomId: 'ABC123',
          callerId: 'host-1',
          receiverId: 'participant-1',
          status: 'RINGING',
        }),
      }),
    );
  });

  it('does not create durable calls for the same account in two tabs', async () => {
    const prisma = prismaWith();
    const lifecycle = new PrismaRealtimeCallLifecycle(prisma);

    await lifecycle.peerJoined('ABC123', 'user-1', 'user-1');

    expect(prisma.call.findFirst).not.toHaveBeenCalled();
    expect(prisma.call.create).not.toHaveBeenCalled();
  });

  it('marks a connected call ended with duration and participant leave times', async () => {
    const prisma = prismaWith();
    jest.mocked(prisma.call.findFirst).mockResolvedValue({
      id: 'call-1',
      startedAt,
    } as never);
    jest.mocked(prisma.call.updateMany).mockResolvedValue({ count: 1 });
    const lifecycle = new PrismaRealtimeCallLifecycle(prisma, () => endedAt);

    await lifecycle.ended('ABC123', 'ENDED');

    expect(prisma.call.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'ENDED', endedAt, duration: 65 },
      }),
    );
    expect(prisma.callParticipant.updateMany).toHaveBeenCalledWith({
      where: { callId: 'call-1', leftAt: null },
      data: { leftAt: endedAt },
    });
  });
});
