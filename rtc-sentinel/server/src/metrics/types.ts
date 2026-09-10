export interface QosMetricSample {
  timestamp: Date;
  rtt: number | null;
  jitter: number | null;
  packetsSent: number;
  packetsReceived: number;
  packetsLost: number;
  packetLoss: number;
  bytesSent: number;
  bytesReceived: number;
  bitrate: number;
  codec: string | null;
  audioLevel: number | null;
  candidateType: string | null;
}

export interface CallMetricRecord extends QosMetricSample {
  id: string;
  callId: string;
}

export interface MetricRepository {
  recordForRoom(roomId: string, sample: QosMetricSample): Promise<CallMetricRecord | null>;
  findForCall(callId: string): Promise<CallMetricRecord[]>;
}
