// ============================================================
// crypto.ts — шифрование PII, HMAC-хеши, генерация токенов
// AES-256-GCM для PII, HMAC-SHA256 для поиска, random для токенов.
// ============================================================

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { config } from '../config.js';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = Buffer.from(config.PII_ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) {
    throw new Error('PII_ENCRYPTION_KEY must be 32 bytes (base64)');
  }
  return key;
}

function getHashKey(): Buffer {
  const key = Buffer.from(config.PII_HASH_KEY, 'base64');
  if (key.length < 32) {
    throw new Error('PII_HASH_KEY must be at least 32 bytes (base64)');
  }
  return key;
}

export function encryptPII(plaintext: string): string {
  if (!plaintext) return '';
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptPII(payload: string): string | null {
  if (!payload) return '';
  try {
    const buf = Buffer.from(payload, 'base64');
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const data = buf.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv(ALGO, getEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

export function hashPII(value: string): string {
  const normalized = normalizePII(value);
  return createHmac('sha256', getHashKey()).update(normalized).digest('hex');
}

function normalizePII(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hmacSign(payload: string, secret?: string): string {
  const key = secret ?? config.CSRF_SECRET;
  return createHmac('sha256', key).update(payload).digest('base64url');
}

export function hmacVerify(payload: string, signature: string, secret?: string): boolean {
  const expected = hmacSign(payload, secret);
  return safeEqual(expected, signature);
}

export function maskPhone(phone: string): string {
  if (phone.length < 6) return '***';
  return phone.slice(0, 4) + '***' + phone.slice(-2);
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return '***';
  const visible = user.slice(0, 2);
  return `${visible}***@${domain}`;
}

export function maskName(name: string): string {
  return name
    .split(/\s+/)
    .filter((p) => p.length > 0)
    .map((part) => part[0] + '***')
    .join(' ');
}