// ============================================================
// payments/schemas.ts — Zod-схемы для платежей и подписок
// ============================================================

import { z } from 'zod';

export const subscribeSchema = z.object({
  planCode: z.string().min(1).max(32).optional().default('monthly'),
  returnUrl: z.string().url().max(500).optional(),
});

export const cancelSubscriptionSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const paymentsHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  status: z.enum(['pending', 'succeeded', 'failed', 'refunded']).optional(),
});

export const webhookBodySchema = z.record(z.string(), z.unknown());

export type SubscribeInput = z.infer<typeof subscribeSchema>;
export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>;
export type PaymentsHistoryQuery = z.infer<typeof paymentsHistoryQuerySchema>;