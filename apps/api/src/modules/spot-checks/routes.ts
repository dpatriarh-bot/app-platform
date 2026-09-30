// ============================================================
// spot-checks/routes.ts — роуты очных проверок
// Публичный kiosk-роут без requireAuth по токену.
// ============================================================

import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import {
  scheduleSpotCheckSchema,
  saveSpotAnswerSchema,
  finishSpotCheckSchema,
  setVerdictSchema,
  listSpotChecksQuerySchema,
  kioskStartSchema,
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

export default async function spotChecksRoutes(app: FastifyInstance): Promise<void> {

  // ============================================================
  // Публичный kiosk-роут (без requireAuth)
  // ============================================================
  app.post('/kiosk/start', async (req, reply) => {
    let input;
    try {
      input = kioskStartSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
          fields: zodErrors(err),
        });
      }
      throw err;
    }

    const spotCheckId = await service.consumeKioskToken(input.token);
    const session = await service.startSpotCheck(spotCheckId, null);
    return reply.send(session);
  });

  app.patch<{ Params: { id: string } }>('/kiosk/:id/answer', async (req, reply) => {
    const body = req.body as {
      token?: string;
      questionId?: string;
      answer?: unknown;
      timeSpentMs?: number;
    };

    if (!body.token) throw new AppError('UNAUTHORIZED', 'Токен обязателен', 401);

    const spotCheckId = await service.consumeKioskToken(body.token);
    if (spotCheckId !== req.params.id) {
      throw new AppError('FORBIDDEN', 'Токен не подходит к проверке', 403);
    }

    let input;
    try {
      input = saveSpotAnswerSchema.parse({
        questionId: body.questionId,
        answer: body.answer,
        timeSpentMs: body.timeSpentMs,
      });
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
          fields: zodErrors(err),
        });
      }
      throw err;
    }

    const result = await service.saveSpotAnswer(
      spotCheckId,
      input.questionId,
      input.answer,
      input.timeSpentMs,
      null
    );

    return reply.send(result);
  });

  app.post<{ Params: { id: string } }>('/kiosk/:id/finish', async (req, reply) => {
    const body = req.body as { token?: string };

    if (!body.token) throw new AppError('UNAUTHORIZED', 'Токен обязателен', 401);

    const spotCheckId = await service.consumeKioskToken(body.token);
    if (spotCheckId !== req.params.id) {
      throw new AppError('FORBIDDEN', 'Токен не подходит к проверке', 403);
    }

    const result = await service.finishSpotCheck(spotCheckId, null);
    return reply.send(result);
  });

  // ============================================================
  // Кураторские роуты
  // ============================================================

  app.get(
    '/',
    { preHandler: [requireAuth, requirePermission('spot_checks', 'read')] },
    async (req, reply) => {
      let query;
      try {
        query = listSpotChecksQuerySchema.parse(req.query);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте параметры', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const result = await service.listSpotChecks(query);
      return reply.send(result);
    }
  );

  app.get(
    '/candidates',
    { preHandler: [requireAuth, requirePermission('spot_checks', 'read')] },
    async (req, reply) => {
      const q = req.query as { minFlagged?: string; daysBack?: string; limit?: string };
      const items = await service.listCandidatesForSpotCheck({
        minFlaggedAttempts: q.minFlagged ? parseInt(q.minFlagged, 10) : 2,
        daysBack: q.daysBack ? parseInt(q.daysBack, 10) : 30,
        limit: q.limit ? parseInt(q.limit, 10) : 50,
      });
      return reply.send({ items });
    }
  );

  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [requireAuth, requirePermission('spot_checks', 'read')] },
    async (req, reply) => {
      const result = await service.getSpotCheckDetail(req.params.id);
      return reply.send({ spotCheck: result });
    }
  );

  app.post(
    '/',
    { preHandler: [requireAuth, requirePermission('spot_checks', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = scheduleSpotCheckSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const spotCheck = await service.scheduleSpotCheck(input, req.user.id);
      return reply.status(201).send({ spotCheck });
    }
  );

  // Получить kiosk-токен для запуска проверки на устройстве
  app.post<{ Params: { id: string } }>(
    '/:id/kiosk-token',
    { preHandler: [requireAuth, requirePermission('spot_checks', 'write')] },
    async (req, reply) => {
      const token = await service.createKioskToken(req.params.id);
      return reply.send({ token });
    }
  );

  // Запуск проверки куратором (в том же браузере)
  app.post<{ Params: { id: string } }>(
    '/:id/start',
    { preHandler: [requireAuth, requirePermission('spot_checks', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
      const session = await service.startSpotCheck(req.params.id, req.user.id);
      return reply.send(session);
    }
  );

  app.patch<{ Params: { id: string } }>(
    '/:id/answer',
    { preHandler: [requireAuth, requirePermission('spot_checks', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = saveSpotAnswerSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const result = await service.saveSpotAnswer(
        req.params.id,
        input.questionId,
        input.answer,
        input.timeSpentMs,
        req.user.id
      );

      return reply.send(result);
    }
  );

  app.post<{ Params: { id: string } }>(
    '/:id/finish',
    { preHandler: [requireAuth, requirePermission('spot_checks', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      try {
        finishSpotCheckSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const result = await service.finishSpotCheck(req.params.id, req.user.id);
      return reply.send(result);
    }
  );

  app.post<{ Params: { id: string } }>(
    '/:id/verdict',
    { preHandler: [requireAuth, requirePermission('spot_checks', 'verdict')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = setVerdictSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const spotCheck = await service.setVerdict(req.params.id, input, req.user.id);
      return reply.send({ spotCheck });
    }
  );
}