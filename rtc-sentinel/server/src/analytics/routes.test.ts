import request from 'supertest';
import { createApp } from '../app.js';
import { createAccessToken } from '../auth/tokens.js';
import type { UserRepository } from '../auth/types.js';
import type { CallRepository } from '../calls/types.js';
import type { MetricRepository } from '../metrics/types.js';
import { QualityServiceUnavailableError } from './qualityClient.js';
import type { QualityPredictor } from './types.js';

const unusedUsers = {} as UserRepository;
const unusedCalls = {} as CallRepository;
const unusedMetrics = {} as MetricRepository;

function appWith(predictor: QualityPredictor) {
  return createApp(
    unusedUsers,
    unusedCalls,
    () => new Date(),
    unusedMetrics,
    predictor,
  );
}

describe('quality analytics API', () => {
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  });
  const auth = () => `Bearer ${createAccessToken('user-1')}`;
  const features = { rtt: 155, jitter: 34, packetLoss: 4.1, bitrate: 22000 };

  it('returns the Python service prediction to an authenticated user', async () => {
    const predict = jest
      .fn()
      .mockResolvedValue({ quality: 'poor', confidence: 0.92 });
    const response = await request(appWith({ predict }))
      .post('/analytics/predict-quality')
      .set('Authorization', auth())
      .send(features);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      prediction: { quality: 'poor', confidence: 0.92 },
    });
    expect(predict).toHaveBeenCalledWith(features);
  });

  it('requires authentication and validates inputs', async () => {
    const predictor = { predict: jest.fn() };
    const unauthenticated = await request(appWith(predictor))
      .post('/analytics/predict-quality')
      .send(features);
    expect(unauthenticated.status).toBe(401);

    const invalid = await request(appWith(predictor))
      .post('/analytics/predict-quality')
      .set('Authorization', auth())
      .send({ ...features, rtt: 'fast' });
    expect(invalid.status).toBe(400);
  });

  it('returns 503 when the Python service is unavailable', async () => {
    const predictor = {
      predict: jest
        .fn()
        .mockRejectedValue(new QualityServiceUnavailableError()),
    };
    const response = await request(appWith(predictor))
      .post('/analytics/predict-quality')
      .set('Authorization', auth())
      .send(features);

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('QUALITY_SERVICE_UNAVAILABLE');
  });
});
