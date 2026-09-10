import { Router } from 'express';
import { authenticate } from '../auth/middleware.js';
import type { CallRepository } from '../calls/types.js';
import type { MetricRepository } from './types.js';

export function createMetricRouter(calls: CallRepository, metrics: MetricRepository): Router {
  const router = Router();
  router.get('/calls/:id/metrics', authenticate, async (request, response, next) => {
    try {
      const call = await calls.findById(String(request.params.id));
      if (!call) { response.status(404).json({ error: { code: 'CALL_NOT_FOUND', message: 'Call not found' } }); return; }
      const userId = response.locals.userId as string;
      if (call.callerId !== userId && call.receiverId !== userId) {
        response.status(403).json({ error: { code: 'FORBIDDEN', message: 'You cannot access these metrics' } });
        return;
      }
      response.json({ metrics: await metrics.findForCall(call.id) });
    } catch (error) { next(error); }
  });
  return router;
}
