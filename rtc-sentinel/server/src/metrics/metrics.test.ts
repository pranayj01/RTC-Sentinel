import request from 'supertest';
import { createApp } from '../app.js';
import { createAccessToken } from '../auth/tokens.js';
import type { UserRecord, UserRepository } from '../auth/types.js';
import type { CallRecord, CallRepository, CallStatus } from '../calls/types.js';
import type {
  CallMetricRecord,
  MetricRepository,
  QosMetricSample,
} from './types.js';

const timestamp = new Date('2026-09-11T10:00:00.000Z');
const user = (id: string): UserRecord => ({
  id,
  name: id,
  email: `${id}@example.com`,
  passwordHash: 'hash',
  createdAt: timestamp,
  updatedAt: timestamp,
});

class MemoryUsers implements UserRepository {
  constructor(private readonly records: UserRecord[]) {}
  async findByEmail(email: string) {
    return this.records.find((item) => item.email === email) ?? null;
  }
  async findById(id: string) {
    return this.records.find((item) => item.id === id) ?? null;
  }
  async create(input: { name: string; email: string; passwordHash: string }) {
    const record = {
      id: 'new-user',
      ...input,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.records.push(record);
    return record;
  }
}

class MemoryCalls implements CallRepository {
  constructor(private readonly call: CallRecord) {}
  async create(): Promise<CallRecord> {
    return this.call;
  }
  async findById(id: string) {
    return id === this.call.id ? this.call : null;
  }
  async findForUser() {
    return [this.call];
  }
  async update(
    _id: string,
    input: { status: CallStatus; endedAt?: Date; duration?: number },
  ) {
    Object.assign(this.call, input);
    return this.call;
  }
}

class MemoryMetrics implements MetricRepository {
  constructor(readonly records: CallMetricRecord[]) {}
  async recordForRoom(_roomId: string, sample: QosMetricSample) {
    const record = { id: 'metric-new', callId: 'call-1', ...sample };
    this.records.push(record);
    return record;
  }
  async findForCall(callId: string) {
    return this.records.filter((metric) => metric.callId === callId);
  }
}

describe('call metrics API', () => {
  const caller = user('caller');
  const receiver = user('receiver');
  const stranger = user('stranger');
  const call: CallRecord = {
    id: 'call-1',
    roomId: 'ABC123',
    callerId: caller.id,
    receiverId: receiver.id,
    startedAt: timestamp,
    endedAt: null,
    duration: null,
    status: 'CONNECTED',
    createdAt: timestamp,
    updatedAt: timestamp,
    participants: [],
  };
  const metric: CallMetricRecord = {
    id: 'metric-1',
    callId: call.id,
    timestamp,
    rtt: 82,
    jitter: 11,
    packetsSent: 120,
    packetsReceived: 115,
    packetsLost: 1,
    packetLoss: 0.86,
    bytesSent: 12000,
    bytesReceived: 11000,
    bitrate: 45000,
    codec: 'audio/opus',
    audioLevel: 0.42,
    candidateType: 'relay',
    quality: 'Excellent',
    qualityScore: 100,
  };
  const auth = (id: string) => `Bearer ${createAccessToken(id)}`;

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  });

  function app() {
    return createApp(
      new MemoryUsers([caller, receiver, stranger]),
      new MemoryCalls({ ...call }),
      () => timestamp,
      new MemoryMetrics([metric]),
    );
  }

  it('returns chronological metrics to a call participant', async () => {
    const response = await request(app())
      .get('/calls/call-1/metrics')
      .set('Authorization', auth(receiver.id));
    expect(response.status).toBe(200);
    expect(response.body.metrics).toEqual([
      expect.objectContaining({
        id: metric.id,
        rtt: 82,
        candidateType: 'relay',
        quality: 'Excellent',
        qualityScore: 100,
      }),
    ]);
  });

  it('rejects users outside the call', async () => {
    const response = await request(app())
      .get('/calls/call-1/metrics')
      .set('Authorization', auth(stranger.id));
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('requires authentication', async () => {
    const response = await request(app()).get('/calls/call-1/metrics');
    expect(response.status).toBe(401);
  });
});
