// ============================================================
// attempts/fraud.ts — движок скоринга подозрительности
// detectSignalsFromAnswers группирует по типу вопроса.
// ============================================================

import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { fraudRules, type FraudRule } from '../../db/schema.js';

export interface FraudSignalInput {
  type: string;
  count: number;
  meta?: Record<string, unknown>;
}

export interface FraudScoreResult {
  score: number;
  flags: string[];
  details: Array<{
    ruleCode: string;
    ruleName: string;
    weight: number;
    count: number;
    triggered: boolean;
  }>;
}

export async function loadActiveRules(): Promise<FraudRule[]> {
  return db.select().from(fraudRules).where(eq(fraudRules.isActive, true));
}

export function calculateFraudScore(
  signals: FraudSignalInput[],
  rules: FraudRule[]
): FraudScoreResult {
  const signalMap = new Map<string, number>();
  for (const s of signals) {
    signalMap.set(s.type, (signalMap.get(s.type) ?? 0) + s.count);
  }

  let score = 0;
  const flags: string[] = [];
  const details: FraudScoreResult['details'] = [];

  for (const rule of rules) {
    const count = signalMap.get(rule.signalType) ?? 0;
    const threshold = rule.threshold ?? 1;
    const triggered = count >= threshold && count > 0;

    if (triggered) {
      score += rule.weight;
      flags.push(rule.code);
    }

    details.push({
      ruleCode: rule.code,
      ruleName: rule.name,
      weight: rule.weight,
      count,
      triggered,
    });
  }

  return {
    score: Math.min(100, score),
    flags,
    details,
  };
}

export function aggregateSignalsFromEvents(
  events: Array<{ type: string; meta: Record<string, unknown> | null }>
): FraudSignalInput[] {
  const map = new Map<string, { count: number; meta: Record<string, unknown> }>();
  for (const e of events) {
    const existing = map.get(e.type);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(e.type, { count: 1, meta: e.meta ?? {} });
    }
  }
  return [...map.entries()].map(([type, { count, meta }]) => ({ type, count, meta }));
}

/**
 * Группировка по типу вопроса — исправляет ложные срабатывания
 * uniform_timing при смешанных типах (input_text + single_choice).
 */
export function detectSignalsFromAnswers(
  answers: Array<{
    type: string;
    timeSpentMs: number;
    changesCount: number;
    isCorrect: boolean | null;
  }>,
  options: { minAnswerTimeMs: number } = { minAnswerTimeMs: 1500 }
): FraudSignalInput[] {
  const signals: FraudSignalInput[] = [];
  if (answers.length === 0) return signals;

  // fast_answer — по всем ответам
  const fastAnswers = answers.filter((a) => a.timeSpentMs < options.minAnswerTimeMs).length;
  if (fastAnswers / answers.length > 0.5) {
    signals.push({
      type: 'fast_answer',
      count: fastAnswers,
      meta: { ratio: fastAnswers / answers.length },
    });
  }

  // uniform_timing — по каждому типу отдельно
  const byType = new Map<string, number[]>();
  for (const a of answers) {
    if (!byType.has(a.type)) byType.set(a.type, []);
    byType.get(a.type)!.push(a.timeSpentMs);
  }

  let uniformTypeCount = 0;
  const uniformMeta: Record<string, unknown> = {};
  for (const [type, times] of byType) {
    if (times.length < 3) continue;
    const mean = times.reduce((s, t) => s + t, 0) / times.length;
    const variance = times.reduce((s, t) => s + (t - mean) ** 2, 0) / times.length;
    const stddev = Math.sqrt(variance);
    if (stddev < 1500 && mean > 0) {
      uniformTypeCount += 1;
      uniformMeta[type] = { stddev, mean };
    }
  }

  if (uniformTypeCount >= 2) {
    signals.push({
      type: 'uniform_timing',
      count: uniformTypeCount,
      meta: uniformMeta,
    });
  }

  // no_mouse_activity
  const noChangeFast = answers.filter(
    (a) => a.changesCount === 0 && a.timeSpentMs < 3000 && a.isCorrect === true
  ).length;
  if (noChangeFast >= 3) {
    signals.push({
      type: 'no_mouse_activity',
      count: noChangeFast,
      meta: { reason: 'no_changes_and_fast_and_correct' },
    });
  }

  return signals;
}

export async function computeAttemptFraudScore(
  attemptId: string
): Promise<FraudScoreResult> {
  const events = await db.query.attemptEvents.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.attemptId, attemptId),
  });

  const answerRows = await db.query.attemptAnswers.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.attemptId, attemptId),
  });

  const questions = await db.query.questions.findMany({
    where: (t, { inArray }) => inArray(t.id, answerRows.map((a) => a.questionId)),
  });
  const questionTypeById = new Map(questions.map((q) => [q.id, q.type as string]));

  const rules = await loadActiveRules();

  const eventSignals = aggregateSignalsFromEvents(
    events.map((e) => ({ type: e.type, meta: e.meta as Record<string, unknown> | null }))
  );

  const answerSignals = detectSignalsFromAnswers(
    answerRows.map((a) => ({
      type: questionTypeById.get(a.questionId) ?? 'unknown',
      timeSpentMs: a.timeSpentMs,
      changesCount: a.changesCount,
      isCorrect: a.isCorrect,
    }))
  );

  return calculateFraudScore([...eventSignals, ...answerSignals], rules);
}