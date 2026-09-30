// ============================================================
// drizzle.config.ts — конфигурация Drizzle Kit для миграций
// Самодостаточный: не импортирует src/config.ts, чтобы
// drizzle-kit не тянул Zod-валидацию и полный env приложения.
// ============================================================

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgres://ulybka:dummy@localhost:5432/ulybka',
  },
  verbose: true,
  strict: true,
  casing: 'snake_case',
});