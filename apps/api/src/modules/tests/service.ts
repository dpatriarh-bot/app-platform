// ============================================================
// tests/service.ts — CRUD тестов, публикация, версионирование,
// импорт CSV/XLSX, подборка тестов для ребёнка.
// XLSX парсится на сервере.
// ============================================================

import { eq, and, isNull, ilike, sql, desc, asc, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  tests,
  testQuestions,
  questions,
  children,
  type Test,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { writeAudit } from '../audit/service.js';
import { validatePayload } from '../questions/schemas.js';
import type {
  CreateTestInput,
  UpdateTestInput,
  ListTestsQuery,
  SetTestQuestionsInput,
} from './schemas.js';

export interface TestPublic {
  id: string;
  subjectId: string;
  title: string;
  description: string | null;
  status: Test['status'];
  version: number;
  timeLimitSec: number;
  gradeMin: number | null;
  gradeMax: number | null;
  ageMin: number | null;
  ageMax: number | null;
  pointsFixed: number;
  pointsPerCorrect: number;
  pointsPenaltyWrong: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  allowRetake: boolean;
  rewardOnRetake: boolean;
  questionsCount: number;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toPublic(t: Test, questionsCount = 0): TestPublic {
  return {
    id: t.id,
    subjectId: t.subjectId,
    title: t.title,
    description: t.description,
    status: t.status,
    version: t.version,
    timeLimitSec: t.timeLimitSec,
    gradeMin: t.gradeMin,
    gradeMax: t.gradeMax,
    ageMin: t.ageMin,
    ageMax: t.ageMax,
    pointsFixed: t.pointsFixed,
    pointsPerCorrect: t.pointsPerCorrect,
    pointsPenaltyWrong: t.pointsPenaltyWrong,
    shuffleQuestions: t.shuffleQuestions,
    shuffleOptions: t.shuffleOptions,
    allowRetake: t.allowRetake,
    rewardOnRetake: t.rewardOnRetake,
    questionsCount,
    publishedAt: t.publishedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export async function listTests(
  query: ListTestsQuery
): Promise<{ items: TestPublic[]; total: number }> {
  const conditions = [];

  if (query.subjectId) conditions.push(eq(tests.subjectId, query.subjectId));
  if (query.status) conditions.push(eq(tests.status, query.status));
  if (query.q) conditions.push(ilike(tests.title, `%${query.q}%`));
  if (query.gradeMin) {
    conditions.push(
      sql`(${tests.gradeMax} IS NULL OR ${tests.gradeMax} >= ${query.gradeMin})`
    );
  }
  if (query.gradeMax) {
    conditions.push(
      sql`(${tests.gradeMin} IS NULL OR ${tests.gradeMin} <= ${query.gradeMax})`
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        test: tests,
        questionsCount: sql<number>`(
          SELECT COUNT(*)::int FROM test_questions tq
          WHERE tq.test_id = ${tests.id}
        )`,
      })
      .from(tests)
      .where(where)
      .orderBy(desc(tests.updatedAt))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(tests).where(where),
  ]);

  return {
    items: rows.map((r) => toPublic(r.test, r.questionsCount)),
    total: totalRow[0]?.count ?? 0,
  };
}

export async function listTestsForChild(
  childId: string,
  subjectId?: string
): Promise<TestPublic[]> {
  const [child] = await db
    .select()
    .from(children)
    .where(and(eq(children.id, childId), isNull(children.deletedAt)))
    .limit(1);

  if (!child) throw new AppError('NOT_FOUND', 'Ребёнок не найден', 404);

  const age = new Date().getFullYear() - child.birthYear;
  const conditions = [eq(tests.status, 'published')];

  if (subjectId) conditions.push(eq(tests.subjectId, subjectId));

  conditions.push(
    sql`(
      (${tests.gradeMin} IS NULL AND ${tests.gradeMax} IS NULL AND ${tests.ageMin} IS NULL AND ${tests.ageMax} IS NULL)
      OR (${child.grade ?? null}::int IS NOT NULL
          AND (${tests.gradeMin} IS NULL OR ${tests.gradeMin} <= ${child.grade ?? null}::int)
          AND (${tests.gradeMax} IS NULL OR ${tests.gradeMax} >= ${child.grade ?? null}::int))
      OR ((${tests.ageMin} IS NULL OR ${tests.ageMin} <= ${age})
          AND (${tests.ageMax} IS NULL OR ${tests.ageMax} >= ${age}))
    )`
  );

  const rows = await db
    .select({
      test: tests,
      questionsCount: sql<number>`(
        SELECT COUNT(*)::int FROM test_questions tq
        WHERE tq.test_id = ${tests.id}
      )`,
    })
    .from(tests)
    .where(and(...conditions))
    .orderBy(asc(tests.title));

  return rows
    .filter((r) => r.questionsCount > 0)
    .map((r) => toPublic(r.test, r.questionsCount));
}

export async function getTest(id: string): Promise<TestPublic> {
  const [row] = await db
    .select({
      test: tests,
      questionsCount: sql<number>`(
        SELECT COUNT(*)::int FROM test_questions tq
        WHERE tq.test_id = ${tests.id}
      )`,
    })
    .from(tests)
    .where(eq(tests.id, id))
    .limit(1);

  if (!row) throw new AppError('NOT_FOUND', 'Тест не найден', 404);
  return toPublic(row.test, row.questionsCount);
}

export async function getTestWithQuestions(
  id: string
): Promise<TestPublic & { questions: Array<Record<string, unknown>> }> {
  const test = await getTest(id);

  const rows = await db
    .select({
      question: questions,
      orderIndex: testQuestions.orderIndex,
      pointsOverride: testQuestions.pointsOverride,
    })
    .from(testQuestions)
    .innerJoin(questions, eq(questions.id, testQuestions.questionId))
    .where(eq(testQuestions.testId, id))
    .orderBy(asc(testQuestions.orderIndex));

  return {
    ...test,
    questions: rows.map((r) => ({
      id: r.question.id,
      type: r.question.type,
      text: r.question.text,
      imageUrl: r.question.imageUrl,
      explanation: r.question.explanation,
      payload: r.question.payload,
      difficulty: r.question.difficulty,
      tags: r.question.tags ?? [],
      orderIndex: r.orderIndex,
      pointsOverride: r.pointsOverride,
    })),
  };
}

export async function createTest(
  input: CreateTestInput,
  actorId: string
): Promise<TestPublic> {
  const [row] = await db
    .insert(tests)
    .values({
      subjectId: input.subjectId,
      title: input.title,
      description: input.description || null,
      status: 'draft',
      version: 1,
      timeLimitSec: input.timeLimitSec ?? 600,
      gradeMin: input.gradeMin ?? null,
      gradeMax: input.gradeMax ?? null,
      ageMin: input.ageMin ?? null,
      ageMax: input.ageMax ?? null,
      pointsFixed: input.pointsFixed ?? 10,
      pointsPerCorrect: input.pointsPerCorrect ?? 2,
      pointsPenaltyWrong: input.pointsPenaltyWrong ?? 0,
      shuffleQuestions: input.shuffleQuestions ?? false,
      shuffleOptions: input.shuffleOptions ?? false,
      allowRetake: input.allowRetake ?? true,
      rewardOnRetake: input.rewardOnRetake ?? false,
      createdBy: actorId,
    })
    .returning();

  await writeAudit({
    actorId,
    action: 'test.create',
    entity: 'test',
    entityId: row!.id,
    after: { title: row!.title, subjectId: row!.subjectId },
  });

  return toPublic(row!, 0);
}

export async function updateTest(
  id: string,
  input: UpdateTestInput,
  actorId: string
): Promise<TestPublic> {
  const before = await getTest(id);

  if (before.status === 'published') {
    const allowed = ['allowRetake', 'rewardOnRetake', 'shuffleQuestions', 'shuffleOptions'];
    const attempted = Object.keys(input).filter((k) => !allowed.includes(k));
    if (attempted.length > 0) {
      throw new AppError(
        'TEST_PUBLISHED',
        'Опубликованный тест нельзя редактировать. Создайте новую версию.',
        409
      );
    }
  }

  const updates: Partial<typeof tests.$inferInsert> = { updatedAt: new Date() };
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      (updates as Record<string, unknown>)[key] =
        typeof value === 'string' && value === '' ? null : value;
    }
  }

  await db.update(tests).set(updates).where(eq(tests.id, id));

  await writeAudit({
    actorId,
    action: 'test.update',
    entity: 'test',
    entityId: id,
    before: { title: before.title, status: before.status },
  });

  return getTest(id);
}

export async function setTestQuestions(
  id: string,
  input: SetTestQuestionsInput,
  actorId: string
): Promise<TestPublic> {
  const test = await getTest(id);

  if (test.status === 'published') {
    throw new AppError(
      'TEST_PUBLISHED',
      'Опубликованный тест нельзя редактировать',
      409
    );
  }

  const ids = input.items.map((i) => i.questionId);
  if (ids.length > 0) {
    const found = await db
      .select({ id: questions.id, subjectId: questions.subjectId })
      .from(questions)
      .where(inArray(questions.id, ids));

    if (found.length !== ids.length) {
      throw new AppError('QUESTION_NOT_FOUND', 'Один или несколько вопросов не найдены', 404);
    }

    const wrongSubject = found.find((f) => f.subjectId !== test.subjectId);
    if (wrongSubject) {
      throw new AppError(
        'SUBJECT_MISMATCH',
        'Все вопросы должны принадлежать той же дисциплине, что и тест',
        400
      );
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(testQuestions).where(eq(testQuestions.testId, id));

    if (input.items.length > 0) {
      await tx.insert(testQuestions).values(
        input.items.map((i) => ({
          testId: id,
          questionId: i.questionId,
          orderIndex: i.orderIndex,
          pointsOverride: i.pointsOverride ?? null,
        }))
      );
    }

    await tx.update(tests).set({ updatedAt: new Date() }).where(eq(tests.id, id));
  });

  await writeAudit({
    actorId,
    action: 'test.set_questions',
    entity: 'test',
    entityId: id,
    after: { count: input.items.length },
  });

  return getTest(id);
}

export async function publishTest(
  id: string,
  status: 'draft' | 'review' | 'published' | 'archived',
  actorId: string,
  comment?: string
): Promise<TestPublic> {
  const test = await getTest(id);

  if (status === 'published' && test.questionsCount === 0) {
    throw new AppError('TEST_EMPTY', 'Нельзя опубликовать тест без вопросов', 400);
  }

  const updates: Partial<typeof tests.$inferInsert> = {
    status,
    updatedAt: new Date(),
  };

  if (status === 'published') updates.publishedAt = new Date();
  if (status === 'archived') updates.archivedAt = new Date();
  if (status === 'draft' && test.status === 'published') {
    updates.version = test.version + 1;
  }

  await db.update(tests).set(updates).where(eq(tests.id, id));

  await writeAudit({
    actorId,
    action: 'test.publish',
    entity: 'test',
    entityId: id,
    before: { status: test.status },
    after: { status, comment: comment ?? null },
  });

  return getTest(id);
}

export async function deleteTest(id: string, actorId: string): Promise<void> {
  const test = await getTest(id);

  const attemptsRows = await db.execute<{ count: number }>(
    sql`SELECT COUNT(*)::int AS count FROM attempts WHERE test_id = ${id}`
  );

  if ((attemptsRows[0]?.count ?? 0) > 0) {
    throw new AppError(
      'TEST_HAS_ATTEMPTS',
      'Тест уже проходили. Удалить нельзя — только архивировать.',
      409
    );
  }

  await db.delete(tests).where(eq(tests.id, id));

  await writeAudit({
    actorId,
    action: 'test.delete',
    entity: 'test',
    entityId: id,
    before: { title: test.title },
  });
}

export async function cloneTest(
  id: string,
  actorId: string,
  newTitle?: string
): Promise<TestPublic> {
  const source = await getTestWithQuestions(id);

  const [clone] = await db
    .insert(tests)
    .values({
      subjectId: source.subjectId,
      title: newTitle ?? `${source.title} (копия)`,
      description: source.description,
      status: 'draft',
      version: 1,
      timeLimitSec: source.timeLimitSec,
      gradeMin: source.gradeMin,
      gradeMax: source.gradeMax,
      ageMin: source.ageMin,
      ageMax: source.ageMax,
      pointsFixed: source.pointsFixed,
      pointsPerCorrect: source.pointsPerCorrect,
      pointsPenaltyWrong: source.pointsPenaltyWrong,
      shuffleQuestions: source.shuffleQuestions,
      shuffleOptions: source.shuffleOptions,
      allowRetake: source.allowRetake,
      rewardOnRetake: source.rewardOnRetake,
      createdBy: actorId,
    })
    .returning();

  if (source.questions.length > 0) {
    await db.insert(testQuestions).values(
      source.questions.map((q, i) => ({
        testId: clone!.id,
        questionId: q.id as string,
        orderIndex: i,
        pointsOverride: (q.pointsOverride as number | null) ?? null,
      }))
    );
  }

  await writeAudit({
    actorId,
    action: 'test.clone',
    entity: 'test',
    entityId: clone!.id,
    after: { sourceId: id },
  });

  return getTest(clone!.id);
}

// ============================================================
// Импорт CSV/XLSX
// ============================================================

export interface ImportResult {
  total: number;
  created: number;
  errors: Array<{ row: number; message: string }>;
  dryRun: boolean;
}

interface ParsedRow {
  type: string;
  text: string;
  payload: string;
  explanation?: string;
  difficulty?: string;
  tags?: string;
}

export async function importQuestions(
  subjectId: string,
  format: 'csv' | 'xlsx',
  data: string,
  actorId: string,
  dryRun = false
): Promise<ImportResult> {
  let rows: ParsedRow[];

  if (format === 'xlsx') {
    rows = await parseXlsx(data);
  } else {
    rows = parseCsv(data);
  }

  if (rows.length === 0) {
    throw new AppError('EMPTY_FILE', 'Файл пустой или не содержит данных', 400);
  }

  const result: ImportResult = {
    total: rows.length,
    created: 0,
    errors: [],
    dryRun,
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;

    try {
      const type = r.type.trim() as
        | 'input_number'
        | 'input_text'
        | 'single_choice'
        | 'multi_choice'
        | 'matching'
        | 'ordering'
        | 'formula';

      if (!type || !r.text?.trim() || !r.payload?.trim()) {
        result.errors.push({ row: i + 2, message: 'Пустые обязательные поля' });
        continue;
      }

      const payload = JSON.parse(r.payload) as unknown;
      const check = validatePayload(type, payload);
      if (!check.success) {
        result.errors.push({
          row: i + 2,
          message: check.error.issues.map((x) => x.message).join('; '),
        });
        continue;
      }

      if (!dryRun) {
        await db.insert(questions).values({
          subjectId,
          type,
          text: r.text.trim(),
          payload: check.data as Record<string, unknown>,
          explanation: r.explanation?.trim() || null,
          difficulty: r.difficulty ? parseInt(r.difficulty, 10) : 2,
          tags: r.tags ? r.tags.split('|').map((t) => t.trim()) : [],
          createdBy: actorId,
        });
      }

      result.created += 1;
    } catch (err) {
      result.errors.push({
        row: i + 2,
        message: err instanceof Error ? err.message : 'Ошибка разбора',
      });
    }
  }

  await writeAudit({
    actorId,
    action: dryRun ? 'test.import_dryrun' : 'test.import',
    entity: 'subject',
    entityId: subjectId,
    after: {
      format,
      total: result.total,
      created: result.created,
      errors: result.errors.length,
    },
  });

  return result;
}

function parseCsv(csv: string): ParsedRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) throw new AppError('EMPTY_CSV', 'Пустой CSV', 400);

  const header = lines[0]!.split(',').map((h) => h.trim().toLowerCase());
  const expected = ['type', 'text', 'payload'];
  for (const col of expected) {
    if (!header.includes(col)) {
      throw new AppError('INVALID_CSV', `Отсутствует колонка "${col}"`, 400);
    }
  }

  const idx = {
    type: header.indexOf('type'),
    text: header.indexOf('text'),
    payload: header.indexOf('payload'),
    explanation: header.indexOf('explanation'),
    difficulty: header.indexOf('difficulty'),
    tags: header.indexOf('tags'),
  };

  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]!);
    rows.push({
      type: cells[idx.type] ?? '',
      text: cells[idx.text] ?? '',
      payload: cells[idx.payload] ?? '',
      explanation: idx.explanation >= 0 ? cells[idx.explanation] : undefined,
      difficulty: idx.difficulty >= 0 ? cells[idx.difficulty] : undefined,
      tags: idx.tags >= 0 ? cells[idx.tags] : undefined,
    });
  }
  return rows;
}

async function parseXlsx(base64OrPath: string): Promise<ParsedRow[]> {
  // Динамический импорт: пакет xlsx не обязателен для тех, кто не импортирует XLSX.
  let XLSX: typeof import('xlsx');
  try {
    XLSX = await import('xlsx');
  } catch {
    throw new AppError(
      'XLSX_NOT_SUPPORTED',
      'Пакет xlsx не установлен на сервере. Установите: npm i xlsx',
      500
    );
  }

  const buffer = Buffer.from(
    base64OrPath.startsWith('data:')
      ? base64OrPath.split(',')[1] ?? ''
      : base64OrPath,
    'base64'
  );

  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new AppError('EMPTY_XLSX', 'В файле нет листов', 400);

  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new AppError('EMPTY_XLSX', 'Лист пустой', 400);

  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    header: 1,
    blankrows: false,
    defval: '',
  }) as unknown as unknown[][];

  if (json.length < 2) {
    throw new AppError('EMPTY_XLSX', 'В файле нет данных', 400);
  }

  const header = (json[0] as unknown[]).map((h) => String(h).trim().toLowerCase());
  const expected = ['type', 'text', 'payload'];
  for (const col of expected) {
    if (!header.includes(col)) {
      throw new AppError('INVALID_XLSX', `Отсутствует колонка "${col}"`, 400);
    }
  }

  const idx = {
    type: header.indexOf('type'),
    text: header.indexOf('text'),
    payload: header.indexOf('payload'),
    explanation: header.indexOf('explanation'),
    difficulty: header.indexOf('difficulty'),
    tags: header.indexOf('tags'),
  };

  const rows: ParsedRow[] = [];
  for (let i = 1; i < json.length; i++) {
    const raw = json[i] as unknown[];
    const cell = (col: number): string =>
      col >= 0 && raw[col] !== undefined && raw[col] !== null ? String(raw[col]) : '';

    rows.push({
      type: cell(idx.type),
      text: cell(idx.text),
      payload: cell(idx.payload),
      explanation: idx.explanation >= 0 ? cell(idx.explanation) : undefined,
      difficulty: idx.difficulty >= 0 ? cell(idx.difficulty) : undefined,
      tags: idx.tags >= 0 ? cell(idx.tags) : undefined,
    });
  }

  return rows;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}