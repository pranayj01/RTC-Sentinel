import { z } from 'zod';
import type {
  QualityFeatures,
  QualityPrediction,
  QualityPredictor,
} from './types.js';
import { logEvent } from '../logger.js';
import { withRetry } from '../reliability.js';

const predictionSchema = z.object({
  quality: z.enum(['excellent', 'good', 'fair', 'poor', 'critical']),
  confidence: z.number().min(0).max(1),
});

export class QualityServiceUnavailableError extends Error {
  constructor() {
    super('Quality analytics service is unavailable');
    this.name = 'QualityServiceUnavailableError';
  }
}

export class HttpQualityPredictor implements QualityPredictor {
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

  async predict(features: QualityFeatures): Promise<QualityPrediction> {
    try {
      return await withRetry(
        async () => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
          try {
            const response = await fetch(`${this.baseUrl}/predict-quality`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(features),
              signal: controller.signal,
            });
            if (!response.ok) throw new QualityServiceUnavailableError();
            const parsed = predictionSchema.safeParse(await response.json());
            if (!parsed.success) throw new QualityServiceUnavailableError();
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
              'quality_service_retry',
              { nextAttempt, delayMs },
              error,
            ),
        },
      );
    } catch {
      throw new QualityServiceUnavailableError();
    }
  }
}
