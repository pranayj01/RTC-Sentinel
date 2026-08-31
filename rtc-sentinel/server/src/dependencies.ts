import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';

export const prisma = new PrismaClient();
export const redis = createClient({
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
});

redis.on('error', (error) => {
  console.error('Redis error', error);
});

export async function connectDependencies(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
  await redis.connect();
  await redis.ping();
}

export async function disconnectDependencies(): Promise<void> {
  if (redis.isOpen) await redis.quit();
  await prisma.$disconnect();
}

