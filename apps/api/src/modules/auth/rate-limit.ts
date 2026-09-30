// ============================================================
// auth/rate-limit.ts — точечные лимиты на чувствительные ручки
// Работает поверх @fastify/rate-limit, но с Redis-ключами
// по логину/IP, а не только по IP.
// ============================================================

import { redis } from '../../lib/redis.js';
import { config } from '../../config.js';

export interface LimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * Инкрементирует счётчик и проверяет лимит.
 * Ключ — комбинация префикса и идентификатора (IP, телефон).
 */
export async function checkLimit(
  key: string,
  max: number,
  windowSec: number
): Promise<LimitResult> {
  const redisKey = `rl:${key}`;
  const count = await redis.incr(redisKey);

  if (count === 1) {
    await redis.expire(redisKey, windowSec);
  }

  const ttl = await redis.ttl(redisKey);
  const allowed = count <= max;

  return {
    allowed,
    remaining: Math.max(0, max - count),
    retryAfterSec: ttl > 0 ? ttl : windowSec,
  };
}

export async function loginLimit(identifier: string, ip: string): Promise<LimitResult> {
  // Сначала по логину, потом по IP — оба должны пройти
  const byLogin = await checkLimit(
    `login:${identifier}`,
    config.RATE_LIMIT_LOGIN_MAX,
    config.RATE_LIMIT_LOGIN_WINDOW
  );
  if (!byLogin.allowed) return byLogin;

  const byIp = await checkLimit(
    `login-ip:${ip}`,
    config.RATE_LIMIT_LOGIN_MAX * 3,
    config.RATE_LIMIT_LOGIN_WINDOW
  );
  return byIp;
}

export async function registerLimit(ip: string): Promise<LimitResult> {
  return checkLimit(
    `register:${ip}`,
    config.RATE_LIMIT_REGISTER_MAX,
    config.RATE_LIMIT_REGISTER_WINDOW
  );
}

export async function forgotLimit(identifier: string, ip: string): Promise<LimitResult> {
  const byId = await checkLimit(`forgot:${identifier}`, 3, 3600);
  if (!byId.allowed) return byId;
  return checkLimit(`forgot-ip:${ip}`, 10, 3600);
}

export async function resetLimit(token: string, ip: string): Promise<LimitResult> {
  return checkLimit(`reset:${ip}:${token.slice(0, 16)}`, 5, 900);
}

export async function resetAttempts(key: string): Promise<void> {
  await redis.del(`rl:${key}`);
}