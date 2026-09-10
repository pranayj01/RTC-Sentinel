import { createClient } from 'redis';
import type { QosMetricSample } from './metrics/types.js';

type RedisConnection = ReturnType<typeof createClient>;

export type JoinRoomResult = 'JOINED' | 'ROOM_NOT_FOUND' | 'ROOM_FULL';
export type CallSessionStatus = 'INITIATED' | 'RINGING' | 'CONNECTED' | 'ENDED';

export interface RealtimeStateStore {
  registerSocket(socketId: string): Promise<void>;
  unregisterSocket(socketId: string): Promise<string[]>;
  isSocketActive(socketId: string): Promise<boolean>;
  createRoom(roomId: string, socketId: string): Promise<boolean>;
  joinRoom(roomId: string, socketId: string): Promise<JoinRoomResult>;
  leaveRoom(roomId: string, socketId: string): Promise<boolean>;
  leaveAllRooms(socketId: string): Promise<string[]>;
  isRoomMember(roomId: string, socketId: string): Promise<boolean>;
  getRoomMembers(roomId: string): Promise<string[]>;
  setCallStatus(roomId: string, status: CallSessionStatus): Promise<void>;
  getCallStatus(roomId: string): Promise<CallSessionStatus | null>;
  appendMetric(roomId: string, sample: QosMetricSample): Promise<void>;
  getRecentMetrics(roomId: string): Promise<QosMetricSample[]>;
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

  constructor(
    private readonly ttlSeconds = 3600,
    private readonly now = () => Date.now(),
  ) {}

  private expiresAt(): number {
    return this.now() + this.ttlSeconds * 1000;
  }

  private touchSocket(socketId: string): void {
    if (this.activeSockets.has(socketId)) this.activeSockets.set(socketId, this.expiresAt());
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
    this.rooms.set(roomId, { members: new Set([socketId]), expiresAt: this.expiresAt() });
    this.socketRooms.set(socketId, new Set([...(this.socketRooms.get(socketId) ?? []), roomId]));
    this.touchSocket(socketId);
    await this.setCallStatus(roomId, 'INITIATED');
    return true;
  }

  async joinRoom(roomId: string, socketId: string): Promise<JoinRoomResult> {
    this.sweep();
    const room = this.rooms.get(roomId);
    if (!room) return 'ROOM_NOT_FOUND';
    if (!room.members.has(socketId) && room.members.size >= 2) return 'ROOM_FULL';
    room.members.add(socketId);
    room.expiresAt = this.expiresAt();
    this.socketRooms.set(socketId, new Set([...(this.socketRooms.get(socketId) ?? []), roomId]));
    this.touchSocket(socketId);
    return 'JOINED';
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

  async setCallStatus(roomId: string, status: CallSessionStatus): Promise<void> {
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
    this.metrics.set(roomId, { samples: [...recent, sample].slice(-120), expiresAt: this.expiresAt() });
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
  ) {}

  private room(roomId: string): string { return `${this.prefix}:room:${roomId}`; }
  private roomMembers(roomId: string): string { return `${this.room(roomId)}:members`; }
  private socket(socketId: string): string { return `${this.prefix}:socket:${socketId}`; }
  private socketRooms(socketId: string): string { return `${this.socket(socketId)}:rooms`; }
  private call(roomId: string): string { return `${this.prefix}:call:${roomId}:status`; }
  private metrics(roomId: string): string { return `${this.prefix}:room:${roomId}:metrics`; }
  private activeSockets(): string { return `${this.prefix}:active:sockets`; }
  private activeUntil(): number { return Math.floor(Date.now() / 1000) + this.ttlSeconds; }

  private async touchSocket(socketId: string): Promise<void> {
    await this.client.multi()
      .set(this.socket(socketId), 'active', { EX: this.ttlSeconds })
      .zAdd(this.activeSockets(), [{ score: this.activeUntil(), value: socketId }])
      .exec();
  }

  async registerSocket(socketId: string): Promise<void> {
    await this.client.multi()
      .set(this.socket(socketId), 'active', { EX: this.ttlSeconds })
      .zAdd(this.activeSockets(), [{ score: this.activeUntil(), value: socketId }])
      .exec();
  }

  async unregisterSocket(socketId: string): Promise<string[]> {
    const rooms = await this.leaveAllRooms(socketId);
    await this.client.multi()
      .del([this.socket(socketId), this.socketRooms(socketId)])
      .zRem(this.activeSockets(), socketId)
      .exec();
    return rooms;
  }

  async isSocketActive(socketId: string): Promise<boolean> {
    await this.client.zRemRangeByScore(this.activeSockets(), 0, Math.floor(Date.now() / 1000));
    const score = await this.client.zScore(this.activeSockets(), socketId);
    return score !== null;
  }

  async createRoom(roomId: string, socketId: string): Promise<boolean> {
    const created = await this.client.set(this.room(roomId), 'active', { NX: true, EX: this.ttlSeconds });
    if (!created) return false;
    await this.client.multi()
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
    const alreadyJoined = await this.client.sIsMember(this.roomMembers(roomId), socketId);
    if (!alreadyJoined && (await this.client.sCard(this.roomMembers(roomId))) >= 2) return 'ROOM_FULL';
    await this.client.multi()
      .sAdd(this.roomMembers(roomId), socketId)
      .expire(this.room(roomId), this.ttlSeconds)
      .expire(this.roomMembers(roomId), this.ttlSeconds)
      .sAdd(this.socketRooms(socketId), roomId)
      .expire(this.socketRooms(socketId), this.ttlSeconds)
      .exec();
    await this.touchSocket(socketId);
    return 'JOINED';
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
    const member = await this.client.sIsMember(this.roomMembers(roomId), socketId);
    if (member) {
      await this.client.multi()
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

  async setCallStatus(roomId: string, status: CallSessionStatus): Promise<void> {
    await this.client.set(this.call(roomId), status, { EX: this.ttlSeconds });
  }

  async getCallStatus(roomId: string): Promise<CallSessionStatus | null> {
    return (await this.client.get(this.call(roomId))) as CallSessionStatus | null;
  }

  async appendMetric(roomId: string, sample: QosMetricSample): Promise<void> {
    await this.client.multi()
      .rPush(this.metrics(roomId), JSON.stringify(sample))
      .lTrim(this.metrics(roomId), -120, -1)
      .expire(this.metrics(roomId), this.ttlSeconds)
      .exec();
  }

  async getRecentMetrics(roomId: string): Promise<QosMetricSample[]> {
    const samples = await this.client.lRange(this.metrics(roomId), 0, -1);
    return samples.map((sample) => {
      const parsed = JSON.parse(sample) as Omit<QosMetricSample, 'timestamp'> & { timestamp: string };
      return { ...parsed, timestamp: new Date(parsed.timestamp) };
    });
  }
}
