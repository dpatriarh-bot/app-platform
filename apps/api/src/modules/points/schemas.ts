// ============================================================
// points/schemas.ts — Zod-схемы для модуля баллов
// ============================================================

import { z } from 'zod';

export const pointsReasonSchema = z.enum([
  'attempt_reward',
  'manual_adjust',
  'redemption',
  'referral_bonus',
  'spot_check_confirmed',
  'fraud_reversal',
  'signup_bonus',
]);

export const ledgerQuerySchema = z.object({
  childId: z.string().uuid().optional(),
  reason: pointsReasonSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const manualAdjustSchema = z.object({
  childId: z.string().uuid(),
  delta: z.coerce.number().int().min(-10000).max(10000).refine((v) => v !== 0, {
    message: 'Изменение не может быть нулевым',
  }),
  reason: z.string().min(3).max(500),
});

export const balanceQuerySchema = z.object({
  childId: z.string().uuid(),
});

export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;
export type ManualAdjustInput = z.infer<typeof manualAdjustSchema>;