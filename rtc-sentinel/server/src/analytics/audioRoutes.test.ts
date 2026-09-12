import { Buffer } from 'node:buffer';
import request from 'supertest';
import { createApp } from '../app.js';
import { createAccessToken } from '../auth/tokens.js';
import type { UserRepository } from '../auth/types.js';
import type { CallRepository } from '../calls/types.js';
import type { MetricRepository } from '../metrics/types.js';
import { AudioServiceUnavailableError } from './audioClient.js';
import type { AudioAnalyzer, QualityPredictor } from './types.js';

const unusedUsers = {} as UserRepository;
const unusedCalls = {} as CallRepository;
const unusedMetrics = {} as MetricRepository;
const unusedQuality = {} as QualityPredictor;

function appWith(audioAnalyzer: AudioAnalyzer) {
  return createApp(
    unusedUsers,
    unusedCalls,
    () => new Date(),
    unusedMetrics,
    unusedQuality,
    audioAnalyzer,
  );
}

const chunk = {
  encoding: 'pcm_s16le',
  sampleRate: 48000,
  pcmBase64: Buffer.alloc(4096).toString('base64'),
};

describe('audio analytics API', () => {
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  });
  const auth = () => `Bearer ${createAccessToken('user-1')}`;

  it('returns audio analysis to an authenticated user', async () => {
    const result = {
      label: 'speech' as const,
      confidence: 0.93,
      durationMs: 341.33,
      features: {
        rmsEnergy: 0.12,
        zeroCrossingRate: 0.08,
        spectralCentroidHz: 1250,
        mfcc: Array(13).fill(1),
        melSpectrogram: Array(16).fill(-20),
      },
    };
    const analyze = jest.fn().mockResolvedValue(result);
    const response = await request(appWith({ analyze }))
      .post('/analytics/analyze-audio')
      .set('Authorization', auth())
      .send(chunk);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ analysis: result });
    expect(analyze).toHaveBeenCalledWith(chunk);
  });

  it('requires authentication and validates PCM input', async () => {
    const analyzer = { analyze: jest.fn() };
    const unauthenticated = await request(appWith(analyzer))
      .post('/analytics/analyze-audio')
      .send(chunk);
    expect(unauthenticated.status).toBe(401);

    const invalid = await request(appWith(analyzer))
      .post('/analytics/analyze-audio')
      .set('Authorization', auth())
      .send({ ...chunk, pcmBase64: 'not base64!' });
    expect(invalid.status).toBe(400);

    const undersized = await request(appWith(analyzer))
      .post('/analytics/analyze-audio')
      .set('Authorization', auth())
      .send({ ...chunk, pcmBase64: Buffer.alloc(100).toString('base64') });
    expect(undersized.status).toBe(400);
  });

  it('degrades gracefully when audio analytics is unavailable', async () => {
    const analyzer = {
      analyze: jest.fn().mockRejectedValue(new AudioServiceUnavailableError()),
    };
    const response = await request(appWith(analyzer))
      .post('/analytics/analyze-audio')
      .set('Authorization', auth())
      .send(chunk);

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('AUDIO_ANALYSIS_UNAVAILABLE');
  });
});
