// ============================================================
// password-reset.ts — подпись и проверка токена сброса пароля
// (дополнительный слой поверх БД-записи)
// ============================================================

import { hmacSign, hmacVerify } from './crypto.js';
import { config } from '../config.js';

export function signPasswordResetToken(userId: string, jti: string): string {
  const payload = `${userId}.${jti}`;
  const sig = hmacSign(payload, config.SESSION_SECRET);
  return `${payload}.${sig}`;
}

export function verifyPasswordResetToken(token: string): { userId: string; jti: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, jti, sig] = parts as [string, string, string];
  if (!hmacVerify(`${userId}.${jti}`, sig, config.SESSION_SECRET)) return null;
  return { userId, jti };
}