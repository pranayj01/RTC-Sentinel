import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogFields = Record<string, boolean | number | string | null | undefined>;

function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    return { errorName: error.name, errorMessage: error.message };
  }
  return { errorMessage: String(error) };
}

export function logEvent(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
  error?: unknown,
): void {
  if (process.env.NODE_ENV === 'test' && process.env.LOG_TEST_EVENTS !== 'true')
    return;
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
    ...(error === undefined ? {} : errorFields(error)),
  });
  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else console.log(entry);
}

export function logRequests(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const requestId = randomUUID();
  const startedAt = Date.now();
  response.setHeader('X-Request-Id', requestId);
  response.once('finish', () => {
    if (request.path === '/health') return;
    logEvent('info', 'http_request_completed', {
      requestId,
      method: request.method,
      path: request.path,
      status: response.statusCode,
      durationMs: Date.now() - startedAt,
      userId: response.locals.userId as string | undefined,
    });
  });
  next();
}
