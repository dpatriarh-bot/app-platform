// ============================================================
// points/routes.ts — роуты баллов
// Префикс: /api/v1/points
// ============================================================

import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import {
  ledgerQuerySchema,
  manualAdjustSchema,
  balanceQuerySchema,
} from './schemas.js';
import * as service from './service.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { AppError } from '../../lib/errors.js';
import { db } from '../../db/client.js';
import { children } from '../../db/schema.js';
import { eq, and, isNull, inArray } from 'drizzle-orm';

function zodErrors(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const path = issue.path.join('.') || '_';
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

export default async function pointsRoutes(app: FastifyInstance): Promise<void> {

  // -------- Мой баланс (по всем детям) --------
  app.get('/balance', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    const kids = await db
      .select({ id: children.id })
      .from(children)
      .where(and(eq(children.parentId, req.user.id), isNull(children.deletedAt)));

    if (kids.length === 0) return reply.send({ items: [] });

    const map = await service.getBalancesBatch(kids.map((k) => k.id));

    const items = kids.map((k) => {
      const b = map.get(k.id);
      return {
        childId: k.id,
        balance: b?.balance ?? 0,
        lifetimeEarned: b?.lifetimeEarned ?? 0,
        lifetimeSpent: b?.lifetimeSpent ?? 0,
      };
    });

    return reply.send({ items });
  });

  // -------- Баланс конкретного ребёнка --------
  app.get('/balance/:childId', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    const { childId } = req.params as { childId: string };

    // проверка владения
    const [child] = await db
      .select({ id: children.id })
      .from(children)
      .where(
        and(
          eq(children.id, childId),
          eq(children.parentId, req.user.id),
          isNull(children.deletedAt)
        )
      )
      .limit(1);

    if (!child) throw new AppError('NOT_FOUND', 'Ребёнок не найден', 404);

    const balance = await service.getBalance(childId);
    return reply.send({ balance });
  });

  // -------- История операций --------
  app.get('/ledger', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    let query;
    try {
      query = ledgerQuerySchema.parse(req.query);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте параметры', 422, {
          fields: zodErrors(err),
        });
      }
      throw err;
    }

    // Если childId не указан — берём всех детей родителя
    let childIds: string[];
    if (query.childId) {
      const [c] = await db
        .select({ id: children.id })
        .from(children)
        .where(
          and(
            eq(children.id, query.childId),
            eq(children.parentId, req.user.id),
            isNull(children.deletedAt)
          )
        )
        .limit(1);
      if (!c) throw new AppError('NOT_FOUND', 'Ребёнок не найден', 404);
      childIds = [c.id];
    } else {
      const kids = await db
        .select({ id: children.id })
        .from(children)
        .where(and(eq(children.parentId, req.user.id), isNull(children.deletedAt)));
      childIds = kids.map((k) => k.id);
    }

    if (childIds.length === 0) {
      return reply.send({ items: [], total: 0 });
    }

    const result = await service.getLedger(childIds[0]!, {
      limit: query.limit,
      offset: query.offset,
      reason: query.reason,
    });

    return reply.send(result);
  });

  // -------- ADMIN: ручная корректировка --------
  app.post(
    '/admin/adjust',
    { preHandler: [requireAuth, requirePermission('points', 'adjust')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = manualAdjustSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const result = await service.manualAdjust({
        childId: input.childId,
        delta: input.delta,
        reason: input.reason,
        actorId: req.user.id,
      });

      return reply.send({
        ok: true,
        balanceAfter: result.balanceAfter,
        duplicate: result.duplicate,
      });
    }
  );

  // -------- ADMIN: пересчёт баланса --------
  app.post<{ Params: { childId: string } }>(
    '/admin/recalc/:childId',
    { preHandler: [requireAuth, requirePermission('points', 'adjust')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
      const balance = await service.recalculateBalance(req.params.childId);
      return reply.send({ ok: true, balance });
    }
  );
}