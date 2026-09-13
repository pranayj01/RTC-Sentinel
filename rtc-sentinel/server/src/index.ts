import { app } from './app.js';
import {
  connectDependencies,
  disconnectDependencies,
  prisma,
  redis,
} from './dependencies.js';
import { createServer } from 'node:http';
import { attachSignaling } from './signaling.js';
import {
  MemoryRealtimeStateStore,
  RedisRealtimeStateStore,
  ResilientRealtimeStateStore,
} from './realtimeState.js';
import { PrismaMetricRepository } from './metrics/metricRepository.js';
import { validateProductionSecurity } from './security.js';
import { logEvent } from './logger.js';
import { PrismaRealtimeCallLifecycle } from './calls/realtimeLifecycle.js';

const port = Number(process.env.PORT ?? 3000);

async function start(): Promise<void> {
  validateProductionSecurity();
  const { redisAvailable } = await connectDependencies();
  const server = createServer(app);
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  const realtimeTtlSeconds = Number(process.env.REALTIME_TTL_SECONDS ?? 3600);
  const resumeTtlSeconds = Number(process.env.RESUME_TOKEN_TTL_SECONDS ?? 120);
  const memoryState = new MemoryRealtimeStateStore(
    realtimeTtlSeconds,
    undefined,
    resumeTtlSeconds,
  );
  const realtimeState = redisAvailable
    ? new ResilientRealtimeStateStore(
        new RedisRealtimeStateStore(
          redis,
          realtimeTtlSeconds,
          resumeTtlSeconds,
        ),
        memoryState,
      )
    : memoryState;
  const signaling = attachSignaling(
    server,
    realtimeState,
    new PrismaMetricRepository(prisma),
    {},
    new PrismaRealtimeCallLifecycle(prisma),
  );
  server.listen(port, () => {
    logEvent('info', 'api_started', {
      port,
      realtimeState: redisAvailable ? 'redis-with-memory-fallback' : 'memory',
    });
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logEvent('info', 'api_shutdown_started', { signal });
    const force = setTimeout(() => {
      logEvent('error', 'api_shutdown_forced');
      server.closeAllConnections();
    }, 10_000);
    force.unref();
    signaling.io.close(() => {
      clearTimeout(force);
      void disconnectDependencies().finally(() => {
        logEvent('info', 'api_shutdown_completed', { signal });
        process.exit(0);
      });
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error: unknown) => {
  logEvent('error', 'api_startup_failed', {}, error);
  process.exit(1);
});
