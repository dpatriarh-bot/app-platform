// ============================================================
// audit/schemas.ts — Zod-схемы аудита
// ============================================================

import { z } from 'zod';

export const auditQuerySchema = z.object({
  actorId: z.string().uuid().optional(),
  action: z.string().max(64).optional(),
  entity: z.string().max(64).optional(),
  entityId: z.string().max(64).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const exportAuditSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  format: z.enum(['json', 'csv']).default('json'),
});

export type AuditQuery = z.infer<typeof auditQuerySchema>;