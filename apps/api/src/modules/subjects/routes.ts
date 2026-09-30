// ============================================================
// subjects/routes.ts — роуты дисциплин
// + список по классу + сводка по классам
// ============================================================

import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import {
  createSubjectSchema,
  updateSubjectSchema,
  listSubjectsQuerySchema,
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

export default async function subjectsRoutes(app: FastifyInstance): Promise<void> {

  // -------- Публичные --------
  app.get('/', { preHandler: [requireAuth] }, async (req, reply) => {
    let query;
    try {
      query = listSubjectsQuerySchema.parse(req.query);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте параметры', 422, {
          fields: zodErrors(err),
        });
      }
      throw err;
    }

    if (query.forChildId && req.user) {
      const items = await service.listSubjectsForChild(query.forChildId);
      return reply.send({ items });
    }

    const items = await service.listSubjects(query);
    return reply.send({ items });
  });

  // -------- Сводка по классам (для админского бара 1..11) --------
  app.get(
    '/admin/grades-summary',
    { preHandler: [requireAuth, requirePermission('subjects', 'read')] },
    async (_req, reply) => {
      const items = await service.getGradesSummary();
      return reply.send({ items });
    }
  );

  app.get<{ Params: { slug: string } }>('/:slug', async (req, reply) => {
    const subject = await service.getSubjectBySlug(req.params.slug);
    return reply.send({ subject });
  });

  // -------- Админские --------
  app.post(
    '/admin',
    { preHandler: [requireAuth, requirePermission('subjects', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = createSubjectSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const subject = await service.createSubject(input, req.user.id);
      return reply.status(201).send({ subject });
    }
  );

  app.patch<{ Params: { id: string } }>(
    '/admin/:id',
    { preHandler: [requireAuth, requirePermission('subjects', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = updateSubjectSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const subject = await service.updateSubject(req.params.id, input, req.user.id);
      return reply.send({ subject });
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/admin/:id',
    { preHandler: [requireAuth, requirePermission('subjects', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
      await service.deleteSubject(req.params.id, req.user.id);
      return reply.send({ ok: true });
    }
  );

  app.post(
    '/admin/reorder',
    { preHandler: [requireAuth, requirePermission('subjects', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      const body = req.body as { items?: Array<{ id: string; orderIndex: number }> };
      if (!Array.isArray(body.items)) {
        throw new AppError('VALIDATION_ERROR', 'items должен быть массивом', 422);
      }

      await service.reorderSubjects(body.items, req.user.id);
      return reply.send({ ok: true });
    }
  );
}