// ============================================================
// gen-keys.ts — генерация секретов для .env
// Запуск: npx tsx scripts/gen-keys.ts
// ============================================================

import { randomBytes } from 'node:crypto';

const keys = {
  JWT_ACCESS_SECRET: randomBytes(48).toString('base64'),
  JWT_REFRESH_SECRET: randomBytes(48).toString('base64'),
  PII_HASH_KEY: randomBytes(32).toString('base64'),
  PII_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  SESSION_SECRET: randomBytes(48).toString('base64'),
  CSRF_SECRET: randomBytes(48).toString('base64'),
  REDIS_PASSWORD: randomBytes(24).toString('base64url'),
  POSTGRES_PASSWORD: randomBytes(24).toString('base64url'),
  MINIO_ROOT_PASSWORD: randomBytes(24).toString('base64url'),
};

// eslint-disable-next-line no-console
console.log('# Сгенерированные секреты — вставьте в .env\n');
for (const [key, value] of Object.entries(keys)) {
  // eslint-disable-next-line no-console
  console.log(`${key}=${value}`);
}