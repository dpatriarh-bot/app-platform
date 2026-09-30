// ============================================================
// questions/routes.ts — роуты вопросов (банк вопросов)
// + роуты справочника типов вопросов (C1).
// ============================================================

import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import {
  createQuestionSchema,
  updateQuestionSchema,
  listQuestionsQuerySchema,
  updateQuestionTypeSettingSchema,
  reorderQuestionTypesSchema,
  questionTypeSchema,
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

export default async function questionsRoutes(app: FastifyInstance): Promise<void> {

  // ============================================================
  // СПРАВОЧНИК ТИПОВ ВОПРОСОВ
  // (важно объявить до /:id, чтобы «type-settings» не улетел в id)
  // ============================================================

  app.get(
    '/type-settings',
    { preHandler: [requireAuth, requirePermission('tests', 'read')] },
    async (_req, reply) => {
      const items = await service.listQuestionTypeSettings();
      return reply.send({ items });
    }
  );

  app.get(
    '/type-settings/enabled',
    { preHandler: [requireAuth] },
    async (_req, reply) => {
      const items = await service.listEnabledQuestionTypeSettings();
      return reply.send({ items });
    }
  );

  app.get<{ Params: { type: string } }>(
    '/type-settings/:type',
    { preHandler: [requireAuth, requirePermission('tests', 'read')] },
    async (req, reply) => {
      const parsed = questionTypeSchema.safeParse(req.params.type);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 'Неизвестный тип вопроса', 422);
      }
      const setting = await service.getQuestionTypeSetting(parsed.data);
      if (!setting) throw new AppError('NOT_FOUND', 'Тип вопроса не найден', 404);
      return reply.send({ setting });
    }
  );

  app.patch<{ Params: { type: string } }>(
    '/type-settings/:type',
    { preHandler: [requireAuth, requirePermission('tests', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      const parsedType = questionTypeSchema.safeParse(req.params.type);
      if (!parsedType.success) {
        throw new AppError('VALIDATION_ERROR', 'Неизвестный тип вопроса', 422);
      }

      let input;
      try {
        input = updateQuestionTypeSettingSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const setting = await service.updateQuestionTypeSetting(
        parsedType.data,
        input,
        req.user.id
      );
      return reply.send({ setting });
    }
  );

  app.post(
    '/type-settings/reorder',
    { preHandler: [requireAuth, requirePermission('tests', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = reorderQuestionTypesSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      await service.reorderQuestionTypes(input.items, req.user.id);
      return reply.send({ ok: true });
    }
  );

  // ============================================================
  // БАНК ВОПРОСОВ
  // ============================================================

  app.get(
    '/',
    { preHandler: [requireAuth, requirePermission('tests', 'read')] },
    async (req, reply) => {
      let query;
      try {
        query = listQuestionsQuerySchema.parse(req.query);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте параметры', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const result = await service.listQuestions(query);
      return reply.send(result);
    }
  );

  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [requireAuth, requirePermission('tests', 'read')] },
    async (req, reply) => {
      const question = await service.getQuestion(req.params.id);
      return reply.send({ question });
    }
  );

  app.post(
    '/',
    { preHandler: [requireAuth, requirePermission('tests', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = createQuestionSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const question = await service.createQuestion(input, req.user.id);
      return reply.status(201).send({ question });
    }
  );

  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [requireAuth, requirePermission('tests', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = updateQuestionSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const question = await service.updateQuestion(req.params.id, input, req.user.id);
      return reply.send({ question });
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [requireAuth, requirePermission('tests', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
      await service.deleteQuestion(req.params.id, req.user.id);
      return reply.send({ ok: true });
    }
  );
}