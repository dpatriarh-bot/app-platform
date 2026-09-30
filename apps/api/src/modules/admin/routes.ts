// ============================================================
// admin/routes.ts — админские роуты
// + bulk-операции с пользователями
// + смена собственного пароля суперадмином
// ============================================================

import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import {
  listUsersQuerySchema,
  setUserRoleSchema,
  setUserStatusSchema,
  createUserSchema,
  dashboardPeriodSchema,
  listAuditQuerySchema,
  adjustPointsSchema,
  toggleFraudSchema,
  bulkUserActionSchema,
  exportQuerySchema,
  changeOwnPasswordSchema,
} from './schemas.js';
import * as service from './service.js';
import * as exports from './export.js';
import { requireAuth, requirePermission, requireRole } from '../auth/middleware.js';
import { checkLimit } from '../auth/rate-limit.js';
import { canCreateRole, listCreatableRoles } from '../../middleware/rbac.js';
import { AppError } from '../../lib/errors.js';
import { withBom } from '../../lib/csv.js';
import { logger } from '../../lib/logger.js';

function zodErrors(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const path = issue.path.join('.') || '_';
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

export default async function adminRoutes(app: FastifyInstance): Promise<void> {

  // -------- Дашборд --------
  app.get(
    '/dashboard',
    { preHandler: [requireAuth, requirePermission('users', 'read')] },
    async (req, reply) => {
      let query;
      try {
        query = dashboardPeriodSchema.parse(req.query);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте параметры', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const data = await service.getDashboard(query.days);
      return reply.send(data);
    }
  );

  // -------- Аномалии --------
  app.get(
    '/anomalies',
    { preHandler: [requireAuth, requirePermission('fraud', 'read')] },
    async (req, reply) => {
      const q = req.query as { days?: string };
      const days = q.days ? parseInt(q.days, 10) : 7;
      const data = await service.getAnomalies(days);
      return reply.send(data);
    }
  );

  // -------- Creatable roles --------
  app.get(
    '/creatable-roles',
    { preHandler: [requireAuth, requirePermission('users', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
      return reply.send({ roles: listCreatableRoles(req.user.role) });
    }
  );

  // -------- Users: list --------
  app.get(
    '/users',
    { preHandler: [requireAuth, requirePermission('users', 'read')] },
    async (req, reply) => {
      let query;
      try {
        query = listUsersQuerySchema.parse(req.query);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте параметры', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const result = await service.listUsers(query);
      return reply.send(result);
    }
  );

  // -------- Users: export CSV --------
  app.get(
    '/users/export',
    { preHandler: [requireAuth, requirePermission('users', 'read')] },
    async (req, reply) => {
      let query;
      try {
        query = exportQuerySchema.parse(req.query);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте параметры', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const csv = await exports.exportUsersCsv(query);
      const filename = `users-${new Date().toISOString().slice(0, 10)}.csv`;

      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`);

      return reply.send(withBom(csv));
    }
  );

  // ============================================================
  // IMPORTANT: смена собственного пароля регистрируется ДО
  // параметризованных роутов /users/:id/* — чтобы никакой другой
  // обработчик не перехватил POST /users/:id/password.
  // ============================================================

  // -------- Users: смена собственного пароля (только superadmin, только сам себя) --------
  app.post<{ Params: { id: string } }>(
    '/users/:id/password',
    { preHandler: [requireAuth, requireRole('superadmin')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      if (req.user.id !== req.params.id) {
        throw new AppError(
          'FORBIDDEN',
          'Можно менять пароль только у своей учётной записи',
          403
        );
      }

      let input;
      try {
        input = changeOwnPasswordSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      await service.changeOwnPassword(req.user, req.params.id, input);

      // Сбрасываем cookie — пользователь должен перелогиниться
      reply
        .clearCookie('ulybka_access', {
          path: '/',
          domain: req.server.config.COOKIE_DOMAIN,
        })
        .clearCookie('ulybka_refresh', {
          path: '/api/v1/auth',
          domain: req.server.config.COOKIE_DOMAIN,
        });

      return reply.send({
        ok: true,
        message: 'Пароль изменён. Войдите заново.',
        relogin: true,
      });
    }
  );

  // -------- Users: bulk operations --------
  app.post(
    '/users/bulk',
    { preHandler: [requireAuth, requirePermission('users', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = bulkUserActionSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const result = await service.bulkUserAction(input, req.user);
      return reply.send(result);
    }
  );

  // -------- Users: create (с rate-limit) --------
  app.post(
    '/users',
    { preHandler: [requireAuth, requirePermission('users', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      const limit = await checkLimit(`admin-create:${req.user.id}`, 20, 3600);
      if (!limit.allowed) {
        reply.header('Retry-After', String(limit.retryAfterSec));
        throw new AppError(
          'TOO_MANY_REQUESTS',
          'Слишком много созданий пользователей. Попробуйте позже.',
          429
        );
      }

      let input;
      try {
        input = createUserSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      if (!canCreateRole(req.user.role, input.role)) {
        throw new AppError(
          'FORBIDDEN',
          `Ваша роль не может создавать пользователей с ролью «${input.role}»`,
          403
        );
      }

      const result = await service.createUserByAdmin(input, req.user, {
        ip: req.ctx.ip,
        userAgent: req.ctx.userAgent,
      });

      logger.info(
        { actorId: req.user.id, newUserId: result.user.id, role: input.role },
        'admin: user created'
      );

      return reply.status(201).send({
        user: result.user,
        temporaryPassword: result.temporaryPassword,
      });
    }
  );

  // -------- Users: detail --------
  app.get<{ Params: { id: string } }>(
    '/users/:id',
    { preHandler: [requireAuth, requirePermission('users', 'read')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);
      const user = await service.getUserDetail(req.params.id, req.user);
      return reply.send({ user });
    }
  );

  // -------- Users: role --------
  app.patch<{ Params: { id: string } }>(
    '/users/:id/role',
    { preHandler: [requireAuth, requirePermission('users', 'write')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = setUserRoleSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const user = await service.setUserRole(req.params.id, input.role, req.user.id);
      return reply.send({ user });
    }
  );

  // -------- Users: status --------
  app.patch<{ Params: { id: string } }>(
    '/users/:id/status',
    { preHandler: [requireAuth, requirePermission('users', 'block')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = setUserStatusSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const user = await service.setUserStatus(
        req.params.id,
        input.status,
        req.user.id,
        input.reason
      );
      return reply.send({ user });
    }
  );

  // -------- Users: fraud toggle --------
  app.patch<{ Params: { id: string } }>(
    '/users/:id/fraud',
    { preHandler: [requireAuth, requireRole('superadmin')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = toggleFraudSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const user = await service.toggleFraudDisabled(req.params.id, input, req.user);
      return reply.send({ user });
    }
  );

  // -------- Children: adjust points --------
  app.post<{ Params: { childId: string } }>(
    '/children/:childId/adjust-points',
    { preHandler: [requireAuth, requirePermission('points', 'adjust')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      let input;
      try {
        input = adjustPointsSchema.parse(req.body);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте поля', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const result = await service.adjustChildBalance(req.params.childId, input, req.user);
      return reply.send({ ok: true, balanceAfter: result.balanceAfter });
    }
  );

  // -------- Points: bulk-grant --------
  app.post(
    '/points/bulk-grant',
    { preHandler: [requireAuth, requirePermission('points', 'adjust')] },
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      const body = req.body as { childIds?: string[]; delta?: number; reason?: string };

      if (!Array.isArray(body.childIds) || body.childIds.length === 0) {
        throw new AppError('VALIDATION_ERROR', 'childIds обязателен', 422);
      }
      if (typeof body.delta !== 'number' || body.delta === 0) {
        throw new AppError('VALIDATION_ERROR', 'delta обязателен и не равен 0', 422);
      }
      if (!body.reason || body.reason.length < 3) {
        throw new AppError('VALIDATION_ERROR', 'reason обязателен', 422);
      }

      const result = await service.bulkGrantPoints({
        childIds: body.childIds,
        delta: body.delta,
        reason: body.reason,
        actorId: req.user.id,
      });

      return reply.send(result);
    }
  );

  // -------- Audit --------
  app.get(
    '/audit',
    { preHandler: [requireAuth, requirePermission('audit', 'read')] },
    async (req, reply) => {
      let query;
      try {
        query = listAuditQuerySchema.parse(req.query);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте параметры', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const result = await service.listAudit(query);
      return reply.send(result);
    }
  );

  // -------- Audit: export CSV --------
  app.get(
    '/audit/export',
    { preHandler: [requireAuth, requirePermission('audit', 'read')] },
    async (req, reply) => {
      let query;
      try {
        query = exportQuerySchema.parse(req.query);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте параметры', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const csv = await exports.exportAuditCsv(query);
      const filename = `audit-${new Date().toISOString().slice(0, 10)}.csv`;

      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`);

      return reply.send(withBom(csv));
    }
  );

  // -------- Attempts: export CSV --------
  app.get(
    '/attempts/export',
    { preHandler: [requireAuth, requirePermission('attempts', 'read')] },
    async (req, reply) => {
      let query;
      try {
        query = exportQuerySchema.parse(req.query);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте параметры', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const csv = await exports.exportAttemptsCsv(query);
      const filename = `attempts-${new Date().toISOString().slice(0, 10)}.csv`;

      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`);

      return reply.send(withBom(csv));
    }
  );

  // -------- Finance: export CSV --------
  app.get(
    '/finance/export',
    { preHandler: [requireAuth, requirePermission('finance', 'export')] },
    async (req, reply) => {
      let query;
      try {
        query = exportQuerySchema.parse(req.query);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте параметры', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const csv = await exports.exportPaymentsCsv(query);
      const filename = `payments-${new Date().toISOString().slice(0, 10)}.csv`;

      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`);

      return reply.send(withBom(csv));
    }
  );

  // -------- Redemptions: export CSV --------
  app.get(
    '/redemptions/export',
    { preHandler: [requireAuth, requirePermission('finance', 'export')] },
    async (req, reply) => {
      let query;
      try {
        query = exportQuerySchema.parse(req.query);
      } catch (err) {
        if (err instanceof ZodError) {
          throw new AppError('VALIDATION_ERROR', 'Проверьте параметры', 422, {
            fields: zodErrors(err),
          });
        }
        throw err;
      }

      const csv = await exports.exportRedemptionsCsv(query);
      const filename = `redemptions-${new Date().toISOString().slice(0, 10)}.csv`;

      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`);

      return reply.send(withBom(csv));
    }
  );
}