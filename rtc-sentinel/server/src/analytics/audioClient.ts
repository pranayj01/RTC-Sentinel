import { z } from 'zod';
import type { AudioAnalysis, AudioAnalyzer, AudioChunk } from './types.js';

const analysisSchema = z.object({
  label: z.enum(['speech', 'silence', 'noise']),
  confidence: z.number().min(0).max(1),
  durationMs: z.number().nonnegative(),
  features: z.object({
    rmsEnergy: z.number().nonnegative(),
    zeroCrossingRate: z.number().min(0).max(1),
    spectralCentroidHz: z.number().nonnegative(),
    mfcc: z.array(z.number()).length(13),
    melSpectrogram: z.array(z.number()).length(16),
  }),
});

export class AudioServiceUnavailableError extends Error {
  constructor() {
    super('Audio analytics service is unavailable');
    this.name = 'AudioServiceUnavailableError';
  }
}

export class HttpAudioAnalyzer implements AudioAnalyzer {
  constructor(
    private readonly baseUrl = process.env.ML_SERVICE_URL ??
      'http://localhost:8000',
    private readonly timeoutMs = Number(
      process.env.ML_SERVICE_TIMEOUT_MS ?? 2000,
    ),
  ) {}

  async analyze(chunk: AudioChunk): Promise<AudioAnalysis> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/analyze-audio`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(chunk),
        signal: controller.signal,
      });
      if (!response.ok) throw new AudioServiceUnavailableError();
      const parsed = analysisSchema.safeParse(await response.json());
      if (!parsed.success) throw new AudioServiceUnavailableError();
      return parsed.data;
    } catch (error) {
      if (error instanceof AudioServiceUnavailableError) throw error;
      throw new AudioServiceUnavailableError();
    } finally {
      clearTimeout(timeout);
    }
  }
}
