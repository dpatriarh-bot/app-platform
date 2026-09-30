// ============================================================
// seed-subjects.ts — наполнение справочника дисциплин 1–11 классов
// Запуск: npm run db:seed:subjects
// ============================================================

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import * as schema from './schema.js';

const { subjects } = schema;

interface SubjectSeed {
  slug: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  grades: number[];
  orderIndex: number;
}

// ---------- Соответствие иконок (Feather) и цветов ----------

const SUBJECTS: SubjectSeed[] = [
  // ---------- Языки и литература ----------
  {
    slug: 'russian',
    title: 'Русский язык',
    description: 'Орфография, пунктуация, лексика, морфология',
    icon: 'book-open',
    color: '#FF5C8A',
    grades: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    orderIndex: 10,
  },
  {
    slug: 'literature',
    title: 'Литература',
    description: 'Русская и зарубежная литература, анализ произведений',
    icon: 'book',
    color: '#7C4DFF',
    grades: [5, 6, 7, 8, 9, 10, 11],
    orderIndex: 11,
  },
  {
    slug: 'literary-reading',
    title: 'Литературное чтение',
    description: 'Чтение и разбор произведений для начальной школы',
    icon: 'book',
    color: '#7C4DFF',
    grades: [1, 2, 3, 4],
    orderIndex: 12,
  },
  {
    slug: 'english',
    title: 'Английский язык',
    description: 'Грамматика, лексика, чтение, аудирование',
    icon: 'globe',
    color: '#00B8D4',
    grades: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    orderIndex: 13,
  },
  {
    slug: 'foreign-language',
    title: 'Иностранный язык',
    description: 'Второй иностранный язык (немецкий, французский и др.)',
    icon: 'globe',
    color: '#00B8D4',
    grades: [5, 6, 7, 8, 9, 10, 11],
    orderIndex: 14,
  },

  // ---------- Математика ----------
  {
    slug: 'math',
    title: 'Математика',
    description: 'Арифметика, начальные разделы алгебры и геометрии',
    icon: 'hash',
    color: '#66B132',
    grades: [1, 2, 3, 4, 5, 6],
    orderIndex: 20,
  },
  {
    slug: 'algebra',
    title: 'Алгебра',
    description: 'Уравнения, функции, алгебраические выражения',
    icon: 'hash',
    color: '#66B132',
    grades: [7, 8, 9, 10, 11],
    orderIndex: 21,
  },
  {
    slug: 'geometry',
    title: 'Геометрия',
    description: 'Планиметрия и стереометрия',
    icon: 'triangle',
    color: '#34C759',
    grades: [7, 8, 9, 10, 11],
    orderIndex: 22,
  },
  {
    slug: 'algebra-analysis',
    title: 'Алгебра и начала анализа',
    description: 'Старшая школа: тригонометрия, производная, интеграл',
    icon: 'trending-up',
    color: '#66B132',
    grades: [10, 11],
    orderIndex: 23,
  },

  // ---------- Естественные науки ----------
  {
    slug: 'biology',
    title: 'Биология',
    description: 'Ботаника, зоология, анатомия, генетика',
    icon: 'leaf',
    color: '#34C759',
    grades: [5, 6, 7, 8, 9, 10, 11],
    orderIndex: 30,
  },
  {
    slug: 'physics',
    title: 'Физика',
    description: 'Механика, термодинамика, электричество, оптика',
    icon: 'zap',
    color: '#FF8A3D',
    grades: [7, 8, 9, 10, 11],
    orderIndex: 31,
  },
  {
    slug: 'chemistry',
    title: 'Химия',
    description: 'Неорганическая и органическая химия',
    icon: 'droplet',
    color: '#00B8D4',
    grades: [8, 9, 10, 11],
    orderIndex: 32,
  },
  {
    slug: 'geography',
    title: 'География',
    description: 'Физическая и экономическая география',
    icon: 'globe',
    color: '#00B8D4',
    grades: [5, 6, 7, 8, 9, 10, 11],
    orderIndex: 33,
  },

  // ---------- Общественные науки ----------
  {
    slug: 'history',
    title: 'История',
    description: 'Древний мир, средние века, Россия, новейшая история',
    icon: 'clock',
    color: '#7C4DFF',
    grades: [5, 6, 7, 8, 9, 10, 11],
    orderIndex: 40,
  },
  {
    slug: 'social-studies',
    title: 'Обществознание',
    description: 'Право, экономика, политика, социология',
    icon: 'users',
    color: '#7C4DFF',
    grades: [9, 10, 11],
    orderIndex: 41,
  },

  // ---------- Окружающий мир и ОРКСЭ ----------
  {
    slug: 'world-around',
    title: 'Окружающий мир',
    description: 'Природа, общество, безопасность (начальная школа)',
    icon: 'sun',
    color: '#66B132',
    grades: [1, 2, 3, 4],
    orderIndex: 50,
  },
  {
    slug: 'orkse',
    title: 'Основы религиозных культур и светской этики',
    description: 'ОРКСЭ — только 4 класс',
    icon: 'book-open',
    color: '#D98B00',
    grades: [4],
    orderIndex: 51,
  },
  {
    slug: 'spiritual-culture',
    title: 'Духовно-нравственная культура России',
    description: 'Новый предмет, вводится с 2026 года',
    icon: 'heart',
    color: '#E23B3B',
    grades: [5, 6, 7],
    orderIndex: 52,
  },

  // ---------- Искусство, труд, физкультура ----------
  {
    slug: 'music',
    title: 'Музыка',
    description: 'Музыкальная грамота, слушание, вокал',
    icon: 'music',
    color: '#7C4DFF',
    grades: [1, 2, 3, 4, 5, 6, 7],
    orderIndex: 60,
  },
  {
    slug: 'art',
    title: 'Изобразительное искусство',
    description: 'ИЗО: рисование, композиция, история искусства',
    icon: 'image',
    color: '#FF5C8A',
    grades: [1, 2, 3, 4, 5, 6, 7],
    orderIndex: 61,
  },
  {
    slug: 'technology',
    title: 'Труд (технология)',
    description: 'Ручной труд, конструирование, проекты',
    icon: 'tool',
    color: '#D98B00',
    grades: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    orderIndex: 62,
  },
  {
    slug: 'physical-culture',
    title: 'Физическая культура',
    description: 'Физкультура: гимнастика, спорт, ОФП',
    icon: 'activity',
    color: '#34C759',
    grades: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    orderIndex: 63,
  },

  // ---------- ИКТ и ОБЗР ----------
  {
    slug: 'informatics',
    title: 'Информатика',
    description: 'Алгоритмы, программирование, ИКТ',
    icon: 'cpu',
    color: '#247EE5',
    grades: [8, 9, 10, 11],
    orderIndex: 70,
  },
  {
    slug: 'obzr',
    title: 'Основы безопасности и защиты Родины',
    description: 'ОБЗР (ранее ОБЖ)',
    icon: 'shield',
    color: '#E23B3B',
    grades: [8, 9, 10, 11],
    orderIndex: 71,
  },
];

async function seed(): Promise<void> {
  const sqlClient = postgres(config.DATABASE_URL, { max: 1 });
  const db = drizzle(sqlClient, { schema });

  logger.info('📚 Seeding subjects for grades 1–11');

  try {
    let created = 0;
    let updated = 0;

    for (const s of SUBJECTS) {
      const [existing] = await db
        .select({ id: subjects.id })
        .from(subjects)
        .where(eq(subjects.slug, s.slug))
        .limit(1);

      if (existing) {
        await db
          .update(subjects)
          .set({
            title: s.title,
            description: s.description,
            icon: s.icon,
            color: s.color,
            grades: s.grades,
            gradeMin: s.grades.length > 0 ? Math.min(...s.grades) : null,
            gradeMax: s.grades.length > 0 ? Math.max(...s.grades) : null,
            orderIndex: s.orderIndex,
            updatedAt: new Date(),
          })
          .where(eq(subjects.id, existing.id));
        updated += 1;
      } else {
        await db.insert(subjects).values({
          slug: s.slug,
          title: s.title,
          description: s.description,
          icon: s.icon,
          color: s.color,
          grades: s.grades,
          gradeMin: s.grades.length > 0 ? Math.min(...s.grades) : null,
          gradeMax: s.grades.length > 0 ? Math.max(...s.grades) : null,
          orderIndex: s.orderIndex,
          isActive: true,
        });
        created += 1;
      }
    }

    logger.info({ created, updated, total: SUBJECTS.length }, '✅ Subjects seeded');
  } catch (err) {
    logger.error({ err }, 'seed subjects failed');
    process.exit(1);
  } finally {
    await sqlClient.end();
  }
}

void seed();