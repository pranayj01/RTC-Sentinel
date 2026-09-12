import { Buffer } from 'node:buffer';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/middleware.js';
import { QualityServiceUnavailableError } from './qualityClient.js';
import { AudioServiceUnavailableError } from './audioClient.js';
import type { AudioAnalyzer, QualityPredictor } from './types.js';

const featuresSchema = z.object({
  rtt: z.number().finite().min(0),
  jitter: z.number().finite().min(0),
  packetLoss: z.number().finite().min(0).max(100),
  bitrate: z.number().finite().min(0),
  audioLevel: z.number().finite().min(0).max(1).optional(),
});

const audioChunkSchema = z.object({
  encoding: z.literal('pcm_s16le'),
  sampleRate: z.number().int().min(8_000).max(96_000),
  pcmBase64: z
    .string()
    .min(1)
    .max(50_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/)
    .refine((value) => {
      const byteLength = Buffer.from(value, 'base64').byteLength;
      return (
        byteLength >= 4_096 && byteLength <= 32_768 && byteLength % 2 === 0
      );
    }, 'PCM must contain between 2048 and 16384 signed 16-bit samples'),
});

export function createAnalyticsRouter(
  predictor: QualityPredictor,
  audioAnalyzer: AudioAnalyzer,
): Router {
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

  router.post(
    '/analytics/analyze-audio',
    authenticate,
    async (request, response, next) => {
      try {
        const analysis = await audioAnalyzer.analyze(
          audioChunkSchema.parse(request.body),
        );
        response.json({ analysis });
      } catch (error) {
        if (error instanceof AudioServiceUnavailableError) {
          response.status(503).json({
            error: {
              code: 'AUDIO_ANALYSIS_UNAVAILABLE',
              message: 'Audio analysis is temporarily unavailable',
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
