// ============================================================
// users/schemas.ts — Zod-схемы для профиля, детей, экспорта
// + активные сессии
// ============================================================

import { z } from 'zod';

export const updateProfileSchema = z.object({
  email: z.string().email('Некорректный формат почты').max(255).optional(),
  fullName: z.string().min(2, 'Укажите ФИО').max(200).optional(),
  city: z.string().max(128).optional().or(z.literal('')),
});

export const updateChildSchema = z.object({
  fullName: z.string().min(2, 'Укажите ФИО ребёнка').max(200).optional(),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Формат ГГГГ-ММ-ДД')
    .refine((v) => {
      const d = new Date(v);
      return !isNaN(d.getTime()) && d < new Date();
    }, 'Некорректная дата')
    .optional(),
  city: z.string().max(128).optional().or(z.literal('')),
  school: z.string().max(255).optional().or(z.literal('')),
  grade: z.coerce.number().int().min(1).max(11).optional(),
});

export const createChildSchema = z.object({
  fullName: z.string().min(2, 'Укажите ФИО ребёнка').max(200),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Формат ГГГГ-ММ-ДД')
    .refine((v) => {
      const d = new Date(v);
      return !isNaN(d.getTime()) && d < new Date();
    }, 'Некорректная дата'),
  city: z.string().max(128).optional().or(z.literal('')),
  school: z.string().max(255).optional().or(z.literal('')),
  grade: z.coerce.number().int().min(1).max(11).optional(),
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Введите пароль'),
  confirm: z.literal('УДАЛИТЬ', {
    errorMap: () => ({ message: 'Введите слово УДАЛИТЬ для подтверждения' }),
  }),
  reason: z.string().max(500).optional(),
});

export const revokeSessionSchema = z.object({
  sessionId: z.string().uuid(),
});

export const revokeOtherSessionsSchema = z.object({
  keepSessionId: z.string().uuid().optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdateChildInput = z.infer<typeof updateChildSchema>;
export type CreateChildInput = z.infer<typeof createChildSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;