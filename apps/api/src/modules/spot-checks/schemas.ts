// ============================================================
// spot-checks/schemas.ts — Zod-схемы очных проверок
// Добавлена схема kiosk-токена.
// ============================================================

import { z } from 'zod';

export const scheduleSpotCheckSchema = z.object({
  childId: z.string().uuid(),
  scheduledAt: z.string().datetime(),
  relatedAttemptIds: z.array(z.string().uuid()).max(50).optional().default([]),
  timeLimitSec: z.coerce.number().int().min(300).max(3600).optional().default(1200),
  curatorId: z.string().uuid().optional(),
  notes: z.string().max(1000).optional(),
});

export const startSpotCheckSchema = z.object({
  spotCheckId: z.string().uuid(),
});

export const kioskStartSchema = z.object({
  token: z.string().min(20),
});

export const saveSpotAnswerSchema = z.object({
  questionId: z.string().uuid(),
  answer: z.unknown(),
  timeSpentMs: z.coerce.number().int().min(0).max(3600_000),
});

export const finishSpotCheckSchema = z.object({
  reason: z.enum(['completed', 'timeout', 'manual']).default('completed'),
});

export const setVerdictSchema = z.object({
  verdict: z.enum(['confirmed', 'rejected', 'partial']),
  notes: z.string().max(2000).optional(),
  revokeAttemptIds: z.array(z.string().uuid()).max(50).optional().default([]),
});

export const listSpotChecksQuerySchema = z.object({
  childId: z.string().uuid().optional(),
  curatorId: z.string().uuid().optional(),
  status: z.enum(['scheduled', 'in_progress', 'completed', 'canceled']).optional(),
  verdict: z.enum(['pending', 'confirmed', 'rejected', 'partial']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type ScheduleSpotCheckInput = z.infer<typeof scheduleSpotCheckSchema>;
export type SetVerdictInput = z.infer<typeof setVerdictSchema>;
export type ListSpotChecksQuery = z.infer<typeof listSpotChecksQuerySchema>;