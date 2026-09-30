// ============================================================
// reset.ts — полный сброс БД (только dev!)
// Запуск: npm run db:reset
// ============================================================

import postgres from 'postgres';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

async function reset() {
  if (config.isProd) {
    logger.error('db:reset запрещён в production');
    process.exit(1);
  }

  logger.warn('⚠️  Полный сброс БД');
  const sql = postgres(config.DATABASE_URL, { max: 1 });

  try {
    await sql`DROP SCHEMA IF EXISTS public CASCADE`;
    await sql`DROP SCHEMA IF EXISTS audit CASCADE`;
    await sql`DROP SCHEMA IF EXISTS analytics CASCADE`;
    await sql`CREATE SCHEMA public`;
    await sql`CREATE SCHEMA audit`;
    await sql`CREATE SCHEMA analytics`;
    await sql`GRANT ALL ON SCHEMA public TO public`;
    await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
    await sql`CREATE EXTENSION IF NOT EXISTS citext`;
    await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
    await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;
    await sql`CREATE EXTENSION IF NOT EXISTS btree_gin`;
    logger.info('✅ БД сброшена. Запустите npm run db:migrate && npm run db:seed');
  } catch (err) {
    logger.error({ err }, 'reset failed');
    process.exit(1);
  } finally {
    await sql.end();
  }
}

reset();