import type { PrismaClient } from '@prisma/client';
import type { CallMetricRecord, MetricRepository, QosMetricSample } from './types.js';

export class PrismaMetricRepository implements MetricRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async recordForRoom(roomId: string, sample: QosMetricSample): Promise<CallMetricRecord | null> {
    const call = await this.prisma.call.findFirst({
      where: { roomId, status: 'CONNECTED' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!call) return null;
    return this.prisma.callMetric.create({ data: { callId: call.id, ...sample } });
  }

  findForCall(callId: string): Promise<CallMetricRecord[]> {
    return this.prisma.callMetric.findMany({ where: { callId }, orderBy: { timestamp: 'asc' } });
  }
}

export class NullMetricRepository implements MetricRepository {
  async recordForRoom(): Promise<null> { return null; }
  async findForCall(): Promise<CallMetricRecord[]> { return []; }
}
