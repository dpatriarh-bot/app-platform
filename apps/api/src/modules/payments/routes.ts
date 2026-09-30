// ============================================================
// payments/routes.ts — роуты платежей и подписок
// Префикс: /api/v1/payments
// ============================================================

import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import {
  subscribeSchema,
  cancelSubscriptionSchema,
  paymentsHistoryQuerySchema,
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

export default async function paymentsRoutes(app: FastifyInstance): Promise<void> {

  // -------- Публичные тарифы --------
  app.get('/plans', async (_req, reply) => {
    const plans = await service.listPlans();
    return reply.send({ plans });
  });

  // -------- Текущая подписка --------
  app.get('/subscription', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
    const subscription = await service.getCurrentSubscription(req.user.id);
    return reply.send({ subscription });
  });

  // -------- Оформление --------
  app.post('/subscribe', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    let input;
    try {
      input = subscribeSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
          fields: zodErrors(err),
        });
      }
      throw err;
    }

    const result = await service.subscribe(req.user.id, input, {
      ip: req.ctx.ip,
      userAgent: req.ctx.userAgent,
    });

    return reply.status(201).send(result);
  });

  // -------- Отмена автопродления --------
  app.post('/cancel', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    let input;
    try {
      input = cancelSubscriptionSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
          fields: zodErrors(err),
        });
      }
      throw err;
    }

    const subscription = await service.cancelAutoRenew(req.user.id, input);
    return reply.send({ subscription });
  });

  // -------- Возобновление автопродления --------
  app.post('/resume', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
    const subscription = await service.resumeAutoRenew(req.user.id);
    return reply.send({ subscription });
  });

  // -------- История платежей --------
  app.get('/history', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    let query;
    try {
      query = paymentsHistoryQuerySchema.parse(req.query);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте параметры', 422, {
          fields: zodErrors(err),
        });
      }
      throw err;
    }

    const result = await service.getPaymentsHistory(req.user.id, query);
    return reply.send(result);
  });

  // -------- Webhook (без авторизации, но с подписью) --------
  app.post(
    '/webhook',
    {
      config: {
        rawBody: true,
      },
    },
    async (req, reply) => {
      const rawBody = typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body);

      const result = await service.handleWebhook(rawBody, req.headers);
      return reply.status(result.ok ? 200 : 400).send(result);
    }
  );

  // -------- ADMIN: статистика --------
  app.get(
    '/admin/stats',
    { preHandler: [requireAuth, requirePermission('finance', 'read')] },
    async (_req, reply) => {
      const stats = await service.getFinanceStats();
      return reply.send({ stats });
    }
  );

  // -------- ADMIN: ручное списание --------
  app.post<{ Params: { subscriptionId: string } }>(
    '/admin/charge/:subscriptionId',
    { preHandler: [requireAuth, requirePermission('finance', 'read')] },
    async (req, reply) => {
      const payment = await service.chargeRecurrent(req.params.subscriptionId);
      return reply.send({ payment });
    }
  );
}