// ============================================================
// partners/schemas.ts — Zod-схемы партнёрской панели
// ============================================================

import { z } from 'zod';

const slugRegex = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export const createPartnerSchema = z.object({
  slug: z.string().min(2).max(64).regex(slugRegex, 'Только латиница, цифры и дефис'),
  name: z.string().min(2).max(255),
  description: z.string().max(2000).optional().or(z.literal('')),
  logoUrl: z.string().url().optional().or(z.literal('')),
  websiteUrl: z.string().url().optional().or(z.literal('')),
  contactName: z.string().max(255).optional().or(z.literal('')),
  contactEmail: z.string().email().max(255).optional().or(z.literal('')),
  contactPhone: z.string().max(32).optional().or(z.literal('')),
});

export const updatePartnerSchema = createPartnerSchema.partial();

export const createOfferSchema = z.object({
  partnerId: z.string().uuid(),
  title: z.string().min(3).max(255),
  description: z.string().max(5000).optional().or(z.literal('')),
  imageUrl: z.string().url().optional().or(z.literal('')),
  costPoints: z.coerce.number().int().min(1).max(100000),
  stock: z.coerce.number().int().min(0).optional(),
  terms: z.string().max(2000).optional().or(z.literal('')),
  redemptionType: z.enum(['qr', 'promo', 'referral', 'manual']).default('qr'),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
});

export const updateOfferSchema = createOfferSchema.partial().omit({ partnerId: true });

export const verifyQrSchema = z.object({
  qrToken: z.string().min(20),
});

export const partnerPromoBatchSchema = z.object({
  partnerId: z.string().uuid(),
  offerId: z.string().uuid().optional(),
  name: z.string().min(2).max(128),
  codePrefix: z.string().max(16).optional(),
  totalCodes: z.coerce.number().int().min(1).max(100000),
  validUntil: z.string().datetime().optional(),
});

export const listPartnersQuerySchema = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(['pending', 'active', 'suspended']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type CreatePartnerInput = z.infer<typeof createPartnerSchema>;
export type UpdatePartnerInput = z.infer<typeof updatePartnerSchema>;
export type CreateOfferInput = z.infer<typeof createOfferSchema>;
export type UpdateOfferInput = z.infer<typeof updateOfferSchema>;
export type ListPartnersQuery = z.infer<typeof listPartnersQuerySchema>;
export type PartnerPromoBatchInput = z.infer<typeof partnerPromoBatchSchema>;