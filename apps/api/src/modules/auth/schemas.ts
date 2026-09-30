// ============================================================
// auth/schemas.ts — Zod-схемы auth
// + согласие с офертой (consentVersion), SMS-восстановление.
// ============================================================

import { z } from 'zod';
import { PASSWORD_MIN_LENGTH } from '../../lib/password.js';

export const CONSENT_VERSION = '1.0';

const phoneSchema = z
  .string()
  .min(10, 'Укажите телефон')
  .max(20, 'Телефон слишком длинный')
  .refine(
    (v) => /^(\+7|8|7)?[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-()]*\d{2}[\s\-()]*\d{2}$/.test(v),
    'Некорректный формат телефона'
  );

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Пароль должен содержать минимум ${PASSWORD_MIN_LENGTH} символов`)
  .regex(/[A-Za-z]/, 'Пароль должен содержать хотя бы одну латинскую букву')
  .regex(/\d/, 'Пароль должен содержать хотя бы одну цифру')
  .max(128, 'Пароль слишком длинный');

const emailSchema = z.string().email('Некорректный формат почты').max(255);

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата должна быть в формате ГГГГ-ММ-ДД')
  .refine((v) => {
    const d = new Date(v);
    return !isNaN(d.getTime()) && d < new Date();
  }, 'Некорректная дата рождения');

export const childSchema = z.object({
  fullName: z.string().min(2, 'Укажите ФИО ребёнка').max(200),
  birthDate: dateSchema,
  city: z.string().min(2).max(128).optional().or(z.literal('')),
  school: z.string().max(255).optional().or(z.literal('')),
  grade: z.coerce.number().int().min(1).max(11).optional(),
});

export const registerSchema = z
  .object({
    phone: phoneSchema,
    email: emailSchema,
    password: passwordSchema,
    passwordConfirm: z.string(),
    fullName: z.string().min(2, 'Укажите ФИО').max(200),
    city: z.string().min(2).max(128).optional().or(z.literal('')),
    child: childSchema,
    consent: z.literal(true, {
      errorMap: () => ({ message: 'Необходимо согласие с офертой' }),
    }),
    consentVersion: z.string().max(32).optional(),
    captchaToken: z.string().optional(),
  })
  .refine((d) => d.password === d.passwordConfirm, {
    message: 'Пароли не совпадают',
    path: ['passwordConfirm'],
  });

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, 'Введите пароль'),
  rememberMe: z.boolean().optional().default(false),
  totp: z.string().optional(),
  captchaToken: z.string().optional(),
});

export const forgotSchema = z.object({
  phone: phoneSchema,
  method: z.enum(['email', 'sms']).optional().default('email'),
  captchaToken: z.string().optional(),
});

export const resetSchema = z
  .object({
    token: z.string().min(16, 'Некорректный токен').optional(),
    phone: phoneSchema.optional(),
    code: z.string().regex(/^\d{6}$/, 'Код должен содержать 6 цифр').optional(),
    password: passwordSchema,
    passwordConfirm: z.string(),
  })
  .refine((d) => d.password === d.passwordConfirm, {
    message: 'Пароли не совпадают',
    path: ['passwordConfirm'],
  })
  .refine((d) => !!d.token || (!!d.phone && !!d.code), {
    message: 'Укажите токен или телефон+код',
    path: ['token'],
  });

export const totpEnableSchema = z.object({
  secret: z.string().min(16),
  code: z.string().regex(/^\d{6}$/, 'Код должен содержать 6 цифр'),
});

export const totpVerifySchema = z.object({
  code: z.string().min(6).max(10),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
    newPasswordConfirm: z.string(),
  })
  .refine((d) => d.newPassword === d.newPasswordConfirm, {
    message: 'Пароли не совпадают',
    path: ['newPasswordConfirm'],
  });

export const acceptConsentSchema = z.object({
  version: z.string().min(1).max(32),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotInput = z.infer<typeof forgotSchema>;
export type ResetInput = z.infer<typeof resetSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type AcceptConsentInput = z.infer<typeof acceptConsentSchema>;