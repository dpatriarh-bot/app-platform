// ============================================================
// catalog/routes.ts — роуты каталога
// Префикс: /api/v1/catalog
// ============================================================

import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import {
  redeemSchema,
  catalogQuerySchema,
  redemptionsQuerySchema,
} from './schemas.js';
import * as service from './service.js';
import { requireAuth } from '../auth/middleware.js';
import { AppError } from '../../lib/errors.js';

function zodErrors(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const path = issue.path.join('.') || '_';
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

export default async function catalogRoutes(app: FastifyInstance): Promise<void> {

  // -------- Публичный каталог (доступен авторизованным) --------
  app.get('/', { preHandler: [requireAuth] }, async (req, reply) => {
    let query;
    try {
      query = catalogQuerySchema.parse(req.query);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте параметры', 422, {
          fields: zodErrors(err),
        });
      }
      throw err;
    }

    const items = await service.listCatalog(query);
    return reply.send({ items });
  });

  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const offer = await service.getOffer(req.params.id);
      return reply.send({ offer });
    }
  );

  // -------- Обмен --------
  app.post('/redeem', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    let input;
    try {
      input = redeemSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
          fields: zodErrors(err),
        });
      }
      throw err;
    }

    const result = await service.redeem(req.user.id, input);
    return reply.status(201).send(result);
  });

  // -------- История обменов --------
  app.get('/redemptions', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    let query;
    try {
      query = redemptionsQuerySchema.parse(req.query);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте параметры', 422, {
          fields: zodErrors(err),
        });
      }
      throw err;
    }

    const result = await service.listRedemptions(req.user.id, query);
    return reply.send(result);
  });

  app.get<{ Params: { id: string } }>(
    '/redemptions/:id',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
      const redemption = await service.getRedemption(req.user.id, req.params.id);
      return reply.send({ redemption });
    }
  );

  // -------- Реферальная ссылка --------
  app.get<{ Params: { childId: string } }>(
    '/referral/:childId',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const link = await service.getReferralLink(req.params.childId);
      return reply.send(link);
    }
  );
}