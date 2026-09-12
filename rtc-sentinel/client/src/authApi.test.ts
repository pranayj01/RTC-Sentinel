import {
  analyzeAudio,
  getCurrentUser,
  predictQuality,
  register,
} from './authApi';

const fetchMock = jest.fn();
globalThis.fetch = fetchMock;

beforeEach(() => {
  fetchMock.mockReset();
});

test('registers through the same-origin API gateway', async () => {
  const session = {
    user: {
      id: 'user-1',
      name: 'Test User',
      email: 'test@example.com',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
  };
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => session,
  });

  await expect(
    register({
      name: 'Test User',
      email: 'test@example.com',
      password: 'StrongPass1',
    }),
  ).resolves.toEqual(session);
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/auth/register',
    expect.objectContaining({ method: 'POST' }),
  );
});

test('adds the access token to protected requests', async () => {
  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        prediction: { quality: 'good', confidence: 0.91 },
      }),
    });

  await getCurrentUser('access-token');
  await predictQuality('access-token', {
    rtt: 100,
    jitter: 12,
    packetLoss: 0.5,
    bitrate: 48_000,
    audioLevel: 0.4,
  });

  for (const [, init] of fetchMock.mock.calls as Array<[string, RequestInit]>) {
    expect((init.headers as Headers).get('Authorization')).toBe(
      'Bearer access-token',
    );
  }
});

test('sends PCM frames to the protected audio endpoint', async () => {
  const analysis = {
    label: 'speech' as const,
    confidence: 0.9,
    durationMs: 341.33,
    features: {
      rmsEnergy: 0.1,
      zeroCrossingRate: 0.08,
      spectralCentroidHz: 1200,
      mfcc: Array(13).fill(1),
      melSpectrogram: Array(16).fill(-20),
    },
  };
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ analysis }),
  });

  await expect(
    analyzeAudio('access-token', {
      encoding: 'pcm_s16le',
      sampleRate: 48000,
      pcmBase64: 'AAAA',
    }),
  ).resolves.toEqual(analysis);
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/analytics/analyze-audio',
    expect.objectContaining({ method: 'POST' }),
  );
});

test('surfaces API error messages', async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    status: 409,
    json: async () => ({
      error: { code: 'EMAIL_EXISTS', message: 'Email already registered' },
    }),
  });

  await expect(
    register({
      name: 'Test User',
      email: 'test@example.com',
      password: 'StrongPass1',
    }),
  ).rejects.toMatchObject({
    message: 'Email already registered',
    status: 409,
    code: 'EMAIL_EXISTS',
  });
});
