// ============================================================
// questions/service.ts — CRUD вопросов, банк, случайная подборка,
// настройки типов вопросов (справочник).
// ============================================================

import { eq, and, isNull, ilike, sql, desc, asc, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  questions,
  questionTypeSettings,
  type Question,
  type QuestionTypeSetting,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { writeAudit } from '../audit/service.js';
import { validatePayload } from './schemas.js';
import type {
  CreateQuestionInput,
  UpdateQuestionInput,
  ListQuestionsQuery,
  QuestionType,
  QuestionTypeSettingUpdate,
} from './schemas.js';

export interface QuestionPublic {
  id: string;
  subjectId: string;
  type: Question['type'];
  text: string;
  imageUrl: string | null;
  explanation: string | null;
  payload: Record<string, unknown>;
  difficulty: number;
  tags: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toPublic(q: Question): QuestionPublic {
  return {
    id: q.id,
    subjectId: q.subjectId,
    type: q.type,
    text: q.text,
    imageUrl: q.imageUrl,
    explanation: q.explanation,
    payload: q.payload,
    difficulty: q.difficulty,
    tags: q.tags ?? [],
    isActive: q.isActive,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  };
}

export async function listQuestions(
  query: ListQuestionsQuery
): Promise<{ items: QuestionPublic[]; total: number }> {
  const conditions = [];

  if (query.subjectId) conditions.push(eq(questions.subjectId, query.subjectId));
  if (query.type) conditions.push(eq(questions.type, query.type));
  if (query.active === '1') conditions.push(eq(questions.isActive, true));
  if (query.active === '0') conditions.push(eq(questions.isActive, false));
  if (query.q) conditions.push(ilike(questions.text, `%${query.q}%`));
  if (query.tag) {
    conditions.push(sql`${questions.tags} @> ${JSON.stringify([query.tag])}::jsonb`);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalRow] = await Promise.all([
    db
      .select()
      .from(questions)
      .where(where)
      .orderBy(desc(questions.createdAt))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(questions).where(where),
  ]);

  return {
    items: rows.map(toPublic),
    total: totalRow[0]?.count ?? 0,
  };
}

export async function getQuestion(id: string): Promise<QuestionPublic> {
  const [row] = await db.select().from(questions).where(eq(questions.id, id)).limit(1);
  if (!row) throw new AppError('NOT_FOUND', 'Вопрос не найден', 404);
  return toPublic(row);
}

export async function createQuestion(
  input: CreateQuestionInput,
  actorId: string
): Promise<QuestionPublic> {
  const check = validatePayload(input.type, input.payload);
  if (!check.success) {
    throw new AppError('INVALID_PAYLOAD', 'Некорректный payload для типа вопроса', 422, {
      issues: check.error.issues,
    });
  }

  const settings = await getQuestionTypeSetting(input.type);
  if (settings && !settings.isEnabled) {
    throw new AppError(
      'QUESTION_TYPE_DISABLED',
      `Тип вопроса «${settings.title}» отключён в настройках`,
      400
    );
  }

  const [row] = await db
    .insert(questions)
    .values({
      subjectId: input.subjectId,
      type: input.type,
      text: input.text,
      imageUrl: input.imageUrl || null,
      explanation: input.explanation || null,
      payload: check.data as Record<string, unknown>,
      difficulty: input.difficulty ?? 2,
      tags: input.tags ?? [],
      createdBy: actorId,
    })
    .returning();

  await writeAudit({
    actorId,
    action: 'question.create',
    entity: 'question',
    entityId: row!.id,
    after: { type: row!.type, subjectId: row!.subjectId },
  });

  return toPublic(row!);
}

export async function updateQuestion(
  id: string,
  input: UpdateQuestionInput,
  actorId: string
): Promise<QuestionPublic> {
  const before = await getQuestion(id);

  const updates: Partial<typeof questions.$inferInsert> = { updatedAt: new Date() };
  const nextType = input.type ?? before.type;

  if (input.payload !== undefined) {
    const check = validatePayload(nextType, input.payload);
    if (!check.success) {
      throw new AppError('INVALID_PAYLOAD', 'Некорректный payload', 422, {
        issues: check.error.issues,
      });
    }
    updates.payload = check.data as Record<string, unknown>;
  }

  if (input.type !== undefined) updates.type = input.type;
  if (input.text !== undefined) updates.text = input.text;
  if (input.imageUrl !== undefined) updates.imageUrl = input.imageUrl || null;
  if (input.explanation !== undefined) updates.explanation = input.explanation || null;
  if (input.difficulty !== undefined) updates.difficulty = input.difficulty;
  if (input.tags !== undefined) updates.tags = input.tags;
  if (input.isActive !== undefined) updates.isActive = input.isActive;

  await db.update(questions).set(updates).where(eq(questions.id, id));

  await writeAudit({
    actorId,
    action: 'question.update',
    entity: 'question',
    entityId: id,
    before: { type: before.type, text: before.text.slice(0, 100) },
  });

  return getQuestion(id);
}

export async function deleteQuestion(id: string, actorId: string): Promise<void> {
  const q = await getQuestion(id);

  const usage = await db.execute<{ count: number }>(
    sql`SELECT COUNT(*)::int AS count FROM test_questions WHERE question_id = ${id}`
  );

  if ((usage[0]?.count ?? 0) > 0) {
    throw new AppError(
      'QUESTION_IN_USE',
      'Вопрос используется в тестах. Сначала удалите его из тестов.',
      409
    );
  }

  await db.delete(questions).where(eq(questions.id, id));

  await writeAudit({
    actorId,
    action: 'question.delete',
    entity: 'question',
    entityId: id,
    before: { type: q.type, text: q.text.slice(0, 100) },
  });
}

export async function pickRandomQuestions(
  subjectId: string,
  count: number,
  options: { exclude?: string[]; types?: Question['type'][] } = {}
): Promise<QuestionPublic[]> {
  const conditions = [
    eq(questions.subjectId, subjectId),
    eq(questions.isActive, true),
  ];

  if (options.exclude && options.exclude.length > 0) {
    conditions.push(sql`${questions.id} NOT IN ${options.exclude}`);
  }

  if (options.types && options.types.length > 0) {
    conditions.push(inArray(questions.type, options.types));
  }

  const rows = await db
    .select()
    .from(questions)
    .where(and(...conditions))
    .orderBy(sql`random()`)
    .limit(count);

  return rows.map(toPublic);
}

export async function pickFromHistory(
  childId: string,
  count: number
): Promise<QuestionPublic[]> {
  const rows = await db.execute<{
    id: string;
    subject_id: string;
    type: Question['type'];
    text: string;
    image_url: string | null;
    explanation: string | null;
    payload: Record<string, unknown>;
    difficulty: number;
    tags: string[] | null;
    is_active: boolean;
    created_by: string | null;
    created_at: Date;
    updated_at: Date;
  }>(sql`
    SELECT DISTINCT ON (q.id)
      q.id, q.subject_id, q.type, q.text, q.image_url, q.explanation,
      q.payload, q.difficulty, q.tags, q.is_active, q.created_by,
      q.created_at, q.updated_at
    FROM questions q
    INNER JOIN attempt_answers aa ON aa.question_id = q.id
    INNER JOIN attempts a ON a.id = aa.attempt_id
    WHERE a.child_id = ${childId}
      AND aa.is_correct = true
      AND q.is_active = true
    ORDER BY q.id, random()
    LIMIT ${count}
  `);

  return rows.map((r) => ({
    id: r.id,
    subjectId: r.subject_id,
    type: r.type,
    text: r.text,
    imageUrl: r.image_url,
    explanation: r.explanation,
    payload: r.payload,
    difficulty: r.difficulty,
    tags: r.tags ?? [],
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

// ============================================================
// QUESTION TYPE SETTINGS
// ============================================================

export interface QuestionTypeSettingPublic {
  type: QuestionType;
  title: string;
  description: string | null;
  icon: string | null;
  isEnabled: boolean;
  defaultPoints: number;
  minOptions: number | null;
  maxOptions: number | null;
  requiresImage: boolean;
  sortOrder: number;
  allowedRoles: string[];
  createdAt: Date;
  updatedAt: Date;
}

function toSettingPublic(s: QuestionTypeSetting): QuestionTypeSettingPublic {
  return {
    type: s.type,
    title: s.title,
    description: s.description,
    icon: s.icon,
    isEnabled: s.isEnabled,
    defaultPoints: s.defaultPoints,
    minOptions: s.minOptions,
    maxOptions: s.maxOptions,
    requiresImage: s.requiresImage,
    sortOrder: s.sortOrder,
    allowedRoles: s.allowedRoles ?? [],
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export async function listQuestionTypeSettings(): Promise<QuestionTypeSettingPublic[]> {
  const rows = await db
    .select()
    .from(questionTypeSettings)
    .orderBy(asc(questionTypeSettings.sortOrder), asc(questionTypeSettings.type));

  return rows.map(toSettingPublic);
}

export async function listEnabledQuestionTypeSettings(): Promise<QuestionTypeSettingPublic[]> {
  const rows = await db
    .select()
    .from(questionTypeSettings)
    .where(eq(questionTypeSettings.isEnabled, true))
    .orderBy(asc(questionTypeSettings.sortOrder), asc(questionTypeSettings.type));

  return rows.map(toSettingPublic);
}

export async function getQuestionTypeSetting(
  type: QuestionType
): Promise<QuestionTypeSettingPublic | null> {
  const [row] = await db
    .select()
    .from(questionTypeSettings)
    .where(eq(questionTypeSettings.type, type))
    .limit(1);

  return row ? toSettingPublic(row) : null;
}

export async function updateQuestionTypeSetting(
  type: QuestionType,
  input: QuestionTypeSettingUpdate,
  actorId: string
): Promise<QuestionTypeSettingPublic> {
  const before = await getQuestionTypeSetting(type);
  if (!before) {
    throw new AppError('NOT_FOUND', 'Тип вопроса не найден', 404);
  }

  const updates: Partial<typeof questionTypeSettings.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description || null;
  if (input.icon !== undefined) updates.icon = input.icon || null;
  if (input.isEnabled !== undefined) updates.isEnabled = input.isEnabled;
  if (input.defaultPoints !== undefined) updates.defaultPoints = input.defaultPoints;
  if (input.minOptions !== undefined) updates.minOptions = input.minOptions;
  if (input.maxOptions !== undefined) updates.maxOptions = input.maxOptions;
  if (input.requiresImage !== undefined) updates.requiresImage = input.requiresImage;
  if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;
  if (input.allowedRoles !== undefined) updates.allowedRoles = input.allowedRoles;

  await db
    .update(questionTypeSettings)
    .set(updates)
    .where(eq(questionTypeSettings.type, type));

  await writeAudit({
    actorId,
    action: 'question_type.update',
    entity: 'question_type',
    entityId: type,
    before: { isEnabled: before.isEnabled, sortOrder: before.sortOrder },
    after: {
      isEnabled: updates.isEnabled ?? before.isEnabled,
      sortOrder: updates.sortOrder ?? before.sortOrder,
    },
  });

  const updated = await getQuestionTypeSetting(type);
  if (!updated) throw new AppError('INTERNAL', 'Не удалось обновить', 500);
  return updated;
}

export async function reorderQuestionTypes(
  items: Array<{ type: QuestionType; sortOrder: number }>,
  actorId: string
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const item of items) {
      await tx
        .update(questionTypeSettings)
        .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
        .where(eq(questionTypeSettings.type, item.type));
    }
  });

  await writeAudit({
    actorId,
    action: 'question_type.reorder',
    entity: 'question_type',
    after: { count: items.length },
  });
}