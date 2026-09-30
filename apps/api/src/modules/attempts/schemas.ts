// ============================================================
// attempts/schemas.ts — Zod-схемы для попыток тестов
// ============================================================

import { z } from 'zod';

export const fraudSignalSchema = z.enum([
  'focus_lost',
  'copy_paste',
  'devtools_open',
  'fast_answer',
  'uniform_timing',
  'no_mouse_activity',
  'paste_answer',
  'ip_change',
  'parallel_session',
  'ua_change',
  'suspicious_ua',
]);

export const startAttemptSchema = z.object({
  testId: z.string().uuid(),
  childId: z.string().uuid(),
  deviceFingerprint: z.string().max(64).optional(),
  screenWidth: z.coerce.number().int().min(0).max(10000).optional(),
  screenHeight: z.coerce.number().int().min(0).max(10000).optional(),
  timezone: z.string().max(64).optional(),
});

export const saveAnswerSchema = z.object({
  questionId: z.string().uuid(),
  answer: z.unknown(),
  timeSpentMs: z.coerce.number().int().min(0).max(3600_000),
  changesCount: z.coerce.number().int().min(0).max(1000).optional().default(0),
});

export const logEventSchema = z.object({
  type: fraudSignalSchema,
  questionId: z.string().uuid().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const finishAttemptSchema = z.object({
  reason: z.enum(['completed', 'timeout', 'manual']).default('completed'),
});

export const listAttemptsQuerySchema = z.object({
  childId: z.string().uuid().optional(),
  testId: z.string().uuid().optional(),
  status: z
    .enum(['in_progress', 'finished', 'abandoned', 'flagged', 'blocked'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const resumeAttemptSchema = z.object({
  attemptId: z.string().uuid(),
});

export const flagAttemptSchema = z.object({
  action: z.enum(['approve', 'reject', 'reset_points']),
  notes: z.string().max(1000).optional(),
});

export type StartAttemptInput = z.infer<typeof startAttemptSchema>;
export type SaveAnswerInput = z.infer<typeof saveAnswerSchema>;
export type LogEventInput = z.infer<typeof logEventSchema>;
export type FinishAttemptInput = z.infer<typeof finishAttemptSchema>;
export type ListAttemptsQuery = z.infer<typeof listAttemptsQuerySchema>;
export type FlagAttemptInput = z.infer<typeof flagAttemptSchema>;