// ============================================================
// seed-test-all-types.ts — создаёт тест со всеми 7 типами вопросов
// Запуск: npm run db:seed:test
// ============================================================

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { encryptPII, hashPII } from '../lib/crypto.js';
import * as schema from './schema.js';

const {
  subjects,
  tests,
  questions,
  testQuestions,
  children,
  childBalances,
  users,
  parents,
} = schema;

const TEST_TITLE = '🎨 Все 7 типов вопросов — демо';
const TEST_SLUG = 'all-question-types';

interface SeedQuestion {
  type:
    | 'input_number'
    | 'input_text'
    | 'single_choice'
    | 'multi_choice'
    | 'matching'
    | 'ordering'
    | 'formula';
  text: string;
  explanation?: string;
  difficulty?: number;
  tags?: string[];
  payload: Record<string, unknown>;
}

const DEMO_QUESTIONS: SeedQuestion[] = [
  {
    type: 'input_number',
    text: 'Сколько будет 25 + 17?',
    explanation: '25 + 17 = 42. Простое сложение в столбик.',
    difficulty: 1,
    tags: ['арифметика', 'сложение'],
    payload: { correct: 42, tolerance: 0 },
  },
  {
    type: 'input_text',
    text: 'Столица России?',
    explanation: 'Москва — столица Российской Федерации с 1918 года.',
    difficulty: 1,
    tags: ['география'],
    payload: { correct: ['Москва', 'москва'], caseSensitive: false },
  },
  {
    type: 'single_choice',
    text: 'Какое число чётное?',
    explanation: '24 делится на 2 без остатка, остальные — нет.',
    difficulty: 1,
    tags: ['числа'],
    payload: {
      options: [
        { id: 'a', text: '17' },
        { id: 'b', text: '24' },
        { id: 'c', text: '31' },
        { id: 'd', text: '45' },
      ],
      correct: 'b',
    },
  },
  {
    type: 'multi_choice',
    text: 'Выберите все простые числа',
    explanation: '2, 3 и 5 — простые. 4 = 2 × 2, поэтому не простое.',
    difficulty: 2,
    tags: ['числа', 'простые'],
    payload: {
      options: [
        { id: 'a', text: '2' },
        { id: 'b', text: '3' },
        { id: 'c', text: '4' },
        { id: 'd', text: '5' },
      ],
      correct: ['a', 'b', 'd'],
    },
  },
  {
    type: 'matching',
    text: 'Сопоставьте страну и её столицу',
    explanation: 'Франция — Париж, Германия — Берлин, Италия — Рим.',
    difficulty: 2,
    tags: ['география'],
    payload: {
      left: ['Франция', 'Германия', 'Италия'],
      right: ['Париж', 'Берлин', 'Рим'],
      correct: {
        'Франция': 'Париж',
        'Германия': 'Берлин',
        'Италия': 'Рим',
      },
    },
  },
  {
    type: 'ordering',
    text: 'Расставьте числа по возрастанию',
    explanation: 'Правильный порядок: 3 → 7 → 12 → 20.',
    difficulty: 1,
    tags: ['числа', 'порядок'],
    payload: {
      items: ['3', '7', '12', '20'],
      correct: [0, 1, 2, 3],
    },
  },
  {
    type: 'formula',
    text: 'Вычислите площадь квадрата со стороной 5 (введите формулу)',
    explanation: 'S = a² = 5² = 25. Можно ввести «5^2» или «5*5».',
    difficulty: 2,
    tags: ['геометрия', 'формула'],
    payload: { correct: '25' },
  },
];

async function seed(): Promise<void> {
  const sqlClient = postgres(config.DATABASE_URL, { max: 1 });
  const db = drizzle(sqlClient, { schema });

  logger.info('🎨 Seeding demo test with all 7 question types');

  try {
    // 1. Гарантируем наличие дисциплины «Демо»
    let [subject] = await db
      .select()
      .from(subjects)
      .where(eq(subjects.slug, 'demo'))
      .limit(1);

    if (!subject) {
      [subject] = await db
        .insert(subjects)
        .values({
          slug: 'demo',
          title: 'Демо-дисциплина',
          description: 'Демонстрационная дисциплина со всеми типами вопросов',
          icon: 'star',
          color: '#7C4DFF',
          orderIndex: 100,
          isActive: true,
        })
        .returning();
      logger.info('→ Создана дисциплина «Демо»');
    }

    // 2. Удаляем старый демо-тест, если есть (для перезапуска)
    const [existingTest] = await db
      .select({ id: tests.id })
      .from(tests)
      .where(eq(tests.title, TEST_TITLE))
      .limit(1);

    if (existingTest) {
      await db.delete(testQuestions).where(eq(testQuestions.testId, existingTest.id));
      await db.delete(questions).where(eq(questions.subjectId, subject!.id));
      await db.delete(tests).where(eq(tests.id, existingTest.id));
      logger.info('→ Удалён старый демо-тест');
    } else {
      // На всякий случай удаляем вопросы дисциплины «Демо»
      await db.delete(questions).where(eq(questions.subjectId, subject!.id));
    }

    // 3. Создаём тест
    const [test] = await db
      .insert(tests)
      .values({
        subjectId: subject!.id,
        title: TEST_TITLE,
        description:
          'Пройдите короткий тест из 7 вопросов — по одному на каждый тип. ' +
          'Так вы увидите, как выглядит прохождение.',
        status: 'published',
        timeLimitSec: 900,
        gradeMin: 1,
        gradeMax: 11,
        pointsFixed: 10,
        pointsPerCorrect: 5,
        pointsPenaltyWrong: 0,
        shuffleQuestions: false,
        shuffleOptions: false,
        allowRetake: true,
        rewardOnRetake: true,
        publishedAt: new Date(),
      })
      .returning();

    logger.info({ testId: test!.id }, '→ Тест создан');

    // 4. Создаём вопросы и привязываем к тесту
    const insertedIds: string[] = [];

    for (let i = 0; i < DEMO_QUESTIONS.length; i++) {
      const q = DEMO_QUESTIONS[i]!;
      const [inserted] = await db
        .insert(questions)
        .values({
          subjectId: subject!.id,
          type: q.type,
          text: q.text,
          explanation: q.explanation ?? null,
          payload: q.payload,
          difficulty: q.difficulty ?? 2,
          tags: q.tags ?? [],
          isActive: true,
        })
        .returning();
      insertedIds.push(inserted!.id);
    }

    await db.insert(testQuestions).values(
      insertedIds.map((qid, i) => ({
        testId: test!.id,
        questionId: qid,
        orderIndex: i,
      }))
    );

    logger.info({ count: insertedIds.length }, '→ Вопросы привязаны');

    // 5. Даем демо-ребёнку доступ (если есть)
    const [demoChild] = await db
      .select({ id: children.id, parentId: children.parentId })
      .from(children)
      .where(isNull(children.deletedAt))
      .limit(1);

    if (demoChild) {
      // Проверим, есть ли баланс — если нет, создадим
      const [balance] = await db
        .select()
        .from(childBalances)
        .where(eq(childBalances.childId, demoChild.id))
        .limit(1);

      if (!balance) {
        await db.insert(childBalances).values({
          childId: demoChild.id,
          balance: 0,
          lifetimeEarned: 0,
          lifetimeSpent: 0,
        });
      }
      logger.info({ childId: demoChild.id }, '→ Демо-ребёнок готов к тесту');
    } else {
      logger.warn('→ Демо-ребёнок не найден, тест доступен после создания ребёнка');
    }

    logger.info('✅ Демо-тест со всеми 7 типами создан');
    logger.info('');
    logger.info(`   Дисциплина:  ${subject!.title} (${subject!.slug})`);
    logger.info(`   Тест:        ${TEST_TITLE}`);
    logger.info(`   Test ID:     ${test!.id}`);
    logger.info(`   Вопросов:    ${insertedIds.length}`);
    logger.info('');
    logger.info('   Откройте: /app/subjects → «Демо-дисциплина» → тест');
  } catch (err) {
    logger.error({ err }, '❌ seed failed');
    process.exit(1);
  } finally {
    await sqlClient.end();
  }
}

void seed;
void users;
void parents;
void encryptPII;
void hashPII;
void and;
void sql;

seed();