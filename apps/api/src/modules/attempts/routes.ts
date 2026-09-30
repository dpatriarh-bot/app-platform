// ============================================================
// attempts/routes.ts — роуты попыток
// ============================================================

import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import {
  startAttemptSchema,
  saveAnswerSchema,
  logEventSchema,
  finishAttemptSchema,
  listAttemptsQuerySchema,
  flagAttemptSchema,
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

export default async function attemptsRoutes(app: FastifyInstance): Promise<void> {

  // -------- START --------
  app.post('/start', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    let input;
    try {
      input = startAttemptSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
          fields: zodErrors(err),
        });
      }
      throw err;
    }

    const result = await service.startAttempt(input, {
      ip: req.ctx.ip,
      userAgent: req.ctx.userAgent,
      parentId: req.user.id,
    });

    return reply.status(201).send(result);
  });

  // -------- GET ATTEMPT QUESTIONS --------
  // Возвращает вопросы уже созданной попытки.
  // Используется страницей прохождения, чтобы не создавать попытку заново.
  app.get<{ Params: { id: string } }>(
    '/:id/questions',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      const result = await service.getAttemptQuestions(req.params.id, {
        parentId: req.user.id,
      });

      return reply.send(result);
    }
  );

  // -------- SAVE ANSWER --------
  app.patch<{ Params: { id: string } }>(
    '/:id/answer',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = saveAnswerSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const result = await service.saveAnswer(req.params.id, input, {
        parentId: req.user.id,
        ip: req.ctx.ip,
      });

      return reply.send(result);
    }
  );

  // -------- LOG EVENT --------
  app.post<{ Params: { id: string } }>(
    '/:id/event',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = logEventSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      await service.logEvent(req.params.id, input, {
        parentId: req.user.id,
        ip: req.ctx.ip,
      });

      return reply.send({ ok: true });
    }
  );

  // -------- FINISH --------
  app.post<{ Params: { id: string } }>(
    '/:id/finish',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = finishAttemptSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const result = await service.finishAttempt(req.params.id, {
        parentId: req.user.id,
        ip: req.ctx.ip,
      });

      return reply.send(result);
    }
  );

  // -------- RESULT --------
  app.get<{ Params: { id: string } }>(
    '/:id/result',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
      const result = await service.getAttemptResult(req.params.id, {
        parentId: req.user.id,
      });
      return reply.send({ result });
    }
  );

  // -------- LIST --------
  app.get('/', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    let query;
    try {
      query = listAttemptsQuerySchema.parse(req.query);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте параметры', 422, {
          fields: zodErrors(err),
        });
      }
      throw err;
    }

    const result = await service.listAttempts(req.user.id, query);
    return reply.send(result);
  });

  // -------- ADMIN: flagged list --------
  app.get(
    '/admin/flagged',
    { preHandler: [requireAuth, requirePermission('attempts', 'review')] },
    async (req, reply) => {
      const query = req.query as { limit?: string; offset?: string };
      const items = await service.listFlaggedAttempts({
        limit: query.limit ? parseInt(query.limit, 10) : 50,
        offset: query.offset ? parseInt(query.offset, 10) : 0,
      });
      return reply.send({ items });
    }
  );

  // -------- ADMIN: approve / reject --------
  app.post<{ Params: { id: string } }>(
    '/admin/:id/review',
    { preHandler: [requireAuth, requirePermission('attempts', 'review')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = flagAttemptSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      if (input.action === 'approve') {
        await service.approveFlaggedAttempt(req.params.id, req.user.id, input.notes);
      } else if (input.action === 'reject') {
        await service.rejectFlaggedAttempt(req.params.id, req.user.id, input.notes);
      }

      return reply.send({ ok: true });
    }
  );

  // -------- ADMIN: result --------
  app.get<{ Params: { id: string } }>(
    '/admin/:id/result',
    { preHandler: [requireAuth, requirePermission('attempts', 'read')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
      const result = await service.getAttemptResult(req.params.id, {
        curatorId: req.user.id,
      });
      return reply.send({ result });
    }
  );
}