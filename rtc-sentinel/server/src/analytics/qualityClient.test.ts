import {
  HttpQualityPredictor,
  QualityServiceUnavailableError,
} from './qualityClient.js';

describe('HTTP quality predictor', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends features to the Python service and validates its response', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ quality: 'poor', confidence: 0.92 }),
    } as Response);
    const predictor = new HttpQualityPredictor(
      'http://analytics:8000',
      100,
      1,
      0,
    );
    const features = { rtt: 155, jitter: 34, packetLoss: 4.1, bitrate: 22000 };

    await expect(predictor.predict(features)).resolves.toEqual({
      quality: 'poor',
      confidence: 0.92,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://analytics:8000/predict-quality',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(features),
      }),
    );
  });

  it.each([
    { ok: false, json: async () => ({ detail: 'failure' }) },
    { ok: true, json: async () => ({ quality: 'impossible', confidence: 4 }) },
  ])('rejects unavailable or invalid service responses', async (response) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response as Response);
    await expect(
      new HttpQualityPredictor('http://analytics:8000', 100, 1, 0).predict({
        rtt: 80,
        jitter: 10,
        packetLoss: 0.5,
        bitrate: 48000,
      }),
    ).rejects.toBeInstanceOf(QualityServiceUnavailableError);
  });

  it('maps network failures to a service-unavailable error', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('connection refused'));
    await expect(
      new HttpQualityPredictor('http://analytics:8000', 100, 1, 0).predict({
        rtt: 80,
        jitter: 10,
        packetLoss: 0.5,
        bitrate: 48000,
      }),
    ).rejects.toBeInstanceOf(QualityServiceUnavailableError);
  });

  it('retries one temporary failure before returning a prediction', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValue({
        ok: true,
        json: async () => ({ quality: 'good', confidence: 0.8 }),
      } as Response);

    await expect(
      new HttpQualityPredictor('http://analytics:8000', 100, 2, 0).predict({
        rtt: 80,
        jitter: 10,
        packetLoss: 0.5,
        bitrate: 48000,
      }),
    ).resolves.toEqual({ quality: 'good', confidence: 0.8 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
