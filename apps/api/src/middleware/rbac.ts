// ============================================================
// middleware/rbac.ts — RBAC-хелперы: requireRole, requirePermission,
// getDefaultPermissionsForRole, canCreateRole.
// Плюс распределение прав при создании пользователей.
// ============================================================

import { db } from '../db/client.js';
import { permissions, type User } from '../db/schema.js';
import { eq, and, or } from 'drizzle-orm';
import { redis } from '../lib/redis.js';
import { Errors } from '../lib/errors.js';

// ============================================================
// Какие роли может создавать каждая роль
// ============================================================

const CREATE_MATRIX: Record<User['role'], User['role'][]> = {
  parent: [],
  partner: [],
  manager: [],
  curator: [],
  admin: ['parent', 'partner', 'manager', 'curator'],
  superadmin: ['parent', 'partner', 'manager', 'curator', 'admin', 'superadmin'],
};

export function canCreateRole(actorRole: User['role'], targetRole: User['role']): boolean {
  return CREATE_MATRIX[actorRole]?.includes(targetRole) ?? false;
}

export function listCreatableRoles(actorRole: User['role']): User['role'][] {
  return [...(CREATE_MATRIX[actorRole] ?? [])];
}

// ============================================================
// Роли, которые могут управлять флагом anti-fraud
// ============================================================

export function canToggleFraudDisabled(actorRole: User['role']): boolean {
  return actorRole === 'superadmin';
}

// ============================================================
// Проверка права по ресурсу/действию
// ============================================================

export async function hasPermission(
  role: User['role'],
  resource: string,
  action: string
): Promise<boolean> {
  if (role === 'superadmin') return true;

  const cacheKey = `perm:${role}:${resource}:${action}`;
  const cached = await redis.get(cacheKey);
  if (cached === '1') return true;
  if (cached === '0') return false;

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
  return allowed;
}

export async function requirePermission(
  role: User['role'],
  resource: string,
  action: string
): Promise<void> {
  const ok = await hasPermission(role, resource, action);
  if (!ok) throw Errors.forbidden();
}