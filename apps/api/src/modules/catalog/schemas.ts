// ============================================================
// catalog/schemas.ts — Zod-схемы каталога подарков
// ============================================================

import { z } from 'zod';

export const redemptionTypeSchema = z.enum(['qr', 'promo', 'referral', 'manual']);

export const redeemSchema = z.object({
  offerId: z.string().uuid(),
  childId: z.string().uuid(),
  redemptionType: redemptionTypeSchema.optional(),
});

export const catalogQuerySchema = z.object({
  partnerId: z.string().uuid().optional(),
  q: z.string().max(200).optional(),
  maxCost: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const redemptionsQuerySchema = z.object({
  childId: z.string().uuid().optional(),
  status: z.enum(['issued', 'redeemed', 'expired', 'canceled']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type RedeemInput = z.infer<typeof redeemSchema>;
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
export type RedemptionsQuery = z.infer<typeof redemptionsQuerySchema>;