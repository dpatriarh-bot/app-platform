// ============================================================
// client.ts — подключение к PostgreSQL через postgres.js + Drizzle
// Один пул на процесс, graceful shutdown.
// ============================================================

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import * as schema from './schema.js';

const queryClient = postgres(config.DATABASE_URL, {
  max: config.DATABASE_POOL_MAX,
  min: config.DATABASE_POOL_MIN,
  idle_timeout: 20,
  connect_timeout: 10,
  // prepare: true отключён — иначе postgres.js не может закодировать
  // Date в timestamptz через prepare/bind протокол.
  prepare: false,
  transform: {
    undefined: null,
  },
  onnotice: () => {
    // Игнорируем NOTICE от Postgres
  },
  debug: config.isDev
    ? (conn, query, params) => {
        logger.trace({ conn, query, params }, 'sql');
      }
    : undefined,
});

export const db = drizzle(queryClient, { schema, logger: false });

export type DB = typeof db;

/**
 * Проверка соединения (используется в /health).
 */
export async function pingDatabase(): Promise<boolean> {
  try {
    await queryClient`SELECT 1`;
    return true;
  } catch (err) {
    logger.error({ err }, 'database ping failed');
    return false;
  }
}

/**
 * Graceful shutdown.
 */
export async function closeDatabase(): Promise<void> {
  await queryClient.end({ timeout: 5 });
  logger.info('database connection closed');
}