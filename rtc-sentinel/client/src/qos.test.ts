import { collectQosMetric, type QosBaseline } from './qos';

function peerWithStats(records: Array<Record<string, unknown>>): RTCPeerConnection {
  const values = new Map(records.map((record) => [record.id as string, record]));
  const report = {
    forEach: (callback: (value: unknown) => void) => values.forEach(callback),
    get: (id: string) => values.get(id),
  } as unknown as RTCStatsReport;
  return { getStats: jest.fn().mockResolvedValue(report) } as unknown as RTCPeerConnection;
}

const records = [
  { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' },
  { id: 'pair', type: 'candidate-pair', nominated: true, state: 'succeeded', localCandidateId: 'local', currentRoundTripTime: 0.082, availableOutgoingBitrate: 45000 },
  { id: 'local', type: 'local-candidate', candidateType: 'relay' },
  { id: 'inbound', type: 'inbound-rtp', kind: 'audio', packetsReceived: 99, packetsLost: 1, bytesReceived: 1000, jitter: 0.011, audioLevel: 0.42, codecId: 'codec' },
  { id: 'outbound', type: 'outbound-rtp', kind: 'audio', packetsSent: 100, bytesSent: 2000, codecId: 'codec' },
  { id: 'codec', type: 'codec', mimeType: 'audio/opus' },
];

test('extracts WebRTC audio and network metrics', async () => {
  const { metric, baseline } = await collectQosMetric(peerWithStats(records), undefined, 10_000);
  expect(metric).toEqual({
    timestamp: new Date(10_000).toISOString(), rtt: 82, jitter: 11,
    packetsSent: 100, packetsReceived: 99, packetsLost: 1, packetLoss: 1,
    bytesSent: 2000, bytesReceived: 1000, bitrate: 45000,
    codec: 'audio/opus', audioLevel: 0.42, candidateType: 'relay',
  });
  expect(baseline).toEqual({ timestamp: 10_000, totalBytes: 3000 });
});

test('calculates bitrate from byte deltas', async () => {
  const previous: QosBaseline = { timestamp: 7_000, totalBytes: 2_000 };
  const { metric } = await collectQosMetric(peerWithStats(records), previous, 10_000);
  expect(metric.bitrate).toBe(2667);
});

test('uses safe defaults when reports are unavailable', async () => {
  const { metric } = await collectQosMetric(peerWithStats([]), undefined, 10_000);
  expect(metric).toMatchObject({ rtt: null, jitter: null, packetLoss: 0, bitrate: 0, codec: null, candidateType: null });
});

test('reflects high latency, jitter, loss, and reduced bandwidth', async () => {
  const degraded = records.map((record) => {
    if (record.id === 'pair') return { ...record, currentRoundTripTime: 0.45 };
    if (record.id === 'inbound') return { ...record, jitter: 0.08, packetsReceived: 70, packetsLost: 30, bytesReceived: 1100 };
    if (record.id === 'outbound') return { ...record, bytesSent: 1200 };
    return record;
  });
  const previous: QosBaseline = { timestamp: 7_000, totalBytes: 2_000 };
  const { metric } = await collectQosMetric(peerWithStats(degraded), previous, 10_000);
  expect(metric).toMatchObject({ rtt: 450, jitter: 80, packetLoss: 30, bitrate: 800 });
});
