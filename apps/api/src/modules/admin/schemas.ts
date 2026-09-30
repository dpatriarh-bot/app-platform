// ============================================================
// admin/schemas.ts — Zod-схемы админ-модуля
// + bulkUserActionSchema, exportQuerySchema, changeOwnPasswordSchema.
// ============================================================

import { z } from 'zod';
import { PASSWORD_MIN_LENGTH } from '../../lib/password.js';

const phoneSchema = z
  .string()
  .min(10, 'Укажите телефон')
  .max(20, 'Телефон слишком длинный')
  .refine(
    (v) => /^(\+7|8|7)?[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-()]*\d{2}[\s\-()]*\d{2}$/.test(v),
    'Некорректный формат телефона'
  );

const emailSchema = z.string().email('Некорректный формат почты').max(255);

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Пароль должен содержать минимум ${PASSWORD_MIN_LENGTH} символов`)
  .regex(/[A-Za-z]/, 'Пароль должен содержать хотя бы одну латинскую букву')
  .regex(/\d/, 'Пароль должен содержать хотя бы одну цифру')
  .max(128, 'Пароль слишком длинный');

const userRoleSchema = z.enum([
  'parent',
  'partner',
  'manager',
  'curator',
  'admin',
  'superadmin',
]);

export const listUsersQuerySchema = z.object({
  q: z.string().max(200).optional(),
  role: userRoleSchema.optional(),
  status: z.enum(['pending', 'active', 'blocked', 'deleted']).optional(),
  hasSubscription: z.enum(['0', '1']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const setUserRoleSchema = z.object({
  role: userRoleSchema,
});

export const setUserStatusSchema = z.object({
  status: z.enum(['pending', 'active', 'blocked', 'deleted']),
  reason: z.string().max(500).optional(),
});

export const createUserSchema = z
  .object({
    role: userRoleSchema,
    phone: phoneSchema,
    email: emailSchema,
    fullName: z.string().min(2).max(200).optional(),
    city: z.string().max(128).optional(),
    partnerId: z.string().uuid().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === 'parent') {
      if (!data.fullName || data.fullName.trim().length < 2) {
        ctx.addIssue({
          code: 'custom',
          path: ['fullName'],
          message: 'Для родителя ФИО обязательно',
        });
      }
    }
    if (data.role === 'partner') {
      if (!data.partnerId) {
        ctx.addIssue({
          code: 'custom',
          path: ['partnerId'],
          message: 'Для роли «партнёр» нужно выбрать партнёра',
        });
      }
    }
  });

export const dashboardPeriodSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional().default(30),
});

export const listAuditQuerySchema = z.object({
  actorId: z.string().uuid().optional(),
  action: z.string().max(64).optional(),
  entity: z.string().max(64).optional(),
  entityId: z.string().max(64).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const adjustPointsSchema = z.object({
  delta: z.coerce.number().int().min(-100000).max(100000).refine((v) => v !== 0, {
    message: 'Значение не может быть 0',
  }),
  reason: z.string().min(3).max(500),
});

export const toggleFraudSchema = z.object({
  disabled: z.boolean(),
  reason: z.string().min(3).max(500),
});

export const bulkUserActionSchema = z
  .object({
    userIds: z.array(z.string().uuid()).min(1).max(500),
    action: z.enum(['block', 'unblock', 'restore', 'set_role']),
    role: userRoleSchema.optional(),
    reason: z.string().min(3).max(500),
  })
  .superRefine((data, ctx) => {
    if (data.action === 'set_role' && !data.role) {
      ctx.addIssue({
        code: 'custom',
        path: ['role'],
        message: 'role обязателен для set_role',
      });
    }
  });

export const exportQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50000).optional().default(5000),
});

// ---------- Смена собственного пароля (superadmin) ----------

export const changeOwnPasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Введите текущий пароль'),
    newPassword: passwordSchema,
    newPasswordConfirm: z.string(),
  })
  .refine((d) => d.newPassword === d.newPasswordConfirm, {
    message: 'Пароли не совпадают',
    path: ['newPasswordConfirm'],
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'Новый пароль должен отличаться от текущего',
    path: ['newPassword'],
  });

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type AdjustPointsInput = z.infer<typeof adjustPointsSchema>;
export type ToggleFraudInput = z.infer<typeof toggleFraudSchema>;
export type BulkUserActionInput = z.infer<typeof bulkUserActionSchema>;
export type ExportQuery = z.infer<typeof exportQuerySchema>;
export type ChangeOwnPasswordInput = z.infer<typeof changeOwnPasswordSchema>;