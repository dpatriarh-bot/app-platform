// ============================================================
// queues.ts — BullMQ очереди
// Единая точка создания очередей: fraud, mailings, payments,
// reminders, notifications, scheduler.
// ============================================================

import { Queue, type QueueOptions } from 'bullmq';
import { config } from '../config.js';
import { logger } from './logger.js';

const connection = {
  host: new URL(config.REDIS_URL).hostname,
  port: parseInt(new URL(config.REDIS_URL).port || '6379', 10),
  password: new URL(config.REDIS_URL).password || undefined,
};

const defaultOptions: QueueOptions = {
  connection,
  prefix: `${config.REDIS_PREFIX}bull`,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 1000, age: 24 * 3600 },
    removeOnFail: { count: 5000, age: 7 * 24 * 3600 },
  },
};

export const fraudQueue = new Queue('fraud', defaultOptions);
export const mailingsQueue = new Queue('mailings', defaultOptions);
export const paymentsQueue = new Queue('payments', defaultOptions);
export const remindersQueue = new Queue('reminders', defaultOptions);
export const notificationsQueue = new Queue('notifications', defaultOptions);
export const schedulerQueue = new Queue('scheduler', defaultOptions);

export const allQueues = [
  fraudQueue,
  mailingsQueue,
  paymentsQueue,
  remindersQueue,
  notificationsQueue,
  schedulerQueue,
];

export async function closeQueues(): Promise<void> {
  await Promise.all(allQueues.map((q) => q.close()));
  logger.info('queues closed');
}

logger.info('queues initialized');