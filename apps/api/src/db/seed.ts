// ============================================================
// seed.ts — наполнение БД
// ============================================================

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { hashPassword } from '../lib/password.js';
import { encryptPII, hashPII } from '../lib/crypto.js';
import * as schema from './schema.js';

const {
  users,
  parents,
  children,
  permissions,
  plans,
  subjects,
  tests,
  questions,
  testQuestions,
  fraudRules,
  mailTemplates,
  childBalances,
  partners,
  partnerOffers,
  promoCodeBatches,
  promoCodes,
  questionTypeSettings,
  achievements,
  charitySettings,
} = schema;

const DEFAULT_PERMISSIONS: Array<{
  role: schema.User['role'];
  resource: string;
  action: string;
}> = [
  { role: 'parent', resource: 'profile', action: 'read' },
  { role: 'parent', resource: 'profile', action: 'write' },
  { role: 'parent', resource: 'children', action: 'read' },
  { role: 'parent', resource: 'children', action: 'write' },
  { role: 'parent', resource: 'subscription', action: 'read' },
  { role: 'parent', resource: 'subscription', action: 'cancel' },
  { role: 'parent', resource: 'payments', action: 'read' },
  { role: 'parent', resource: 'catalog', action: 'read' },
  { role: 'parent', resource: 'catalog', action: 'redeem' },
  { role: 'parent', resource: 'charity', action: 'donate' },

  { role: 'partner', resource: 'partner_portal', action: 'read' },
  { role: 'partner', resource: 'partner_offers', action: 'read' },
  { role: 'partner', resource: 'partner_redemptions', action: 'read' },
  { role: 'partner', resource: 'partner_redemptions', action: 'mark_redeemed' },

  { role: 'manager', resource: 'users', action: 'read' },
  { role: 'manager', resource: 'subjects', action: 'read' },
  { role: 'manager', resource: 'subjects', action: 'write' },
  { role: 'manager', resource: 'tests', action: 'read' },
  { role: 'manager', resource: 'tests', action: 'write' },
  { role: 'manager', resource: 'tests', action: 'publish' },
  { role: 'manager', resource: 'partners', action: 'read' },
  { role: 'manager', resource: 'partners', action: 'write' },
  { role: 'manager', resource: 'mailings', action: 'read' },
  { role: 'manager', resource: 'mailings', action: 'write' },
  { role: 'manager', resource: 'finance', action: 'read' },

  { role: 'curator', resource: 'users', action: 'read' },
  { role: 'curator', resource: 'attempts', action: 'read' },
  { role: 'curator', resource: 'attempts', action: 'review' },
  { role: 'curator', resource: 'spot_checks', action: 'read' },
  { role: 'curator', resource: 'spot_checks', action: 'write' },
  { role: 'curator', resource: 'spot_checks', action: 'verdict' },
  { role: 'curator', resource: 'points', action: 'adjust' },

  { role: 'admin', resource: 'users', action: 'read' },
  { role: 'admin', resource: 'users', action: 'write' },
  { role: 'admin', resource: 'users', action: 'block' },
  { role: 'admin', resource: 'subjects', action: 'read' },
  { role: 'admin', resource: 'subjects', action: 'write' },
  { role: 'admin', resource: 'tests', action: 'read' },
  { role: 'admin', resource: 'tests', action: 'write' },
  { role: 'admin', resource: 'tests', action: 'publish' },
  { role: 'admin', resource: 'tests', action: 'delete' },
  { role: 'admin', resource: 'points', action: 'adjust' },
  { role: 'admin', resource: 'partners', action: 'read' },
  { role: 'admin', resource: 'partners', action: 'write' },
  { role: 'admin', resource: 'mailings', action: 'read' },
  { role: 'admin', resource: 'mailings', action: 'write' },
  { role: 'admin', resource: 'finance', action: 'read' },
  { role: 'admin', resource: 'finance', action: 'export' },
  { role: 'admin', resource: 'audit', action: 'read' },
  { role: 'admin', resource: 'fraud', action: 'read' },
  { role: 'admin', resource: 'fraud', action: 'write' },
  { role: 'admin', resource: 'achievements', action: 'read' },
  { role: 'admin', resource: 'achievements', action: 'write' },
  { role: 'admin', resource: 'charity', action: 'read' },
  { role: 'admin', resource: 'charity', action: 'write' },

  { role: 'superadmin', resource: '*', action: '*' },
];

const DEFAULT_FRAUD_RULES: Array<{
  code: string;
  name: string;
  description: string;
  signalType: schema.AttemptEvent['type'];
  weight: number;
  threshold: number | null;
}> = [
  { code: 'fast_answer', name: 'Слишком быстрый ответ', description: 'Ответ введён быстрее порога', signalType: 'fast_answer', weight: 20, threshold: 5 },
  { code: 'uniform_timing', name: 'Одинаковое время ответов', description: 'Все ответы за одинаковое время', signalType: 'uniform_timing', weight: 15, threshold: 3 },
  { code: 'focus_lost', name: 'Потеря фокуса окна', description: 'Пользователь ушёл со вкладки', signalType: 'focus_lost', weight: 10, threshold: 3 },
  { code: 'copy_paste', name: 'Копирование / вставка', description: 'Обнаружено copy/paste на странице теста', signalType: 'copy_paste', weight: 25, threshold: 1 },
  { code: 'paste_answer', name: 'Ответ вставлен', description: 'Ответ введён одним событием вставки', signalType: 'paste_answer', weight: 30, threshold: 1 },
  { code: 'no_mouse_activity', name: 'Нет активности мыши', description: 'Ответ введён без движения мыши', signalType: 'no_mouse_activity', weight: 10, threshold: 2 },
  { code: 'devtools_open', name: 'Открыты инструменты разработчика', description: 'Эвристика по размеру окна', signalType: 'devtools_open', weight: 35, threshold: 1 },
  { code: 'ip_change', name: 'Смена IP во время теста', description: 'IP-адрес изменился в процессе прохождения', signalType: 'ip_change', weight: 20, threshold: 1 },
  { code: 'parallel_session', name: 'Параллельная сессия', description: 'Тот же ребёнок в двух местах', signalType: 'parallel_session', weight: 40, threshold: 1 },
];

const DEFAULT_QUESTION_TYPES: Array<{
  type: 'input_number' | 'input_text' | 'single_choice' | 'multi_choice' | 'matching' | 'ordering' | 'formula';
  title: string;
  description: string;
  icon: string;
  defaultPoints: number;
  minOptions: number | null;
  maxOptions: number | null;
  requiresImage: boolean;
  sortOrder: number;
  allowedRoles: string[];
}> = [
  { type: 'input_number', title: 'Число', description: 'Ребёнок вводит число. Допускается погрешность при необходимости.', icon: 'hash', defaultPoints: 2, minOptions: null, maxOptions: null, requiresImage: false, sortOrder: 1, allowedRoles: ['manager', 'curator', 'admin', 'superadmin'] },
  { type: 'input_text', title: 'Текст', description: 'Ввод текстового ответа. Несколько правильных вариантов разделяются символом |.', icon: 'edit-2', defaultPoints: 2, minOptions: null, maxOptions: null, requiresImage: false, sortOrder: 2, allowedRoles: ['manager', 'curator', 'admin', 'superadmin'] },
  { type: 'single_choice', title: 'Один вариант', description: 'Один правильный ответ из нескольких вариантов.', icon: 'check-circle', defaultPoints: 2, minOptions: 2, maxOptions: 10, requiresImage: false, sortOrder: 3, allowedRoles: ['manager', 'curator', 'admin', 'superadmin'] },
  { type: 'multi_choice', title: 'Несколько вариантов', description: 'Несколько правильных ответов. Возможен частичный зачёт.', icon: 'check-square', defaultPoints: 2, minOptions: 2, maxOptions: 10, requiresImage: false, sortOrder: 4, allowedRoles: ['manager', 'curator', 'admin', 'superadmin'] },
  { type: 'matching', title: 'Сопоставление', description: 'Соотнесение элементов из левой колонки с правой.', icon: 'link', defaultPoints: 3, minOptions: 2, maxOptions: 8, requiresImage: false, sortOrder: 5, allowedRoles: ['manager', 'curator', 'admin', 'superadmin'] },
  { type: 'ordering', title: 'Порядок', description: 'Расстановка элементов в правильном порядке.', icon: 'list', defaultPoints: 3, minOptions: 2, maxOptions: 10, requiresImage: false, sortOrder: 6, allowedRoles: ['manager', 'curator', 'admin', 'superadmin'] },
  { type: 'formula', title: 'Формула', description: 'Ввод математического выражения. Проверяется через безопасный парсер.', icon: 'zap', defaultPoints: 3, minOptions: null, maxOptions: null, requiresImage: false, sortOrder: 7, allowedRoles: ['curator', 'admin', 'superadmin'] },
];

const DEFAULT_ACHIEVEMENTS: Array<{
  code: string;
  kind: 'milestone' | 'social' | 'activity';
  title: string;
  description: string;
  icon: string;
  rewardPoints: number;
  condition: Record<string, unknown>;
  sortOrder: number;
}> = [
  { code: 'first_test', kind: 'milestone', title: 'Первый шаг', description: 'Пройден первый тест', icon: '🎯', rewardPoints: 20, condition: { type: 'attempts_count', value: 1 }, sortOrder: 1 },
  { code: 'ten_tests', kind: 'milestone', title: 'Десятка', description: 'Пройдено 10 тестов', icon: '🔟', rewardPoints: 100, condition: { type: 'attempts_count', value: 10 }, sortOrder: 2 },
  { code: 'fifty_tests', kind: 'milestone', title: 'Пятьдесят', description: 'Пройдено 50 тестов', icon: '🏅', rewardPoints: 500, condition: { type: 'attempts_count', value: 50 }, sortOrder: 3 },
  { code: 'hundred_correct', kind: 'milestone', title: 'Сотня', description: '100 правильных ответов', icon: '💯', rewardPoints: 200, condition: { type: 'correct_count', value: 100 }, sortOrder: 4 },
  { code: 'five_hundred_correct', kind: 'milestone', title: 'Пятьсот', description: '500 правильных ответов', icon: '🏆', rewardPoints: 1000, condition: { type: 'correct_count', value: 500 }, sortOrder: 5 },
  { code: 'perfect_test', kind: 'milestone', title: 'Идеально', description: 'Тест на 100%', icon: '⭐', rewardPoints: 150, condition: { type: 'perfect_score', value: 1 }, sortOrder: 6 },
  { code: 'social_vk', kind: 'social', title: 'Мы в ВК', description: 'Подписка на страницу во ВКонтакте', icon: 'vk', rewardPoints: 999, condition: { platform: 'vk' }, sortOrder: 10 },
  { code: 'social_telegram', kind: 'social', title: 'Мы в Telegram', description: 'Подписка на канал в Telegram', icon: 'send', rewardPoints: 499, condition: { platform: 'telegram' }, sortOrder: 11 },
  { code: 'social_youtube', kind: 'social', title: 'Наш YouTube', description: 'Подписка на YouTube-канал', icon: 'youtube', rewardPoints: 499, condition: { platform: 'youtube' }, sortOrder: 12 },
];

const DEMO_PASSWORD = 'Demo12345!';

async function seed(): Promise<void> {
  const sqlClient = postgres(config.DATABASE_URL, { max: 1 });
  const db = drizzle(sqlClient, { schema });

  logger.info('🌱 Seeding database');

  try {
    logger.info('→ permissions');
    for (const p of DEFAULT_PERMISSIONS) {
      await db.insert(permissions).values(p).onConflictDoNothing();
    }

    logger.info('→ plans');
    await db
      .insert(plans)
      .values([
        { code: 'monthly', name: 'Месяц', priceRub: 190, periodDays: 30, isActive: true, isDefault: false },
        { code: 'quarterly', name: '3 месяца', priceRub: 490, periodDays: 90, isActive: true, isDefault: false },
        { code: 'yearly', name: 'Год', priceRub: 1690, periodDays: 365, isActive: true, isDefault: true },
      ])
      .onConflictDoNothing();

    await db
      .update(plans)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(plans.isDefault, true));

    await db
      .update(plans)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(plans.code, 'yearly'));

    logger.info('→ charity settings');
    await db
      .insert(charitySettings)
      .values({
        id: 1,
        sharePercent: 80,
        cashbackPercent: 10,
        title: '80% выручки с подписок — на благотворительность',
        description: 'Мы перечисляем 80% от каждой оплаты подписки в благотворительный фонд «Улыбка детям».',
        fundName: 'Фонд «Улыбка детям»',
        fundUrl: 'https://example.com/fund',
      })
      .onConflictDoNothing();

    logger.info('→ fraud rules');
    for (const r of DEFAULT_FRAUD_RULES) {
      await db.insert(fraudRules).values(r).onConflictDoNothing();
    }

    logger.info('→ question type settings');
    for (const qt of DEFAULT_QUESTION_TYPES) {
      await db
        .insert(questionTypeSettings)
        .values({
          type: qt.type,
          title: qt.title,
          description: qt.description,
          icon: qt.icon,
          isEnabled: true,
          defaultPoints: qt.defaultPoints,
          minOptions: qt.minOptions,
          maxOptions: qt.maxOptions,
          requiresImage: qt.requiresImage,
          sortOrder: qt.sortOrder,
          allowedRoles: qt.allowedRoles,
        })
        .onConflictDoNothing();
    }

    logger.info('→ achievements');
    for (const a of DEFAULT_ACHIEVEMENTS) {
      await db
        .insert(achievements)
        .values({
          code: a.code,
          kind: a.kind,
          title: a.title,
          description: a.description,
          icon: a.icon,
          rewardPoints: a.rewardPoints,
          condition: a.condition,
          sortOrder: a.sortOrder,
          isActive: true,
        })
        .onConflictDoNothing();
    }

    logger.info('→ mail templates');
    await db
      .insert(mailTemplates)
      .values([
        { code: 'welcome', name: 'Приветствие', subject: 'Добро пожаловать в «Улыбку ребёнка»', bodyHtml: '<h1>Здравствуйте, {{parentName}}!</h1><p>Вы зарегистрировались на платформе.</p>', bodyText: 'Здравствуйте, {{parentName}}!', variables: ['parentName', 'planName', 'price'] },
        { code: 'subscription_reminder', name: 'Напоминание о списании', subject: 'Напоминание: списание через 3 дня', bodyHtml: '<p>Здравствуйте, {{parentName}}!</p><p>{{date}} произойдёт списание {{price}} ₽.</p>', bodyText: 'Здравствуйте! {{date}} произойдёт списание {{price}} ₽.', variables: ['parentName', 'date', 'price'] },
        { code: 'password_reset', name: 'Сброс пароля', subject: 'Сброс пароля', bodyHtml: '<p>Для сброса пароля перейдите: <a href="{{resetUrl}}">{{resetUrl}}</a></p>', bodyText: 'Сброс пароля: {{resetUrl}}', variables: ['resetUrl'] },
      ])
      .onConflictDoNothing();

    logger.info('→ subjects');
    const subjectsData = [
      { slug: 'math', title: 'Математика', description: 'Арифметика, алгебра, геометрия', icon: 'hash', color: '#66B132', orderIndex: 1 },
      { slug: 'russian', title: 'Русский язык', description: 'Орфография, пунктуация, лексика', icon: 'book-open', color: '#FF5C8A', orderIndex: 2 },
      { slug: 'biology', title: 'Биология', description: 'Ботаника, зоология, анатомия', icon: 'leaf', color: '#34C759', orderIndex: 3 },
      { slug: 'physics', title: 'Физика', description: 'Механика, термодинамика, электричество', icon: 'zap', color: '#FF8A3D', orderIndex: 4 },
      { slug: 'history', title: 'История', description: 'Древний мир, Россия, Новое время', icon: 'clock', color: '#7C4DFF', orderIndex: 5 },
      { slug: 'english', title: 'Английский язык', description: 'Грамматика, лексика, чтение', icon: 'globe', color: '#00B8D4', orderIndex: 6 },
    ];

    const insertedSubjects = await db.insert(subjects).values(subjectsData).onConflictDoNothing().returning();
    const allSubjects = insertedSubjects.length > 0 ? insertedSubjects : await db.select().from(subjects);
    const subjectBySlug = Object.fromEntries(allSubjects.map((s) => [s.slug, s]));

    logger.info('→ demo users');
    const passwordHash = await hashPassword(DEMO_PASSWORD);

    const parentUser = await upsertUser(db, {
      role: 'parent',
      phone: '+79000000001',
      email: 'parent@demo.ulybka.ru',
      passwordHash,
    });

    const parentFio = 'Иванова Мария Петровна';
    await db
      .insert(parents)
      .values({
        userId: parentUser.id,
        fullNameEnc: encryptPII(parentFio),
        fullNameHash: hashPII(parentFio),
        city: 'Москва',
      })
      .onConflictDoNothing();

    const childFio = 'Иванов Пётр Сергеевич';
    const birthDate = '2014-05-12';

    const existingChild = await db.select().from(children).where(eq(children.parentId, parentUser.id)).limit(1);

    let childId: string;
    if (existingChild.length === 0) {
      const [c] = await db
        .insert(children)
        .values({
          parentId: parentUser.id,
          fullNameEnc: encryptPII(childFio),
          fullNameHash: hashPII(childFio),
          birthDateEnc: encryptPII(birthDate),
          birthYear: 2014,
          city: 'Москва',
          school: 'ГБОУ Школа №1234',
          grade: 4,
        })
        .returning();
      childId = c!.id;
      await db.insert(childBalances).values({ childId, balance: 500, lifetimeEarned: 500, lifetimeSpent: 0 }).onConflictDoNothing();
    } else {
      childId = existingChild[0]!.id;
      await db.insert(childBalances).values({ childId, balance: 500, lifetimeEarned: 500, lifetimeSpent: 0 }).onConflictDoNothing();
    }

    await upsertUser(db, { role: 'curator', phone: '+79000000002', email: 'curator@demo.ulybka.ru', passwordHash });
    await upsertUser(db, { role: 'admin', phone: '+79000000003', email: 'admin@demo.ulybka.ru', passwordHash });
    await upsertUser(db, { role: 'superadmin', phone: '+79000000004', email: 'root@demo.ulybka.ru', passwordHash });

    logger.info('→ demo partners');

    const [partner] = await db
      .insert(partners)
      .values({
        slug: 'knizhny-mir',
        name: 'Книжный мир',
        description: 'Сеть книжных магазинов для детей и подростков',
        websiteUrl: 'https://example.com',
        contactName: 'Отдел маркетинга',
        contactEmail: 'partners@example.com',
        contactPhone: '+74950000000',
        status: 'active',
      })
      .onConflictDoNothing()
      .returning();

    let partnerId: string | null = null;
    if (partner) {
      partnerId = partner.id;

      const inserted = await db
        .insert(partnerOffers)
        .values([
          { partnerId: partner.id, title: 'Скидка 15% на любую книгу', description: 'Действует на весь ассортимент магазина', costPoints: 200, stock: 100, redemptionType: 'qr', status: 'published', terms: 'Одно использование на ребёнка', createdBy: null },
          { partnerId: partner.id, title: 'Подарочная закладка', description: 'Яркая закладка с любимым героем', costPoints: 50, stock: 500, redemptionType: 'promo', status: 'published', terms: 'Покажите промокод на кассе', createdBy: null },
          { partnerId: partner.id, title: 'Бесплатный мастер-класс', description: 'Творческое занятие в книжном магазине', costPoints: 800, stock: 20, redemptionType: 'qr', status: 'published', terms: 'По предварительной записи', createdBy: null },
        ])
        .onConflictDoNothing()
        .returning();

      const bookmarkOffer = inserted.find((o) => o.title === 'Подарочная закладка');
      if (bookmarkOffer) {
        const [batch] = await db
          .insert(promoCodeBatches)
          .values({
            partnerId: partner.id,
            offerId: bookmarkOffer.id,
            name: 'Закладки — партия 1',
            codePrefix: 'ZKL',
            totalCodes: 50,
            usedCodes: 0,
          })
          .onConflictDoNothing()
          .returning();

        if (batch) {
          const codes: Array<{ batchId: string; code: string }> = [];
          const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
          for (let i = 0; i < 50; i++) {
            let chunk = '';
            for (let j = 0; j < 8; j++) {
              chunk += alphabet[Math.floor(Math.random() * alphabet.length)];
            }
            codes.push({ batchId: batch.id, code: `ZKL-${chunk}` });
          }
          await db.insert(promoCodes).values(codes).onConflictDoNothing();
        }
      }
    }

    logger.info('→ demo tests');
    const existingTest = await db.select().from(tests).where(eq(tests.title, 'Арифметика: сложение и вычитание')).limit(1);

    if (existingTest.length === 0 && subjectBySlug.math) {
      const [t] = await db
        .insert(tests)
        .values({
          subjectId: subjectBySlug.math.id,
          title: 'Арифметика: сложение и вычитание',
          description: 'Базовые примеры для 3–4 класса',
          status: 'published',
          timeLimitSec: 300,
          gradeMin: 3,
          gradeMax: 4,
          pointsFixed: 10,
          pointsPerCorrect: 2,
          publishedAt: new Date(),
        })
        .returning();

      const demoQuestions = [
        { type: 'input_number' as const, text: 'Сколько будет 25 + 17?', payload: { correct: 42 }, explanation: '25 + 17 = 42' },
        { type: 'input_number' as const, text: 'Сколько будет 80 − 34?', payload: { correct: 46 }, explanation: '80 − 34 = 46' },
        { type: 'single_choice' as const, text: 'Какое число чётное?', payload: { options: [{ id: 'a', text: '17' }, { id: 'b', text: '24' }, { id: 'c', text: '31' }, { id: 'd', text: '45' }], correct: 'b' }, explanation: '24 делится на 2 без остатка' },
        { type: 'multi_choice' as const, text: 'Выберите все простые числа', payload: { options: [{ id: 'a', text: '2' }, { id: 'b', text: '3' }, { id: 'c', text: '4' }, { id: 'd', text: '5' }], correct: ['a', 'b', 'd'] }, explanation: '2, 3, 5 — простые. 4 = 2×2.' },
        { type: 'input_number' as const, text: 'Сколько будет 7 × 8?', payload: { correct: 56 }, explanation: '7 × 8 = 56' },
      ];

      for (let i = 0; i < demoQuestions.length; i++) {
        const q = demoQuestions[i]!;
        const [insertedQ] = await db
          .insert(questions)
          .values({
            subjectId: subjectBySlug.math.id,
            type: q.type,
            text: q.text,
            payload: q.payload,
            explanation: q.explanation,
            difficulty: 2,
          })
          .returning();

        await db.insert(testQuestions).values({ testId: t!.id, questionId: insertedQ!.id, orderIndex: i });
      }
    }

    logger.info('✅ Seed завершён');
    logger.info('');
    logger.info('Демо-аккаунты (пароль Demo12345!):');
    logger.info('  Родитель:    +79000000001');
    logger.info('  Куратор:     +79000000002');
    logger.info('  Админ:       +79000000003');
    logger.info('  Супер-админ: +79000000004');
    logger.info('');
    logger.info(`  Ребёнок родителя: id=${childId}, баланс=500`);
    if (partnerId) {
      logger.info(`  Демо-партнёр: «Книжный мир» (id=${partnerId})`);
    }
  } catch (err) {
    logger.error({ err }, 'seed failed');
    process.exit(1);
  } finally {
    await sqlClient.end();
  }
}

async function upsertUser(
  db: ReturnType<typeof drizzle>,
  data: {
    role: schema.User['role'];
    phone: string;
    email: string;
    passwordHash: string;
  }
): Promise<schema.User> {
  const existing = await db.select().from(users).where(eq(users.phone, data.phone)).limit(1);
  if (existing.length > 0) return existing[0]!;

  const [u] = await db
    .insert(users)
    .values({
      ...data,
      status: 'active',
      consentVersion: '1.0',
      consentAt: new Date(),
    })
    .returning();

  return u!;
}

void seed;
void sql;

seed();