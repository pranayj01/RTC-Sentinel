import { app } from './app.js';
import { connectDependencies, disconnectDependencies } from './dependencies.js';

const port = Number(process.env.PORT ?? 3000);

async function start(): Promise<void> {
  await connectDependencies();
  const server = app.listen(port, () => {
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

