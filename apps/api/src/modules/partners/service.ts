// ============================================================
// schema.ts — полная схема БД
// Добавлена таблица child_notifications.
// ============================================================

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  smallint,
  numeric,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  foreignKey,
  date,
  inet,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ============================================================
// ENUM
// ============================================================

export const userRoleEnum = pgEnum('user_role', [
  'parent',
  'partner',
  'manager',
  'curator',
  'admin',
  'superadmin',
]);

export const userStatusEnum = pgEnum('user_status', ['pending', 'active', 'blocked', 'deleted']);
export const testStatusEnum = pgEnum('test_status', ['draft', 'review', 'published', 'archived']);
export const questionTypeEnum = pgEnum('question_type', [
  'input_number',
  'input_text',
  'single_choice',
  'multi_choice',
  'matching',
  'ordering',
  'formula',
]);
export const attemptStatusEnum = pgEnum('attempt_status', [
  'in_progress',
  'finished',
  'abandoned',
  'flagged',
  'blocked',
]);
export const pointsReasonEnum = pgEnum('points_reason', [
  'attempt_reward',
  'manual_adjust',
  'redemption',
  'referral_bonus',
  'spot_check_confirmed',
  'fraud_reversal',
  'signup_bonus',
  'achievement_reward',
  'social_reward',
  'donation_cashback',
]);
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'pending',
  'active',
  'past_due',
  'canceled',
  'expired',
]);
export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'succeeded',
  'failed',
  'refunded',
]);
export const paymentProviderEnum = pgEnum('payment_provider', [
  'stub',
  'yookassa',
  'cloudpayments',
  'tinkoff',
]);
export const redemptionTypeEnum = pgEnum('redemption_type', ['qr', 'promo', 'referral', 'manual']);
export const redemptionStatusEnum = pgEnum('redemption_status', [
  'issued',
  'redeemed',
  'expired',
  'canceled',
]);
export const partnerStatusEnum = pgEnum('partner_status', ['pending', 'active', 'suspended']);
export const offerStatusEnum = pgEnum('offer_status', ['draft', 'review', 'published', 'archived']);
export const spotCheckStatusEnum = pgEnum('spot_check_status', [
  'scheduled',
  'in_progress',
  'completed',
  'canceled',
]);
export const spotCheckVerdictEnum = pgEnum('spot_check_verdict', [
  'pending',
  'confirmed',
  'rejected',
  'partial',
]);
export const fraudSignalEnum = pgEnum('fraud_signal', [
  'focus_lost',
  'copy_paste',
  'devtools_open',
  'fast_answer',
  'uniform_timing',
  'no_mouse_activity',
  'paste_answer',
  'ip_change',
  'parallel_session',
  'ua_change',
  'suspicious_ua',
]);
export const mailingStatusEnum = pgEnum('mailing_status', [
  'draft',
  'scheduled',
  'sending',
  'sent',
  'failed',
  'canceled',
]);

export const childRankEnum = pgEnum('child_rank', [
  'novice',
  'bronze',
  'silver',
  'gold',
  'platinum',
  'legend',
]);

export const achievementKindEnum = pgEnum('achievement_kind', [
  'milestone',
  'social',
  'activity',
]);

export const donationStatusEnum = pgEnum('donation_status', [
  'pending',
  'succeeded',
  'failed',
  'refunded',
]);

// ============================================================
// PARTNERS
// ============================================================

export const partners = pgTable(
  'partners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: varchar('slug', { length: 64 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    logoUrl: text('logo_url'),
    websiteUrl: text('website_url'),
    contactName: varchar('contact_name', { length: 255 }),
    contactEmail: varchar('contact_email', { length: 255 }),
    contactPhone: varchar('contact_phone', { length: 32 }),
    apiKeyHash: varchar('api_key_hash', { length: 128 }),
    status: partnerStatusEnum('status').notNull().default('pending'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugUq: uniqueIndex('partners_slug_uq').on(t.slug),
    statusIdx: index('partners_status_idx').on(t.status),
  })
);

// ============================================================
// USERS / PARENTS / CHILDREN
// ============================================================

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    role: userRoleEnum('role').notNull(),
    status: userStatusEnum('status').notNull().default('active'),
    phone: varchar('phone', { length: 16 }).notNull(),
    email: varchar('email', { length: 255 }),
    passwordHash: text('password_hash').notNull(),
    partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'set null' }),
    fraudDisabled: boolean('fraud_disabled').notNull().default(false),
    totpSecret: text('totp_secret'),
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    totpRecoveryCodes: jsonb('totp_recovery_codes').$type<string[]>(),
    consentVersion: varchar('consent_version', { length: 32 }),
    consentAt: timestamp('consent_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    lastLoginIp: inet('last_login_ip'),
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    phoneUq: uniqueIndex('users_phone_uq').on(t.phone),
    emailUq: uniqueIndex('users_email_uq').on(t.email).where(sql`${t.email} IS NOT NULL`),
    roleIdx: index('users_role_idx').on(t.role),
    statusIdx: index('users_status_idx').on(t.status),
    partnerIdx: index('users_partner_idx').on(t.partnerId),
  })
);

export const parents = pgTable(
  'parents',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    fullNameEnc: text('full_name_enc').notNull(),
    fullNameHash: varchar('full_name_hash', { length: 64 }).notNull(),
    city: varchar('city', { length: 128 }),
    defaultPaymentMethodId: varchar('default_payment_method_id', { length: 128 }),
  },
  (t) => ({
    nameHashIdx: index('parents_name_hash_idx').on(t.fullNameHash),
  })
);

export const children = pgTable(
  'children',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentId: uuid('parent_id')
      .notNull()
      .references(() => parents.userId, { onDelete: 'cascade' }),
    fullNameEnc: text('full_name_enc').notNull(),
    fullNameHash: varchar('full_name_hash', { length: 64 }).notNull(),
    birthDateEnc: text('birth_date_enc').notNull(),
    birthYear: smallint('birth_year').notNull(),
    city: varchar('city', { length: 128 }),
    school: varchar('school', { length: 255 }),
    grade: smallint('grade'),
    avatarUrl: text('avatar_url'),
    rank: childRankEnum('rank').notNull().default('novice'),
    rankUpdatedAt: timestamp('rank_updated_at', { withTimezone: true }),
    socialLinks: jsonb('social_links').$type<Record<string, string>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    parentIdx: index('children_parent_idx').on(t.parentId),
    nameHashIdx: index('children_name_hash_idx').on(t.fullNameHash),
    birthYearIdx: index('children_birth_year_idx').on(t.birthYear),
    rankIdx: index('children_rank_idx').on(t.rank),
  })
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshJti: varchar('refresh_jti', { length: 64 }).notNull(),
    refreshHash: varchar('refresh_hash', { length: 128 }).notNull(),
    userAgent: text('user_agent'),
    ip: inet('ip'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: varchar('revoked_reason', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('sessions_user_idx').on(t.userId),
    jtiUq: uniqueIndex('sessions_jti_uq').on(t.refreshJti),
    activeIdx: index('sessions_active_idx')
      .on(t.userId, t.expiresAt)
      .where(sql`${t.revokedAt} IS NULL`),
  })
);

export const passwordResets = pgTable(
  'password_resets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 128 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    ip: inet('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenUq: uniqueIndex('password_resets_token_uq').on(t.tokenHash),
    userIdx: index('password_resets_user_idx').on(t.userId),
  })
);

export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    role: userRoleEnum('role').notNull(),
    resource: varchar('resource', { length: 64 }).notNull(),
    action: varchar('action', { length: 32 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    roleResActUq: uniqueIndex('permissions_uq').on(t.role, t.resource, t.action),
    roleIdx: index('permissions_role_idx').on(t.role),
  })
);

export const subjects = pgTable(
  'subjects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: varchar('slug', { length: 64 }).notNull(),
    title: varchar('title', { length: 128 }).notNull(),
    description: text('description'),
    icon: varchar('icon', { length: 64 }),
    color: varchar('color', { length: 16 }),
    gradeMin: smallint('grade_min'),
    gradeMax: smallint('grade_max'),
    ageMin: smallint('age_min'),
    ageMax: smallint('age_max'),
    orderIndex: integer('order_index').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugUq: uniqueIndex('subjects_slug_uq').on(t.slug),
    activeIdx: index('subjects_active_idx').on(t.isActive),
  })
);

export const tests = pgTable(
  'tests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'restrict' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    status: testStatusEnum('status').notNull().default('draft'),
    version: integer('version').notNull().default(1),
    timeLimitSec: integer('time_limit_sec').notNull().default(600),
    gradeMin: smallint('grade_min'),
    gradeMax: smallint('grade_max'),
    ageMin: smallint('age_min'),
    ageMax: smallint('age_max'),
    pointsFixed: integer('points_fixed').notNull().default(10),
    pointsPerCorrect: integer('points_per_correct').notNull().default(2),
    pointsPenaltyWrong: integer('points_penalty_wrong').notNull().default(0),
    shuffleQuestions: boolean('shuffle_questions').notNull().default(false),
    shuffleOptions: boolean('shuffle_options').notNull().default(false),
    allowRetake: boolean('allow_retake').notNull().default(true),
    rewardOnRetake: boolean('reward_on_retake').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    subjectIdx: index('tests_subject_idx').on(t.subjectId),
    statusIdx: index('tests_status_idx').on(t.status),
    gradeIdx: index('tests_grade_idx').on(t.gradeMin, t.gradeMax),
  })
);

export const questions = pgTable(
  'questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'restrict' }),
    type: questionTypeEnum('type').notNull(),
    text: text('text').notNull(),
    imageUrl: text('image_url'),
    explanation: text('explanation'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    difficulty: smallint('difficulty').notNull().default(2),
    tags: jsonb('tags').$type<string[]>().default([]),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    subjectIdx: index('questions_subject_idx').on(t.subjectId),
    typeIdx: index('questions_type_idx').on(t.type),
    activeIdx: index('questions_active_idx').on(t.isActive),
  })
);

export const testQuestions = pgTable(
  'test_questions',
  {
    testId: uuid('test_id')
      .notNull()
      .references(() => tests.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'restrict' }),
    orderIndex: integer('order_index').notNull(),
    pointsOverride: integer('points_override'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.testId, t.questionId] }),
    orderIdx: index('test_questions_order_idx').on(t.testId, t.orderIndex),
  })
);

export const questionTypeSettings = pgTable(
  'question_type_settings',
  {
    type: questionTypeEnum('type').primaryKey(),
    title: varchar('title', { length: 128 }).notNull(),
    description: text('description'),
    icon: varchar('icon', { length: 64 }),
    isEnabled: boolean('is_enabled').notNull().default(true),
    defaultPoints: integer('default_points').notNull().default(2),
    minOptions: smallint('min_options'),
    maxOptions: smallint('max_options'),
    requiresImage: boolean('requires_image').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    allowedRoles: jsonb('allowed_roles').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    enabledIdx: index('question_type_settings_enabled_idx').on(t.isEnabled),
    sortIdx: index('question_type_settings_sort_idx').on(t.sortOrder),
  })
);

export const attempts = pgTable(
  'attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    childId: uuid('child_id')
      .notNull()
      .references(() => children.id, { onDelete: 'cascade' }),
    testId: uuid('test_id')
      .notNull()
      .references(() => tests.id, { onDelete: 'restrict' }),
    testVersion: integer('test_version').notNull(),
    status: attemptStatusEnum('status').notNull().default('in_progress'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    timeSpentSec: integer('time_spent_sec'),
    totalCount: integer('total_count').notNull().default(0),
    correctCount: integer('correct_count').notNull().default(0),
    wrongCount: integer('wrong_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    scorePoints: integer('score_points').notNull().default(0),
    percentCorrect: numeric('percent_correct', { precision: 5, scale: 2 }),
    suspicionScore: integer('suspicion_score').notNull().default(0),
    fraudFlags: jsonb('fraud_flags').$type<string[]>().default([]),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    deviceFingerprint: varchar('device_fingerprint', { length: 64 }),
    connectionDrops: integer('connection_drops').notNull().default(0),
    pointsAwarded: boolean('points_awarded').notNull().default(false),
    pointsAwardedAt: timestamp('points_awarded_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNotes: text('review_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    childIdx: index('attempts_child_idx').on(t.childId),
    testIdx: index('attempts_test_idx').on(t.testId),
    statusIdx: index('attempts_status_idx').on(t.status),
    suspicionIdx: index('attempts_suspicion_idx').on(t.suspicionScore),
    flaggedIdx: index('attempts_flagged_idx')
      .on(t.status, t.suspicionScore)
      .where(sql`${t.status} IN ('flagged','blocked')`),
    childTestIdx: index('attempts_child_test_idx').on(t.childId, t.testId),
    createdAtIdx: index('attempts_created_at_idx').on(t.createdAt),
    oneActivePerChildUq: uniqueIndex('attempts_one_active_per_child_uq')
      .on(t.childId)
      .where(sql`${t.status} = 'in_progress'`),
  })
);

export const attemptAnswers = pgTable(
  'attempt_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'restrict' }),
    orderIndex: integer('order_index').notNull(),
    userAnswer: jsonb('user_answer').$type<unknown>(),
    isCorrect: boolean('is_correct'),
    pointsEarned: integer('points_earned').notNull().default(0),
    timeSpentMs: integer('time_spent_ms').notNull().default(0),
    changesCount: integer('changes_count').notNull().default(0),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    attemptIdx: index('attempt_answers_attempt_idx').on(t.attemptId),
    questionIdx: index('attempt_answers_question_idx').on(t.questionId),
    attemptQuestionUq: uniqueIndex('attempt_answers_uq').on(t.attemptId, t.questionId),
  })
);

export const attemptEvents = pgTable(
  'attempt_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id').references(() => questions.id, { onDelete: 'set null' }),
    type: fraudSignalEnum('type').notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    ip: inet('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    attemptIdx: index('attempt_events_attempt_idx').on(t.attemptId),
    typeIdx: index('attempt_events_type_idx').on(t.type),
    createdAtIdx: index('attempt_events_created_idx').on(t.createdAt),
  })
);

export const pointsLedger = pgTable(
  'points_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    childId: uuid('child_id')
      .notNull()
      .references(() => children.id, { onDelete: 'cascade' }),
    delta: integer('delta').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    reason: pointsReasonEnum('reason').notNull(),
    attemptId: uuid('attempt_id').references(() => attempts.id, { onDelete: 'set null' }),
    redemptionId: uuid('redemption_id'),
    description: text('description'),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    childIdx: index('points_ledger_child_idx').on(t.childId),
    createdAtIdx: index('points_ledger_created_idx').on(t.createdAt),
    reasonIdx: index('points_ledger_reason_idx').on(t.reason),
    idemUq: uniqueIndex('points_ledger_idem_uq').on(t.idempotencyKey),
  })
);

export const childBalances = pgTable('child_balances', {
  childId: uuid('child_id')
    .primaryKey()
    .references(() => children.id, { onDelete: 'cascade' }),
  balance: integer('balance').notNull().default(0),
  lifetimeEarned: integer('lifetime_earned').notNull().default(0),
  lifetimeSpent: integer('lifetime_spent').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 32 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    priceRub: integer('price_rub').notNull(),
    periodDays: integer('period_days').notNull().default(30),
    isActive: boolean('is_active').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeUq: uniqueIndex('plans_code_uq').on(t.code),
  })
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentId: uuid('parent_id')
      .notNull()
      .references(() => parents.userId, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    status: subscriptionStatusEnum('status').notNull().default('pending'),
    provider: paymentProviderEnum('provider').notNull().default('stub'),
    providerSubscriptionId: varchar('provider_subscription_id', { length: 128 }),
    paymentMethodId: varchar('payment_method_id', { length: 128 }),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    autoRenew: boolean('auto_renew').notNull().default(true),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    cancelReason: varchar('cancel_reason', { length: 255 }),
    nextChargeAt: timestamp('next_charge_at', { withTimezone: true }),
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    parentIdx: index('subscriptions_parent_idx').on(t.parentId),
    statusIdx: index('subscriptions_status_idx').on(t.status),
    nextChargeIdx: index('subscriptions_next_charge_idx').on(t.nextChargeAt),
  })
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    parentId: uuid('parent_id')
      .notNull()
      .references(() => parents.userId, { onDelete: 'restrict' }),
    provider: paymentProviderEnum('provider').notNull(),
    providerPaymentId: varchar('provider_payment_id', { length: 128 }),
    amountRub: integer('amount_rub').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('RUB'),
    status: paymentStatusEnum('status').notNull().default('pending'),
    isRecurrent: boolean('is_recurrent').notNull().default(false),
    isTest: boolean('is_test').notNull().default(false),
    receiptUrl: text('receipt_url'),
    receiptSentAt: timestamp('receipt_sent_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>(),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    parentIdx: index('payments_parent_idx').on(t.parentId),
    subIdx: index('payments_sub_idx').on(t.subscriptionId),
    statusIdx: index('payments_status_idx').on(t.status),
    providerPaymentUq: uniqueIndex('payments_provider_payment_uq')
      .on(t.provider, t.providerPaymentId)
      .where(sql`${t.providerPaymentId} IS NOT NULL`),
    idemUq: uniqueIndex('payments_idem_uq').on(t.idempotencyKey),
  })
);

export const paymentWebhookEvents = pgTable(
  'payment_webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: paymentProviderEnum('provider').notNull(),
    externalId: varchar('external_id', { length: 128 }).notNull(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    signatureValid: boolean('signature_valid').notNull().default(false),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processingError: text('processing_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    externalUq: uniqueIndex('payment_webhook_uq').on(t.provider, t.externalId),
  })
);

export const partnerOffers = pgTable(
  'partner_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    imageUrl: text('image_url'),
    costPoints: integer('cost_points').notNull(),
    stock: integer('stock'),
    terms: text('terms'),
    redemptionType: redemptionTypeEnum('redemption_type').notNull().default('qr'),
    status: offerStatusEnum('status').notNull().default('draft'),
    validFrom: timestamp('valid_from', { withTimezone: true }),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    totalRedeemed: integer('total_redeemed').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    partnerIdx: index('partner_offers_partner_idx').on(t.partnerId),
    statusIdx: index('partner_offers_status_idx').on(t.status),
    costIdx: index('partner_offers_cost_idx').on(t.costPoints),
  })
);

export const redemptions = pgTable(
  'redemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    childId: uuid('child_id')
      .notNull()
      .references(() => children.id, { onDelete: 'restrict' }),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => partnerOffers.id, { onDelete: 'restrict' }),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'restrict' }),
    redemptionType: redemptionTypeEnum('redemption_type').notNull(),
    status: redemptionStatusEnum('status').notNull().default('issued'),
    code: varchar('code', { length: 64 }),
    qrToken: text('qr_token'),
    qrNonce: varchar('qr_nonce', { length: 64 }),
    pointsSpent: integer('points_spent').notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
    partnerAckAt: timestamp('partner_ack_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    cancelReason: varchar('cancel_reason', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    childIdx: index('redemptions_child_idx').on(t.childId),
    offerIdx: index('redemptions_offer_idx').on(t.offerId),
    partnerIdx: index('redemptions_partner_idx').on(t.partnerId),
    statusIdx: index('redemptions_status_idx').on(t.status),
    codeUq: uniqueIndex('redemptions_code_uq').on(t.code).where(sql`${t.code} IS NOT NULL`),
    nonceUq: uniqueIndex('redemptions_nonce_uq').on(t.qrNonce).where(sql`${t.qrNonce} IS NOT NULL`),
    idemUq: uniqueIndex('redemptions_idem_uq').on(t.idempotencyKey),
  })
);

export const referrals = pgTable(
  'referrals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    referrerChildId: uuid('referrer_child_id')
      .notNull()
      .references(() => children.id, { onDelete: 'cascade' }),
    referredUserId: uuid('referred_user_id').references(() => users.id, { onDelete: 'set null' }),
    partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'set null' }),
    code: varchar('code', { length: 32 }).notNull(),
    status: varchar('status', { length: 24 }).notNull().default('pending'),
    bonusPoints: integer('bonus_points').notNull().default(0),
    bonusAwarded: boolean('bonus_awarded').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
  },
  (t) => ({
    codeUq: uniqueIndex('referrals_code_uq').on(t.code),
    referrerIdx: index('referrals_referrer_idx').on(t.referrerChildId),
    referredIdx: index('referrals_referred_idx').on(t.referredUserId),
  })
);

export const promoCodeBatches = pgTable(
  'promo_code_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    offerId: uuid('offer_id').references(() => partnerOffers.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 128 }).notNull(),
    codePrefix: varchar('code_prefix', { length: 16 }),
    totalCodes: integer('total_codes').notNull(),
    usedCodes: integer('used_codes').notNull().default(0),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    partnerIdx: index('promo_batches_partner_idx').on(t.partnerId),
  })
);

export const promoCodes = pgTable(
  'promo_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => promoCodeBatches.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 64 }).notNull(),
    redeemedByChildId: uuid('redeemed_by_child_id').references(() => children.id, {
      onDelete: 'set null',
    }),
    redemptionId: uuid('redemption_id').references(() => redemptions.id, { onDelete: 'set null' }),
    usedAt: timestamp('used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeUq: uniqueIndex('promo_codes_code_uq').on(t.code),
    batchIdx: index('promo_codes_batch_idx').on(t.batchId),
  })
);

export const fraudRules = pgTable(
  'fraud_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 64 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    signalType: fraudSignalEnum('signal_type').notNull(),
    weight: integer('weight').notNull(),
    threshold: integer('threshold'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeUq: uniqueIndex('fraud_rules_code_uq').on(t.code),
  })
);

export const spotChecks = pgTable(
  'spot_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    childId: uuid('child_id')
      .notNull()
      .references(() => children.id, { onDelete: 'cascade' }),
    curatorId: uuid('curator_id').references(() => users.id, { onDelete: 'set null' }),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: spotCheckStatusEnum('status').notNull().default('scheduled'),
    verdict: spotCheckVerdictEnum('verdict').notNull().default('pending'),
    timeLimitSec: integer('time_limit_sec').notNull().default(1200),
    relatedAttemptIds: jsonb('related_attempt_ids').$type<string[]>().default([]),
    scorePoints: integer('score_points').notNull().default(0),
    correctCount: integer('correct_count').notNull().default(0),
    totalCount: integer('total_count').notNull().default(0),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    childIdx: index('spot_checks_child_idx').on(t.childId),
    curatorIdx: index('spot_checks_curator_idx').on(t.curatorId),
    statusIdx: index('spot_checks_status_idx').on(t.status),
    scheduledIdx: index('spot_checks_scheduled_idx').on(t.scheduledAt),
  })
);

export const spotCheckItems = pgTable(
  'spot_check_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spotCheckId: uuid('spot_check_id')
      .notNull()
      .references(() => spotChecks.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'restrict' }),
    orderIndex: integer('order_index').notNull(),
    originalAnswer: jsonb('original_answer').$type<unknown>(),
    spotAnswer: jsonb('spot_answer').$type<unknown>(),
    isCorrect: boolean('is_correct'),
    timeSpentMs: integer('time_spent_ms').notNull().default(0),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
  },
  (t) => ({
    checkIdx: index('spot_check_items_check_idx').on(t.spotCheckId),
  })
);

export const mailTemplates = pgTable(
  'mail_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 64 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    subject: varchar('subject', { length: 255 }).notNull(),
    bodyHtml: text('body_html').notNull(),
    bodyText: text('body_text'),
    variables: jsonb('variables').$type<string[]>().default([]),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeUq: uniqueIndex('mail_templates_code_uq').on(t.code),
  })
);

export const mailings = pgTable(
  'mailings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id').references(() => mailTemplates.id, { onDelete: 'set null' }),
    name: varchar('name', { length: 255 }).notNull(),
    channel: varchar('channel', { length: 16 }).notNull().default('email'),
    segment: jsonb('segment').$type<Record<string, unknown>>().notNull(),
    subject: varchar('subject', { length: 255 }),
    bodyHtml: text('body_html'),
    status: mailingStatusEnum('status').notNull().default('draft'),
    totalRecipients: integer('total_recipients').notNull().default(0),
    sentCount: integer('sent_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('mailings_status_idx').on(t.status),
    scheduledIdx: index('mailings_scheduled_idx').on(t.scheduledAt),
  })
);

export const mailingRecipients = pgTable(
  'mailing_recipients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mailingId: uuid('mailing_id')
      .notNull()
      .references(() => mailings.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    address: varchar('address', { length: 255 }).notNull(),
    status: varchar('status', { length: 24 }).notNull().default('pending'),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    mailingIdx: index('mailing_recipients_mailing_idx').on(t.mailingId),
    statusIdx: index('mailing_recipients_status_idx').on(t.status),
  })
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 48 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    body: text('body'),
    link: varchar('link', { length: 255 }),
    isRead: boolean('is_read').notNull().default(false),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('notifications_user_idx').on(t.userId),
    unreadIdx: index('notifications_unread_idx')
      .on(t.userId, t.isRead)
      .where(sql`${t.isRead} = false`),
  })
);

export const childNotifications = pgTable(
  'child_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    childId: uuid('child_id')
      .notNull()
      .references(() => children.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 48 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    body: text('body'),
    link: varchar('link', { length: 255 }),
    isRead: boolean('is_read').notNull().default(false),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    childIdx: index('child_notifications_child_idx').on(t.childId),
    unreadIdx: index('child_notifications_unread_idx')
      .on(t.childId, t.isRead)
      .where(sql`${t.isRead} = false`),
  })
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorRole: userRoleEnum('actor_role'),
    action: varchar('action', { length: 64 }).notNull(),
    entity: varchar('entity', { length: 64 }).notNull(),
    entityId: varchar('entity_id', { length: 64 }),
    beforeJson: jsonb('before_json').$type<Record<string, unknown>>(),
    afterJson: jsonb('after_json').$type<Record<string, unknown>>(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    requestId: varchar('request_id', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    actorIdx: index('audit_actor_idx').on(t.actorId),
    entityIdx: index('audit_entity_idx').on(t.entity, t.entityId),
    actionIdx: index('audit_action_idx').on(t.action),
    createdAtIdx: index('audit_created_idx').on(t.createdAt),
  })
);

// ============================================================
// ACHIEVEMENTS
// ============================================================

export const achievements = pgTable(
  'achievements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 64 }).notNull(),
    kind: achievementKindEnum('kind').notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    icon: varchar('icon', { length: 64 }),
    rewardPoints: integer('reward_points').notNull().default(0),
    condition: jsonb('condition').$type<Record<string, unknown>>().notNull().default({}),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeUq: uniqueIndex('achievements_code_uq').on(t.code),
    kindIdx: index('achievements_kind_idx').on(t.kind),
    activeIdx: index('achievements_active_idx').on(t.isActive),
  })
);

export const childAchievements = pgTable(
  'child_achievements',
  {
    childId: uuid('child_id')
      .notNull()
      .references(() => children.id, { onDelete: 'cascade' }),
    achievementId: uuid('achievement_id')
      .notNull()
      .references(() => achievements.id, { onDelete: 'cascade' }),
    awardedAt: timestamp('awarded_at', { withTimezone: true }).notNull().defaultNow(),
    rewardedAt: timestamp('rewarded_at', { withTimezone: true }),
    pointsAwarded: integer('points_awarded').notNull().default(0),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.childId, t.achievementId] }),
    childIdx: index('child_achievements_child_idx').on(t.childId),
    achIdx: index('child_achievements_ach_idx').on(t.achievementId),
  })
);

// ============================================================
// CHARITY / DONATIONS
// ============================================================

export const charitySettings = pgTable('charity_settings', {
  id: integer('id').primaryKey().default(1),
  sharePercent: smallint('share_percent').notNull().default(80),
  cashbackPercent: smallint('cashback_percent').notNull().default(10),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  fundName: varchar('fund_name', { length: 255 }),
  fundUrl: text('fund_url'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const donations = pgTable(
  'donations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentId: uuid('parent_id')
      .notNull()
      .references(() => parents.userId, { onDelete: 'cascade' }),
    amountRub: integer('amount_rub').notNull(),
    cashbackRub: integer('cashback_rub').notNull().default(0),
    cashbackPoints: integer('cashback_points').notNull().default(0),
    status: donationStatusEnum('status').notNull().default('pending'),
    provider: paymentProviderEnum('provider').notNull().default('stub'),
    providerPaymentId: varchar('provider_payment_id', { length: 128 }),
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>(),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    parentIdx: index('donations_parent_idx').on(t.parentId),
    statusIdx: index('donations_status_idx').on(t.status),
    idemUq: uniqueIndex('donations_idem_uq').on(t.idempotencyKey),
  })
);

// ============================================================
// RELATIONS
// ============================================================

export const usersRelations = relations(users, ({ one, many }) => ({
  parent: one(parents, { fields: [users.id], references: [parents.userId] }),
  sessions: many(sessions),
}));

export const parentsRelations = relations(parents, ({ one, many }) => ({
  user: one(users, { fields: [parents.userId], references: [users.id] }),
  children: many(children),
  subscriptions: many(subscriptions),
  donations: many(donations),
}));

export const childrenRelations = relations(children, ({ one, many }) => ({
  parent: one(parents, { fields: [children.parentId], references: [parents.userId] }),
  attempts: many(attempts),
  balance: one(childBalances, {
    fields: [children.id],
    references: [childBalances.childId],
  }),
  achievements: many(childAchievements),
  notifications: many(childNotifications),
}));

export const subjectsRelations = relations(subjects, ({ many }) => ({
  tests: many(tests),
  questions: many(questions),
}));

export const testsRelations = relations(tests, ({ one, many }) => ({
  subject: one(subjects, { fields: [tests.subjectId], references: [subjects.id] }),
  questions: many(testQuestions),
  attempts: many(attempts),
}));

export const attemptsRelations = relations(attempts, ({ one, many }) => ({
  child: one(children, { fields: [attempts.childId], references: [children.id] }),
  test: one(tests, { fields: [attempts.testId], references: [tests.id] }),
  answers: many(attemptAnswers),
  events: many(attemptEvents),
}));

export const achievementsRelations = relations(achievements, ({ many }) => ({
  children: many(childAchievements),
}));

export const childAchievementsRelations = relations(childAchievements, ({ one }) => ({
  child: one(children, { fields: [childAchievements.childId], references: [children.id] }),
  achievement: one(achievements, {
    fields: [childAchievements.achievementId],
    references: [achievements.id],
  }),
}));

// ============================================================
// TYPES
// ============================================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Parent = typeof parents.$inferSelect;
export type Child = typeof children.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Subject = typeof subjects.$inferSelect;
export type Test = typeof tests.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type QuestionTypeSetting = typeof questionTypeSettings.$inferSelect;
export type NewQuestionTypeSetting = typeof questionTypeSettings.$inferInsert;
export type Attempt = typeof attempts.$inferSelect;
export type AttemptAnswer = typeof attemptAnswers.$inferSelect;
export type AttemptEvent = typeof attemptEvents.$inferSelect;
export type PointsLedgerEntry = typeof pointsLedger.$inferSelect;
export type ChildBalance = typeof childBalances.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Partner = typeof partners.$inferSelect;
export type PartnerOffer = typeof partnerOffers.$inferSelect;
export type Redemption = typeof redemptions.$inferSelect;
export type FraudRule = typeof fraudRules.$inferSelect;
export type SpotCheck = typeof spotChecks.$inferSelect;
export type SpotCheckItem = typeof spotCheckItems.$inferSelect;
export type Mailing = typeof mailings.$inferSelect;
export type MailTemplate = typeof mailTemplates.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type ChildNotification = typeof childNotifications.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type Achievement = typeof achievements.$inferSelect;
export type ChildAchievement = typeof childAchievements.$inferSelect;
export type CharitySettings = typeof charitySettings.$inferSelect;
export type Donation = typeof donations.$inferSelect;

void foreignKey;
void date;