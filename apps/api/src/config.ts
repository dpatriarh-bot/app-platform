// ============================================================
// config.ts — типизированная конфигурация с валидацией Zod
// ============================================================

import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(def)
    .transform((v) =>
      typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())
    );

const int = (def: number) =>
  z
    .union([z.number(), z.string()])
    .default(def)
    .transform((v) => (typeof v === 'number' ? v : parseInt(v, 10)))
    .pipe(z.number().int());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().default('Улыбка ребёнка'),
  APP_URL: z.string().url().default('http://localhost'),
  TZ: z.string().default('Europe/Moscow'),

  API_PORT: int(3000),
  API_HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MIN: int(2),
  DATABASE_POOL_MAX: int(20),
  DATABASE_STATEMENT_TIMEOUT_MS: int(30000),

  REDIS_URL: z.string().url(),
  REDIS_PREFIX: z.string().default('ulybka:'),

  MINIO_ENDPOINT: z.string().default('minio'),
  MINIO_PORT: int(9000),
  MINIO_USE_SSL: bool(false),
  MINIO_ROOT_USER: z.string(),
  MINIO_ROOT_PASSWORD: z.string(),
  MINIO_BUCKET: z.string().default('ulybka'),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  JWT_ISSUER: z.string().default('ulybka.ru'),
  JWT_AUDIENCE: z.string().default('ulybka-web'),

  PII_HASH_KEY: z.string().min(32),
  PII_ENCRYPTION_KEY: z.string().min(32),

  COOKIE_DOMAIN: z.string().default('localhost'),
  COOKIE_SECURE: bool(false),
  COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('strict'),
  SESSION_SECRET: z.string().min(32),

  CORS_ORIGIN: z.string().default('http://localhost'),
  CSRF_SECRET: z.string().min(32),

  RATE_LIMIT_GLOBAL_MAX: int(300),
  RATE_LIMIT_GLOBAL_WINDOW: int(60),
  RATE_LIMIT_LOGIN_MAX: int(5),
  RATE_LIMIT_LOGIN_WINDOW: int(900),
  RATE_LIMIT_REGISTER_MAX: int(3),
  RATE_LIMIT_REGISTER_WINDOW: int(3600),

  CAPTCHA_PROVIDER: z.enum(['stub', 'hcaptcha', 'pow']).default('stub'),
  CAPTCHA_SECRET: z.string().default(''),
  CAPTCHA_SITE_KEY: z.string().default(''),

  PAYMENT_PROVIDER: z.enum(['stub', 'yookassa', 'cloudpayments', 'tinkoff']).default('stub'),
  PAYMENT_STUB_ALWAYS_SUCCESS: bool(true),

  SMTP_HOST: z.string().default(''),
  SMTP_PORT: int(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_FROM: z.string().default('Улыбка ребёнка <noreply@ulybka.ru>'),
  SMTP_SECURE: bool(true),

  SMS_PROVIDER: z.enum(['stub', 'smsru', 'turbosms']).default('stub'),
  SMS_API_KEY: z.string().default(''),
  SMS_SENDER: z.string().default('ULYBKA'),

  FRAUD_ENABLED: bool(true),
  FRAUD_FLAG_THRESHOLD: int(30),
  FRAUD_BLOCK_THRESHOLD: int(70),
  FRAUD_MIN_ANSWER_TIME_MS: int(1500),
  FRAUD_FOCUS_LOST_LIMIT: int(3),
  FRAUD_PARALLEL_SESSION_BLOCK: bool(true),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_PRETTY: bool(true),

  UPLOAD_MAX_SIZE_MB: int(10),
  UPLOAD_ALLOWED_MIME: z
    .string()
    .default('image/png,image/jpeg,image/webp,application/pdf'),

  // Версия оферты. Меняется при юридически значимом обновлении,
  // форсирует ре-согласие у всех родителей.
  CONSENT_VERSION: z.string().default('1.0'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:');
  // eslint-disable-next-line no-console
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = Object.freeze({
  ...parsed.data,
  isDev: parsed.data.NODE_ENV === 'development',
  isProd: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
  uploadAllowedMime: parsed.data.UPLOAD_ALLOWED_MIME.split(',').map((s) => s.trim()),
  corsOrigins: parsed.data.CORS_ORIGIN.split(',').map((s) => s.trim()),
});

export type Config = typeof config;