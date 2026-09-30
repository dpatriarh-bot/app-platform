// ============================================================
// subjects/service.ts — CRUD дисциплин + фильтрация по классу
// ============================================================

import { eq, and, isNull, ilike, sql, asc, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  subjects,
  children,
  tests,
  type Subject,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { writeAudit } from '../audit/service.js';
import type {
  CreateSubjectInput,
  UpdateSubjectInput,
  ListSubjectsQuery,
} from './schemas.js';

export interface SubjectPublic {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  grades: number[];
  gradeMin: number | null;
  gradeMax: number | null;
  ageMin: number | null;
  ageMax: number | null;
  orderIndex: number;
  isActive: boolean;
  testsCount: number;
  allTestsCount: number;
  createdAt: Date;
  updatedAt: Date;
}

function toPublic(s: Subject, testsCount = 0, allTestsCount = 0): SubjectPublic {
  return {
    id: s.id,
    slug: s.slug,
    title: s.title,
    description: s.description,
    icon: s.icon,
    color: s.color,
    grades: (s.grades ?? []) as number[],
    gradeMin: s.gradeMin,
    gradeMax: s.gradeMax,
    ageMin: s.ageMin,
    ageMax: s.ageMax,
    orderIndex: s.orderIndex,
    isActive: s.isActive,
    testsCount,
    allTestsCount,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

async function getTestsCountBySubject(
  subjectIds: string[]
): Promise<Map<string, { published: number; all: number }>> {
  const map = new Map<string, { published: number; all: number }>();
  if (subjectIds.length === 0) return map;

  const rows = await db
    .select({
      subjectId: tests.subjectId,
      all: sql<number>`count(*)::int`,
      published: sql<number>`count(*) FILTER (WHERE ${tests.status} = 'published')::int`,
    })
    .from(tests)
    .where(inArray(tests.subjectId, subjectIds))
    .groupBy(tests.subjectId);

  for (const r of rows) {
    map.set(r.subjectId, { published: r.published, all: r.all });
  }
  return map;
}

// ============================================================
// LIST
// ============================================================

export async function listSubjects(
  query: ListSubjectsQuery
): Promise<SubjectPublic[]> {
  const conditions = [];

  if (query.active === '1') conditions.push(eq(subjects.isActive, true));
  if (query.active === '0') conditions.push(eq(subjects.isActive, false));
  if (query.q) conditions.push(ilike(subjects.title, `%${query.q}%`));

  // Фильтр по классу: subjects.grades содержит указанный класс
  if (query.grade !== undefined) {
    conditions.push(
      sql`${subjects.grades} && ARRAY[${query.grade}]::smallint[]`
    );
  }

  const rows = await db
    .select()
    .from(subjects)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(subjects.orderIndex), asc(subjects.title))
    .limit(query.limit)
    .offset(query.offset);

  if (rows.length === 0) return [];

  const countsMap = await getTestsCountBySubject(rows.map((s) => s.id));

  return rows.map((s) => {
    const c = countsMap.get(s.id);
    return toPublic(s, c?.published ?? 0, c?.all ?? 0);
  });
}

// ============================================================
// Сводка по классам: сколько дисциплин в каждом классе 1..11
// ============================================================

export interface GradesSummary {
  grade: number;
  subjectsCount: number;
}

export async function getGradesSummary(): Promise<GradesSummary[]> {
  const rows = await db.execute<{ grade: number; count: number }>(sql`
    SELECT g AS grade, COUNT(s.id)::int AS count
    FROM generate_series(1, 11) AS g
    LEFT JOIN subjects s
      ON s.is_active = true
      AND s.grades && ARRAY[g]::smallint[]
    GROUP BY g
    ORDER BY g
  `);

  return rows.map((r) => ({
    grade: r.grade,
    subjectsCount: r.count,
  }));
}

// ============================================================
// LIST FOR CHILD
// ============================================================

export async function listSubjectsForChild(childId: string): Promise<SubjectPublic[]> {
  const [child] = await db
    .select()
    .from(children)
    .where(and(eq(children.id, childId), isNull(children.deletedAt)))
    .limit(1);

  if (!child) throw new AppError('NOT_FOUND', 'Ребёнок не найден', 404);

  const age = new Date().getFullYear() - child.birthYear;
  const grade = child.grade;

  const rows = await db.execute<{
    id: string;
    slug: string;
    title: string;
    description: string | null;
    icon: string | null;
    color: string | null;
    grades: number[];
    grade_min: number | null;
    grade_max: number | null;
    age_min: number | null;
    age_max: number | null;
    order_index: number;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
    tests_count: number;
    all_tests_count: number;
  }>(sql`
    SELECT
      s.id, s.slug, s.title, s.description, s.icon, s.color,
      s.grades,
      s.grade_min, s.grade_max, s.age_min, s.age_max,
      s.order_index, s.is_active, s.created_at, s.updated_at,
      (
        SELECT COUNT(*)::int
        FROM tests t
        WHERE t.subject_id = s.id
          AND t.status = 'published'
          AND (
            (
              t.grade_min IS NULL
              AND t.grade_max IS NULL
              AND t.age_min IS NULL
              AND t.age_max IS NULL
            )
            OR (
              ${grade}::int IS NOT NULL
              AND (t.grade_min IS NULL OR t.grade_min <= ${grade}::int)
              AND (t.grade_max IS NULL OR t.grade_max >= ${grade}::int)
            )
            OR (
              (t.age_min IS NULL OR t.age_min <= ${age}::int)
              AND (t.age_max IS NULL OR t.age_max >= ${age}::int)
            )
          )
      ) AS tests_count,
      (
        SELECT COUNT(*)::int
        FROM tests t
        WHERE t.subject_id = s.id
      ) AS all_tests_count
    FROM subjects s
    WHERE s.is_active = true
      AND (
        array_length(s.grades, 1) IS NULL
        OR (${grade}::int IS NOT NULL AND s.grades && ARRAY[${grade}]::smallint[])
      )
    ORDER BY s.order_index ASC, s.title ASC
  `);

  return rows
    .filter((r) => r.tests_count > 0)
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      description: r.description,
      icon: r.icon,
      color: r.color,
      grades: r.grades ?? [],
      gradeMin: r.grade_min,
      gradeMax: r.grade_max,
      ageMin: r.age_min,
      ageMax: r.age_max,
      orderIndex: r.order_index,
      isActive: r.is_active,
      testsCount: r.tests_count,
      allTestsCount: r.all_tests_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
}

// ============================================================
// GET BY SLUG / ID
// ============================================================

export async function getSubjectBySlug(slug: string): Promise<SubjectPublic> {
  const [row] = await db
    .select()
    .from(subjects)
    .where(eq(subjects.slug, slug))
    .limit(1);

  if (!row) throw new AppError('NOT_FOUND', 'Дисциплина не найдена', 404);

  const counts = await getTestsCountBySubject([row.id]);
  const c = counts.get(row.id);

  return toPublic(row, c?.published ?? 0, c?.all ?? 0);
}

export async function getSubjectById(id: string): Promise<SubjectPublic> {
  const [row] = await db
    .select()
    .from(subjects)
    .where(eq(subjects.id, id))
    .limit(1);

  if (!row) throw new AppError('NOT_FOUND', 'Дисциплина не найдена', 404);

  const counts = await getTestsCountBySubject([row.id]);
  const c = counts.get(row.id);

  return toPublic(row, c?.published ?? 0, c?.all ?? 0);
}

// ============================================================
// CREATE / UPDATE / DELETE
// ============================================================

export async function createSubject(
  input: CreateSubjectInput,
  actorId: string
): Promise<SubjectPublic> {
  const existing = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(eq(subjects.slug, input.slug))
    .limit(1);

  if (existing.length > 0) {
    throw new AppError('SLUG_TAKEN', 'Дисциплина с таким slug уже существует', 409);
  }

  const grades = normalizeGrades(input.grades);
  const gradeMin = grades.length > 0 ? Math.min(...grades) : input.gradeMin ?? null;
  const gradeMax = grades.length > 0 ? Math.max(...grades) : input.gradeMax ?? null;

  const [row] = await db
    .insert(subjects)
    .values({
      slug: input.slug,
      title: input.title,
      description: input.description || null,
      icon: input.icon || null,
      color: input.color || null,
      grades,
      gradeMin,
      gradeMax,
      ageMin: input.ageMin ?? null,
      ageMax: input.ageMax ?? null,
      orderIndex: input.orderIndex ?? 0,
      isActive: input.isActive ?? true,
    })
    .returning();

  await writeAudit({
    actorId,
    action: 'subject.create',
    entity: 'subject',
    entityId: row!.id,
    after: { slug: row!.slug, title: row!.title, grades },
  });

  return toPublic(row!, 0, 0);
}

export async function updateSubject(
  id: string,
  input: UpdateSubjectInput,
  actorId: string
): Promise<SubjectPublic> {
  const before = await getSubjectById(id);

  const updates: Partial<typeof subjects.$inferInsert> = { updatedAt: new Date() };

  if (input.slug !== undefined && input.slug !== before.slug) {
    const dup = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(eq(subjects.slug, input.slug))
      .limit(1);
    if (dup.length > 0 && dup[0]!.id !== id) {
      throw new AppError('SLUG_TAKEN', 'Дисциплина с таким slug уже существует', 409);
    }
    updates.slug = input.slug;
  }

  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description || null;
  if (input.icon !== undefined) updates.icon = input.icon || null;
  if (input.color !== undefined) updates.color = input.color || null;
  if (input.ageMin !== undefined) updates.ageMin = input.ageMin ?? null;
  if (input.ageMax !== undefined) updates.ageMax = input.ageMax ?? null;
  if (input.orderIndex !== undefined) updates.orderIndex = input.orderIndex;
  if (input.isActive !== undefined) updates.isActive = input.isActive;

  if (input.grades !== undefined) {
    const grades = normalizeGrades(input.grades);
    updates.grades = grades;
    updates.gradeMin = grades.length > 0 ? Math.min(...grades) : null;
    updates.gradeMax = grades.length > 0 ? Math.max(...grades) : null;
  }

  await db.update(subjects).set(updates).where(eq(subjects.id, id));

  await writeAudit({
    actorId,
    action: 'subject.update',
    entity: 'subject',
    entityId: id,
    before: { slug: before.slug, grades: before.grades, isActive: before.isActive },
    after: {
      slug: updates.slug ?? before.slug,
      grades: updates.grades ?? before.grades,
      isActive: updates.isActive ?? before.isActive,
    },
  });

  return getSubjectById(id);
}

export async function deleteSubject(id: string, actorId: string): Promise<void> {
  const subject = await getSubjectById(id);

  const testsRows = await db
    .select({ id: tests.id })
    .from(tests)
    .where(eq(tests.subjectId, id))
    .limit(1);

  if (testsRows.length > 0) {
    throw new AppError(
      'SUBJECT_HAS_TESTS',
      'Нельзя удалить дисциплину, в которой есть тесты. Сначала удалите или перенесите тесты.',
      409
    );
  }

  await db.delete(subjects).where(eq(subjects.id, id));

  await writeAudit({
    actorId,
    action: 'subject.delete',
    entity: 'subject',
    entityId: id,
    before: { slug: subject.slug, title: subject.title },
  });
}

export async function reorderSubjects(
  items: Array<{ id: string; orderIndex: number }>,
  actorId: string
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const item of items) {
      await tx
        .update(subjects)
        .set({ orderIndex: item.orderIndex, updatedAt: new Date() })
        .where(eq(subjects.id, item.id));
    }
  });

  await writeAudit({
    actorId,
    action: 'subject.reorder',
    entity: 'subject',
    after: { count: items.length },
  });
}

// ============================================================
// Helpers
// ============================================================

function normalizeGrades(grades: number[] | undefined): number[] {
  if (!grades || grades.length === 0) return [];
  const set = new Set<number>();
  for (const g of grades) {
    if (Number.isInteger(g) && g >= 1 && g <= 11) set.add(g);
  }
  return [...set].sort((a, b) => a - b);
}