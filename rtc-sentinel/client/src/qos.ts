export interface QosMetric {
  timestamp: string;
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

export interface QosBaseline {
  timestamp: number;
  totalBytes: number;
}

interface StatsRecord extends RTCStats {
  [key: string]: unknown;
}

const numberValue = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const optionalNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const rounded = (value: number, digits = 2) => Number(value.toFixed(digits));
const isAudio = (report: StatsRecord) => report.kind === 'audio' || report.mediaType === 'audio';

export async function collectQosMetric(
  peer: RTCPeerConnection,
  previous?: QosBaseline,
  now = Date.now(),
): Promise<{ metric: QosMetric; baseline: QosBaseline }> {
  const stats = await peer.getStats();
  const reports: StatsRecord[] = [];
  stats.forEach((report) => reports.push(report as StatsRecord));

  const transport = reports.find((report) => report.type === 'transport' && report.selectedCandidatePairId);
  const pairId = transport?.selectedCandidatePairId as string | undefined;
  const pair = (pairId ? stats.get(pairId) : undefined) as StatsRecord | undefined
    ?? reports.find((report) => report.type === 'candidate-pair' && report.nominated && report.state === 'succeeded');
  const inbound = reports.find((report) => report.type === 'inbound-rtp' && isAudio(report));
  const outbound = reports.find((report) => report.type === 'outbound-rtp' && isAudio(report));
  const remoteInbound = reports.find((report) => report.type === 'remote-inbound-rtp' && isAudio(report));
  const audioSource = reports.find((report) => ['media-source', 'audio-source'].includes(report.type) && isAudio(report));
  const codecId = (inbound?.codecId ?? outbound?.codecId) as string | undefined;
  const codec = (codecId ? stats.get(codecId) : undefined) as StatsRecord | undefined;
  const localCandidateId = pair?.localCandidateId as string | undefined;
  const localCandidate = (localCandidateId ? stats.get(localCandidateId) : undefined) as StatsRecord | undefined;

  const packetsSent = numberValue(outbound?.packetsSent);
  const packetsReceived = numberValue(inbound?.packetsReceived);
  const packetsLost = Math.max(0, numberValue(inbound?.packetsLost));
  const bytesSent = numberValue(outbound?.bytesSent);
  const bytesReceived = numberValue(inbound?.bytesReceived);
  const totalPackets = packetsReceived + packetsLost;
  const totalBytes = bytesSent + bytesReceived;
  const elapsedSeconds = previous ? (now - previous.timestamp) / 1000 : 0;
  const measuredBitrate = previous && elapsedSeconds > 0
    ? Math.max(0, ((totalBytes - previous.totalBytes) * 8) / elapsedSeconds)
    : numberValue(pair?.availableOutgoingBitrate);
  const rttSeconds = optionalNumber(pair?.currentRoundTripTime) ?? optionalNumber(remoteInbound?.roundTripTime);
  const jitterSeconds = optionalNumber(inbound?.jitter);
  const audioLevel = optionalNumber(inbound?.audioLevel) ?? optionalNumber(audioSource?.audioLevel);

  return {
    metric: {
      timestamp: new Date(now).toISOString(),
      rtt: rttSeconds === null ? null : rounded(rttSeconds * 1000),
      jitter: jitterSeconds === null ? null : rounded(jitterSeconds * 1000),
      packetsSent,
      packetsReceived,
      packetsLost,
      packetLoss: totalPackets === 0 ? 0 : rounded((packetsLost / totalPackets) * 100),
      bytesSent,
      bytesReceived,
      bitrate: rounded(measuredBitrate, 0),
      codec: typeof codec?.mimeType === 'string' ? codec.mimeType : null,
      audioLevel,
      candidateType: typeof localCandidate?.candidateType === 'string' ? localCandidate.candidateType : null,
    },
    baseline: { timestamp: now, totalBytes },
  };
}
