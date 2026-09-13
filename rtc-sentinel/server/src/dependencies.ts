import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import { logEvent } from './logger.js';
import { withRetry } from './reliability.js';

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const prisma = new PrismaClient();
export const redis = createClient({
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  disableOfflineQueue: true,
  socket: {
    connectTimeout: positiveInteger(
      process.env.REDIS_CONNECT_TIMEOUT_MS,
      2_000,
    ),
    reconnectStrategy: false,
  },
});

redis.on('error', (error) => {
  logEvent('warn', 'redis_error', {}, error);
});

export async function connectDependencies(): Promise<{
  redisAvailable: boolean;
}> {
  await withRetry(() => prisma.$queryRaw`SELECT 1`, {
    attempts: positiveInteger(process.env.DATABASE_CONNECT_ATTEMPTS, 5),
    baseDelayMs: 500,
    maxDelayMs: 4_000,
    onRetry: (error, nextAttempt, delayMs) =>
      logEvent(
        'warn',
        'database_connect_retry',
        { nextAttempt, delayMs },
        error,
      ),
  });

  try {
    await withRetry(
      async () => {
        if (!redis.isOpen) await redis.connect();
        await redis.ping();
      },
      {
        attempts: positiveInteger(process.env.REDIS_CONNECT_ATTEMPTS, 3),
        baseDelayMs: 250,
        maxDelayMs: 1_000,
        onRetry: (error, nextAttempt, delayMs) =>
          logEvent(
            'warn',
            'redis_connect_retry',
            { nextAttempt, delayMs },
            error,
          ),
      },
    );
    return { redisAvailable: true };
  } catch (error) {
    logEvent('warn', 'redis_startup_degraded', { fallback: 'memory' }, error);
    return { redisAvailable: false };
  }
}

export async function disconnectDependencies(): Promise<void> {
  const results = await Promise.allSettled([
    redis.isOpen ? redis.quit() : Promise.resolve(),
    prisma.$disconnect(),
  ]);
  for (const result of results) {
    if (result.status === 'rejected')
      logEvent('warn', 'dependency_disconnect_failed', {}, result.reason);
  }
}
