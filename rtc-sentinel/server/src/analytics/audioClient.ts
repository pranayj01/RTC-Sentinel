import { z } from 'zod';
import type { AudioAnalysis, AudioAnalyzer, AudioChunk } from './types.js';
import { logEvent } from '../logger.js';
import { withRetry } from '../reliability.js';

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
    private readonly retryAttempts = Number(
      process.env.ML_SERVICE_RETRY_ATTEMPTS ?? 2,
    ),
    private readonly retryDelayMs = Number(
      process.env.ML_SERVICE_RETRY_DELAY_MS ?? 150,
    ),
  ) {}

  async analyze(chunk: AudioChunk): Promise<AudioAnalysis> {
    try {
      return await withRetry(
        async () => {
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
          } finally {
            clearTimeout(timeout);
          }
        },
        {
          attempts: this.retryAttempts,
          baseDelayMs: this.retryDelayMs,
          maxDelayMs: Math.max(this.retryDelayMs, 1_000),
          onRetry: (error, nextAttempt, delayMs) =>
            logEvent(
              'warn',
              'audio_service_retry',
              { nextAttempt, delayMs },
              error,
            ),
        },
      );
    } catch {
      throw new AudioServiceUnavailableError();
    }
  }
}
