// ============================================================
// audit/routes.ts — роуты аудита (superadmin)
// Префикс: /api/v1/audit
// ============================================================

import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { auditQuerySchema, exportAuditSchema } from './schemas.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { AppError } from '../../lib/errors.js';
import { listAudit } from '../admin/service.js';

function zodErrors(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const path = issue.path.join('.') || '_';
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

export default async function auditRoutes(app: FastifyInstance): Promise<void> {

  app.get(
    '/',
    { preHandler: [requireAuth, requireRole('superadmin')] },
    async (req, reply) => {
      let query;
      try {
        query = auditQuerySchema.parse(req.query);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте параметры', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const result = await listAudit(query);
      return reply.send(result);
    }
  );

  app.post(
    '/export',
    { preHandler: [requireAuth, requireRole('superadmin')] },
    async (req, reply) => {
      let input;
      try {
        input = exportAuditSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const result = await listAudit({
        from: input.from,
        to: input.to,
        limit: 500,
        offset: 0,
      });

      const filename = `audit-${input.from.slice(0, 10)}_${input.to.slice(0, 10)}.json`;
      reply
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`);

      return reply.send(JSON.stringify(result.items, null, 2));
    }
  );
}