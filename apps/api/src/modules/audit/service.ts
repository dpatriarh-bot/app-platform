// ============================================================
// audit/service.ts — запись в audit_log (write-only журнал)
// ============================================================

import { db } from '../../db/client.js';
import { auditLog } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import type { FastifyRequest } from 'fastify';
import type { User } from '../../db/schema.js';

export interface AuditEntryInput {
  actorId?: string | null;
  actorRole?: User['role'] | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  req?: FastifyRequest;
}

export async function writeAudit(input: AuditEntryInput): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actorId: input.actorId ?? null,
      actorRole: input.actorRole ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      beforeJson: input.before ?? null,
      afterJson: input.after ?? null,
      ip: input.req?.ctx?.ip ?? null,
      userAgent: input.req?.ctx?.userAgent ?? null,
      requestId: input.req?.ctx?.requestId ?? null,
    });
  } catch (err) {
    logger.error({ err, action: input.action, entity: input.entity }, 'audit write failed');
  }
}