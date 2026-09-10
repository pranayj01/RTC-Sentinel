import type { QosMetric } from './qos';

export type QualityLabel =
  'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Critical' | 'Unknown';

export interface QualityAssessment {
  quality: QualityLabel;
  score: number | null;
  limitingFactors: string[];
}

const labels: QualityLabel[] = [
  'Excellent',
  'Good',
  'Fair',
  'Poor',
  'Critical',
];
const scores = [100, 80, 60, 40, 20];

function upperBoundTier(value: number, bounds: number[]): number {
  const tier = bounds.findIndex((bound) => value < bound);
  return tier === -1 ? 4 : tier;
}

function bitrateTier(bitrate: number): number {
  if (bitrate >= 32_000) return 0;
  if (bitrate >= 24_000) return 1;
  if (bitrate >= 16_000) return 2;
  if (bitrate >= 8_000) return 3;
  return 4;
}

export function assessCallQuality(
  metric: Pick<QosMetric, 'rtt' | 'jitter' | 'packetLoss' | 'bitrate'>,
): QualityAssessment {
  if (metric.rtt === null || metric.jitter === null) {
    return {
      quality: 'Unknown',
      score: null,
      limitingFactors: ['Waiting for complete WebRTC statistics'],
    };
  }
  const dimensions = [
    {
      name: 'round-trip time',
      tier: upperBoundTier(metric.rtt, [150, 250, 400, 800]),
    },
    { name: 'jitter', tier: upperBoundTier(metric.jitter, [20, 40, 70, 120]) },
    {
      name: 'packet loss',
      tier: upperBoundTier(metric.packetLoss, [1, 2.5, 5, 10]),
    },
    { name: 'bitrate', tier: bitrateTier(metric.bitrate) },
  ];
  const worstTier = Math.max(...dimensions.map((dimension) => dimension.tier));
  return {
    quality: labels[worstTier],
    score: scores[worstTier],
    limitingFactors: dimensions
      .filter((dimension) => dimension.tier === worstTier)
      .map((dimension) => dimension.name),
  };
}
