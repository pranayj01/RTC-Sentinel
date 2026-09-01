import request from 'supertest';
import { createAccessToken } from '../auth/tokens.js';
import type { UserRecord, UserRepository } from '../auth/types.js';
import { createApp } from '../app.js';
import type { CallRecord, CallRepository, CallStatus } from './types.js';

class MemoryUsers implements UserRepository {
  constructor(private readonly users: UserRecord[]) {}
  async findByEmail(email: string) { return this.users.find((user) => user.email === email) ?? null; }
  async findById(id: string) { return this.users.find((user) => user.id === id) ?? null; }
  async create(input: { name: string; email: string; passwordHash: string }) {
    const now = new Date(); const user = { id: `user-${this.users.length + 1}`, ...input, createdAt: now, updatedAt: now };
    this.users.push(user); return user;
  }
}

class MemoryCalls implements CallRepository {
  records: CallRecord[] = [];
  async create(input: { roomId: string; callerId: string; receiverId: string; startedAt: Date }) {
    const call: CallRecord = {
      id: `call-${this.records.length + 1}`, ...input, endedAt: null, duration: null, status: 'INITIATED',
      createdAt: input.startedAt, updatedAt: input.startedAt,
      participants: [
        { id: 'participant-1', callId: `call-${this.records.length + 1}`, userId: input.callerId, joinedAt: input.startedAt, leftAt: null },
        { id: 'participant-2', callId: `call-${this.records.length + 1}`, userId: input.receiverId, joinedAt: null, leftAt: null },
      ],
    };
    this.records.push(call); return call;
  }
  async findById(id: string) { return this.records.find((call) => call.id === id) ?? null; }
  async findForUser(userId: string) { return this.records.filter((call) => call.callerId === userId || call.receiverId === userId); }
  async update(id: string, input: { status: CallStatus; endedAt?: Date; duration?: number }) {
    const call = (await this.findById(id))!; Object.assign(call, input); return call;
  }
}

const date = new Date('2026-09-01T10:00:00.000Z');
const user = (id: string): UserRecord => ({ id, name: id, email: `${id}@example.com`, passwordHash: 'hash', createdAt: date, updatedAt: date });

describe('call storage API', () => {
  const caller = user('caller'); const receiver = user('receiver'); const stranger = user('stranger');
  const auth = (id: string) => `Bearer ${createAccessToken(id)}`;
  let users: MemoryUsers; let calls: MemoryCalls; let clock: Date;
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret'; users = new MemoryUsers([caller, receiver, stranger]);
    calls = new MemoryCalls(); clock = new Date(date);
  });

  async function createCall() {
    return request(createApp(users, calls, () => new Date(clock)))
      .post('/calls').set('Authorization', auth(caller.id)).send({ roomId: 'abc123', receiverId: receiver.id });
  }

  it('creates a call row with participants and the correct start time', async () => {
    const response = await createCall();
    expect(response.status).toBe(201);
    expect(response.body.call).toMatchObject({ roomId: 'ABC123', callerId: caller.id, receiverId: receiver.id, status: 'INITIATED', startedAt: date.toISOString() });
    expect(response.body.call.participants).toHaveLength(2); expect(calls.records).toHaveLength(1);
  });

  it('moves through initiated, ringing, connected, and ended with duration', async () => {
    const app = createApp(users, calls, () => new Date(clock));
    const created = await request(app).post('/calls').set('Authorization', auth(caller.id)).send({ roomId: 'ABC123', receiverId: receiver.id });
    const id = created.body.call.id;
    expect((await request(app).patch(`/calls/${id}/status`).set('Authorization', auth(caller.id)).send({ status: 'RINGING' })).body.call.status).toBe('RINGING');
    expect((await request(app).patch(`/calls/${id}/status`).set('Authorization', auth(receiver.id)).send({ status: 'CONNECTED' })).body.call.status).toBe('CONNECTED');
    clock = new Date(date.getTime() + 65_000);
    const ended = await request(app).post(`/calls/${id}/end`).set('Authorization', auth(caller.id));
    expect(ended.status).toBe(200); expect(ended.body.call).toMatchObject({ status: 'ENDED', endedAt: clock.toISOString(), duration: 65 });
  });

  it('lists and returns calls for participants', async () => {
    const created = await createCall(); const app = createApp(users, calls);
    const list = await request(app).get('/calls').set('Authorization', auth(receiver.id));
    expect(list.status).toBe(200); expect(list.body.calls).toHaveLength(1);
    const detail = await request(app).get(`/calls/${created.body.call.id}`).set('Authorization', auth(receiver.id));
    expect(detail.status).toBe(200);
  });

  it('rejects protected APIs without a JWT', async () => {
    const response = await request(createApp(users, calls)).get('/calls'); expect(response.status).toBe(401);
  });

  it("prevents a user from reading another user's private call", async () => {
    const created = await createCall();
    const response = await request(createApp(users, calls)).get(`/calls/${created.body.call.id}`).set('Authorization', auth(stranger.id));
    expect(response.status).toBe(403); expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects invalid lifecycle transitions', async () => {
    const created = await createCall();
    const response = await request(createApp(users, calls)).post(`/calls/${created.body.call.id}/end`).set('Authorization', auth(caller.id));
    expect(response.status).toBe(409); expect(response.body.error.code).toBe('INVALID_TRANSITION');
  });
});
