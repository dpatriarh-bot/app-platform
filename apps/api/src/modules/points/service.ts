// ============================================================
// points/service.ts — атомарное начисление и списание баллов
// Использует points_ledger с idempotency_key + child_balances
// для быстрого чтения баланса. Всё в транзакции.
// ============================================================

import { eq, and, sql, desc, isNull, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  pointsLedger,
  childBalances,
  children,
  type PointsLedgerEntry,
  type ChildBalance,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { writeAudit } from '../audit/service.js';
import { logger } from '../../lib/logger.js';
import { createNotification } from '../notifications/service.js';
import { redis } from '../../lib/redis.js';

export type PointsReason =
  | 'attempt_reward'
  | 'manual_adjust'
  | 'redemption'
  | 'referral_bonus'
  | 'spot_check_confirmed'
  | 'fraud_reversal'
  | 'signup_bonus';

export interface AwardPointsInput {
  childId: string;
  delta: number; // может быть отрицательным (списание)
  reason: PointsReason;
  description?: string;
  attemptId?: string;
  redemptionId?: string;
  actorId?: string;
  idempotencyKey: string;
}

export interface AwardResult {
  entry: PointsLedgerEntry;
  balanceAfter: number;
  duplicate: boolean;
}

/**
 * Атомарное начисление/списание баллов.
 * Гарантия: одна и та же idempotencyKey не начислит баллы дважды.
 */
export async function awardPoints(input: AwardPointsInput): Promise<AwardResult> {
  return db.transaction(async (tx) => {
    // 1. Проверяем идемпотентность
    const existing = await tx
      .select()
      .from(pointsLedger)
      .where(eq(pointsLedger.idempotencyKey, input.idempotencyKey))
      .limit(1);

    if (existing.length > 0) {
      const entry = existing[0]!;
      return {
        entry,
        balanceAfter: entry.balanceAfter,
        duplicate: true,
      };
    }

    // 2. Блокируем строку баланса (SELECT ... FOR UPDATE)
    const balanceRows = await tx.execute<{ child_id: string; balance: number; lifetime_earned: number; lifetime_spent: number }>(
      sql`SELECT child_id, balance, lifetime_earned, lifetime_spent
          FROM child_balances
          WHERE child_id = ${input.childId}
          FOR UPDATE`
    );

    if (balanceRows.length === 0) {
      // создаём, если нет
      await tx.insert(childBalances).values({
        childId: input.childId,
        balance: 0,
        lifetimeEarned: 0,
        lifetimeSpent: 0,
      });
    }

    const current = balanceRows[0] ?? {
      balance: 0,
      lifetime_earned: 0,
      lifetime_spent: 0,
    };

    const newBalance = current.balance + input.delta;

    if (newBalance < 0) {
      throw new AppError(
        'INSUFFICIENT_POINTS',
        'Недостаточно баллов для списания',
        400
      );
    }

    const lifetimeEarned =
      input.delta > 0 ? current.lifetime_earned + input.delta : current.lifetime_earned;
    const lifetimeSpent =
      input.delta < 0 ? current.lifetime_spent + Math.abs(input.delta) : current.lifetime_spent;

    // 3. Записываем транзакцию в ledger
    const [entry] = await tx
      .insert(pointsLedger)
      .values({
        childId: input.childId,
        delta: input.delta,
        balanceAfter: newBalance,
        reason: input.reason,
        description: input.description ?? null,
        attemptId: input.attemptId ?? null,
        redemptionId: input.redemptionId ?? null,
        actorId: input.actorId ?? null,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();

    // 4. Обновляем материализованный баланс
    await tx
      .update(childBalances)
      .set({
        balance: newBalance,
        lifetimeEarned,
        lifetimeSpent,
        updatedAt: new Date(),
      })
      .where(eq(childBalances.childId, input.childId));

    return {
      entry: entry!,
      balanceAfter: newBalance,
      duplicate: false,
    };
  });
}

/**
 * Массовое начисление баллов группе детей.
 */
export async function awardPointsBatch(
  inputs: AwardPointsInput[]
): Promise<AwardResult[]> {
  const results: AwardResult[] = [];
  for (const input of inputs) {
    results.push(await awardPoints(input));
  }
  return results;
}

/**
 * Получить баланс ребёнка.
 */
export async function getBalance(childId: string): Promise<ChildBalance> {
  const [row] = await db
    .select()
    .from(childBalances)
    .where(eq(childBalances.childId, childId))
    .limit(1);

  if (!row) {
    return {
      childId,
      balance: 0,
      lifetimeEarned: 0,
      lifetimeSpent: 0,
      updatedAt: new Date(),
    };
  }

  return row;
}

/**
 * Получить балансы нескольких детей одним запросом.
 */
export async function getBalancesBatch(
  childIds: string[]
): Promise<Map<string, ChildBalance>> {
  if (childIds.length === 0) return new Map();

  const rows = await db
    .select()
    .from(childBalances)
    .where(inArray(childBalances.childId, childIds));

  const map = new Map<string, ChildBalance>();
  for (const row of rows) {
    map.set(row.childId, row);
  }
  return map;
}

/**
 * История операций по ребёнку.
 */
export async function getLedger(
  childId: string,
  options: { limit?: number; offset?: number; reason?: PointsReason } = {}
): Promise<{ items: PointsLedgerEntry[]; total: number }> {
  const limit = Math.min(options.limit ?? 50, 200);
  const offset = options.offset ?? 0;

  const conditions = [eq(pointsLedger.childId, childId)];
  if (options.reason) conditions.push(eq(pointsLedger.reason, options.reason));

  const where = and(...conditions);

  const [items, totalRow] = await Promise.all([
    db
      .select()
      .from(pointsLedger)
      .where(where)
      .orderBy(desc(pointsLedger.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(pointsLedger)
      .where(where),
  ]);

  return {
    items,
    total: totalRow[0]?.count ?? 0,
  };
}

/**
 * Ручная корректировка баллов администратором.
 * Пишет в audit_log, отправляет уведомление родителю.
 */
export async function manualAdjust(
  input: {
    childId: string;
    delta: number;
    reason: string;
    actorId: string;
  }
): Promise<AwardResult> {
  if (input.delta === 0) {
    throw new AppError('INVALID_DELTA', 'Изменение баллов не может быть нулевым', 400);
  }

  const idempotencyKey = `manual:${input.actorId}:${input.childId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

  const result = await awardPoints({
    childId: input.childId,
    delta: input.delta,
    reason: 'manual_adjust',
    description: input.reason,
    actorId: input.actorId,
    idempotencyKey,
  });

  // Инвалидируем кэш баланса
  await redis.del(`balance:${input.childId}`);

  // Уведомление ребёнку через его родителя
  const [child] = await db
    .select({ parentId: children.parentId })
    .from(children)
    .where(eq(children.id, input.childId))
    .limit(1);

  if (child) {
    await createNotification({
      userId: child.parentId,
      type: input.delta > 0 ? 'points_awarded' : 'points_deducted',
      title: input.delta > 0
        ? `Начислено ${input.delta} баллов`
        : `Списано ${Math.abs(input.delta)} баллов`,
      body: input.reason,
      link: '/app/points',
    });
  }

  await writeAudit({
    actorId: input.actorId,
    action: 'points.manual_adjust',
    entity: 'child',
    entityId: input.childId,
    after: { delta: input.delta, reason: input.reason, balanceAfter: result.balanceAfter },
  });

  logger.info(
    { childId: input.childId, delta: input.delta, actorId: input.actorId },
    'manual points adjust'
  );

  return result;
}

/**
 * Пересчёт баланса ребёнка из ledger (аварийное восстановление).
 * Используется, если баланс в child_balances разошёлся с ledger.
 */
export async function recalculateBalance(childId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const [sumRow] = await tx
      .select({
        total: sql<number>`COALESCE(SUM(${pointsLedger.delta}), 0)::int`,
        earned: sql<number>`COALESCE(SUM(CASE WHEN ${pointsLedger.delta} > 0 THEN ${pointsLedger.delta} ELSE 0 END), 0)::int`,
        spent: sql<number>`COALESCE(SUM(CASE WHEN ${pointsLedger.delta} < 0 THEN -${pointsLedger.delta} ELSE 0 END), 0)::int`,
      })
      .from(pointsLedger)
      .where(eq(pointsLedger.childId, childId));

    const total = sumRow?.total ?? 0;
    const earned = sumRow?.earned ?? 0;
    const spent = sumRow?.spent ?? 0;

    await tx
      .update(childBalances)
      .set({
        balance: total,
        lifetimeEarned: earned,
        lifetimeSpent: spent,
        updatedAt: new Date(),
      })
      .where(eq(childBalances.childId, childId));

    logger.warn({ childId, total, earned, spent }, 'balance recalculated');

    return total;
  });
}