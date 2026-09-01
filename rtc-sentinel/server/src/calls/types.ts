export type CallStatus = 'INITIATED' | 'RINGING' | 'CONNECTED' | 'ENDED' | 'REJECTED' | 'FAILED' | 'MISSED';

export interface CallParticipantRecord {
  id: string;
  callId: string;
  userId: string;
  joinedAt: Date | null;
  leftAt: Date | null;
}

export interface CallRecord {
  id: string;
  roomId: string;
  callerId: string;
  receiverId: string;
  startedAt: Date;
  endedAt: Date | null;
  duration: number | null;
  status: CallStatus;
  createdAt: Date;
  updatedAt: Date;
  participants: CallParticipantRecord[];
}

export interface CallRepository {
  create(input: { roomId: string; callerId: string; receiverId: string; startedAt: Date }): Promise<CallRecord>;
  findById(id: string): Promise<CallRecord | null>;
  findForUser(userId: string): Promise<CallRecord[]>;
  update(id: string, input: { status: CallStatus; endedAt?: Date; duration?: number }): Promise<CallRecord>;
}
