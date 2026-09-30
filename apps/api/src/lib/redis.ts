// ============================================================
// redis.ts — клиент Redis с префиксом и graceful shutdown
// ============================================================

import Redis from 'ioredis';
import { config } from '../config.js';
import { logger } from './logger.js';

export const redis = new Redis(config.REDIS_URL, {
  keyPrefix: config.REDIS_PREFIX,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
  retryStrategy(times) {
    const delay = Math.min(times * 100, 3000);
    logger.warn({ times, delay }, 'redis reconnect');
    return delay;
  },
});

redis.on('error', (err) => logger.error({ err }, 'redis error'));
redis.on('connect', () => logger.info('redis connected'));
redis.on('ready', () => logger.info('redis ready'));

export async function pingRedis(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch (err) {
    logger.error({ err }, 'redis ping failed');
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  await redis.quit();
  logger.info('redis connection closed');
}