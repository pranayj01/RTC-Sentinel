import { createClient } from 'redis';
import type { QosMetricSample } from './metrics/types.js';
import { logEvent } from './logger.js';

type RedisConnection = ReturnType<typeof createClient>;

export type JoinRoomResult = 'JOINED' | 'ROOM_NOT_FOUND' | 'ROOM_FULL';
export type ResumeRoomResult = {
  result: JoinRoomResult | 'RESUME_INVALID';
  previousSocketId?: string;
};
export type CallSessionStatus = 'INITIATED' | 'RINGING' | 'CONNECTED' | 'ENDED';

export interface RealtimeStateStore {
  registerSocket(socketId: string): Promise<void>;
  unregisterSocket(socketId: string): Promise<string[]>;
  isSocketActive(socketId: string): Promise<boolean>;
  createRoom(roomId: string, socketId: string): Promise<boolean>;
  joinRoom(roomId: string, socketId: string): Promise<JoinRoomResult>;
  setRoomResumeToken(
    roomId: string,
    socketId: string,
    token: string,
  ): Promise<void>;
  resumeRoom(
    roomId: string,
    token: string,
    socketId: string,
  ): Promise<ResumeRoomResult>;
  leaveRoom(roomId: string, socketId: string): Promise<boolean>;
  leaveAllRooms(socketId: string): Promise<string[]>;
  isRoomMember(roomId: string, socketId: string): Promise<boolean>;
  getRoomMembers(roomId: string): Promise<string[]>;
  setCallStatus(roomId: string, status: CallSessionStatus): Promise<void>;
  getCallStatus(roomId: string): Promise<CallSessionStatus | null>;
  appendMetric(roomId: string, sample: QosMetricSample): Promise<void>;
  getRecentMetrics(roomId: string): Promise<QosMetricSample[]>;
}

export class ResilientRealtimeStateStore implements RealtimeStateStore {
  private primaryAvailable = true;

  constructor(
    private readonly primary: RealtimeStateStore,
    private readonly fallback: RealtimeStateStore,
  ) {}

  private degrade(error: unknown): void {
    if (!this.primaryAvailable) return;
    this.primaryAvailable = false;
    logEvent(
      'warn',
      'realtime_state_degraded',
      { fallback: this.fallback.constructor.name },
      error,
    );
  }

  private async execute<T>(
    primary: () => Promise<T>,
    fallback: () => Promise<T>,
    mirror?: (result: T) => Promise<unknown>,
  ): Promise<T> {
    if (!this.primaryAvailable) return fallback();
    try {
      const result = await primary();
      if (mirror) {
        try {
          await mirror(result);
        } catch (error) {
          logEvent('error', 'realtime_fallback_mirror_failed', {}, error);
        }
      }
      return result;
    } catch (error) {
      this.degrade(error);
      return fallback();
    }
  }

  registerSocket(socketId: string): Promise<void> {
    return this.execute(
      () => this.primary.registerSocket(socketId),
      () => this.fallback.registerSocket(socketId),
      () => this.fallback.registerSocket(socketId),
    );
  }

  unregisterSocket(socketId: string): Promise<string[]> {
    return this.execute(
      () => this.primary.unregisterSocket(socketId),
      () => this.fallback.unregisterSocket(socketId),
      () => this.fallback.unregisterSocket(socketId),
    );
  }

  isSocketActive(socketId: string): Promise<boolean> {
    return this.execute(
      () => this.primary.isSocketActive(socketId),
      () => this.fallback.isSocketActive(socketId),
    );
  }

  createRoom(roomId: string, socketId: string): Promise<boolean> {
    return this.execute(
      () => this.primary.createRoom(roomId, socketId),
      () => this.fallback.createRoom(roomId, socketId),
      async (created) => {
        if (created) await this.fallback.createRoom(roomId, socketId);
      },
    );
  }

  joinRoom(roomId: string, socketId: string): Promise<JoinRoomResult> {
    return this.execute(
      () => this.primary.joinRoom(roomId, socketId),
      () => this.fallback.joinRoom(roomId, socketId),
      async (result) => {
        if (result === 'JOINED') await this.fallback.joinRoom(roomId, socketId);
      },
    );
  }

  resumeRoom(
    roomId: string,
    token: string,
    socketId: string,
  ): Promise<ResumeRoomResult> {
    return this.execute(
      () => this.primary.resumeRoom(roomId, token, socketId),
      () => this.fallback.resumeRoom(roomId, token, socketId),
      async (result) => {
        if (result.result === 'JOINED')
          await this.fallback.resumeRoom(roomId, token, socketId);
      },
    );
  }

  setRoomResumeToken(
    roomId: string,
    socketId: string,
    token: string,
  ): Promise<void> {
    return this.execute(
      () => this.primary.setRoomResumeToken(roomId, socketId, token),
      () => this.fallback.setRoomResumeToken(roomId, socketId, token),
      () => this.fallback.setRoomResumeToken(roomId, socketId, token),
    );
  }

  leaveRoom(roomId: string, socketId: string): Promise<boolean> {
    return this.execute(
      () => this.primary.leaveRoom(roomId, socketId),
      () => this.fallback.leaveRoom(roomId, socketId),
      async (removed) => {
        if (removed) await this.fallback.leaveRoom(roomId, socketId);
      },
    );
  }

  leaveAllRooms(socketId: string): Promise<string[]> {
    return this.execute(
      () => this.primary.leaveAllRooms(socketId),
      () => this.fallback.leaveAllRooms(socketId),
      () => this.fallback.leaveAllRooms(socketId),
    );
  }

  isRoomMember(roomId: string, socketId: string): Promise<boolean> {
    return this.execute(
      () => this.primary.isRoomMember(roomId, socketId),
      () => this.fallback.isRoomMember(roomId, socketId),
      async (member) => {
        if (member) await this.fallback.isRoomMember(roomId, socketId);
      },
    );
  }

  getRoomMembers(roomId: string): Promise<string[]> {
    return this.execute(
      () => this.primary.getRoomMembers(roomId),
      () => this.fallback.getRoomMembers(roomId),
    );
  }

  setCallStatus(roomId: string, status: CallSessionStatus): Promise<void> {
    return this.execute(
      () => this.primary.setCallStatus(roomId, status),
      () => this.fallback.setCallStatus(roomId, status),
      () => this.fallback.setCallStatus(roomId, status),
    );
  }

  getCallStatus(roomId: string): Promise<CallSessionStatus | null> {
    return this.execute(
      () => this.primary.getCallStatus(roomId),
      () => this.fallback.getCallStatus(roomId),
    );
  }

  appendMetric(roomId: string, sample: QosMetricSample): Promise<void> {
    return this.execute(
      () => this.primary.appendMetric(roomId, sample),
      () => this.fallback.appendMetric(roomId, sample),
      () => this.fallback.appendMetric(roomId, sample),
    );
  }

  getRecentMetrics(roomId: string): Promise<QosMetricSample[]> {
    return this.execute(
      () => this.primary.getRecentMetrics(roomId),
      () => this.fallback.getRecentMetrics(roomId),
    );
  }
}

interface ExpiringRoom {
  members: Set<string>;
  expiresAt: number;
}

interface ExpiringCall {
  status: CallSessionStatus;
  expiresAt: number;
}

interface ExpiringMetrics {
  samples: QosMetricSample[];
  expiresAt: number;
}

export class MemoryRealtimeStateStore implements RealtimeStateStore {
  private readonly activeSockets = new Map<string, number>();
  private readonly rooms = new Map<string, ExpiringRoom>();
  private readonly socketRooms = new Map<string, Set<string>>();
  private readonly calls = new Map<string, ExpiringCall>();
  private readonly metrics = new Map<string, ExpiringMetrics>();
  private readonly resumeTokens = new Map<
    string,
    { roomId: string; socketId: string; expiresAt: number }
  >();

  constructor(
    private readonly ttlSeconds = 3600,
    private readonly now = () => Date.now(),
    private readonly resumeTtlSeconds = 120,
  ) {}

  private expiresAt(): number {
    return this.now() + this.ttlSeconds * 1000;
  }

  private touchSocket(socketId: string): void {
    if (this.activeSockets.has(socketId))
      this.activeSockets.set(socketId, this.expiresAt());
  }

  private sweep(): void {
    const now = this.now();
    for (const [socketId, expiresAt] of this.activeSockets) {
      if (expiresAt <= now) this.activeSockets.delete(socketId);
    }
    for (const [roomId, room] of this.rooms) {
      if (room.expiresAt > now) continue;
      this.rooms.delete(roomId);
      for (const socketId of room.members) {
        const memberships = this.socketRooms.get(socketId);
        memberships?.delete(roomId);
        if (memberships?.size === 0) this.socketRooms.delete(socketId);
      }
    }
    for (const [roomId, call] of this.calls) {
      if (call.expiresAt <= now) this.calls.delete(roomId);
    }
    for (const [roomId, metrics] of this.metrics) {
      if (metrics.expiresAt <= now) this.metrics.delete(roomId);
    }
    for (const [token, session] of this.resumeTokens) {
      if (session.expiresAt <= now) this.resumeTokens.delete(token);
    }
  }

  async registerSocket(socketId: string): Promise<void> {
    this.sweep();
    this.activeSockets.set(socketId, this.expiresAt());
  }

  async unregisterSocket(socketId: string): Promise<string[]> {
    const rooms = await this.leaveAllRooms(socketId);
    this.activeSockets.delete(socketId);
    this.socketRooms.delete(socketId);
    return rooms;
  }

  async isSocketActive(socketId: string): Promise<boolean> {
    this.sweep();
    return this.activeSockets.has(socketId);
  }

  async createRoom(roomId: string, socketId: string): Promise<boolean> {
    this.sweep();
    if (this.rooms.has(roomId)) return false;
    this.rooms.set(roomId, {
      members: new Set([socketId]),
      expiresAt: this.expiresAt(),
    });
    this.socketRooms.set(
      socketId,
      new Set([...(this.socketRooms.get(socketId) ?? []), roomId]),
    );
    this.touchSocket(socketId);
    await this.setCallStatus(roomId, 'INITIATED');
    return true;
  }

  async joinRoom(roomId: string, socketId: string): Promise<JoinRoomResult> {
    this.sweep();
    const room = this.rooms.get(roomId);
    if (!room) return 'ROOM_NOT_FOUND';
    if (!room.members.has(socketId) && room.members.size >= 2)
      return 'ROOM_FULL';
    room.members.add(socketId);
    room.expiresAt = this.expiresAt();
    this.socketRooms.set(
      socketId,
      new Set([...(this.socketRooms.get(socketId) ?? []), roomId]),
    );
    this.touchSocket(socketId);
    return 'JOINED';
  }

  async setRoomResumeToken(
    roomId: string,
    socketId: string,
    token: string,
  ): Promise<void> {
    this.sweep();
    this.resumeTokens.set(token, {
      roomId,
      socketId,
      expiresAt: this.now() + this.resumeTtlSeconds * 1000,
    });
  }

  async resumeRoom(
    roomId: string,
    token: string,
    socketId: string,
  ): Promise<ResumeRoomResult> {
    this.sweep();
    const session = this.resumeTokens.get(token);
    if (!session || session.roomId !== roomId)
      return { result: 'RESUME_INVALID' };
    const room = this.rooms.get(roomId);
    if (!room) return { result: 'ROOM_NOT_FOUND' };
    if (!room.members.has(session.socketId))
      return { result: 'RESUME_INVALID' };
    this.resumeTokens.delete(token);
    if (room.members.has(socketId))
      return { result: 'JOINED', previousSocketId: session.socketId };

    room.members.delete(session.socketId);
    room.members.add(socketId);
    room.expiresAt = this.expiresAt();
    const previousRooms = this.socketRooms.get(session.socketId);
    previousRooms?.delete(roomId);
    if (previousRooms?.size === 0) this.socketRooms.delete(session.socketId);
    this.socketRooms.set(socketId, new Set([roomId]));
    this.touchSocket(socketId);
    return { result: 'JOINED', previousSocketId: session.socketId };
  }

  async leaveRoom(roomId: string, socketId: string): Promise<boolean> {
    this.sweep();
    const room = this.rooms.get(roomId);
    if (!room?.members.delete(socketId)) return false;
    const memberships = this.socketRooms.get(socketId);
    memberships?.delete(roomId);
    if (memberships?.size === 0) this.socketRooms.delete(socketId);
    if (room.members.size === 0) this.rooms.delete(roomId);
    return true;
  }

  async leaveAllRooms(socketId: string): Promise<string[]> {
    this.sweep();
    const rooms = [...(this.socketRooms.get(socketId) ?? [])];
    for (const roomId of rooms) await this.leaveRoom(roomId, socketId);
    return rooms;
  }

  async isRoomMember(roomId: string, socketId: string): Promise<boolean> {
    this.sweep();
    const room = this.rooms.get(roomId);
    if (!room?.members.has(socketId)) return false;
    room.expiresAt = this.expiresAt();
    this.touchSocket(socketId);
    return true;
  }

  async getRoomMembers(roomId: string): Promise<string[]> {
    this.sweep();
    return [...(this.rooms.get(roomId)?.members ?? [])];
  }

  async setCallStatus(
    roomId: string,
    status: CallSessionStatus,
  ): Promise<void> {
    this.sweep();
    this.calls.set(roomId, { status, expiresAt: this.expiresAt() });
  }

  async getCallStatus(roomId: string): Promise<CallSessionStatus | null> {
    this.sweep();
    return this.calls.get(roomId)?.status ?? null;
  }

  async appendMetric(roomId: string, sample: QosMetricSample): Promise<void> {
    this.sweep();
    const recent = this.metrics.get(roomId)?.samples ?? [];
    this.metrics.set(roomId, {
      samples: [...recent, sample].slice(-120),
      expiresAt: this.expiresAt(),
    });
  }

  async getRecentMetrics(roomId: string): Promise<QosMetricSample[]> {
    this.sweep();
    return this.metrics.get(roomId)?.samples ?? [];
  }
}

export class RedisRealtimeStateStore implements RealtimeStateStore {
  private readonly prefix = 'rtc:realtime';

  constructor(
    private readonly client: RedisConnection,
    private readonly ttlSeconds = 3600,
    private readonly resumeTtlSeconds = 120,
  ) {}

  private room(roomId: string): string {
    return `${this.prefix}:room:${roomId}`;
  }
  private roomMembers(roomId: string): string {
    return `${this.room(roomId)}:members`;
  }
  private socket(socketId: string): string {
    return `${this.prefix}:socket:${socketId}`;
  }
  private socketRooms(socketId: string): string {
    return `${this.socket(socketId)}:rooms`;
  }
  private call(roomId: string): string {
    return `${this.prefix}:call:${roomId}:status`;
  }
  private metrics(roomId: string): string {
    return `${this.prefix}:room:${roomId}:metrics`;
  }
  private resume(token: string): string {
    return `${this.prefix}:resume:${token}`;
  }
  private activeSockets(): string {
    return `${this.prefix}:active:sockets`;
  }
  private activeUntil(): number {
    return Math.floor(Date.now() / 1000) + this.ttlSeconds;
  }

  private async touchSocket(socketId: string): Promise<void> {
    await this.client
      .multi()
      .set(this.socket(socketId), 'active', { EX: this.ttlSeconds })
      .zAdd(this.activeSockets(), [
        { score: this.activeUntil(), value: socketId },
      ])
      .exec();
  }

  async registerSocket(socketId: string): Promise<void> {
    await this.client
      .multi()
      .set(this.socket(socketId), 'active', { EX: this.ttlSeconds })
      .zAdd(this.activeSockets(), [
        { score: this.activeUntil(), value: socketId },
      ])
      .exec();
  }

  async unregisterSocket(socketId: string): Promise<string[]> {
    const rooms = await this.leaveAllRooms(socketId);
    await this.client
      .multi()
      .del([this.socket(socketId), this.socketRooms(socketId)])
      .zRem(this.activeSockets(), socketId)
      .exec();
    return rooms;
  }

  async isSocketActive(socketId: string): Promise<boolean> {
    await this.client.zRemRangeByScore(
      this.activeSockets(),
      0,
      Math.floor(Date.now() / 1000),
    );
    const score = await this.client.zScore(this.activeSockets(), socketId);
    return score !== null;
  }

  async createRoom(roomId: string, socketId: string): Promise<boolean> {
    const created = await this.client.set(this.room(roomId), 'active', {
      NX: true,
      EX: this.ttlSeconds,
    });
    if (!created) return false;
    await this.client
      .multi()
      .sAdd(this.roomMembers(roomId), socketId)
      .expire(this.roomMembers(roomId), this.ttlSeconds)
      .sAdd(this.socketRooms(socketId), roomId)
      .expire(this.socketRooms(socketId), this.ttlSeconds)
      .exec();
    await this.touchSocket(socketId);
    await this.setCallStatus(roomId, 'INITIATED');
    return true;
  }

  async joinRoom(roomId: string, socketId: string): Promise<JoinRoomResult> {
    if (!(await this.client.exists(this.room(roomId)))) return 'ROOM_NOT_FOUND';
    const alreadyJoined = await this.client.sIsMember(
      this.roomMembers(roomId),
      socketId,
    );
    if (
      !alreadyJoined &&
      (await this.client.sCard(this.roomMembers(roomId))) >= 2
    )
      return 'ROOM_FULL';
    await this.client
      .multi()
      .sAdd(this.roomMembers(roomId), socketId)
      .expire(this.room(roomId), this.ttlSeconds)
      .expire(this.roomMembers(roomId), this.ttlSeconds)
      .sAdd(this.socketRooms(socketId), roomId)
      .expire(this.socketRooms(socketId), this.ttlSeconds)
      .exec();
    await this.touchSocket(socketId);
    return 'JOINED';
  }

  async setRoomResumeToken(
    roomId: string,
    socketId: string,
    token: string,
  ): Promise<void> {
    await this.client.set(
      this.resume(token),
      JSON.stringify({ roomId, socketId }),
      { EX: this.resumeTtlSeconds },
    );
  }

  async resumeRoom(
    roomId: string,
    token: string,
    socketId: string,
  ): Promise<ResumeRoomResult> {
    const rawSession = await this.client.get(this.resume(token));
    if (!rawSession) return { result: 'RESUME_INVALID' };
    const session = JSON.parse(rawSession) as {
      roomId?: unknown;
      socketId?: unknown;
    };
    if (session.roomId !== roomId || typeof session.socketId !== 'string')
      return { result: 'RESUME_INVALID' };
    const previousSocketId = session.socketId;
    if (!(await this.client.exists(this.room(roomId))))
      return { result: 'ROOM_NOT_FOUND' };
    if (await this.client.sIsMember(this.roomMembers(roomId), socketId)) {
      await this.client.del(this.resume(token));
      return { result: 'JOINED', previousSocketId };
    }
    if (
      !(await this.client.sIsMember(this.roomMembers(roomId), previousSocketId))
    )
      return { result: 'RESUME_INVALID' };

    await this.client
      .multi()
      .del(this.resume(token))
      .sRem(this.roomMembers(roomId), previousSocketId)
      .sAdd(this.roomMembers(roomId), socketId)
      .expire(this.room(roomId), this.ttlSeconds)
      .expire(this.roomMembers(roomId), this.ttlSeconds)
      .sRem(this.socketRooms(previousSocketId), roomId)
      .sAdd(this.socketRooms(socketId), roomId)
      .expire(this.socketRooms(socketId), this.ttlSeconds)
      .exec();
    await this.touchSocket(socketId);
    return { result: 'JOINED', previousSocketId };
  }

  async leaveRoom(roomId: string, socketId: string): Promise<boolean> {
    const removed = await this.client.sRem(this.roomMembers(roomId), socketId);
    if (!removed) return false;
    await this.client.sRem(this.socketRooms(socketId), roomId);
    if ((await this.client.sCard(this.roomMembers(roomId))) === 0) {
      await this.client.del([this.room(roomId), this.roomMembers(roomId)]);
    }
    return true;
  }

  async leaveAllRooms(socketId: string): Promise<string[]> {
    const rooms = await this.client.sMembers(this.socketRooms(socketId));
    for (const roomId of rooms) await this.leaveRoom(roomId, socketId);
    await this.client.del(this.socketRooms(socketId));
    return rooms;
  }

  async isRoomMember(roomId: string, socketId: string): Promise<boolean> {
    const member = await this.client.sIsMember(
      this.roomMembers(roomId),
      socketId,
    );
    if (member) {
      await this.client
        .multi()
        .expire(this.room(roomId), this.ttlSeconds)
        .expire(this.roomMembers(roomId), this.ttlSeconds)
        .expire(this.socketRooms(socketId), this.ttlSeconds)
        .exec();
      await this.touchSocket(socketId);
    }
    return member;
  }

  getRoomMembers(roomId: string): Promise<string[]> {
    return this.client.sMembers(this.roomMembers(roomId));
  }

  async setCallStatus(
    roomId: string,
    status: CallSessionStatus,
  ): Promise<void> {
    await this.client.set(this.call(roomId), status, { EX: this.ttlSeconds });
  }

  async getCallStatus(roomId: string): Promise<CallSessionStatus | null> {
    return (await this.client.get(
      this.call(roomId),
    )) as CallSessionStatus | null;
  }

  async appendMetric(roomId: string, sample: QosMetricSample): Promise<void> {
    await this.client
      .multi()
      .rPush(this.metrics(roomId), JSON.stringify(sample))
      .lTrim(this.metrics(roomId), -120, -1)
      .expire(this.metrics(roomId), this.ttlSeconds)
      .exec();
  }

  async getRecentMetrics(roomId: string): Promise<QosMetricSample[]> {
    const samples = await this.client.lRange(this.metrics(roomId), 0, -1);
    return samples.map((sample) => {
      const parsed = JSON.parse(sample) as Omit<
        QosMetricSample,
        'timestamp'
      > & { timestamp: string };
      return { ...parsed, timestamp: new Date(parsed.timestamp) };
    });
  }
}
