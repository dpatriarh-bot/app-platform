// ============================================================
// attempts/service.ts — жизненный цикл попытки теста
// Учитывает users.fraudDisabled, предотвращает race на
// pointsAwarded, уведомляет ребёнка при начислении.
// ============================================================

import { eq, and, isNull, desc, sql, inArray, lt, asc } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  attempts,
  attemptAnswers,
  attemptEvents,
  tests,
  testQuestions,
  questions,
  children,
  users,
  type Attempt,
  type Question,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { writeAudit } from '../audit/service.js';
import { checkAnswer, getCorrectAnswer, sanitizePayloadForClient } from '../questions/checker.js';
import { awardPoints } from '../points/service.js';
import { createNotification } from '../notifications/service.js';
import { createChildNotification } from '../notifications/child-service.js';
import { hasActiveAccess } from '../payments/service.js';
import { config } from '../../config.js';
import { computeAttemptFraudScore } from './fraud.js';
import { link } from '../../lib/links.js';
import type {
  StartAttemptInput,
  SaveAnswerInput,
  LogEventInput,
  ListAttemptsQuery,
} from './schemas.js';

// ============================================================
// START
// ============================================================

export interface StartedAttempt {
  attemptId: string;
  testId: string;
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

export async function startAttempt(
  input: StartAttemptInput,
  meta: { ip: string; userAgent: string; parentId: string }
): Promise<StartedAttempt> {
  const hasAccess = await hasActiveAccess(meta.parentId);
  if (!hasAccess) {
    throw new AppError(
      'SUBSCRIPTION_REQUIRED',
      'Для прохождения тестов нужна активная подписка. Оформите её в разделе «Подписка».',
      402
    );
  }

  const [child] = await db
    .select()
    .from(children)
    .where(
      and(
        eq(children.id, input.childId),
        eq(children.parentId, meta.parentId),
        isNull(children.deletedAt)
      )
    )
    .limit(1);

  if (!child) throw new AppError('NOT_FOUND', 'Ребёнок не найден', 404);

  const [test] = await db
    .select()
    .from(tests)
    .where(and(eq(tests.id, input.testId), eq(tests.status, 'published')))
    .limit(1);

  if (!test) throw new AppError('NOT_FOUND', 'Тест не найден или не опубликован', 404);

  const age = new Date().getFullYear() - child.birthYear;
  if (test.gradeMin && child.grade && child.grade < test.gradeMin) {
    throw new AppError('TEST_NOT_AVAILABLE', 'Тест не подходит по классу', 403);
  }
  if (test.gradeMax && child.grade && child.grade > test.gradeMax) {
    throw new AppError('TEST_NOT_AVAILABLE', 'Тест не подходит по классу', 403);
  }
  if (test.ageMin && age < test.ageMin) {
    throw new AppError('TEST_NOT_AVAILABLE', 'Тест не подходит по возрасту', 403);
  }
  if (test.ageMax && age > test.ageMax) {
    throw new AppError('TEST_NOT_AVAILABLE', 'Тест не подходит по возрасту', 403);
  }

  await abandonStaleAttempts(input.childId);

  if (config.FRAUD_PARALLEL_SESSION_BLOCK) {
    const active = await db
      .select({ id: attempts.id, testId: attempts.testId, startedAt: attempts.startedAt })
      .from(attempts)
      .where(
        and(
          eq(attempts.childId, input.childId),
          eq(attempts.status, 'in_progress')
        )
      )
      .limit(1);

    if (active.length > 0) {
      await db.insert(attemptEvents).values({
        attemptId: active[0]!.id,
        type: 'parallel_session',
        meta: { newTestId: input.testId, ip: meta.ip },
        ip: meta.ip,
      });

      throw new AppError(
        'PARALLEL_SESSION',
        'У вас уже есть активная попытка. Завершите её или подождите 30 минут.',
        409
      );
    }
  }

  const previousAttempts = await db
    .select({ id: attempts.id, pointsAwarded: attempts.pointsAwarded })
    .from(attempts)
    .where(
      and(
        eq(attempts.childId, input.childId),
        eq(attempts.testId, input.testId),
        inArray(attempts.status, ['finished', 'flagged'])
      )
    );

  if (previousAttempts.length > 0 && !test.allowRetake) {
    throw new AppError('RETAKE_NOT_ALLOWED', 'Повторное прохождение этого теста запрещено', 403);
  }

  const questionRows = await db
    .select({
      question: questions,
      orderIndex: testQuestions.orderIndex,
      pointsOverride: testQuestions.pointsOverride,
    })
    .from(testQuestions)
    .innerJoin(questions, eq(questions.id, testQuestions.questionId))
    .where(and(eq(testQuestions.testId, test.id), eq(questions.isActive, true)))
    .orderBy(testQuestions.orderIndex);

  if (questionRows.length === 0) {
    throw new AppError('TEST_EMPTY', 'В тесте нет вопросов', 400);
  }

  let ordered = questionRows.map((r) => r.question);
  if (test.shuffleQuestions) {
    ordered = shuffleArray(ordered);
  }

  const result = await db.transaction(async (tx) => {
    const [attempt] = await tx
      .insert(attempts)
      .values({
        childId: input.childId,
        testId: test.id,
        testVersion: test.version,
        status: 'in_progress',
        totalCount: ordered.length,
        ip: meta.ip,
        userAgent: meta.userAgent.slice(0, 500),
        deviceFingerprint: input.deviceFingerprint ?? null,
      })
      .returning();

    await tx.insert(attemptAnswers).values(
      ordered.map((q, i) => ({
        attemptId: attempt!.id,
        questionId: q.id,
        orderIndex: i,
        userAnswer: null,
        isCorrect: null,
        pointsEarned: 0,
      }))
    );

    return attempt!;
  });

  logger.info(
    { attemptId: result.id, childId: input.childId, testId: test.id },
    'attempt started'
  );

  return {
    attemptId: result.id,
    testId: test.id,
    startedAt: result.startedAt,
    timeLimitSec: test.timeLimitSec,
    questions: ordered.map((q, i) => ({
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
// GET ATTEMPT QUESTIONS
// ============================================================

export interface AttemptQuestions {
  attemptId: string;
  testId: string;
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

export async function getAttemptQuestions(
  attemptId: string,
  meta: { parentId: string }
): Promise<AttemptQuestions> {
  const attempt = await loadAttemptForParent(attemptId, meta.parentId);

  if (attempt.status !== 'in_progress') {
    throw new AppError('ATTEMPT_FINISHED', 'Попытка уже завершена', 400);
  }

  const [test] = await db
    .select()
    .from(tests)
    .where(eq(tests.id, attempt.testId))
    .limit(1);

  if (!test) throw new AppError('NOT_FOUND', 'Тест не найден', 404);

  const rows = await db
    .select({
      question: questions,
      orderIndex: attemptAnswers.orderIndex,
    })
    .from(attemptAnswers)
    .innerJoin(questions, eq(questions.id, attemptAnswers.questionId))
    .where(eq(attemptAnswers.attemptId, attemptId))
    .orderBy(asc(attemptAnswers.orderIndex));

  if (rows.length === 0) {
    throw new AppError('TEST_EMPTY', 'В попытке нет вопросов', 400);
  }

  return {
    attemptId: attempt.id,
    testId: test.id,
    startedAt: attempt.startedAt,
    timeLimitSec: test.timeLimitSec,
    questions: rows.map((r, i) => ({
      id: r.question.id,
      type: r.question.type,
      text: r.question.text,
      imageUrl: r.question.imageUrl,
      payload: sanitizePayloadForClient(r.question),
      orderIndex: r.orderIndex ?? i,
    })),
  };
}

// ============================================================
// Сброс «зависших» попыток
// ============================================================

async function abandonStaleAttempts(childId: string): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);

  const result = await db
    .update(attempts)
    .set({
      status: 'abandoned',
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(attempts.childId, childId),
        eq(attempts.status, 'in_progress'),
        lt(attempts.startedAt, cutoff)
      )
    )
    .returning({ id: attempts.id });

  if (result.length > 0) {
    logger.info({ childId, abandonedCount: result.length }, 'abandoned stale attempts');
  }
}

// ============================================================
// SAVE ANSWER
// ============================================================

export async function saveAnswer(
  attemptId: string,
  input: SaveAnswerInput,
  meta: { parentId: string; ip: string }
): Promise<{ saved: boolean; answeredCount: number }> {
  const attempt = await loadAttemptForParent(attemptId, meta.parentId);

  if (attempt.status !== 'in_progress') {
    throw new AppError('ATTEMPT_FINISHED', 'Попытка уже завершена', 400);
  }

  const [answer] = await db
    .select()
    .from(attemptAnswers)
    .where(
      and(
        eq(attemptAnswers.attemptId, attemptId),
        eq(attemptAnswers.questionId, input.questionId)
      )
    )
    .limit(1);

  if (!answer) {
    throw new AppError('ANSWER_NOT_FOUND', 'Ответ не найден в этой попытке', 404);
  }

  await db
    .update(attemptAnswers)
    .set({
      userAnswer: input.answer as object,
      timeSpentMs: input.timeSpentMs,
      changesCount: input.changesCount,
      answeredAt: new Date(),
    })
    .where(eq(attemptAnswers.id, answer.id));

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(attemptAnswers)
    .where(
      and(
        eq(attemptAnswers.attemptId, attemptId),
        sql`${attemptAnswers.userAnswer} IS NOT NULL`
      )
    );

  return { saved: true, answeredCount: count };
}

// ============================================================
// LOG EVENT (антифрод)
// ============================================================

export async function logEvent(
  attemptId: string,
  input: LogEventInput,
  meta: { parentId: string; ip: string }
): Promise<void> {
  const attempt = await loadAttemptForParent(attemptId, meta.parentId);

  if (attempt.status !== 'in_progress') return;

  const disabled = await isFraudDisabledForChild(attempt.childId);
  if (disabled) return;

  if (attempt.ip && attempt.ip !== meta.ip) {
    await db.insert(attemptEvents).values({
      attemptId,
      type: 'ip_change',
      meta: { from: attempt.ip, to: meta.ip },
      ip: meta.ip,
    });
  }

  await db.insert(attemptEvents).values({
    attemptId,
    questionId: input.questionId ?? null,
    type: input.type,
    meta: input.meta ?? {},
    ip: meta.ip,
  });

  if (input.type === 'focus_lost') {
    await db
      .update(attempts)
      .set({
        connectionDrops: sql`${attempts.connectionDrops} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(attempts.id, attemptId));
  }
}

// ============================================================
// FINISH
// ============================================================

export interface FinishedAttempt {
  attemptId: string;
  status: Attempt['status'];
  totalCount: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  scorePoints: number;
  percentCorrect: number;
  pointsAwarded: boolean;
  suspicionScore: number;
  fraudFlags: string[];
  message?: string;
}

export async function finishAttempt(
  attemptId: string,
  meta: { parentId: string; ip: string }
): Promise<FinishedAttempt> {
  const attempt = await loadAttemptForParent(attemptId, meta.parentId);

  if (attempt.status !== 'in_progress') {
    return buildFinishedResult(attemptId);
  }

  const [test] = await db
    .select()
    .from(tests)
    .where(eq(tests.id, attempt.testId))
    .limit(1);

  if (!test) throw new AppError('NOT_FOUND', 'Тест не найден', 404);

  const rows = await db
    .select({
      answer: attemptAnswers,
      question: questions,
      pointsOverride: testQuestions.pointsOverride,
    })
    .from(attemptAnswers)
    .innerJoin(questions, eq(questions.id, attemptAnswers.questionId))
    .leftJoin(
      testQuestions,
      and(
        eq(testQuestions.testId, attempt.testId),
        eq(testQuestions.questionId, attemptAnswers.questionId)
      )
    )
    .where(eq(attemptAnswers.attemptId, attemptId))
    .orderBy(attemptAnswers.orderIndex);

  let correctCount = 0;
  let wrongCount = 0;
  let skippedCount = 0;
  let totalPoints = 0;

  for (const row of rows) {
    const userAnswer = row.answer.userAnswer;

    if (userAnswer === null || userAnswer === undefined) {
      skippedCount += 1;
      await db
        .update(attemptAnswers)
        .set({ isCorrect: false, pointsEarned: 0 })
        .where(eq(attemptAnswers.id, row.answer.id));
      continue;
    }

    const result = checkAnswer(
      { type: row.question.type, payload: row.question.payload as Record<string, unknown> },
      userAnswer
    );

    const basePoints = row.pointsOverride ?? test.pointsPerCorrect;
    const points = result.isCorrect
      ? basePoints
      : Math.floor(result.partialScore * basePoints);

    const penalty = !result.isCorrect && result.partialScore === 0
      ? test.pointsPenaltyWrong
      : 0;

    if (result.isCorrect) correctCount += 1;
    else wrongCount += 1;

    totalPoints += Math.max(0, points - penalty);

    await db
      .update(attemptAnswers)
      .set({
        isCorrect: result.isCorrect,
        pointsEarned: Math.max(0, points - penalty),
      })
      .where(eq(attemptAnswers.id, row.answer.id));
  }

  const total = rows.length;
  const percent = total > 0 ? (correctCount / total) * 100 : 0;
  const fixedPoints = test.pointsFixed;
  const scorePoints = fixedPoints + totalPoints;

  const fraudDisabled = await isFraudDisabledForChild(attempt.childId);
  const fraud = !fraudDisabled && config.FRAUD_ENABLED
    ? await computeAttemptFraudScore(attemptId)
    : { score: 0, flags: [] as string[], details: [] };

  let status: Attempt['status'] = 'finished';
  let pointsAwarded = false;
  let message: string | undefined;

  if (fraudDisabled) {
    message = 'Начисление баллов выполнено без проверки антифрода.';
  } else if (fraud.score >= config.FRAUD_BLOCK_THRESHOLD) {
    status = 'blocked';
    message = 'Результат проверяется куратором. Баллы будут начислены после подтверждения.';
  } else if (fraud.score >= config.FRAUD_FLAG_THRESHOLD) {
    status = 'flagged';
    message = 'Результат помечен для проверки. Баллы начислены, но могут быть пересмотрены.';
  }

  if (status !== 'blocked' && scorePoints > 0) {
    const shouldReward =
      test.rewardOnRetake ||
      !(await hasPreviousReward(attempt.childId, attempt.testId, attemptId));

    if (shouldReward) {
      try {
        await awardPoints({
          childId: attempt.childId,
          delta: scorePoints,
          reason: 'attempt_reward',
          description: `За тест «${test.title}»: ${correctCount}/${total} правильных`,
          attemptId,
          idempotencyKey: `attempt:${attemptId}:reward`,
        });
        pointsAwarded = true;
      } catch (err) {
        logger.error({ err, attemptId }, 'failed to award points');
      }
    }
  }

  await db
    .update(attempts)
    .set({
      status,
      finishedAt: new Date(),
      timeSpentSec: Math.floor((Date.now() - attempt.startedAt.getTime()) / 1000),
      correctCount,
      wrongCount,
      skippedCount,
      scorePoints,
      percentCorrect: percent.toFixed(2),
      suspicionScore: fraud.score,
      fraudFlags: fraud.flags,
      pointsAwarded,
      pointsAwardedAt: pointsAwarded ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(attempts.id, attemptId));

  const [child] = await db
    .select({ parentId: children.parentId })
    .from(children)
    .where(eq(children.id, attempt.childId))
    .limit(1);

  if (child) {
    await createNotification({
      userId: child.parentId,
      type: status === 'blocked' ? 'attempt_flagged' : 'attempt_finished',
      title:
        status === 'blocked'
          ? 'Результат теста требует проверки'
          : `Тест завершён: ${correctCount}/${total}`,
      body: `«${test.title}» — ${percent.toFixed(0)}%, +${scorePoints} баллов`,
      link: link.result(attemptId),
    });
  }

  if (pointsAwarded) {
    await createChildNotification({
      childId: attempt.childId,
      type: 'points_awarded',
      title: `+${scorePoints} трудокоинов`,
      body: `За тест «${test.title}»: ${correctCount}/${total} правильных`,
      link: link.points(),
    }).catch((err) => logger.error({ err }, 'child notification failed'));
  }

  logger.info(
    { attemptId, correctCount, total, scorePoints, fraudScore: fraud.score, status, fraudDisabled },
    'attempt finished'
  );

  return {
    attemptId,
    status,
    totalCount: total,
    correctCount,
    wrongCount,
    skippedCount,
    scorePoints,
    percentCorrect: Number(percent.toFixed(2)),
    pointsAwarded,
    suspicionScore: fraud.score,
    fraudFlags: fraud.flags,
    message,
  };
}

async function hasPreviousReward(
  childId: string,
  testId: string,
  excludeAttemptId: string
): Promise<boolean> {
  const rows = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
    FROM points_ledger pl
    INNER JOIN attempts a ON a.id = pl.attempt_id
    WHERE a.child_id = ${childId}
      AND a.test_id = ${testId}
      AND a.id != ${excludeAttemptId}
      AND pl.reason = 'attempt_reward'
  `);
  return (rows[0]?.count ?? 0) > 0;
}

// ============================================================
// Проверка флага fraudDisabled у родителя ребёнка
// ============================================================

export async function isFraudDisabledForChild(childId: string): Promise<boolean> {
  const [row] = await db
    .select({ fraudDisabled: users.fraudDisabled })
    .from(children)
    .innerJoin(users, eq(users.id, children.parentId))
    .where(eq(children.id, childId))
    .limit(1);

  return row?.fraudDisabled ?? false;
}

// ============================================================
// RESULT
// ============================================================

export interface AttemptResult {
  attemptId: string;
  testId: string;
  testTitle: string;
  childId: string;
  status: Attempt['status'];
  startedAt: Date;
  finishedAt: Date | null;
  timeSpentSec: number | null;
  totalCount: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  scorePoints: number;
  percentCorrect: number;
  pointsAwarded: boolean;
  suspicionScore: number;
  fraudFlags: string[];
  questions: Array<{
    id: string;
    type: Question['type'];
    text: string;
    imageUrl: string | null;
    explanation: string | null;
    userAnswer: unknown;
    correctAnswer: unknown;
    isCorrect: boolean | null;
    pointsEarned: number;
  }>;
}

export async function getAttemptResult(
  attemptId: string,
  meta: { parentId?: string; curatorId?: string }
): Promise<AttemptResult> {
  const attempt = meta.curatorId
    ? await loadAttempt(attemptId)
    : await loadAttemptForParent(attemptId, meta.parentId!);

  const [test] = await db.select().from(tests).where(eq(tests.id, attempt.testId)).limit(1);
  if (!test) throw new AppError('NOT_FOUND', 'Тест не найден', 404);

  const rows = await db
    .select({
      answer: attemptAnswers,
      question: questions,
    })
    .from(attemptAnswers)
    .innerJoin(questions, eq(questions.id, attemptAnswers.questionId))
    .where(eq(attemptAnswers.attemptId, attemptId))
    .orderBy(attemptAnswers.orderIndex);

  return {
    attemptId: attempt.id,
    testId: test.id,
    testTitle: test.title,
    childId: attempt.childId,
    status: attempt.status,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
    timeSpentSec: attempt.timeSpentSec,
    totalCount: attempt.totalCount,
    correctCount: attempt.correctCount,
    wrongCount: attempt.wrongCount,
    skippedCount: attempt.skippedCount,
    scorePoints: attempt.scorePoints,
    percentCorrect: Number(attempt.percentCorrect ?? 0),
    pointsAwarded: attempt.pointsAwarded,
    suspicionScore: attempt.suspicionScore,
    fraudFlags: attempt.fraudFlags ?? [],
    questions: rows.map((r) => ({
      id: r.question.id,
      type: r.question.type,
      text: r.question.text,
      imageUrl: r.question.imageUrl,
      explanation: r.question.explanation,
      userAnswer: r.answer.userAnswer,
      correctAnswer: getCorrectAnswer({
        type: r.question.type,
        payload: r.question.payload as Record<string, unknown>,
      }),
      isCorrect: r.answer.isCorrect,
      pointsEarned: r.answer.pointsEarned,
    })),
  };
}

async function buildFinishedResult(attemptId: string): Promise<FinishedAttempt> {
  const [a] = await db.select().from(attempts).where(eq(attempts.id, attemptId)).limit(1);
  if (!a) throw new AppError('NOT_FOUND', 'Попытка не найдена', 404);

  return {
    attemptId: a.id,
    status: a.status,
    totalCount: a.totalCount,
    correctCount: a.correctCount,
    wrongCount: a.wrongCount,
    skippedCount: a.skippedCount,
    scorePoints: a.scorePoints,
    percentCorrect: Number(a.percentCorrect ?? 0),
    pointsAwarded: a.pointsAwarded,
    suspicionScore: a.suspicionScore,
    fraudFlags: a.fraudFlags ?? [],
  };
}

// ============================================================
// LIST
// ============================================================

export async function listAttempts(
  parentId: string,
  query: ListAttemptsQuery
): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
  const kids = await db
    .select({ id: children.id })
    .from(children)
    .where(and(eq(children.parentId, parentId), isNull(children.deletedAt)));

  if (kids.length === 0) return { items: [], total: 0 };

  const childIds = kids.map((k) => k.id);
  const conditions = [inArray(attempts.childId, childIds)];

  if (query.childId) conditions.push(eq(attempts.childId, query.childId));
  if (query.testId) conditions.push(eq(attempts.testId, query.testId));
  if (query.status) conditions.push(eq(attempts.status, query.status));

  const where = and(...conditions);

  const [items, totalRow] = await Promise.all([
    db
      .select({
        id: attempts.id,
        childId: attempts.childId,
        testId: attempts.testId,
        testTitle: tests.title,
        status: attempts.status,
        startedAt: attempts.startedAt,
        finishedAt: attempts.finishedAt,
        totalCount: attempts.totalCount,
        correctCount: attempts.correctCount,
        scorePoints: attempts.scorePoints,
        percentCorrect: attempts.percentCorrect,
      })
      .from(attempts)
      .leftJoin(tests, eq(tests.id, attempts.testId))
      .where(where)
      .orderBy(desc(attempts.startedAt))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(attempts).where(where),
  ]);

  return { items, total: totalRow[0]?.count ?? 0 };
}

// ============================================================
// Helpers
// ============================================================

async function loadAttempt(attemptId: string): Promise<Attempt> {
  const [a] = await db.select().from(attempts).where(eq(attempts.id, attemptId)).limit(1);
  if (!a) throw new AppError('NOT_FOUND', 'Попытка не найдена', 404);
  return a;
}

async function loadAttemptForParent(
  attemptId: string,
  parentId: string
): Promise<Attempt> {
  const [row] = await db
    .select({ attempt: attempts })
    .from(attempts)
    .innerJoin(children, eq(children.id, attempts.childId))
    .where(and(eq(attempts.id, attemptId), eq(children.parentId, parentId)))
    .limit(1);

  if (!row) throw new AppError('NOT_FOUND', 'Попытка не найдена', 404);
  return row.attempt;
}

function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ============================================================
// Админские операции
// ============================================================

export async function listFlaggedAttempts(options: {
  limit?: number;
  offset?: number;
}): Promise<Array<Record<string, unknown>>> {
  const rows = await db
    .select({
      id: attempts.id,
      childId: attempts.childId,
      testId: attempts.testId,
      testTitle: tests.title,
      status: attempts.status,
      suspicionScore: attempts.suspicionScore,
      fraudFlags: attempts.fraudFlags,
      startedAt: attempts.startedAt,
      finishedAt: attempts.finishedAt,
      scorePoints: attempts.scorePoints,
      correctCount: attempts.correctCount,
      totalCount: attempts.totalCount,
    })
    .from(attempts)
    .leftJoin(tests, eq(tests.id, attempts.testId))
    .where(inArray(attempts.status, ['flagged', 'blocked']))
    .orderBy(desc(attempts.suspicionScore), desc(attempts.finishedAt))
    .limit(options.limit ?? 50)
    .offset(options.offset ?? 0);

  return rows;
}

export async function approveFlaggedAttempt(
  attemptId: string,
  curatorId: string,
  notes?: string
): Promise<void> {
  const attempt = await loadAttempt(attemptId);

  if (attempt.status !== 'flagged' && attempt.status !== 'blocked') {
    throw new AppError('NOT_FLAGGED', 'Попытка не помечена', 400);
  }

  const [test] = await db.select().from(tests).where(eq(tests.id, attempt.testId)).limit(1);

  let newlyAwarded = false;
  if (!attempt.pointsAwarded && attempt.scorePoints > 0) {
    try {
      await awardPoints({
        childId: attempt.childId,
        delta: attempt.scorePoints,
        reason: 'attempt_reward',
        description: `Подтверждено куратором: «${test?.title ?? ''}»`,
        attemptId,
        actorId: curatorId,
        idempotencyKey: `attempt:${attemptId}:reward`,
      });
      newlyAwarded = true;
    } catch (err) {
      logger.error({ err, attemptId }, 'approve: failed to award points');
    }
  }

  await db
    .update(attempts)
    .set({
      status: 'finished',
      reviewedBy: curatorId,
      reviewedAt: new Date(),
      reviewNotes: notes ?? null,
      pointsAwarded: newlyAwarded || attempt.pointsAwarded,
      pointsAwardedAt: newlyAwarded ? new Date() : attempt.pointsAwardedAt,
      updatedAt: new Date(),
    })
    .where(eq(attempts.id, attemptId));

  await writeAudit({
    actorId: curatorId,
    action: 'attempt.approve',
    entity: 'attempt',
    entityId: attemptId,
    after: { notes: notes ?? null, newlyAwarded },
  });
}

export async function rejectFlaggedAttempt(
  attemptId: string,
  curatorId: string,
  notes?: string
): Promise<void> {
  const attempt = await loadAttempt(attemptId);

  if (attempt.pointsAwarded && attempt.scorePoints > 0) {
    try {
      await awardPoints({
        childId: attempt.childId,
        delta: -attempt.scorePoints,
        reason: 'fraud_reversal',
        description: `Аннулировано куратором: подозрение на нарушение`,
        attemptId,
        actorId: curatorId,
        idempotencyKey: `attempt:${attemptId}:reversal`,
      });
    } catch (err) {
      logger.error({ err, attemptId }, 'reject: failed to reverse points');
    }
  }

  await db
    .update(attempts)
    .set({
      status: 'blocked',
      reviewedBy: curatorId,
      reviewedAt: new Date(),
      reviewNotes: notes ?? null,
      pointsAwarded: false,
      updatedAt: new Date(),
    })
    .where(eq(attempts.id, attemptId));

  await writeAudit({
    actorId: curatorId,
    action: 'attempt.reject',
    entity: 'attempt',
    entityId: attemptId,
    after: { notes: notes ?? null },
  });
}