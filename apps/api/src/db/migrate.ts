// ============================================================
// migrate.ts — применение миграций Drizzle
// Запуск: npm run db:migrate
// ============================================================

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

async function run() {
  logger.info('starting migrations');

  const migrationClient = postgres(config.DATABASE_URL, { max: 1 });
  const db = drizzle(migrationClient);

  try {
    await migrate(db, { migrationsFolder: './src/db/migrations' });
    logger.info('✅ migrations applied');
  } catch (err) {
    logger.error({ err }, '❌ migration failed');
    process.exit(1);
  } finally {
    await migrationClient.end();
  }
}

run();