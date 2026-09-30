// ============================================================
// auth/middleware.ts — requireAuth, optionalAuth, requireRole,
// requirePermission. Проверка access-токена и прав.
// ============================================================

import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken } from '../../lib/jwt.js';
import { Errors } from '../../lib/errors.js';
import { db } from '../../db/client.js';
import { users, permissions } from '../../db/schema.js';
import { eq, and, or } from 'drizzle-orm';
import { redis } from '../../lib/redis.js';
import type { User } from '../../db/schema.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
  }
}

const ACCESS_COOKIE = 'ulybka_access';

export function extractAccessToken(req: FastifyRequest): string | null {
  const fromCookie = req.cookies[ACCESS_COOKIE];
  if (fromCookie) return fromCookie;

  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);

  return null;
}

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = extractAccessToken(req);
  if (!token) throw Errors.unauthorized();

  let payload;
  try {
    payload = await verifyAccessToken(token);
  } catch {
    throw Errors.unauthorized('Сессия истекла');
  }

  const revokedKey = `session:revoked:${payload.sid}`;
  const isRevoked = await redis.get(revokedKey);
  if (isRevoked) throw Errors.unauthorized('Сессия отозвана');

  const cacheKey = `user:${payload.sub}`;
  let user: User | undefined;

  const cached = await redis.get(cacheKey);
  if (cached) {
    user = JSON.parse(cached) as User;
  } else {
    const [u] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
    if (u) {
      user = u;
      await redis.setex(cacheKey, 30, JSON.stringify(u));
    }
  }

  if (!user || user.status !== 'active') {
    throw Errors.unauthorized('Аккаунт недоступен');
  }

  req.user = user;
}

export async function optionalAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  try {
    await requireAuth(req, _reply);
  } catch {
    // гость
  }
}

export function requireRole(...roles: User['role'][]) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!req.user) throw Errors.unauthorized();
    if (!roles.includes(req.user.role)) throw Errors.forbidden();
  };
}

export function requirePermission(resource: string, action: string) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!req.user) throw Errors.unauthorized();

    const role = req.user.role;
    if (role === 'superadmin') return;

    const cacheKey = `perm:${role}:${resource}:${action}`;
    const cached = await redis.get(cacheKey);
    if (cached === '1') return;
    if (cached === '0') throw Errors.forbidden();

    const rows = await db
      .select()
      .from(permissions)
      .where(
        and(
          eq(permissions.role, role),
          or(
            and(eq(permissions.resource, resource), eq(permissions.action, action)),
            and(eq(permissions.resource, resource), eq(permissions.action, '*')),
            and(eq(permissions.resource, '*'), eq(permissions.action, '*'))
          )
        )
      )
      .limit(1);

    const allowed = rows.length > 0;
    await redis.setex(cacheKey, 300, allowed ? '1' : '0');

    if (!allowed) throw Errors.forbidden();
  };
}

export async function markSessionRevoked(sessionId: string, ttlSec = 900): Promise<void> {
  await redis.setex(`session:revoked:${sessionId}`, ttlSec, '1');
}