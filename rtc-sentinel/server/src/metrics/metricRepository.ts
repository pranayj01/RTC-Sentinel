import type { PrismaClient } from '@prisma/client';
import type {
  CallMetricRecord,
  CallQuality,
  MetricRepository,
  QosMetricSample,
} from './types.js';

const callQualities = new Set<CallQuality>([
  'Excellent',
  'Good',
  'Fair',
  'Poor',
  'Critical',
  'Unknown',
]);

function normalizeQuality<T extends { quality: string }>(
  record: T,
): Omit<T, 'quality'> & { quality: CallQuality } {
  return {
    ...record,
    quality: callQualities.has(record.quality as CallQuality)
      ? (record.quality as CallQuality)
      : 'Unknown',
  };
}

export class PrismaMetricRepository implements MetricRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async recordForRoom(
    roomId: string,
    sample: QosMetricSample,
  ): Promise<CallMetricRecord | null> {
    const call = await this.prisma.call.findFirst({
      where: { roomId, status: 'CONNECTED' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!call) return null;
    return normalizeQuality(
      await this.prisma.callMetric.create({
        data: { callId: call.id, ...sample },
      }),
    );
  }

  async findForCall(callId: string): Promise<CallMetricRecord[]> {
    const records = await this.prisma.callMetric.findMany({
      where: { callId },
      orderBy: { timestamp: 'asc' },
    });
    return records.map(normalizeQuality);
  }
}

export class NullMetricRepository implements MetricRepository {
  async recordForRoom(): Promise<null> {
    return null;
  }
  async findForCall(): Promise<CallMetricRecord[]> {
    return [];
  }
}
