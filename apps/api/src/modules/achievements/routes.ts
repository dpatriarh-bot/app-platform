// ============================================================
// achievements/routes.ts — ачивки и статусы
// Префикс: /api/v1/achievements
// ============================================================

import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { z } from 'zod';
import * as service from './service.js';
import { requireAuth } from '../auth/middleware.js';
import { AppError } from '../../lib/errors.js';

const claimSocialSchema = z.object({
  childId: z.string().uuid(),
  platform: z.enum(['vk', 'telegram', 'youtube', 'other']),
  url: z.string().url().max(500).optional(),
});

function zodErrors(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const path = issue.path.join('.') || '_';
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

export default async function achievementsRoutes(app: FastifyInstance): Promise<void> {

  app.get('/catalog', { preHandler: [requireAuth] }, async (_req, reply) => {
    const items = await service.listAchievements();
    return reply.send({ items });
  });

  app.get('/ranks', async (_req, reply) => {
    return reply.send({ ranks: service.allRanks() });
  });

  app.get<{ Params: { childId: string } }>(
    '/for-child/:childId',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      const [items, rank] = await Promise.all([
        service.listForChild(req.params.childId),
        service.getRankForChild(req.params.childId),
      ]);

      return reply.send({ items, rank });
    }
  );

  app.post('/social/claim', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    let input;
    try {
      input = claimSocialSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
          fields: zodErrors(err),
        });
      }
      throw err;
    }

    const result = await service.claimSocialAchievement(req.user.id, input.childId, {
      platform: input.platform,
      url: input.url,
    });

    return reply.send(result);
  });
}