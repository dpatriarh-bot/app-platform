// ============================================================
// notifications/routes.ts — уведомления родителя и ребёнка
// ============================================================

import type { FastifyInstance } from 'fastify';
import * as service from './service.js';
import * as childService from './child-service.js';
import { requireAuth } from '../auth/middleware.js';
import { AppError } from '../../lib/errors.js';
import { db } from '../../db/client.js';
import { children } from '../../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';

export default async function notificationsRoutes(app: FastifyInstance): Promise<void> {

  app.get('/', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    const query = req.query as { limit?: string; unread?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    const unreadOnly = query.unread === '1' || query.unread === 'true';

    const items = await service.listNotifications(req.user.id, { limit, unreadOnly });
    const unreadCount = await service.countUnread(req.user.id);

    return reply.send({ items, unreadCount });
  });

  app.get('/count', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
    const count = await service.countUnread(req.user.id);
    const byType = await service.countUnreadByType(req.user.id);
    return reply.send({ count, byType });
  });

  app.post<{ Params: { id: string } }>(
    '/:id/read',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
      await service.markAsRead(req.user.id, req.params.id);
      return reply.send({ ok: true });
    }
  );

  app.post('/read-all', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
    const count = await service.markAllAsRead(req.user.id);
    return reply.send({ ok: true, count });
  });

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
      await service.deleteNotification(req.user.id, req.params.id);
      return reply.send({ ok: true });
    }
  );

  app.delete('/', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
    await service.clearAll(req.user.id);
    return reply.send({ ok: true });
  });

  // ============================================================
  // УВЕДОМЛЕНИЯ РЕБЁНКА
  // ============================================================

  app.get<{ Params: { childId: string } }>(
    '/child/:childId',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      const [child] = await db
        .select({ id: children.id })
        .from(children)
        .where(
          and(
            eq(children.id, req.params.childId),
            eq(children.parentId, req.user.id),
            isNull(children.deletedAt)
          )
        )
        .limit(1);

      if (!child) throw new AppError('NOT_FOUND', 'Ребёнок не найден', 404);

      const query = req.query as { limit?: string; unread?: string };
      const limit = query.limit ? parseInt(query.limit, 10) : 30;
      const unreadOnly = query.unread === '1' || query.unread === 'true';

      const items = await childService.listChildNotifications(req.params.childId, {
        limit,
        unreadOnly,
      });
      const unreadCount = await childService.countUnreadChild(req.params.childId);

      return reply.send({ items, unreadCount });
    }
  );

  app.post<{ Params: { childId: string; id: string } }>(
    '/child/:childId/:id/read',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      const [child] = await db
        .select({ id: children.id })
        .from(children)
        .where(
          and(
            eq(children.id, req.params.childId),
            eq(children.parentId, req.user.id),
            isNull(children.deletedAt)
          )
        )
        .limit(1);

      if (!child) throw new AppError('NOT_FOUND', 'Ребёнок не найден', 404);

      await childService.markChildAsRead(req.params.childId, req.params.id);
      return reply.send({ ok: true });
    }
  );

  app.post<{ Params: { childId: string } }>(
    '/child/:childId/read-all',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      const [child] = await db
        .select({ id: children.id })
        .from(children)
        .where(
          and(
            eq(children.id, req.params.childId),
            eq(children.parentId, req.user.id),
            isNull(children.deletedAt)
          )
        )
        .limit(1);

      if (!child) throw new AppError('NOT_FOUND', 'Ребёнок не найден', 404);

      const count = await childService.markAllChildAsRead(req.params.childId);
      return reply.send({ ok: true, count });
    }
  );
}