// ============================================================
// mailings/routes.ts — роуты рассылок
// Префикс: /api/v1/mailings
// ============================================================

import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import {
  createMailTemplateSchema,
  updateMailTemplateSchema,
  createMailingSchema,
  listMailingsQuerySchema,
  previewSegmentSchema,
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

export default async function mailingsRoutes(app: FastifyInstance): Promise<void> {

  // -------- Шаблоны --------
  app.get(
    '/templates',
    { preHandler: [requireAuth, requirePermission('mailings', 'read')] },
    async (_req, reply) => {
      const items = await service.listTemplates();
      return reply.send({ items });
    }
  );

  app.post(
    '/templates',
    { preHandler: [requireAuth, requirePermission('mailings', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = createMailTemplateSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const template = await service.createTemplate(input, req.user.id);
      return reply.status(201).send({ template });
    }
  );

  app.patch<{ Params: { id: string } }>(
    '/templates/:id',
    { preHandler: [requireAuth, requirePermission('mailings', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = updateMailTemplateSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const template = await service.updateTemplate(req.params.id, input, req.user.id);
      return reply.send({ template });
    }
  );

  // -------- Сегмент: предпросмотр --------
  app.post(
    '/segment/preview',
    { preHandler: [requireAuth, requirePermission('mailings', 'read')] },
    async (req, reply) => {
      let input;
      try {
        input = previewSegmentSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const result = await service.previewSegment(input);
      return reply.send(result);
    }
  );

  // -------- Рассылки --------
  app.get(
    '/',
    { preHandler: [requireAuth, requirePermission('mailings', 'read')] },
    async (req, reply) => {
      let query;
      try {
        query = listMailingsQuerySchema.parse(req.query);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте параметры', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const result = await service.listMailings(query);
      return reply.send(result);
    }
  );

  app.post(
    '/',
    { preHandler: [requireAuth, requirePermission('mailings', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = createMailingSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const mailing = await service.createMailing(input, req.user.id);
      return reply.status(201).send({ mailing });
    }
  );

  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [requireAuth, requirePermission('mailings', 'read')] },
    async (req, reply) => {
      const mailing = await service.getMailing(req.params.id);
      return reply.send({ mailing });
    }
  );

  app.post<{ Params: { id: string } }>(
    '/:id/send',
    { preHandler: [requireAuth, requirePermission('mailings', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
      const mailing = await service.sendMailing(req.params.id, req.user.id);
      return reply.send({ mailing });
    }
  );

  app.post<{ Params: { id: string } }>(
    '/:id/cancel',
    { preHandler: [requireAuth, requirePermission('mailings', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
      const mailing = await service.cancelMailing(req.params.id, req.user.id);
      return reply.send({ mailing });
    }
  );
}