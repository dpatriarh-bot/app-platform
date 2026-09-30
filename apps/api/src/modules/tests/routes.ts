// ============================================================
// tests/routes.ts — роуты тестов
// XLSX и CSV через один endpoint /admin/import.
// ============================================================

import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import {
  createTestSchema,
  updateTestSchema,
  publishTestSchema,
  setTestQuestionsSchema,
  importQuestionsSchema,
  listTestsQuerySchema,
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

export default async function testsRoutes(app: FastifyInstance): Promise<void> {

  app.get('/', { preHandler: [requireAuth] }, async (req, reply) => {
    let query;
    try {
      query = listTestsQuerySchema.parse(req.query);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте параметры', 422, {
          fields: zodErrors(err),
        });
      }
      throw err;
    }

    if (query.forChildId) {
      const items = await service.listTestsForChild(query.forChildId, query.subjectId);
      return reply.send({ items });
    }

    const result = await service.listTests(query);
    return reply.send(result);
  });

  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const test = await service.getTest(req.params.id);
      return reply.send({ test });
    }
  );

  app.get<{ Params: { id: string } }>(
    '/admin/:id/full',
    { preHandler: [requireAuth, requirePermission('tests', 'read')] },
    async (req, reply) => {
      const test = await service.getTestWithQuestions(req.params.id);
      return reply.send({ test });
    }
  );

  app.post(
    '/admin',
    { preHandler: [requireAuth, requirePermission('tests', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = createTestSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const test = await service.createTest(input, req.user.id);
      return reply.status(201).send({ test });
    }
  );

  app.patch<{ Params: { id: string } }>(
    '/admin/:id',
    { preHandler: [requireAuth, requirePermission('tests', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = updateTestSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const test = await service.updateTest(req.params.id, input, req.user.id);
      return reply.send({ test });
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/admin/:id',
    { preHandler: [requireAuth, requirePermission('tests', 'delete')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
      await service.deleteTest(req.params.id, req.user.id);
      return reply.send({ ok: true });
    }
  );

  app.post<{ Params: { id: string } }>(
    '/admin/:id/questions',
    { preHandler: [requireAuth, requirePermission('tests', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = setTestQuestionsSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const test = await service.setTestQuestions(req.params.id, input, req.user.id);
      return reply.send({ test });
    }
  );

  app.post<{ Params: { id: string } }>(
    '/admin/:id/publish',
    { preHandler: [requireAuth, requirePermission('tests', 'publish')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = publishTestSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const test = await service.publishTest(
        req.params.id,
        input.status,
        req.user.id,
        input.comment
      );
      return reply.send({ test });
    }
  );

  app.post<{ Params: { id: string } }>(
    '/admin/:id/clone',
    { preHandler: [requireAuth, requirePermission('tests', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      const body = req.body as { title?: string };
      const test = await service.cloneTest(req.params.id, req.user.id, body.title);
      return reply.status(201).send({ test });
    }
  );

  app.post(
    '/admin/import',
    { preHandler: [requireAuth, requirePermission('tests', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = importQuestionsSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const result = await service.importQuestions(
        input.subjectId,
        input.format,
        input.data,
        req.user.id,
        input.dryRun
      );

      return reply.send(result);
    }
  );
}