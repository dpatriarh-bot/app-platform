// ============================================================
// mailings/schemas.ts — Zod-схемы для рассылок
// ============================================================

import { z } from 'zod';

const segmentSchema = z.object({
  roles: z.array(z.enum(['parent', 'manager', 'curator', 'admin', 'superadmin'])).optional(),
  statuses: z.array(z.enum(['pending', 'active', 'blocked', 'deleted'])).optional(),
  subscriptionStatuses: z.array(z.enum(['pending', 'active', 'past_due', 'canceled', 'expired'])).optional(),
  hasChildren: z.boolean().optional(),
  childGradeMin: z.coerce.number().int().min(1).max(11).optional(),
  childGradeMax: z.coerce.number().int().min(1).max(11).optional(),
  registeredAfter: z.string().datetime().optional(),
  registeredBefore: z.string().datetime().optional(),
});

export const createMailTemplateSchema = z.object({
  code: z.string().min(2).max(64).regex(/^[a-z0-9_-]+$/),
  name: z.string().min(2).max(128),
  subject: z.string().min(2).max(255),
  bodyHtml: z.string().min(10).max(50000),
  bodyText: z.string().max(20000).optional().or(z.literal('')),
  variables: z.array(z.string().max(64)).max(50).optional().default([]),
  isActive: z.boolean().optional().default(true),
});

export const updateMailTemplateSchema = createMailTemplateSchema.partial().omit({ code: true });

export const createMailingSchema = z.object({
  name: z.string().min(2).max(255),
  templateId: z.string().uuid().optional(),
  channel: z.enum(['email', 'sms']).optional().default('email'),
  segment: segmentSchema.optional().default({}),
  subject: z.string().max(255).optional(),
  bodyHtml: z.string().max(50000).optional(),
  scheduledAt: z.string().datetime().optional(),
});

export const listMailingsQuerySchema = z.object({
  status: z.enum(['draft', 'scheduled', 'sending', 'sent', 'failed', 'canceled']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const previewSegmentSchema = z.object({
  segment: segmentSchema.optional().default({}),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export type CreateMailTemplateInput = z.infer<typeof createMailTemplateSchema>;
export type UpdateMailTemplateInput = z.infer<typeof updateMailTemplateSchema>;
export type CreateMailingInput = z.infer<typeof createMailingSchema>;
export type ListMailingsQuery = z.infer<typeof listMailingsQuerySchema>;
export type PreviewSegmentInput = z.infer<typeof previewSegmentSchema>;