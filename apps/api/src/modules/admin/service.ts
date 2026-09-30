// ============================================================
// admin/service.ts — админский дашборд, пользователи, статистика,
// создание пользователей, карточка пользователя, антифрод-тумблер,
// восстановление soft-deleted, массовые операции.
// ============================================================

import { eq, and, isNull, ilike, sql, desc, gte, lte, inArray } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { db } from '../../db/client.js';
import {
  users,
  parents,
  children,
  childBalances,
  attempts,
  tests,
  subjects,
  subscriptions,
  payments,
  auditLog,
  spotChecks,
  partners,
  partnerOffers,
  redemptions,
  type User,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { writeAudit } from '../audit/service.js';
import { redis } from '../../lib/redis.js';
import { decryptPII, maskPhone, encryptPII, hashPII } from '../../lib/crypto.js';
import { normalizePhone } from '../../lib/phone.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { revokeAllUserSessions } from '../auth/service.js';
import { canCreateRole, canToggleFraudDisabled } from '../../middleware/rbac.js';
import { awardPoints } from '../points/service.js';
import { logger } from '../../lib/logger.js';
import type {
  ListUsersQuery,
  ListAuditQuery,
  CreateUserInput,
  AdjustPointsInput,
  ToggleFraudInput,
  BulkUserActionInput,
  ChangeOwnPasswordInput,
} from './schemas.js';

// ============================================================
// Дашборд
// ============================================================

export interface DashboardData {
  period: { days: number; from: Date; to: Date };
  totals: {
    parents: number;
    children: number;
    attempts: number;
    activeSubscriptions: number;
    pastDueSubscriptions: number;
    revenueRub: number;
    flaggedAttempts: number;
    blockedAttempts: number;
    pendingSpotChecks: number;
  };
  trend: {
    registrations: Array<{ date: string; count: number }>;
    attempts: Array<{ date: string; count: number }>;
    revenue: Array<{ date: string; amountRub: number }>;
  };
  topSubjects: Array<{ subjectId: string; title: string; attempts: number }>;
  topSuspicious: Array<{
    childId: string;
    childName: string;
    flaggedCount: number;
    avgSuspicion: number;
  }>;
}

export async function getDashboard(days: number): Promise<DashboardData> {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 3600 * 1000);

  const [
    parentsCount,
    childrenCount,
    attemptsCount,
    activeSubsCount,
    pastDueCount,
    revenueRow,
    flaggedCount,
    blockedCount,
    spotChecksCount,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.role, 'parent'), isNull(users.deletedAt))),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(children)
      .where(isNull(children.deletedAt)),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(attempts)
      .where(gte(attempts.startedAt, from)),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(subscriptions)
      .where(eq(subscriptions.status, 'active')),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(subscriptions)
      .where(eq(subscriptions.status, 'past_due')),

    db
      .select({ total: sql<number>`COALESCE(SUM(${payments.amountRub}), 0)::int` })
      .from(payments)
      .where(and(eq(payments.status, 'succeeded'), gte(payments.paidAt, from))),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(attempts)
      .where(and(eq(attempts.status, 'flagged'), gte(attempts.finishedAt, from))),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(attempts)
      .where(and(eq(attempts.status, 'blocked'), gte(attempts.finishedAt, from))),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(spotChecks)
      .where(inArray(spotChecks.status, ['scheduled', 'in_progress'])),
  ]);

  const registrationsRows = await db
    .select({
      d: sql<string>`TO_CHAR(${users.createdAt}::date, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(users)
    .where(and(eq(users.role, 'parent'), gte(users.createdAt, from)))
    .groupBy(sql`TO_CHAR(${users.createdAt}::date, 'YYYY-MM-DD')`)
    .orderBy(sql`TO_CHAR(${users.createdAt}::date, 'YYYY-MM-DD')`);

  const attemptsTrendRows = await db
    .select({
      d: sql<string>`TO_CHAR(${attempts.startedAt}::date, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(attempts)
    .where(gte(attempts.startedAt, from))
    .groupBy(sql`TO_CHAR(${attempts.startedAt}::date, 'YYYY-MM-DD')`)
    .orderBy(sql`TO_CHAR(${attempts.startedAt}::date, 'YYYY-MM-DD')`);

  const revenueTrendRows = await db
    .select({
      d: sql<string>`TO_CHAR(${payments.paidAt}::date, 'YYYY-MM-DD')`,
      amountRub: sql<number>`COALESCE(SUM(${payments.amountRub}), 0)::int`,
    })
    .from(payments)
    .where(and(eq(payments.status, 'succeeded'), gte(payments.paidAt, from)))
    .groupBy(sql`TO_CHAR(${payments.paidAt}::date, 'YYYY-MM-DD')`)
    .orderBy(sql`TO_CHAR(${payments.paidAt}::date, 'YYYY-MM-DD')`);

  const topSubjectsRows = await db
    .select({
      subjectId: subjects.id,
      title: subjects.title,
      attempts: sql<number>`count(${attempts.id})::int`,
    })
    .from(subjects)
    .innerJoin(tests, eq(tests.subjectId, subjects.id))
    .innerJoin(attempts, eq(attempts.testId, tests.id))
    .where(gte(attempts.startedAt, from))
    .groupBy(subjects.id, subjects.title)
    .orderBy(desc(sql`count(${attempts.id})`))
    .limit(5);

  const topSuspiciousRows = await db
    .select({
      childId: attempts.childId,
      fullNameEnc: children.fullNameEnc,
      flaggedCount: sql<number>`count(*) FILTER (WHERE ${attempts.status} IN ('flagged','blocked'))::int`,
      avgSuspicion: sql<number>`COALESCE(AVG(${attempts.suspicionScore}) FILTER (WHERE ${attempts.status} IN ('flagged','blocked')), 0)::int`,
    })
    .from(attempts)
    .innerJoin(children, eq(children.id, attempts.childId))
    .where(
      and(
        gte(attempts.finishedAt, from),
        inArray(attempts.status, ['flagged', 'blocked'])
      )
    )
    .groupBy(attempts.childId, children.fullNameEnc)
    .orderBy(
      desc(
        sql`COALESCE(AVG(${attempts.suspicionScore}) FILTER (WHERE ${attempts.status} IN ('flagged','blocked')), 0)`
      )
    )
    .limit(5);

  return {
    period: { days, from, to },
    totals: {
      parents: parentsCount[0]?.count ?? 0,
      children: childrenCount[0]?.count ?? 0,
      attempts: attemptsCount[0]?.count ?? 0,
      activeSubscriptions: activeSubsCount[0]?.count ?? 0,
      pastDueSubscriptions: pastDueCount[0]?.count ?? 0,
      revenueRub: revenueRow[0]?.total ?? 0,
      flaggedAttempts: flaggedCount[0]?.count ?? 0,
      blockedAttempts: blockedCount[0]?.count ?? 0,
      pendingSpotChecks: spotChecksCount[0]?.count ?? 0,
    },
    trend: {
      registrations: registrationsRows.map((r) => ({ date: r.d, count: r.count })),
      attempts: attemptsTrendRows.map((r) => ({ date: r.d, count: r.count })),
      revenue: revenueTrendRows.map((r) => ({ date: r.d, amountRub: r.amountRub })),
    },
    topSubjects: topSubjectsRows.map((r) => ({
      subjectId: r.subjectId,
      title: r.title,
      attempts: r.attempts,
    })),
    topSuspicious: topSuspiciousRows.map((r) => ({
      childId: r.childId,
      childName: decryptPII(r.fullNameEnc) ?? '',
      flaggedCount: r.flaggedCount,
      avgSuspicion: r.avgSuspicion,
    })),
  };
}

// ============================================================
// Пользователи — список
// ============================================================

export interface AdminUserPublic {
  id: string;
  role: User['role'];
  status: User['status'];
  phone: string;
  phoneMasked: string;
  email: string | null;
  fullName: string | null;
  city: string | null;
  childrenCount: number;
  attemptsCount: number;
  subscriptionStatus: string | null;
  fraudDisabled: boolean;
  partnerId: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  totpEnabled: boolean;
}

export async function listUsers(
  query: ListUsersQuery
): Promise<{ items: AdminUserPublic[]; total: number }> {
  const conditions = [isNull(users.deletedAt)];

  if (query.role) conditions.push(eq(users.role, query.role));
  if (query.status) conditions.push(eq(users.status, query.status));

  if (query.q) {
    const phone = normalizePhone(query.q);
    if (phone) {
      conditions.push(eq(users.phone, phone));
    } else {
      const like = `%${query.q.toLowerCase()}%`;
      conditions.push(sql`(LOWER(COALESCE(${users.email}, '')) LIKE ${like})`);
    }
  }

  const where = and(...conditions);

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        user: users,
        parentFullNameEnc: parents.fullNameEnc,
        parentCity: parents.city,
        childrenCount: sql<number>`(
          SELECT COUNT(*)::int FROM children c
          WHERE c.parent_id = ${users.id} AND c.deleted_at IS NULL
        )`,
        attemptsCount: sql<number>`(
          SELECT COUNT(*)::int FROM attempts a
          INNER JOIN children c ON c.id = a.child_id
          WHERE c.parent_id = ${users.id}
        )`,
        subscriptionStatus: sql<string | null>`(
          SELECT s.status::text FROM subscriptions s
          WHERE s.parent_id = ${users.id}
          ORDER BY s.created_at DESC LIMIT 1
        )`,
      })
      .from(users)
      .leftJoin(parents, eq(parents.userId, users.id))
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(users).where(where),
  ]);

  return {
    items: rows.map((r) => toAdminUser(r)),
    total: totalRow[0]?.count ?? 0,
  };
}

function toAdminUser(r: {
  user: User;
  parentFullNameEnc: string | null;
  parentCity: string | null;
  childrenCount: number;
  attemptsCount: number;
  subscriptionStatus: string | null;
}): AdminUserPublic {
  return {
    id: r.user.id,
    role: r.user.role,
    status: r.user.status,
    phone: r.user.phone,
    phoneMasked: maskPhone(r.user.phone),
    email: r.user.email,
    fullName: r.parentFullNameEnc ? decryptPII(r.parentFullNameEnc) ?? null : null,
    city: r.parentCity ?? null,
    childrenCount: r.childrenCount,
    attemptsCount: r.attemptsCount,
    subscriptionStatus: r.subscriptionStatus,
    fraudDisabled: r.user.fraudDisabled,
    partnerId: r.user.partnerId,
    createdAt: r.user.createdAt,
    lastLoginAt: r.user.lastLoginAt,
    totpEnabled: r.user.totpEnabled,
  };
}

// ============================================================
// Пользователь — карточка
// ============================================================

export interface AdminChildShort {
  id: string;
  fullName: string;
  age: number;
  grade: number | null;
  balance: number;
  attemptsCount: number;
  flaggedCount: number;
}

export interface AdminAttemptShort {
  id: string;
  testTitle: string;
  status: string;
  scorePoints: number;
  percentCorrect: number;
  suspicionScore: number;
  finishedAt: Date | null;
  startedAt: Date;
}

export interface AdminPaymentShort {
  id: string;
  amountRub: number;
  status: string;
  paidAt: Date | null;
  createdAt: Date;
}

export interface AdminPartnerShort {
  id: string;
  slug: string;
  name: string;
  status: string;
  offersCount: number;
  redemptionsCount: number;
}

export interface AdminUserDetail extends AdminUserPublic {
  children: AdminChildShort[];
  recentAttempts: AdminAttemptShort[];
  recentPayments: AdminPaymentShort[];
  partner: AdminPartnerShort | null;
  totalPaidRub: number;
  fraudDisabledReason: string | null;
}

export async function getUserDetail(
  id: string,
  actor?: User
): Promise<AdminUserDetail> {
  const [row] = await db
    .select({
      user: users,
      parentFullNameEnc: parents.fullNameEnc,
      parentCity: parents.city,
      childrenCount: sql<number>`(
        SELECT COUNT(*)::int FROM children c
        WHERE c.parent_id = ${users.id} AND c.deleted_at IS NULL
      )`,
      attemptsCount: sql<number>`(
        SELECT COUNT(*)::int FROM attempts a
        INNER JOIN children c ON c.id = a.child_id
        WHERE c.parent_id = ${users.id}
      )`,
      subscriptionStatus: sql<string | null>`(
        SELECT s.status::text FROM subscriptions s
        WHERE s.parent_id = ${users.id}
        ORDER BY s.created_at DESC LIMIT 1
      )`,
    })
    .from(users)
    .leftJoin(parents, eq(parents.userId, users.id))
    .where(eq(users.id, id))
    .limit(1);

  if (!row) throw new AppError('NOT_FOUND', 'Пользователь не найден', 404);

  if (actor) {
    await writeAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'admin.user.read_pii',
      entity: 'user',
      entityId: id,
    });
  }

  const base = toAdminUser(row);

  const kids = await db
    .select({
      id: children.id,
      fullNameEnc: children.fullNameEnc,
      birthYear: children.birthYear,
      grade: children.grade,
      balance: childBalances.balance,
    })
    .from(children)
    .leftJoin(childBalances, eq(childBalances.childId, children.id))
    .where(and(eq(children.parentId, id), isNull(children.deletedAt)));

  const kidIds = kids.map((k) => k.id);

  const statsByChild = new Map<
    string,
    { count: number; flagged: number }
  >();
  if (kidIds.length > 0) {
    const statsRows = await db
      .select({
        childId: attempts.childId,
        count: sql<number>`count(*)::int`,
        flagged: sql<number>`count(*) FILTER (WHERE ${attempts.status} IN ('flagged','blocked'))::int`,
      })
      .from(attempts)
      .where(inArray(attempts.childId, kidIds))
      .groupBy(attempts.childId);
    for (const s of statsRows) {
      statsByChild.set(s.childId, { count: s.count, flagged: s.flagged });
    }
  }

  const kidsDetailed: AdminChildShort[] = kids.map((k) => {
    const s = statsByChild.get(k.id);
    return {
      id: k.id,
      fullName: decryptPII(k.fullNameEnc) ?? '',
      age: new Date().getFullYear() - k.birthYear,
      grade: k.grade,
      balance: k.balance ?? 0,
      attemptsCount: s?.count ?? 0,
      flaggedCount: s?.flagged ?? 0,
    };
  });

  const recentAttempts = await db
    .select({
      id: attempts.id,
      testTitle: tests.title,
      status: attempts.status,
      scorePoints: attempts.scorePoints,
      percentCorrect: attempts.percentCorrect,
      suspicionScore: attempts.suspicionScore,
      finishedAt: attempts.finishedAt,
      startedAt: attempts.startedAt,
    })
    .from(attempts)
    .innerJoin(children, eq(children.id, attempts.childId))
    .leftJoin(tests, eq(tests.id, attempts.testId))
    .where(eq(children.parentId, id))
    .orderBy(desc(attempts.startedAt))
    .limit(10);

  const recentPayments = await db
    .select({
      id: payments.id,
      amountRub: payments.amountRub,
      status: payments.status,
      paidAt: payments.paidAt,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .where(eq(payments.parentId, id))
    .orderBy(desc(payments.createdAt))
    .limit(10);

  const [sumRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(${payments.amountRub}), 0)::int` })
    .from(payments)
    .where(and(eq(payments.parentId, id), eq(payments.status, 'succeeded')));

  let partner: AdminPartnerShort | null = null;
  if (row.user.partnerId) {
    const [p] = await db
      .select({
        id: partners.id,
        slug: partners.slug,
        name: partners.name,
        status: partners.status,
      })
      .from(partners)
      .where(eq(partners.id, row.user.partnerId))
      .limit(1);

    if (p) {
      const [offersCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(partnerOffers)
        .where(eq(partnerOffers.partnerId, p.id));

      const [redsCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(redemptions)
        .where(eq(redemptions.partnerId, p.id));

      partner = {
        id: p.id,
        slug: p.slug,
        name: p.name,
        status: p.status,
        offersCount: offersCount?.count ?? 0,
        redemptionsCount: redsCount?.count ?? 0,
      };
    }
  }

  return {
    ...base,
    children: kidsDetailed,
    recentAttempts: recentAttempts.map((a) => ({
      id: a.id,
      testTitle: a.testTitle ?? '—',
      status: a.status,
      scorePoints: a.scorePoints,
      percentCorrect: Number(a.percentCorrect ?? 0),
      suspicionScore: a.suspicionScore,
      finishedAt: a.finishedAt,
      startedAt: a.startedAt,
    })),
    recentPayments: recentPayments.map((p) => ({
      id: p.id,
      amountRub: p.amountRub,
      status: p.status,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
    })),
    partner,
    totalPaidRub: sumRow?.total ?? 0,
    fraudDisabledReason: null,
  };
}

// ============================================================
// Изменение роли / статуса / восстановление
// ============================================================

export async function setUserRole(
  userId: string,
  role: User['role'],
  actorId: string
): Promise<AdminUserPublic> {
  const before = await getUserDetail(userId, undefined);
  if (userId === actorId) {
    throw new AppError('SELF_ROLE', 'Нельзя изменить свою роль', 400);
  }

  await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, userId));
  await redis.del(`user:${userId}`);

  await writeAudit({
    actorId,
    action: 'admin.user.set_role',
    entity: 'user',
    entityId: userId,
    before: { role: before.role },
    after: { role },
  });

  return getUserDetail(userId);
}

export async function setUserStatus(
  userId: string,
  status: User['status'],
  actorId: string,
  reason?: string
): Promise<AdminUserPublic> {
  const before = await getUserDetail(userId, undefined);

  if (userId === actorId && status !== 'active') {
    throw new AppError('SELF_BLOCK', 'Нельзя заблокировать себя', 400);
  }

  if (status === 'active' && before.status === 'deleted') {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) throw new AppError('NOT_FOUND', 'Пользователь не найден', 404);
    if (!user.deletedAt) throw new AppError('NOT_DELETED', 'Пользователь не был удалён', 400);

    const [conflict] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.phone, user.phone), isNull(users.deletedAt)))
      .limit(1);

    if (conflict && conflict.id !== userId) {
      throw new AppError(
        'PHONE_TAKEN',
        `Телефон ${user.phone} уже занят другим активным пользователем. Восстановление невозможно.`,
        409
      );
    }

    await db
      .update(users)
      .set({
        status: 'active',
        deletedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    await redis.del(`user:${userId}`);

    await writeAudit({
      actorId,
      action: 'admin.user.restore',
      entity: 'user',
      entityId: userId,
      before: { status: before.status },
      after: { status: 'active', reason: reason ?? null },
    });

    return getUserDetail(userId);
  }

  await db.update(users).set({ status, updatedAt: new Date() }).where(eq(users.id, userId));

  if (status === 'blocked' || status === 'deleted') {
    await db.execute(sql`
      UPDATE sessions SET revoked_at = NOW(), revoked_reason = ${`admin_${status}`}
      WHERE user_id = ${userId} AND revoked_at IS NULL
    `);
  }

  await redis.del(`user:${userId}`);

  await writeAudit({
    actorId,
    action: 'admin.user.set_status',
    entity: 'user',
    entityId: userId,
    before: { status: before.status },
    after: { status, reason: reason ?? null },
  });

  return getUserDetail(userId);
}

// ============================================================
// Создание пользователя (админский флоу)
// ============================================================

export interface CreateUserResult {
  user: AdminUserDetail;
  temporaryPassword: string;
}

export async function createUserByAdmin(
  input: CreateUserInput,
  actor: User,
  _meta: { ip: string; userAgent: string }
): Promise<CreateUserResult> {
  if (!canCreateRole(actor.role, input.role)) {
    throw new AppError('FORBIDDEN', `Роль «${actor.role}» не может создавать «${input.role}»`, 403);
  }

  const phone = normalizePhone(input.phone);
  if (!phone) throw new AppError('INVALID_PHONE', 'Некорректный номер телефона', 400);

  const existingByPhone = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phone, phone))
    .limit(1);
  if (existingByPhone.length > 0) {
    throw new AppError('PHONE_TAKEN', 'Пользователь с таким телефоном уже существует', 409);
  }

  const email = input.email.toLowerCase().trim();
  const existingByEmail = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existingByEmail.length > 0) {
    throw new AppError('EMAIL_TAKEN', 'Пользователь с таким адресом уже существует', 409);
  }

  let partnerId: string | null = null;
  if (input.role === 'partner') {
    if (!input.partnerId) {
      throw new AppError('PARTNER_REQUIRED', 'Для роли «партнёр» нужно выбрать партнёра', 422);
    }
    const [p] = await db
      .select({ id: partners.id })
      .from(partners)
      .where(eq(partners.id, input.partnerId))
      .limit(1);
    if (!p) throw new AppError('NOT_FOUND', 'Партнёр не найден', 404);
    partnerId = p.id;
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const created = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        role: input.role,
        status: 'active',
        phone,
        email,
        passwordHash,
        partnerId,
        mustChangePassword: true,
        createdBy: actor.id,
      })
      .returning();

    const fullName = input.fullName?.trim() || 'Не указано';
    await tx.insert(parents).values({
      userId: user!.id,
      fullNameEnc: encryptPII(fullName),
      fullNameHash: hashPII(fullName),
      city: input.city?.trim() || null,
    });

    return user!;
  });

  await writeAudit({
    actorId: actor.id,
    action: 'admin.user.create',
    entity: 'user',
    entityId: created.id,
    after: {
      role: input.role,
      phone: maskPhone(phone),
      email,
      partnerId,
    },
  });

  const detail = await getUserDetail(created.id, actor);

  return { user: detail, temporaryPassword };
}

function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const symbols = '!@#$%';
  const pick = (pool: string, n: number): string => {
    let s = '';
    for (let i = 0; i < n; i++) {
      s += pool[randomInt(0, pool.length)] ?? '';
    }
    return s;
  };
  return `${pick(alphabet, 6)}${pick(symbols, 1)}${pick(alphabet, 3)}`;
}

// ============================================================
// Тумблер антифрода (только superadmin)
// ============================================================

export async function toggleFraudDisabled(
  userId: string,
  input: ToggleFraudInput,
  actor: User
): Promise<AdminUserPublic> {
  if (!canToggleFraudDisabled(actor.role)) {
    throw new AppError('FORBIDDEN', 'Только супер-админ может менять этот флаг', 403);
  }

  const before = await getUserDetail(userId, undefined);
  if (before.role !== 'parent') {
    throw new AppError('INVALID_TARGET', 'Флаг антифрода применяется только к родителям', 400);
  }

  await db
    .update(users)
    .set({ fraudDisabled: input.disabled, updatedAt: new Date() })
    .where(eq(users.id, userId));

  await redis.del(`user:${userId}`);

  await writeAudit({
    actorId: actor.id,
    action: input.disabled ? 'admin.user.fraud_disabled' : 'admin.user.fraud_enabled',
    entity: 'user',
    entityId: userId,
    before: { fraudDisabled: before.fraudDisabled },
    after: { fraudDisabled: input.disabled, reason: input.reason },
  });

  return getUserDetail(userId);
}

// ============================================================
// Ручное изменение баланса ребёнка
// ============================================================

export async function adjustChildBalance(
  childId: string,
  input: AdjustPointsInput,
  actor: User
): Promise<{ balanceAfter: number }> {
  const [child] = await db
    .select({ id: children.id, parentId: children.parentId })
    .from(children)
    .where(and(eq(children.id, childId), isNull(children.deletedAt)))
    .limit(1);

  if (!child) throw new AppError('NOT_FOUND', 'Ребёнок не найден', 404);

  const result = await awardPoints({
    childId,
    delta: input.delta,
    reason: 'manual_adjust',
    description: input.reason,
    actorId: actor.id,
    idempotencyKey: `admin-adjust:${actor.id}:${childId}:${Date.now()}`,
  });

  await writeAudit({
    actorId: actor.id,
    action: 'admin.child.adjust_points',
    entity: 'child',
    entityId: childId,
    after: { delta: input.delta, reason: input.reason, balanceAfter: result.balanceAfter },
  });

  return { balanceAfter: result.balanceAfter };
}

// ============================================================
// Массовые операции с пользователями
// ============================================================

export interface BulkUserActionResult {
  affected: number;
  skipped: number;
  errors: Array<{ userId: string; message: string }>;
}

export async function bulkUserAction(
  input: BulkUserActionInput,
  actor: User
): Promise<BulkUserActionResult> {
  const result: BulkUserActionResult = {
    affected: 0,
    skipped: 0,
    errors: [],
  };

  for (const userId of input.userIds) {
    try {
      if (userId === actor.id && input.action !== 'unblock') {
        result.skipped += 1;
        continue;
      }

      switch (input.action) {
        case 'block':
          await setUserStatus(userId, 'blocked', actor.id, input.reason);
          break;
        case 'unblock':
          await setUserStatus(userId, 'active', actor.id, input.reason);
          break;
        case 'restore':
          await setUserStatus(userId, 'active', actor.id, input.reason);
          break;
        case 'set_role':
          if (!input.role) {
            throw new AppError('VALIDATION_ERROR', 'role обязателен для set_role', 422);
          }
          if (!canCreateRole(actor.role, input.role)) {
            throw new AppError('FORBIDDEN', 'Недостаточно прав для смены роли', 403);
          }
          await setUserRole(userId, input.role, actor.id);
          break;
      }

      result.affected += 1;
    } catch (err) {
      result.errors.push({
        userId,
        message: err instanceof AppError ? err.message : 'Неизвестная ошибка',
      });
    }
  }

  await writeAudit({
    actorId: actor.id,
    action: `admin.users.bulk_${input.action}`,
    entity: 'user',
    after: {
      action: input.action,
      requested: input.userIds.length,
      affected: result.affected,
      skipped: result.skipped,
      errors: result.errors.length,
      reason: input.reason,
    },
  });

  return result;
}

// ============================================================
// Аудит
// ============================================================

export interface AuditEntryPublic {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: Date;
}

export async function listAudit(
  query: ListAuditQuery
): Promise<{ items: AuditEntryPublic[]; total: number }> {
  const conditions = [];

  if (query.actorId) conditions.push(eq(auditLog.actorId, query.actorId));
  if (query.action) conditions.push(eq(auditLog.action, query.action));
  if (query.entity) conditions.push(eq(auditLog.entity, query.entity));
  if (query.entityId) conditions.push(eq(auditLog.entityId, query.entityId));
  if (query.from) conditions.push(gte(auditLog.createdAt, new Date(query.from)));
  if (query.to) conditions.push(lte(auditLog.createdAt, new Date(query.to)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalRow] = await Promise.all([
    db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(auditLog).where(where),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      actorRole: r.actorRole,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      before: r.beforeJson,
      after: r.afterJson,
      ip: r.ip,
      userAgent: r.userAgent,
      requestId: r.requestId,
      createdAt: r.createdAt,
    })),
    total: totalRow[0]?.count ?? 0,
  };
}

// ============================================================
// Аномалии
// ============================================================

export interface AnomaliesData {
  sharedIps: Array<{ ip: string; usersCount: number; userIds: string[] }>;
  sharedFingerprints: Array<{ fingerprint: string; attemptsCount: number; childIds: string[] }>;
  burstRegistrations: Array<{ date: string; count: number }>;
}

export async function getAnomalies(days = 7): Promise<AnomaliesData> {
  const from = new Date(Date.now() - days * 24 * 3600 * 1000);

  const ipsRows = await db.execute<{ ip: string; users_count: number; user_ids: string[] }>(sql`
    SELECT ip::text AS ip, COUNT(DISTINCT user_id)::int AS users_count,
           ARRAY_AGG(DISTINCT user_id::text) AS user_ids
    FROM sessions
    WHERE created_at >= ${from.toISOString()}::timestamptz AND ip IS NOT NULL
    GROUP BY ip
    HAVING COUNT(DISTINCT user_id) >= 3
    ORDER BY users_count DESC
    LIMIT 20
  `);

  const fpRows = await db.execute<{
    device_fingerprint: string;
    attempts_count: number;
    child_ids: string[];
  }>(sql`
    SELECT device_fingerprint, COUNT(*)::int AS attempts_count,
           ARRAY_AGG(DISTINCT child_id::text) AS child_ids
    FROM attempts
    WHERE started_at >= ${from.toISOString()}::timestamptz AND device_fingerprint IS NOT NULL
    GROUP BY device_fingerprint
    HAVING COUNT(DISTINCT child_id) >= 2
    ORDER BY attempts_count DESC
    LIMIT 20
  `);

  const burstRows = await db.execute<{ d: string; count: number }>(sql`
    SELECT TO_CHAR(created_at::date, 'YYYY-MM-DD') AS d, COUNT(*)::int AS count
    FROM users
    WHERE created_at >= ${from.toISOString()}::timestamptz AND role = 'parent'
    GROUP BY d
    HAVING COUNT(*) >= 10
    ORDER BY count DESC
  `);

  return {
    sharedIps: ipsRows.map((r) => ({
      ip: r.ip,
      usersCount: r.users_count,
      userIds: r.user_ids,
    })),
    sharedFingerprints: fpRows.map((r) => ({
      fingerprint: r.device_fingerprint,
      attemptsCount: r.attempts_count,
      childIds: r.child_ids,
    })),
    burstRegistrations: burstRows.map((r) => ({ date: r.d, count: r.count })),
  };
}

// ============================================================
// Массовое начисление баллов
// ============================================================

export async function bulkGrantPoints(input: {
  childIds: string[];
  delta: number;
  reason: string;
  actorId: string;
}): Promise<{ affected: number }> {
  if (input.childIds.length === 0) return { affected: 0 };
  if (input.delta === 0) throw new AppError('INVALID_DELTA', 'delta ≠ 0', 400);

  let affected = 0;
  for (const childId of input.childIds) {
    try {
      await awardPoints({
        childId,
        delta: input.delta,
        reason: 'manual_adjust',
        description: input.reason,
        actorId: input.actorId,
        idempotencyKey: `bulk:${input.actorId}:${childId}:${Date.now()}`,
      });
      affected += 1;
    } catch {
      // skip
    }
  }

  await writeAudit({
    actorId: input.actorId,
    action: 'admin.bulk_grant_points',
    entity: 'child',
    after: { count: affected, delta: input.delta, reason: input.reason },
  });

  return { affected };
}

// ============================================================
// Смена пароля суперадмином для себя
// ============================================================

export interface ChangeOwnPasswordResult {
  ok: true;
  revokedSessions: number;
}

/**
 * Меняет пароль суперадмина для своей же учётной записи.
 *
 * Защита:
 *  - actor.role === 'superadmin' (иначе 403)
 *  - actor.id === targetUserId (иначе 403)
 *  - требуется корректный текущий пароль
 *
 * Побочные эффекты:
 *  - старый пароль инвалидируется
 *  - все активные сессии отзываются
 *  - mustChangePassword сбрасывается
 *  - пишется audit
 */
export async function changeOwnPassword(
  actor: User,
  targetUserId: string,
  input: ChangeOwnPasswordInput
): Promise<ChangeOwnPasswordResult> {
  if (actor.role !== 'superadmin') {
    throw new AppError(
      'FORBIDDEN',
      'Смена пароля доступна только суперадмину',
      403
    );
  }

  if (actor.id !== targetUserId) {
    throw new AppError(
      'FORBIDDEN',
      'Можно менять пароль только у своей учётной записи',
      403
    );
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);

  if (!user) {
    throw new AppError('NOT_FOUND', 'Пользователь не найден', 404);
  }

  if (user.status === 'deleted') {
    throw new AppError('FORBIDDEN', 'Учётная запись удалена', 403);
  }

  const ok = await verifyPassword(user.passwordHash, input.currentPassword);
  if (!ok) {
    await writeAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'admin.self_password_change_failed',
      entity: 'user',
      entityId: targetUserId,
      after: { reason: 'invalid_current_password' },
    });
    throw new AppError('INVALID_PASSWORD', 'Неверный текущий пароль', 401);
  }

  const newHash = await hashPassword(input.newPassword);

  await db
    .update(users)
    .set({
      passwordHash: newHash,
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, targetUserId));

  await redis.del(`user:${targetUserId}`);

  await revokeAllUserSessions(targetUserId, 'admin_password_changed');

  await writeAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'admin.self_password_change',
    entity: 'user',
    entityId: targetUserId,
    after: { sessionsRevoked: true },
  });

  logger.info(
    { actorId: actor.id, targetUserId },
    'superadmin changed own password'
  );

  return { ok: true, revokedSessions: 0 };
}

void logger;