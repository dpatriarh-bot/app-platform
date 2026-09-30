// ============================================================
// password.ts — хеширование паролей Argon2id (OWASP 2024)
// ============================================================

import { hash, verify, Algorithm } from '@node-rs/argon2';

const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hashStr: string, password: string): Promise<boolean> {
  try {
    return await verify(hashStr, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d!@#$%^&*()_\-+=]{8,}$/;

export interface PasswordValidation {
  valid: boolean;
  errors: string[];
}

export function validatePassword(password: string, confirm?: string): PasswordValidation {
  const errors: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Пароль должен содержать минимум ${PASSWORD_MIN_LENGTH} символов`);
  }
  if (!/[A-Za-z]/.test(password)) {
    errors.push('Пароль должен содержать хотя бы одну латинскую букву');
  }
  if (!/\d/.test(password)) {
    errors.push('Пароль должен содержать хотя бы одну цифру');
  }
  if (confirm !== undefined && password !== confirm) {
    errors.push('Пароли не совпадают');
  }
  return { valid: errors.length === 0, errors };
}