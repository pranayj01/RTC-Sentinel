import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/middleware.js';
import { QualityServiceUnavailableError } from './qualityClient.js';
import type { QualityPredictor } from './types.js';

const featuresSchema = z.object({
  rtt: z.number().finite().min(0),
  jitter: z.number().finite().min(0),
  packetLoss: z.number().finite().min(0).max(100),
  bitrate: z.number().finite().min(0),
});

export function createAnalyticsRouter(predictor: QualityPredictor): Router {
  const router = Router();

  router.post(
    '/analytics/predict-quality',
    authenticate,
    async (request, response, next) => {
      try {
        const prediction = await predictor.predict(
          featuresSchema.parse(request.body),
        );
        response.json({ prediction });
      } catch (error) {
        if (error instanceof QualityServiceUnavailableError) {
          response.status(503).json({
            error: {
              code: 'QUALITY_SERVICE_UNAVAILABLE',
              message: 'Quality analytics is temporarily unavailable',
            },
          });
          return;
        }
        next(error);
      }
    },
  );

  return router;
}
