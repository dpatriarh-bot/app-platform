// ============================================================
// captcha.ts — проверка капчи
// PoW с одноразовым challenge в Redis.
// ============================================================

import { randomBytes, createHash } from 'node:crypto';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { redis } from '../../lib/redis.js';

export interface CaptchaVerifyResult {
  success: boolean;
  reason?: string;
}

export async function verifyCaptcha(
  token: string | undefined,
  remoteIp: string
): Promise<CaptchaVerifyResult> {
  if (config.CAPTCHA_PROVIDER === 'stub') {
    return { success: true };
  }

  if (!token) {
    return { success: false, reason: 'missing_token' };
  }

  if (config.CAPTCHA_PROVIDER === 'hcaptcha') {
    return verifyHcaptcha(token, remoteIp);
  }

  if (config.CAPTCHA_PROVIDER === 'pow') {
    return verifyPow(token);
  }

  return { success: false, reason: 'unknown_provider' };
}

async function verifyHcaptcha(
  token: string,
  remoteIp: string
): Promise<CaptchaVerifyResult> {
  try {
    const body = new URLSearchParams({
      secret: config.CAPTCHA_SECRET,
      response: token,
      remoteip: remoteIp,
    });

    const res = await fetch('https://hcaptcha.com/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    const data = (await res.json()) as { success: boolean; 'error-codes'?: string[] };
    if (!data.success) {
      return { success: false, reason: (data['error-codes'] ?? []).join(',') };
    }
    return { success: true };
  } catch (err) {
    logger.error({ err }, 'hcaptcha verify failed');
    return { success: false, reason: 'network_error' };
  }
}

const POW_DIFFICULTY = 4;
const POW_TTL_SEC = 300;

/**
 * PoW: sha256(challenge + nonce) с POW_DIFFICULTY ведущих нулей.
 * Формат токена: "<challenge>.<nonce>".
 * Challenge выдаётся generatePowChallenge и удаляется при проверке.
 */
async function verifyPow(token: string): Promise<CaptchaVerifyResult> {
  const parts = token.split('.');
  if (parts.length !== 2) return { success: false, reason: 'malformed' };

  const [challenge, nonce] = parts as [string, string];
  if (!challenge || !nonce) return { success: false, reason: 'malformed' };

  // Одноразовость: удаляем challenge; если его не было — отказ.
  const deleted = await redis.del(`pow:${challenge}`);
  if (deleted === 0) {
    return { success: false, reason: 'challenge_not_found_or_used' };
  }

  const hash = createHash('sha256').update(`${challenge}${nonce}`).digest('hex');
  if (!hash.startsWith('0'.repeat(POW_DIFFICULTY))) {
    return { success: false, reason: 'insufficient_work' };
  }

  return { success: true };
}

export async function generatePowChallenge(): Promise<{
  challenge: string;
  difficulty: number;
}> {
  const challenge = randomBytes(16).toString('hex');
  await redis.setex(`pow:${challenge}`, POW_TTL_SEC, '1');
  return { challenge, difficulty: POW_DIFFICULTY };
}