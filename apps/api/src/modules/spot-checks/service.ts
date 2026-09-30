// ============================================================
// spot-checks/service.ts — очные проверки результатов
// Race-safe start через UPDATE ... RETURNING.
// Kiosk-токен отдельно, sanitize через общий checker.
// ============================================================

import { eq, and, isNull, desc, sql, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  spotChecks,
  spotCheckItems,
  attempts,
  children,
  type SpotCheck,
  type Question,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { writeAudit } from '../audit/service.js';
import { createNotification } from '../notifications/service.js';
import { awardPoints } from '../points/service.js';
import { checkAnswer } from '../questions/checker.js';
import { sanitizePayloadForClient } from '../questions/checker.js';
import { pickFromHistory } from '../questions/service.js';
import { decryptPII, randomToken, hmacSign, hmacVerify } from '../../lib/crypto.js';
import { redis } from '../../lib/redis.js';
import { link } from '../../lib/links.js';
import { config } from '../../config.js';
import type {
  ScheduleSpotCheckInput,
  SetVerdictInput,
  ListSpotChecksQuery,
} from './schemas.js';

const KIOSK_TOKEN_TTL_SEC = 60 * 60 * 2;

// ============================================================
// Назначение
// ============================================================

export interface SpotCheckPublic {
  id: string;
  childId: string;
  childName: string;
  curatorId: string | null;
  curatorName: string | null;
  scheduledAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  status: SpotCheck['status'];
  verdict: SpotCheck['verdict'];
  timeLimitSec: number;
  relatedAttemptIds: string[];
  correctCount: number;
  totalCount: number;
  scorePoints: number;
  notes: string | null;
  createdAt: Date;
}

async function toPublic(row: {
  check: SpotCheck;
  childNameEnc?: string | null;
}): Promise<SpotCheckPublic> {
  return {
    id: row.check.id,
    childId: row.check.childId,
    childName: row.childNameEnc ? decryptPII(row.childNameEnc) ?? '' : '',
    curatorId: row.check.curatorId,
    curatorName: null,
    scheduledAt: row.check.scheduledAt,
    startedAt: row.check.startedAt,
    finishedAt: row.check.finishedAt,
    status: row.check.status,
    verdict: row.check.verdict,
    timeLimitSec: row.check.timeLimitSec,
    relatedAttemptIds: row.check.relatedAttemptIds ?? [],
    correctCount: row.check.correctCount,
    totalCount: row.check.totalCount,
    scorePoints: row.check.scorePoints,
    notes: row.check.notes,
    createdAt: row.check.createdAt,
  };
}

export async function scheduleSpotCheck(
  input: ScheduleSpotCheckInput,
  actorId: string
): Promise<SpotCheckPublic> {
  const [child] = await db
    .select()
    .from(children)
    .where(and(eq(children.id, input.childId), isNull(children.deletedAt)))
    .limit(1);

  if (!child) throw new AppError('NOT_FOUND', 'Ребёнок не найден', 404);

  const existing = await db
    .select({ id: spotChecks.id, status: spotChecks.status })
    .from(spotChecks)
    .where(
      and(
        eq(spotChecks.childId, input.childId),
        inArray(spotChecks.status, ['scheduled', 'in_progress'])
      )
    )
    .limit(1);

  if (existing.length > 0) {
    throw new AppError(
      'CHECK_ALREADY_ACTIVE',
      'У ребёнка уже есть активная очная проверка',
      409
    );
  }

  const [row] = await db
    .insert(spotChecks)
    .values({
      childId: input.childId,
      curatorId: input.curatorId ?? actorId,
      scheduledAt: new Date(input.scheduledAt),
      status: 'scheduled',
      verdict: 'pending',
      timeLimitSec: input.timeLimitSec ?? 1200,
      relatedAttemptIds: input.relatedAttemptIds ?? [],
      notes: input.notes ?? null,
    })
    .returning();

  await createNotification({
    userId: child.parentId,
    type: 'spot_check_scheduled',
    title: 'Назначена очная проверка',
    body: `Дата: ${new Date(input.scheduledAt).toLocaleString('ru-RU')}`,
    link: link.check(row!.id),
  });

  await writeAudit({
    actorId,
    action: 'spot_check.schedule',
    entity: 'spot_check',
    entityId: row!.id,
    after: {
      childId: input.childId,
      scheduledAt: input.scheduledAt,
      relatedAttempts: input.relatedAttemptIds?.length ?? 0,
    },
  });

  logger.info(
    { spotCheckId: row!.id, childId: input.childId, actorId },
    'spot check scheduled'
  );

  return toPublic({ check: row!, childNameEnc: child.fullNameEnc });
}

// ============================================================
// Kiosk-токен (без авторизации, но с HMAC)
// ============================================================

export async function createKioskToken(spotCheckId: string): Promise<string> {
  const [check] = await db
    .select()
    .from(spotChecks)
    .where(eq(spotChecks.id, spotCheckId))
    .limit(1);

  if (!check) throw new AppError('NOT_FOUND', 'Проверка не найдена', 404);
  if (check.status !== 'scheduled') {
    throw new AppError('CHECK_NOT_SCHEDULED', 'Проверка уже запущена или завершена', 400);
  }

  const jti = randomToken(16);
  const payload = `${spotCheckId}.${jti}`;
  const sig = hmacSign(payload, config.SESSION_SECRET);

  await redis.setex(`kiosk:${jti}`, KIOSK_TOKEN_TTL_SEC, spotCheckId);

  return `${payload}.${sig}`;
}

export async function consumeKioskToken(token: string): Promise<string> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new AppError('INVALID_KIOSK_TOKEN', 'Некорректный kiosk-токен', 401);
  }
  const [spotCheckId, jti, sig] = parts as [string, string, string];

  if (!hmacVerify(`${spotCheckId}.${jti}`, sig, config.SESSION_SECRET)) {
    throw new AppError('INVALID_KIOSK_TOKEN', 'Неверная подпись токена', 401);
  }

  const stored = await redis.get(`kiosk:${jti}`);
  if (stored !== spotCheckId) {
    throw new AppError('INVALID_KIOSK_TOKEN', 'Токен истёк или использован', 401);
  }

  return spotCheckId;
}

// ============================================================
// Запуск (kiosk-режим) — race-safe
// ============================================================

export interface SpotCheckSession {
  spotCheckId: string;
  startedAt: Date;
  timeLimitSec: number;
  questions: Array<{
    id: string;
    type: Question['type'];
    text: string;
    imageUrl: string | null;
    payload: Record<string, unknown>;
    orderIndex: number;
  }>;
}

export async function startSpotCheck(
  spotCheckId: string,
  actorId: string | null
): Promise<SpotCheckSession> {
  // Атомарный переход scheduled → in_progress.
  const [updated] = await db
    .update(spotChecks)
    .set({
      status: 'in_progress',
      startedAt: new Date(),
      curatorId: actorId ?? sql`${spotChecks.curatorId}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(spotChecks.id, spotCheckId),
        eq(spotChecks.status, 'scheduled')
      )
    )
    .returning();

  if (!updated) {
    const [check] = await db
      .select()
      .from(spotChecks)
      .where(eq(spotChecks.id, spotCheckId))
      .limit(1);

    if (!check) throw new AppError('NOT_FOUND', 'Проверка не найдена', 404);
    if (check.status === 'in_progress') {
      throw new AppError('CHECK_ALREADY_STARTED', 'Проверка уже запущена', 409);
    }
    throw new AppError('CHECK_NOT_SCHEDULED', 'Проверка недоступна для запуска', 400);
  }

  const pool = await pickFromHistory(updated.childId, 20);

  if (pool.length === 0) {
    // Откатываем статус, если подборка пуста
    await db
      .update(spotChecks)
      .set({ status: 'scheduled', startedAt: null, updatedAt: new Date() })
      .where(eq(spotChecks.id, spotCheckId));

    throw new AppError(
      'NO_HISTORY',
      'У ребёнка нет истории правильных ответов для подборки',
      400
    );
  }

  const count = Math.min(10, pool.length);
  const picked = shuffleArray(pool).slice(0, count);

  await db.transaction(async (tx) => {
    await tx.delete(spotCheckItems).where(eq(spotCheckItems.spotCheckId, spotCheckId));

    await tx.insert(spotCheckItems).values(
      picked.map((q, i) => ({
        spotCheckId,
        questionId: q.id,
        orderIndex: i,
      }))
    );

    await tx
      .update(spotChecks)
      .set({ totalCount: picked.length, updatedAt: new Date() })
      .where(eq(spotChecks.id, spotCheckId));
  });

  if (actorId) {
    await writeAudit({
      actorId,
      action: 'spot_check.start',
      entity: 'spot_check',
      entityId: spotCheckId,
      after: { questionsCount: picked.length },
    });
  }

  logger.info(
    { spotCheckId, childId: updated.childId, questions: picked.length },
    'spot check started'
  );

  return {
    spotCheckId,
    startedAt: updated.startedAt ?? new Date(),
    timeLimitSec: updated.timeLimitSec,
    questions: picked.map((q, i) => ({
      id: q.id,
      type: q.type,
      text: q.text,
      imageUrl: q.imageUrl,
      payload: sanitizePayloadForClient(q),
      orderIndex: i,
    })),
  };
}

// ============================================================
// Сохранение ответа
// ============================================================

export async function saveSpotAnswer(
  spotCheckId: string,
  questionId: string,
  answer: unknown,
  timeSpentMs: number,
  _actorId: string | null
): Promise<{ saved: boolean; answeredCount: number }> {
  const [check] = await db
    .select()
    .from(spotChecks)
    .where(eq(spotChecks.id, spotCheckId))
    .limit(1);

  if (!check) throw new AppError('NOT_FOUND', 'Проверка не найдена', 404);
  if (check.status !== 'in_progress') {
    throw new AppError('CHECK_NOT_ACTIVE', 'Проверка не активна', 400);
  }

  const [item] = await db
    .select()
    .from(spotCheckItems)
    .where(
      and(
        eq(spotCheckItems.spotCheckId, spotCheckId),
        eq(spotCheckItems.questionId, questionId)
      )
    )
    .limit(1);

  if (!item) {
    throw new AppError('ITEM_NOT_FOUND', 'Вопрос не найден в подборке', 404);
  }

  await db
    .update(spotCheckItems)
    .set({
      spotAnswer: answer as object,
      timeSpentMs,
      answeredAt: new Date(),
    })
    .where(eq(spotCheckItems.id, item.id));

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(spotCheckItems)
    .where(
      and(
        eq(spotCheckItems.spotCheckId, spotCheckId),
        sql`${spotCheckItems.spotAnswer} IS NOT NULL`
      )
    );

  return { saved: true, answeredCount: count };
}

// ============================================================
// Завершение
// ============================================================

export interface SpotCheckResult {
  spotCheckId: string;
  status: SpotCheck['status'];
  totalCount: number;
  correctCount: number;
  scorePoints: number;
  items: Array<{
    questionId: string;
    text: string;
    userAnswer: unknown;
    correctAnswer: unknown;
    isCorrect: boolean | null;
    originalAnswer: unknown;
  }>;
}

export async function finishSpotCheck(
  spotCheckId: string,
  actorId: string | null
): Promise<SpotCheckResult> {
  const [check] = await db
    .select()
    .from(spotChecks)
    .where(eq(spotChecks.id, spotCheckId))
    .limit(1);

  if (!check) throw new AppError('NOT_FOUND', 'Проверка не найдена', 404);
  if (check.status !== 'in_progress') {
    throw new AppError('CHECK_NOT_ACTIVE', 'Проверка не активна', 400);
  }

  const items = await db
    .select({
      item: spotCheckItems,
      question: (await import('../../db/schema.js')).questions,
    })
    .from(spotCheckItems)
    .innerJoin(
      (await import('../../db/schema.js')).questions,
      eq((await import('../../db/schema.js')).questions.id, spotCheckItems.questionId)
    )
    .where(eq(spotCheckItems.spotCheckId, spotCheckId))
    .orderBy(spotCheckItems.orderIndex);

  let correctCount = 0;
  const results: SpotCheckResult['items'] = [];

  for (const row of items) {
    const userAnswer = row.item.spotAnswer;

    if (userAnswer === null || userAnswer === undefined) {
      await db
        .update(spotCheckItems)
        .set({ isCorrect: false })
        .where(eq(spotCheckItems.id, row.item.id));

      results.push({
        questionId: row.question.id,
        text: row.question.text,
        userAnswer: null,
        correctAnswer: getCorrectForDisplay(row.question),
        isCorrect: false,
        originalAnswer: row.item.originalAnswer,
      });
      continue;
    }

    const checkResult = checkAnswer(
      {
        type: row.question.type,
        payload: row.question.payload as Record<string, unknown>,
      },
      userAnswer
    );

    if (checkResult.isCorrect) correctCount += 1;

    await db
      .update(spotCheckItems)
      .set({ isCorrect: checkResult.isCorrect })
      .where(eq(spotCheckItems.id, row.item.id));

    results.push({
      questionId: row.question.id,
      text: row.question.text,
      userAnswer,
      correctAnswer: getCorrectForDisplay(row.question),
      isCorrect: checkResult.isCorrect,
      originalAnswer: row.item.originalAnswer,
    });
  }

  const total = items.length;
  const scorePoints = correctCount * 5;

  await db
    .update(spotChecks)
    .set({
      status: 'completed',
      finishedAt: new Date(),
      correctCount,
      totalCount: total,
      scorePoints,
      updatedAt: new Date(),
    })
    .where(eq(spotChecks.id, spotCheckId));

  if (actorId) {
    await writeAudit({
      actorId,
      action: 'spot_check.finish',
      entity: 'spot_check',
      entityId: spotCheckId,
      after: { correctCount, total, scorePoints },
    });
  }

  logger.info({ spotCheckId, correctCount, total }, 'spot check finished');

  return {
    spotCheckId,
    status: 'completed',
    totalCount: total,
    correctCount,
    scorePoints,
    items: results,
  };
}

// ============================================================
// Вердикт куратора
// ============================================================

export async function setVerdict(
  spotCheckId: string,
  input: SetVerdictInput,
  actorId: string
): Promise<SpotCheckPublic> {
  const [check] = await db
    .select()
    .from(spotChecks)
    .where(eq(spotChecks.id, spotCheckId))
    .limit(1);

  if (!check) throw new AppError('NOT_FOUND', 'Проверка не найдена', 404);
  if (check.status !== 'completed') {
    throw new AppError('CHECK_NOT_COMPLETED', 'Проверка не завершена', 400);
  }
  if (check.verdict !== 'pending') {
    throw new AppError('VERDICT_ALREADY_SET', 'Вердикт уже выставлен', 409);
  }

  const percent = check.totalCount > 0 ? (check.correctCount / check.totalCount) * 100 : 0;

  if (input.verdict === 'confirmed' && percent < 50) {
    logger.warn({ spotCheckId, percent }, 'verdict=confirmed with low correct ratio');
  }

  await db.transaction(async (tx) => {
    await tx
      .update(spotChecks)
      .set({
        verdict: input.verdict,
        notes: input.notes ?? check.notes,
        updatedAt: new Date(),
      })
      .where(eq(spotChecks.id, spotCheckId));

    if (input.verdict === 'rejected' || input.verdict === 'partial') {
      const toRevoke = input.revokeAttemptIds.length > 0
        ? input.revokeAttemptIds
        : check.relatedAttemptIds ?? [];

      for (const attemptId of toRevoke) {
        const [attempt] = await tx
          .select()
          .from(attempts)
          .where(eq(attempts.id, attemptId))
          .limit(1);

        if (!attempt) continue;
        if (!attempt.pointsAwarded) continue;

        try {
          await awardPoints({
            childId: attempt.childId,
            delta: -attempt.scorePoints,
            reason: 'fraud_reversal',
            description: `Аннулировано по итогам очной проверки ${spotCheckId}`,
            attemptId: attempt.id,
            actorId,
            idempotencyKey: `spotcheck:${spotCheckId}:reversal:${attemptId}`,
          });

          await tx
            .update(attempts)
            .set({
              status: 'blocked',
              pointsAwarded: false,
              reviewNotes: `Аннулировано очной проверкой ${spotCheckId}`,
              reviewedBy: actorId,
              reviewedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(attempts.id, attemptId));
        } catch (err) {
          logger.error({ err, attemptId }, 'failed to revoke attempt points');
        }
      }
    }

    if (input.verdict === 'confirmed' && check.scorePoints > 0) {
      await awardPoints({
        childId: check.childId,
        delta: check.scorePoints,
        reason: 'spot_check_confirmed',
        description: `Бонус за подтверждение результатов (${check.correctCount}/${check.totalCount})`,
        actorId,
        idempotencyKey: `spotcheck:${spotCheckId}:bonus`,
      });
    }
  });

  const [child] = await db
    .select({ parentId: children.parentId })
    .from(children)
    .where(eq(children.id, check.childId))
    .limit(1);

  if (child) {
    await createNotification({
      userId: child.parentId,
      type: 'spot_check_verdict',
      title: verdictTitle(input.verdict),
      body: verdictBody(input.verdict, percent),
      link: link.check(spotCheckId),
    });
  }

  await writeAudit({
    actorId,
    action: 'spot_check.set_verdict',
    entity: 'spot_check',
    entityId: spotCheckId,
    after: {
      verdict: input.verdict,
      percent: Number(percent.toFixed(2)),
      revokeAttempts: input.revokeAttemptIds.length,
    },
  });

  logger.info(
    { spotCheckId, verdict: input.verdict, percent, actorId },
    'spot check verdict set'
  );

  return getSpotCheck(spotCheckId);
}

// ============================================================
// Чтение
// ============================================================

export async function getSpotCheck(id: string): Promise<SpotCheckPublic> {
  const [row] = await db
    .select({
      check: spotChecks,
      childNameEnc: children.fullNameEnc,
    })
    .from(spotChecks)
    .leftJoin(children, eq(children.id, spotChecks.childId))
    .where(eq(spotChecks.id, id))
    .limit(1);

  if (!row) throw new AppError('NOT_FOUND', 'Проверка не найдена', 404);
  return toPublic(row);
}

export interface SpotCheckDetail extends SpotCheckPublic {
  items: Array<{
    questionId: string;
    text: string;
    userAnswer: unknown;
    correctAnswer: unknown;
    isCorrect: boolean | null;
    originalAnswer: unknown;
    timeSpentMs: number;
  }>;
}

export async function getSpotCheckDetail(id: string): Promise<SpotCheckDetail> {
  const base = await getSpotCheck(id);

  const schema = await import('../../db/schema.js');

  const items = await db
    .select({
      item: spotCheckItems,
      question: schema.questions,
    })
    .from(spotCheckItems)
    .innerJoin(schema.questions, eq(schema.questions.id, spotCheckItems.questionId))
    .where(eq(spotCheckItems.spotCheckId, id))
    .orderBy(spotCheckItems.orderIndex);

  return {
    ...base,
    items: items.map((row) => ({
      questionId: row.question.id,
      text: row.question.text,
      userAnswer: row.item.spotAnswer,
      correctAnswer: getCorrectForDisplay(row.question),
      isCorrect: row.item.isCorrect,
      originalAnswer: row.item.originalAnswer,
      timeSpentMs: row.item.timeSpentMs,
    })),
  };
}

export async function listSpotChecks(
  query: ListSpotChecksQuery
): Promise<{ items: SpotCheckPublic[]; total: number }> {
  const conditions = [];
  if (query.childId) conditions.push(eq(spotChecks.childId, query.childId));
  if (query.curatorId) conditions.push(eq(spotChecks.curatorId, query.curatorId));
  if (query.status) conditions.push(eq(spotChecks.status, query.status));
  if (query.verdict) conditions.push(eq(spotChecks.verdict, query.verdict));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        check: spotChecks,
        childNameEnc: children.fullNameEnc,
      })
      .from(spotChecks)
      .leftJoin(children, eq(children.id, spotChecks.childId))
      .where(where)
      .orderBy(desc(spotChecks.scheduledAt))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(spotChecks).where(where),
  ]);

  const items = await Promise.all(rows.map((r) => toPublic(r)));

  return {
    items,
    total: totalRow[0]?.count ?? 0,
  };
}

// ============================================================
// Автоназначение (по флагам)
// ============================================================

export async function listCandidatesForSpotCheck(options: {
  minFlaggedAttempts?: number;
  daysBack?: number;
  limit?: number;
} = {}): Promise<Array<{
  childId: string;
  childName: string;
  parentId: string;
  flaggedCount: number;
  blockedCount: number;
  lastFlaggedAt: Date | null;
  avgSuspicionScore: number;
}>> {
  const minFlagged = options.minFlaggedAttempts ?? 2;
  const daysBack = options.daysBack ?? 30;
  const limit = Math.min(options.limit ?? 50, 200);

  const rows = await db.execute<{
    child_id: string;
    flagged_count: number;
    blocked_count: number;
    last_flagged_at: Date | null;
    avg_suspicion: number;
    full_name_enc: string;
    parent_id: string;
  }>(sql`
    SELECT
      a.child_id,
      COUNT(*) FILTER (WHERE a.status = 'flagged')::int AS flagged_count,
      COUNT(*) FILTER (WHERE a.status = 'blocked')::int AS blocked_count,
      MAX(a.finished_at) FILTER (WHERE a.status IN ('flagged','blocked')) AS last_flagged_at,
      COALESCE(AVG(a.suspicion_score) FILTER (WHERE a.status IN ('flagged','blocked')), 0)::int AS avg_suspicion,
      c.full_name_enc,
      c.parent_id
    FROM attempts a
    INNER JOIN children c ON c.id = a.child_id
    WHERE a.status IN ('flagged','blocked')
      AND a.finished_at >= NOW() - (${daysBack} || ' days')::interval
      AND c.deleted_at IS NULL
    GROUP BY a.child_id, c.full_name_enc, c.parent_id
    HAVING COUNT(*) FILTER (WHERE a.status IN ('flagged','blocked')) >= ${minFlagged}
    ORDER BY avg_suspicion DESC, flagged_count DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    childId: r.child_id,
    childName: decryptPII(r.full_name_enc) ?? '',
    parentId: r.parent_id,
    flaggedCount: r.flagged_count,
    blockedCount: r.blocked_count,
    lastFlaggedAt: r.last_flagged_at,
    avgSuspicionScore: r.avg_suspicion,
  }));
}

// ============================================================
// Helpers
// ============================================================

function getCorrectForDisplay(q: {
  type: Question['type'];
  payload: Record<string, unknown>;
}): unknown {
  const p = q.payload as Record<string, unknown>;
  return p.correct ?? null;
}

function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function verdictTitle(v: SpotCheck['verdict']): string {
  switch (v) {
    case 'confirmed': return 'Результаты подтверждены';
    case 'rejected': return 'Результаты отклонены';
    case 'partial': return 'Результаты подтверждены частично';
    default: return 'Очная проверка завершена';
  }
}

function verdictBody(v: SpotCheck['verdict'], percent: number): string {
  const pct = percent.toFixed(0);
  switch (v) {
    case 'confirmed': return `Ребёнок подтвердил результаты (${pct}%).`;
    case 'rejected': return `Результаты аннулированы (${pct}%).`;
    case 'partial': return `Часть результатов аннулирована (${pct}%).`;
    default: return '';
  }
}