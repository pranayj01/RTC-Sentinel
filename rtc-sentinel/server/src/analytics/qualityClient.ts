import { z } from 'zod';
import type {
  QualityFeatures,
  QualityPrediction,
  QualityPredictor,
} from './types.js';

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
  ) {}

  async predict(features: QualityFeatures): Promise<QualityPrediction> {
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
    } catch (error) {
      if (error instanceof QualityServiceUnavailableError) throw error;
      throw new QualityServiceUnavailableError();
    } finally {
      clearTimeout(timeout);
    }
  }
}
