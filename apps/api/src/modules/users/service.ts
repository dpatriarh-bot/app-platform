// ============================================================
// users/service.ts — профиль, дети, экспорт (152-ФЗ), удаление
// Закрывает активные attempts перед soft-delete.
// Экспорт возвращает реальные названия тестов/офферов/планов.
// ============================================================

import { eq, and, isNull, desc, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  users,
  parents,
  children,
  childBalances,
  attempts,
  pointsLedger,
  subscriptions,
  payments,
  redemptions,
  sessions,
  tests,
  plans,
  partnerOffers,
  partners,
  type User,
  type Child,
} from '../../db/schema.js';
import { encryptPII, decryptPII, hashPII } from '../../lib/crypto.js';
import { verifyPassword } from '../../lib/password.js';
import { AppError } from '../../lib/errors.js';
import { writeAudit } from '../audit/service.js';
import { logger } from '../../lib/logger.js';
import { redis } from '../../lib/redis.js';
import type {
  UpdateProfileInput,
  UpdateChildInput,
  CreateChildInput,
  DeleteAccountInput,
} from './schemas.js';

// ============================================================
// Профиль
// ============================================================

export interface ParentProfile {
  userId: string;
  phone: string;
  email: string | null;
  fullName: string;
  city: string | null;
  role: string;
  status: string;
  totpEnabled: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export async function getProfile(userId: string): Promise<ParentProfile> {
  const [row] = await db
    .select({
      userId: users.id,
      phone: users.phone,
      email: users.email,
      role: users.role,
      status: users.status,
      totpEnabled: users.totpEnabled,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
      fullNameEnc: parents.fullNameEnc,
      city: parents.city,
    })
    .from(users)
    .leftJoin(parents, eq(parents.userId, users.id))
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  if (!row) throw new AppError('NOT_FOUND', 'Профиль не найден', 404);

  const fullName = row.fullNameEnc ? decryptPII(row.fullNameEnc) ?? '' : '';

  return {
    userId: row.userId,
    phone: row.phone,
    email: row.email,
    fullName,
    city: row.city,
    role: row.role,
    status: row.status,
    totpEnabled: row.totpEnabled,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
  };
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
  req?: { ip: string; userAgent: string }
): Promise<ParentProfile> {
  const before = await getProfile(userId);

  await db.transaction(async (tx) => {
    const userUpdates: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };

    if (input.email !== undefined) {
      const email = input.email.toLowerCase().trim();
      if (email !== before.email) {
        const dup = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (dup.length > 0 && dup[0]!.id !== userId) {
          throw new AppError('EMAIL_TAKEN', 'Пользователь с таким адресом уже зарегистрирован', 409);
        }
      }
      userUpdates.email = email;
    }

    if (Object.keys(userUpdates).length > 0) {
      await tx.update(users).set(userUpdates).where(eq(users.id, userId));
    }

    if (input.fullName !== undefined || input.city !== undefined) {
      const parentUpdates: Partial<typeof parents.$inferInsert> = {};
      if (input.fullName !== undefined) {
        const trimmed = input.fullName.trim();
        parentUpdates.fullNameEnc = encryptPII(trimmed);
        parentUpdates.fullNameHash = hashPII(trimmed);
      }
      if (input.city !== undefined) {
        parentUpdates.city = input.city || null;
      }
      if (Object.keys(parentUpdates).length > 0) {
        await tx.update(parents).set(parentUpdates).where(eq(parents.userId, userId));
      }
    }
  });

  await redis.del(`user:${userId}`);

  const after = await getProfile(userId);

  await writeAudit({
    actorId: userId,
    actorRole: after.role as User['role'],
    action: 'profile.update',
    entity: 'user',
    entityId: userId,
    before: { email: before.email, city: before.city },
    after: { email: after.email, city: after.city },
    req: req ? ({ ctx: { ip: req.ip, userAgent: req.userAgent, requestId: '' } } as never) : undefined,
  });

  return after;
}

// ============================================================
// Дети
// ============================================================

export interface ChildPublic {
  id: string;
  fullName: string;
  birthDate: string;
  age: number;
  city: string | null;
  school: string | null;
  grade: number | null;
  avatarUrl: string | null;
  balance: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  createdAt: Date;
}

function calcAge(birthYear: number): number {
  return new Date().getFullYear() - birthYear;
}

export async function listChildren(parentId: string): Promise<ChildPublic[]> {
  const rows = await db
    .select({
      id: children.id,
      fullNameEnc: children.fullNameEnc,
      birthDateEnc: children.birthDateEnc,
      birthYear: children.birthYear,
      city: children.city,
      school: children.school,
      grade: children.grade,
      avatarUrl: children.avatarUrl,
      createdAt: children.createdAt,
      balance: childBalances.balance,
      lifetimeEarned: childBalances.lifetimeEarned,
      lifetimeSpent: childBalances.lifetimeSpent,
    })
    .from(children)
    .leftJoin(childBalances, eq(childBalances.childId, children.id))
    .where(and(eq(children.parentId, parentId), isNull(children.deletedAt)))
    .orderBy(children.createdAt);

  return rows.map((r) => ({
    id: r.id,
    fullName: decryptPII(r.fullNameEnc) ?? '',
    birthDate: decryptPII(r.birthDateEnc) ?? '',
    age: calcAge(r.birthYear),
    city: r.city,
    school: r.school,
    grade: r.grade,
    avatarUrl: r.avatarUrl,
    balance: r.balance ?? 0,
    lifetimeEarned: r.lifetimeEarned ?? 0,
    lifetimeSpent: r.lifetimeSpent ?? 0,
    createdAt: r.createdAt,
  }));
}

export async function getChild(parentId: string, childId: string): Promise<ChildPublic> {
  const [row] = await db
    .select({
      id: children.id,
      fullNameEnc: children.fullNameEnc,
      birthDateEnc: children.birthDateEnc,
      birthYear: children.birthYear,
      city: children.city,
      school: children.school,
      grade: children.grade,
      avatarUrl: children.avatarUrl,
      createdAt: children.createdAt,
      balance: childBalances.balance,
      lifetimeEarned: childBalances.lifetimeEarned,
      lifetimeSpent: childBalances.lifetimeSpent,
    })
    .from(children)
    .leftJoin(childBalances, eq(childBalances.childId, children.id))
    .where(
      and(
        eq(children.id, childId),
        eq(children.parentId, parentId),
        isNull(children.deletedAt)
      )
    )
    .limit(1);

  if (!row) throw new AppError('NOT_FOUND', 'Ребёнок не найден', 404);

  return {
    id: row.id,
    fullName: decryptPII(row.fullNameEnc) ?? '',
    birthDate: decryptPII(row.birthDateEnc) ?? '',
    age: calcAge(row.birthYear),
    city: row.city,
    school: row.school,
    grade: row.grade,
    avatarUrl: row.avatarUrl,
    balance: row.balance ?? 0,
    lifetimeEarned: row.lifetimeEarned ?? 0,
    lifetimeSpent: row.lifetimeSpent ?? 0,
    createdAt: row.createdAt,
  };
}

export async function createChild(
  parentId: string,
  input: CreateChildInput
): Promise<ChildPublic> {
  const fio = input.fullName.trim();
  const birthYear = new Date(input.birthDate).getFullYear();

  const [child] = await db
    .insert(children)
    .values({
      parentId,
      fullNameEnc: encryptPII(fio),
      fullNameHash: hashPII(fio),
      birthDateEnc: encryptPII(input.birthDate),
      birthYear,
      city: input.city || null,
      school: input.school || null,
      grade: input.grade ?? null,
    })
    .returning();

  await db.insert(childBalances).values({
    childId: child!.id,
    balance: 0,
    lifetimeEarned: 0,
    lifetimeSpent: 0,
  });

  await writeAudit({
    actorId: parentId,
    action: 'child.create',
    entity: 'child',
    entityId: child!.id,
    after: { grade: child!.grade, city: child!.city },
  });

  return getChild(parentId, child!.id);
}

export async function updateChild(
  parentId: string,
  childId: string,
  input: UpdateChildInput
): Promise<ChildPublic> {
  const before = await getChild(parentId, childId);

  const updates: Partial<typeof children.$inferInsert> = { updatedAt: new Date() };

  if (input.fullName !== undefined) {
    const fio = input.fullName.trim();
    updates.fullNameEnc = encryptPII(fio);
    updates.fullNameHash = hashPII(fio);
  }
  if (input.birthDate !== undefined) {
    updates.birthDateEnc = encryptPII(input.birthDate);
    updates.birthYear = new Date(input.birthDate).getFullYear();
  }
  if (input.city !== undefined) updates.city = input.city || null;
  if (input.school !== undefined) updates.school = input.school || null;
  if (input.grade !== undefined) updates.grade = input.grade;

  await db
    .update(children)
    .set(updates)
    .where(and(eq(children.id, childId), eq(children.parentId, parentId)));

  await writeAudit({
    actorId: parentId,
    action: 'child.update',
    entity: 'child',
    entityId: childId,
    before: { grade: before.grade, city: before.city },
  });

  return getChild(parentId, childId);
}

export async function deleteChild(parentId: string, childId: string): Promise<void> {
  const child = await getChild(parentId, childId);

  await db
    .update(children)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(children.id, childId), eq(children.parentId, parentId)));

  await writeAudit({
    actorId: parentId,
    action: 'child.delete',
    entity: 'child',
    entityId: childId,
    before: { fullName: child.fullName },
  });
}

// ============================================================
// Экспорт данных (152-ФЗ)
// ============================================================

export interface ExportBundle {
  exportedAt: string;
  user: {
    phone: string;
    email: string | null;
    role: string;
    createdAt: Date;
    consentVersion: string | null;
    consentAt: Date | null;
  };
  parent: { fullName: string; city: string | null } | null;
  children: Array<{
    id: string;
    fullName: string;
    birthDate: string;
    city: string | null;
    school: string | null;
    grade: number | null;
    balance: number;
    attempts: Array<{
      testTitle: string;
      startedAt: Date;
      finishedAt: Date | null;
      scorePoints: number;
      correctCount: number;
      totalCount: number;
    }>;
    pointsHistory: Array<{
      delta: number;
      reason: string;
      description: string | null;
      createdAt: Date;
    }>;
    redemptions: Array<{
      offerTitle: string;
      partnerName: string;
      status: string;
      pointsSpent: number;
      createdAt: Date;
    }>;
  }>;
  subscriptions: Array<{
    status: string;
    planName: string;
    priceRub: number;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    autoRenew: boolean;
  }>;
  payments: Array<{
    amountRub: number;
    status: string;
    paidAt: Date | null;
    createdAt: Date;
  }>;
}

export async function exportUserData(userId: string): Promise<ExportBundle> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AppError('NOT_FOUND', 'Пользователь не найден', 404);

  const [parentRow] = await db
    .select()
    .from(parents)
    .where(eq(parents.userId, userId))
    .limit(1);

  const childrenRows = await db
    .select()
    .from(children)
    .where(and(eq(children.parentId, userId), isNull(children.deletedAt)));

  const childrenBundle: ExportBundle['children'] = [];

  for (const c of childrenRows) {
    const [bal] = await db
      .select()
      .from(childBalances)
      .where(eq(childBalances.childId, c.id))
      .limit(1);

    const childAttempts = await db
      .select({
        startedAt: attempts.startedAt,
        finishedAt: attempts.finishedAt,
        scorePoints: attempts.scorePoints,
        correctCount: attempts.correctCount,
        totalCount: attempts.totalCount,
        testTitle: tests.title,
      })
      .from(attempts)
      .leftJoin(tests, eq(tests.id, attempts.testId))
      .where(eq(attempts.childId, c.id))
      .orderBy(desc(attempts.startedAt))
      .limit(100);

    const points = await db
      .select({
        delta: pointsLedger.delta,
        reason: pointsLedger.reason,
        description: pointsLedger.description,
        createdAt: pointsLedger.createdAt,
      })
      .from(pointsLedger)
      .where(eq(pointsLedger.childId, c.id))
      .orderBy(desc(pointsLedger.createdAt))
      .limit(200);

    const reds = await db
      .select({
        status: redemptions.status,
        pointsSpent: redemptions.pointsSpent,
        createdAt: redemptions.createdAt,
        offerTitle: partnerOffers.title,
        partnerName: partners.name,
      })
      .from(redemptions)
      .leftJoin(partnerOffers, eq(partnerOffers.id, redemptions.offerId))
      .leftJoin(partners, eq(partners.id, redemptions.partnerId))
      .where(eq(redemptions.childId, c.id))
      .orderBy(desc(redemptions.createdAt))
      .limit(100);

    childrenBundle.push({
      id: c.id,
      fullName: decryptPII(c.fullNameEnc) ?? '',
      birthDate: decryptPII(c.birthDateEnc) ?? '',
      city: c.city,
      school: c.school,
      grade: c.grade,
      balance: bal?.balance ?? 0,
      attempts: childAttempts.map((a) => ({
        testTitle: a.testTitle ?? '—',
        startedAt: a.startedAt,
        finishedAt: a.finishedAt,
        scorePoints: a.scorePoints,
        correctCount: a.correctCount,
        totalCount: a.totalCount,
      })),
      pointsHistory: points.map((p) => ({
        delta: p.delta,
        reason: p.reason,
        description: p.description,
        createdAt: p.createdAt,
      })),
      redemptions: reds.map((r) => ({
        offerTitle: r.offerTitle ?? '—',
        partnerName: r.partnerName ?? '—',
        status: r.status,
        pointsSpent: r.pointsSpent,
        createdAt: r.createdAt,
      })),
    });
  }

  const subs = await db
    .select({
      status: subscriptions.status,
      currentPeriodStart: subscriptions.currentPeriodStart,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      autoRenew: subscriptions.autoRenew,
      planName: plans.name,
      priceRub: plans.priceRub,
    })
    .from(subscriptions)
    .leftJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.parentId, userId));

  const pays = await db
    .select({
      amountRub: payments.amountRub,
      status: payments.status,
      paidAt: payments.paidAt,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .where(eq(payments.parentId, userId))
    .orderBy(desc(payments.createdAt))
    .limit(200);

  await writeAudit({
    actorId: userId,
    action: 'profile.export',
    entity: 'user',
    entityId: userId,
  });

  return {
    exportedAt: new Date().toISOString(),
    user: {
      phone: user.phone,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      consentVersion: user.consentVersion,
      consentAt: user.consentAt,
    },
    parent: parentRow
      ? { fullName: decryptPII(parentRow.fullNameEnc) ?? '', city: parentRow.city }
      : null,
    children: childrenBundle,
    subscriptions: subs.map((s) => ({
      status: s.status,
      planName: s.planName ?? '—',
      priceRub: s.priceRub ?? 0,
      currentPeriodStart: s.currentPeriodStart,
      currentPeriodEnd: s.currentPeriodEnd,
      autoRenew: s.autoRenew,
    })),
    payments: pays.map((p) => ({
      amountRub: p.amountRub,
      status: p.status,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
    })),
  };
}

// ============================================================
// Удаление аккаунта
// ============================================================

export async function deleteAccount(
  userId: string,
  input: DeleteAccountInput,
  req?: { ip: string; userAgent: string }
): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AppError('NOT_FOUND', 'Пользователь не найден', 404);

  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) throw new AppError('INVALID_PASSWORD', 'Неверный пароль', 401);

  await db.transaction(async (tx) => {
    // Забираем детей
    const kids = await tx
      .select({ id: children.id })
      .from(children)
      .where(eq(children.parentId, userId));

    const childIds = kids.map((k) => k.id);

    if (childIds.length > 0) {
      // Закрываем активные попытки
      await tx
        .update(attempts)
        .set({
          status: 'abandoned',
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            inArray(attempts.childId, childIds),
            eq(attempts.status, 'in_progress')
          )
        );

      // Soft-delete детей
      await tx
        .update(children)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(inArray(children.id, childIds));

      // Затираем PII детей
      for (const k of childIds) {
        await tx
          .update(children)
          .set({
            fullNameEnc: '',
            fullNameHash: '',
            birthDateEnc: '',
            school: null,
            city: null,
          })
          .where(eq(children.id, k));
      }
    }

    // PII родителя
    await tx
      .update(parents)
      .set({ fullNameEnc: '', fullNameHash: '', city: null })
      .where(eq(parents.userId, userId));

    // Пользователь
    await tx
      .update(users)
      .set({
        status: 'deleted',
        deletedAt: new Date(),
        email: null,
        totpEnabled: false,
        totpSecret: null,
        totpRecoveryCodes: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    // Сессии — отзываем
    await tx
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: 'account_deleted' })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  });

  await redis.del(`user:${userId}`);

  await writeAudit({
    actorId: userId,
    action: 'profile.delete',
    entity: 'user',
    entityId: userId,
    after: { reason: input.reason ?? null },
    req: req ? ({ ctx: { ip: req.ip, userAgent: req.userAgent, requestId: '' } } as never) : undefined,
  });

  logger.info({ userId }, 'account soft-deleted');
}

// ============================================================
// Статистика профиля
// ============================================================

export interface ProfileStats {
  childrenCount: number;
  totalAttempts: number;
  totalPointsEarned: number;
  totalPointsSpent: number;
  currentBalance: number;
  subscriptionActive: boolean;
}

export async function getProfileStats(userId: string): Promise<ProfileStats> {
  const kids = await db
    .select({ id: children.id })
    .from(children)
    .where(and(eq(children.parentId, userId), isNull(children.deletedAt)));

  let totalAttempts = 0;
  let totalPointsEarned = 0;
  let totalPointsSpent = 0;
  let currentBalance = 0;

  for (const k of kids) {
    const attRows = await db
      .select({ id: attempts.id })
      .from(attempts)
      .where(eq(attempts.childId, k.id));
    totalAttempts += attRows.length;

    const [bal] = await db
      .select()
      .from(childBalances)
      .where(eq(childBalances.childId, k.id))
      .limit(1);

    if (bal) {
      totalPointsEarned += bal.lifetimeEarned;
      totalPointsSpent += bal.lifetimeSpent;
      currentBalance += bal.balance;
    }
  }

  const [sub] = await db
    .select({ status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.parentId, userId))
    .limit(1);

  return {
    childrenCount: kids.length,
    totalAttempts,
    totalPointsEarned,
    totalPointsSpent,
    currentBalance,
    subscriptionActive: sub?.status === 'active',
  };
}