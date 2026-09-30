// ============================================================
// partners/routes.ts — роуты партнёров
// Префикс: /api/v1/partners
// ============================================================

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import {
  createPartnerSchema,
  updatePartnerSchema,
  createOfferSchema,
  updateOfferSchema,
  verifyQrSchema,
  partnerPromoBatchSchema,
  listPartnersQuerySchema,
} from './schemas.js';
import * as service from './service.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { AppError } from '../../lib/errors.js';

function zodErrors(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const path = issue.path.join('.') || '_';
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

async function requirePartnerAuth(
  req: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const header = req.headers['x-partner-api-key'];
  const apiKey = Array.isArray(header) ? header[0] : header;

  if (!apiKey) throw new AppError('UNAUTHORIZED', 'Требуется API-ключ партнёра', 401);

  const partner = await service.authenticatePartnerByApiKey(apiKey);
  if (!partner) throw new AppError('UNAUTHORIZED', 'Неверный API-ключ', 401);

  (req as FastifyRequest & { partner?: typeof partner }).partner = partner;
}

export default async function partnersRoutes(app: FastifyInstance): Promise<void> {

  // ============================================================
  // ADMIN — управление партнёрами
  // ============================================================

  app.get(
    '/admin',
    { preHandler: [requireAuth, requirePermission('partners', 'read')] },
    async (req, reply) => {
      let query;
      try {
        query = listPartnersQuerySchema.parse(req.query);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте параметры', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const result = await service.listPartners(query);
      return reply.send(result);
    }
  );

  app.post(
    '/admin',
    { preHandler: [requireAuth, requirePermission('partners', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = createPartnerSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const partner = await service.createPartner(input, req.user.id);
      return reply.status(201).send({ partner });
    }
  );

  app.patch<{ Params: { id: string } }>(
    '/admin/:id',
    { preHandler: [requireAuth, requirePermission('partners', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = updatePartnerSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const partner = await service.updatePartner(req.params.id, input, req.user.id);
      return reply.send({ partner });
    }
  );

  app.post<{ Params: { id: string } }>(
    '/admin/:id/status',
    { preHandler: [requireAuth, requirePermission('partners', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      const body = req.body as { status?: 'pending' | 'active' | 'suspended' };
      if (!body.status) throw new AppError('VALIDATION_ERROR', 'Укажите статус', 422);

      const partner = await service.setPartnerStatus(req.params.id, body.status, req.user.id);
      return reply.send({ partner });
    }
  );

  app.post<{ Params: { id: string } }>(
    '/admin/:id/rotate-key',
    { preHandler: [requireAuth, requirePermission('partners', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
      const result = await service.rotatePartnerApiKey(req.params.id, req.user.id);
      return reply.send(result);
    }
  );

  // ---- Офферы (админ) ----

  app.get(
    '/admin/offers',
    { preHandler: [requireAuth, requirePermission('partners', 'read')] },
    async (req, reply) => {
      const q = req.query as { partnerId?: string; status?: string; limit?: string; offset?: string };
      const result = await service.listOffers({
        partnerId: q.partnerId,
        status: q.status as never,
        limit: q.limit ? parseInt(q.limit, 10) : 50,
        offset: q.offset ? parseInt(q.offset, 10) : 0,
      });
      return reply.send(result);
    }
  );

  app.post(
    '/admin/offers',
    { preHandler: [requireAuth, requirePermission('partners', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = createOfferSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const offer = await service.createOffer(input, req.user.id);
      return reply.status(201).send({ offer });
    }
  );

  app.patch<{ Params: { id: string } }>(
    '/admin/offers/:id',
    { preHandler: [requireAuth, requirePermission('partners', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = updateOfferSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const offer = await service.updateOffer(req.params.id, input, req.user.id);
      return reply.send({ offer });
    }
  );

  app.post<{ Params: { id: string } }>(
    '/admin/offers/:id/status',
    { preHandler: [requireAuth, requirePermission('partners', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      const body = req.body as { status?: 'draft' | 'review' | 'published' | 'archived' };
      if (!body.status) throw new AppError('VALIDATION_ERROR', 'Укажите статус', 422);

      const offer = await service.setOfferStatus(req.params.id, body.status, req.user.id);
      return reply.send({ offer });
    }
  );

  // ---- Промо-батчи (админ) ----

  app.post(
    '/admin/promo-batches',
    { preHandler: [requireAuth, requirePermission('partners', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = partnerPromoBatchSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const result = await service.createPromoBatch(input, req.user.id);
      return reply.status(201).send(result);
    }
  );

  // ============================================================
  // ПАРТНЁР — по API-ключу
  // ============================================================

  app.post(
    '/verify-qr',
    { preHandler: [requirePartnerAuth] },
    async (req, reply) => {
      let input;
      try {
        input = verifyQrSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const result = await service.verifyQr(input.qrToken);
      return reply.send(result);
    }
  );

  app.post<{ Params: { redemptionId: string } }>(
    '/redemptions/:redemptionId/mark-redeemed',
    { preHandler: [requirePartnerAuth] },
    async (req, reply) => {
      const partner = (req as FastifyRequest & { partner?: { id: string } }).partner;
      if (!partner) throw new AppError('UNAUTHORIZED', 'Партнёр не определён', 401);

      await service.markRedeemed(req.params.redemptionId, partner.id);
      return reply.send({ ok: true });
    }
  );

  app.get(
    '/me',
    { preHandler: [requirePartnerAuth] },
    async (req, reply) => {
      const partner = (req as FastifyRequest & { partner?: { id: string } }).partner;
      if (!partner) throw new AppError('UNAUTHORIZED', 'Партнёр не определён', 401);

      const info = await service.getPartner(partner.id);
      const stats = await service.getPartnerStats(partner.id);
      const offers = await service.listOffers({ partnerId: partner.id });

      return reply.send({ partner: info, stats, offers: offers.items });
    }
  );

  // ============================================================
  // Публичные
  // ============================================================

  app.get<{ Params: { slug: string } }>('/:slug', async (req, reply) => {
    const partner = await service.getPartnerBySlug(req.params.slug);
    return reply.send({ partner });
  });
}