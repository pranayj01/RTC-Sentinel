import { assessCallQuality } from './quality';

test.each([
  [{ rtt: 80, jitter: 10, packetLoss: 0.5, bitrate: 45_000 }, 'Excellent', 100],
  [{ rtt: 180, jitter: 25, packetLoss: 1.5, bitrate: 28_000 }, 'Good', 80],
  [{ rtt: 300, jitter: 55, packetLoss: 4, bitrate: 20_000 }, 'Fair', 60],
  [{ rtt: 650, jitter: 90, packetLoss: 8, bitrate: 10_000 }, 'Poor', 40],
  [{ rtt: 900, jitter: 150, packetLoss: 15, bitrate: 6_000 }, 'Critical', 20],
] as const)('classifies %o as %s', (metric, quality, score) => {
  expect(assessCallQuality(metric)).toMatchObject({ quality, score });
});

test('uses the worst metric instead of hiding it in an average', () => {
  const result = assessCallQuality({
    rtt: 80,
    jitter: 10,
    packetLoss: 12,
    bitrate: 45_000,
  });
  expect(result).toEqual({
    quality: 'Critical',
    score: 20,
    limitingFactors: ['packet loss'],
  });
});

test('waits for complete connection statistics', () => {
  expect(
    assessCallQuality({ rtt: null, jitter: null, packetLoss: 0, bitrate: 0 }),
  ).toMatchObject({ quality: 'Unknown', score: null });
});
