import { app } from './app.js';
import {
  connectDependencies,
  disconnectDependencies,
  prisma,
  redis,
} from './dependencies.js';
import { createServer } from 'node:http';
import { attachSignaling } from './signaling.js';
import { RedisRealtimeStateStore } from './realtimeState.js';
import { PrismaMetricRepository } from './metrics/metricRepository.js';
import { validateProductionSecurity } from './security.js';

const port = Number(process.env.PORT ?? 3000);

async function start(): Promise<void> {
  validateProductionSecurity();
  await connectDependencies();
  const server = createServer(app);
  const realtimeTtlSeconds = Number(process.env.REALTIME_TTL_SECONDS ?? 3600);
  attachSignaling(
    server,
    new RedisRealtimeStateStore(redis, realtimeTtlSeconds),
    new PrismaMetricRepository(prisma),
  );
  server.listen(port, () => {
    console.log(`RTC Sentinel API listening on port ${port}`);
  });

  const shutdown = () => {
    server.close(() => {
      void disconnectDependencies().finally(() => process.exit(0));
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((error: unknown) => {
  console.error('API startup failed', error);
  process.exit(1);
});
