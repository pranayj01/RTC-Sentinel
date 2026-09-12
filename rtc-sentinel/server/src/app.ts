import express, { type ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { createApiRouter } from './auth/routes.js';
import type { UserRepository } from './auth/types.js';
import { PrismaUserRepository } from './auth/userRepository.js';
import { prisma } from './dependencies.js';
import { createCallRouter } from './calls/routes.js';
import type { CallRepository } from './calls/types.js';
import { PrismaCallRepository } from './calls/callRepository.js';
import { PrismaMetricRepository } from './metrics/metricRepository.js';
import { createMetricRouter } from './metrics/routes.js';
import type { MetricRepository } from './metrics/types.js';
import { createAnalyticsRouter } from './analytics/routes.js';
import { HttpQualityPredictor } from './analytics/qualityClient.js';
import { HttpAudioAnalyzer } from './analytics/audioClient.js';
import type { AudioAnalyzer, QualityPredictor } from './analytics/types.js';

export function createApp(
  users: UserRepository = new PrismaUserRepository(prisma),
  calls: CallRepository = new PrismaCallRepository(prisma),
  now: () => Date = () => new Date(),
  metrics: MetricRepository = new PrismaMetricRepository(prisma),
  qualityPredictor: QualityPredictor = new HttpQualityPredictor(),
  audioAnalyzer: AudioAnalyzer = new HttpAudioAnalyzer(),
) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/health', (_request, response) =>
    response.status(200).json({ status: 'ok' }),
  );
  app.use(createApiRouter(users));
  app.use(createCallRouter(users, calls, now));
  app.use(createMetricRouter(calls, metrics));
  app.use(createAnalyticsRouter(qualityPredictor, audioAnalyzer));
  const errors: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof ZodError) {
      response.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: error.flatten(),
        },
      });
      return;
    }
    if (error instanceof SyntaxError) {
      response.status(400).json({
        error: { code: 'INVALID_JSON', message: 'Invalid JSON body' },
      });
      return;
    }
    console.error(error);
    response.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  };
  app.use(errors);
  return app;
}
export const app = createApp();
