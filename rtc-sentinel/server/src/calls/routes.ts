import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/middleware.js';
import type { UserRepository } from '../auth/types.js';
import type { CallRecord, CallRepository, CallStatus } from './types.js';

const createSchema = z
  .object({
    roomId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{6}$/),
    receiverId: z.string().min(1).max(128),
  })
  .strict();
const statusSchema = z
  .object({
    status: z.enum(['RINGING', 'CONNECTED', 'REJECTED', 'FAILED', 'MISSED']),
  })
  .strict();
const transitions: Record<CallStatus, CallStatus[]> = {
  INITIATED: ['RINGING', 'REJECTED', 'FAILED', 'MISSED'],
  RINGING: ['CONNECTED', 'REJECTED', 'FAILED', 'MISSED'],
  CONNECTED: ['ENDED', 'FAILED'],
  ENDED: [],
  REJECTED: [],
  FAILED: [],
  MISSED: [],
};

const canAccess = (call: CallRecord, userId: string) =>
  call.callerId === userId || call.receiverId === userId;
const notFound = {
  error: { code: 'CALL_NOT_FOUND', message: 'Call not found' },
};
const forbidden = {
  error: { code: 'FORBIDDEN', message: 'You cannot access this call' },
};

export function createCallRouter(
  users: UserRepository,
  calls: CallRepository,
  now = () => new Date(),
): Router {
  const router = Router();
  router.use('/calls', authenticate);

  router.post('/calls', async (request, response, next) => {
    try {
      const input = createSchema.parse(request.body);
      const callerId = response.locals.userId as string;
      if (callerId === input.receiverId) {
        response.status(400).json({
          error: {
            code: 'INVALID_RECEIVER',
            message: 'Caller and receiver must differ',
          },
        });
        return;
      }
      if (!(await users.findById(input.receiverId))) {
        response.status(404).json({
          error: { code: 'USER_NOT_FOUND', message: 'Receiver not found' },
        });
        return;
      }
      const call = await calls.create({
        ...input,
        roomId: input.roomId.toUpperCase(),
        callerId,
        startedAt: now(),
      });
      response.status(201).json({ call });
    } catch (error) {
      next(error);
    }
  });

  router.get('/calls', async (_request, response, next) => {
    try {
      response.json({
        calls: await calls.findForUser(response.locals.userId as string),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/calls/:id', async (request, response, next) => {
    try {
      const call = await calls.findById(request.params.id);
      if (!call) {
        response.status(404).json(notFound);
        return;
      }
      if (!canAccess(call, response.locals.userId as string)) {
        response.status(403).json(forbidden);
        return;
      }
      response.json({ call });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/calls/:id/status', async (request, response, next) => {
    try {
      const { status } = statusSchema.parse(request.body);
      const call = await calls.findById(request.params.id);
      if (!call) {
        response.status(404).json(notFound);
        return;
      }
      if (!canAccess(call, response.locals.userId as string)) {
        response.status(403).json(forbidden);
        return;
      }
      if (!transitions[call.status].includes(status)) {
        response.status(409).json({
          error: {
            code: 'INVALID_TRANSITION',
            message: `Cannot transition ${call.status} to ${status}`,
          },
        });
        return;
      }
      response.json({ call: await calls.update(call.id, { status }) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/calls/:id/end', async (request, response, next) => {
    try {
      const call = await calls.findById(request.params.id);
      if (!call) {
        response.status(404).json(notFound);
        return;
      }
      if (!canAccess(call, response.locals.userId as string)) {
        response.status(403).json(forbidden);
        return;
      }
      if (call.status !== 'CONNECTED') {
        response.status(409).json({
          error: {
            code: 'INVALID_TRANSITION',
            message: 'Only connected calls can end',
          },
        });
        return;
      }
      const endedAt = now();
      const duration = Math.max(
        0,
        Math.floor((endedAt.getTime() - call.startedAt.getTime()) / 1000),
      );
      response.json({
        call: await calls.update(call.id, {
          status: 'ENDED',
          endedAt,
          duration,
        }),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
