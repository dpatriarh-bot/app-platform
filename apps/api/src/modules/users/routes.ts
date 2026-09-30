// ============================================================
// users/routes.ts — роуты профиля, детей, экспорта, удаления
// ============================================================

import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import {
  updateProfileSchema,
  updateChildSchema,
  createChildSchema,
  deleteAccountSchema,
} from './schemas.js';
import * as usersService from './service.js';
import { requireAuth } from '../auth/middleware.js';
import { AppError } from '../../lib/errors.js';

function zodErrors(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const path = issue.path.join('.') || '_';
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

export default async function usersRoutes(app: FastifyInstance): Promise<void> {

  // -------- Профиль --------
  app.get('/profile', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
    const profile = await usersService.getProfile(req.user.id);
    return reply.send({ profile });
  });

  app.patch('/profile', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    let input;
    try {
      input = updateProfileSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
          fields: zodErrors(err),
        });
      }
      throw err;
    }

    const profile = await usersService.updateProfile(req.user.id, input, {
      ip: req.ctx.ip,
      userAgent: req.ctx.userAgent,
    });

    return reply.send({ profile });
  });

  app.get('/stats', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
    const stats = await usersService.getProfileStats(req.user.id);
    return reply.send({ stats });
  });

  // -------- Дети --------
  app.get('/children', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
    const children = await usersService.listChildren(req.user.id);
    return reply.send({ children });
  });

  app.get<{ Params: { id: string } }>(
    '/children/:id',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
      const child = await usersService.getChild(req.user.id, req.params.id);
      return reply.send({ child });
    }
  );

  app.post('/children', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    let input;
    try {
      input = createChildSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
          fields: zodErrors(err),
        });
      }
      throw err;
    }

    const child = await usersService.createChild(req.user.id, input);
    return reply.status(201).send({ child });
  });

  app.patch<{ Params: { id: string } }>(
    '/children/:id',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = updateChildSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const child = await usersService.updateChild(req.user.id, req.params.id, input);
      return reply.send({ child });
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/children/:id',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
      await usersService.deleteChild(req.user.id, req.params.id);
      return reply.send({ ok: true });
    }
  );

  // -------- Экспорт (152-ФЗ) --------
  app.get('/export', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    const bundle = await usersService.exportUserData(req.user.id);

    const filename = `ulybka-export-${new Date().toISOString().slice(0, 10)}.json`;

    reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`);

    return reply.send(JSON.stringify(bundle, null, 2));
  });

  // -------- Удаление аккаунта --------
  app.post('/delete', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    let input;
    try {
      input = deleteAccountSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
          fields: zodErrors(err),
        });
      }
      throw err;
    }

    await usersService.deleteAccount(req.user.id, input, {
      ip: req.ctx.ip,
      userAgent: req.ctx.userAgent,
    });

    reply.clearCookie('ulybka_access', { path: '/', domain: req.server.config.COOKIE_DOMAIN });
    reply.clearCookie('ulybka_refresh', {
      path: '/api/v1/auth',
      domain: req.server.config.COOKIE_DOMAIN,
    });

    return reply.send({ ok: true });
  });

  // -------- Счётчик уведомлений --------
  app.get('/notifications/count', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    const { countUnread } = await import('../notifications/service.js');
    const count = await countUnread(req.user.id);
    return reply.send({ count });
  });
}