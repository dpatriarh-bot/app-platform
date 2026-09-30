// ============================================================
// charity/routes.ts — благотворительность
// Префикс: /api/v1/charity
// ============================================================

import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { z } from 'zod';
import * as service from './service.js';
import { requireAuth } from '../auth/middleware.js';
import { AppError } from '../../lib/errors.js';

const donateSchema = z.object({
  amountRub: z.coerce.number().int().min(100).max(500000),
  childId: z.string().uuid().optional(),
});

function zodErrors(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const path = issue.path.join('.') || '_';
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

export default async function charityRoutes(app: FastifyInstance): Promise<void> {

  app.get('/settings', async (_req, reply) => {
    const s = await service.getSettings();
    return reply.send({
      sharePercent: s.sharePercent,
      cashbackPercent: s.cashbackPercent,
      title: s.title,
      description: s.description,
      fundName: s.fundName,
      fundUrl: s.fundUrl,
    });
  });

  app.get('/stats', async (_req, reply) => {
    const stats = await service.getStats();
    return reply.send(stats);
  });

  app.post('/donate', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    let input;
    try {
      input = donateSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
          fields: zodErrors(err),
        });
      }
      throw err;
    }

    const result = await service.createDonation(
      req.user.id,
      input.amountRub,
      input.childId ?? null
    );

    return reply.status(201).send({ donation: result });
  });

  app.get('/donations', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(parseInt(q.limit ?? '50', 10) || 50, 200);
    const offset = parseInt(q.offset ?? '0', 10) || 0;

    const result = await service.listDonations(req.user.id, limit, offset);
    return reply.send(result);
  });
}