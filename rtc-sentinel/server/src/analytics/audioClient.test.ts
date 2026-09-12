import {
  AudioServiceUnavailableError,
  HttpAudioAnalyzer,
} from './audioClient.js';

const chunk = {
  encoding: 'pcm_s16le' as const,
  sampleRate: 48000,
  pcmBase64: 'AAAA'.repeat(1024),
};

const analysis = {
  label: 'speech' as const,
  confidence: 0.91,
  durationMs: 341.33,
  features: {
    rmsEnergy: 0.12,
    zeroCrossingRate: 0.08,
    spectralCentroidHz: 1250,
    mfcc: Array(13).fill(1),
    melSpectrogram: Array(16).fill(-20),
  },
};

describe('HTTP audio analyzer', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends PCM to the Python service and validates its response', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => analysis,
    } as Response);
    const analyzer = new HttpAudioAnalyzer('http://analytics:8000', 100);

    await expect(analyzer.analyze(chunk)).resolves.toEqual(analysis);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://analytics:8000/analyze-audio',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(chunk) }),
    );
  });

  it.each([
    { ok: false, json: async () => ({ detail: 'failure' }) },
    { ok: true, json: async () => ({ label: 'music', confidence: 4 }) },
  ])('rejects unavailable or invalid responses', async (response) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response as Response);
    await expect(
      new HttpAudioAnalyzer('http://analytics:8000', 100).analyze(chunk),
    ).rejects.toBeInstanceOf(AudioServiceUnavailableError);
  });
});
