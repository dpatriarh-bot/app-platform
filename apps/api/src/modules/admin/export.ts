// ============================================================
// admin/export.ts — экспорт в CSV: users, attempts, payments,
// redemptions, audit.
// ============================================================

import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  users,
  parents,
  children,
  attempts,
  tests,
  payments,
  redemptions,
  partnerOffers,
  partners,
  auditLog,
} from '../../db/schema.js';
import { decryptPII, maskPhone } from '../../lib/crypto.js';
import { toCsv, type CsvColumn } from '../../lib/csv.js';

export interface ExportQuery {
  from?: string;
  to?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 5000;
const MAX_LIMIT = 50000;

function buildDateRange(query: ExportQuery): { from?: Date; to?: Date } {
  const out: { from?: Date; to?: Date } = {};
  if (query.from) out.from = new Date(query.from);
  if (query.to) out.to = new Date(query.to);
  return out;
}

// ============================================================
// USERS
// ============================================================

export async function exportUsersCsv(query: ExportQuery): Promise<string> {
  const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const rows = await db
    .select({
      user: users,
      parentFullNameEnc: parents.fullNameEnc,
      parentCity: parents.city,
      childrenCount: sql<number>`(
        SELECT COUNT(*)::int FROM children c
        WHERE c.parent_id = ${users.id} AND c.deleted_at IS NULL
      )`,
      attemptsCount: sql<number>`(
        SELECT COUNT(*)::int FROM attempts a
        INNER JOIN children c ON c.id = a.child_id
        WHERE c.parent_id = ${users.id}
      )`,
    })
    .from(users)
    .leftJoin(parents, eq(parents.userId, users.id))
    .where(isNull(users.deletedAt))
    .orderBy(desc(users.createdAt))
    .limit(limit);

  const columns: CsvColumn<typeof rows[number]>[] = [
    { key: 'id', header: 'ID', value: (r) => r.user.id },
    { key: 'role', header: 'Роль', value: (r) => r.user.role },
    { key: 'status', header: 'Статус', value: (r) => r.user.status },
    { key: 'phone', header: 'Телефон', value: (r) => r.user.phone },
    { key: 'email', header: 'Email', value: (r) => r.user.email ?? '' },
    {
      key: 'fullName',
      header: 'ФИО',
      value: (r) => (r.parentFullNameEnc ? decryptPII(r.parentFullNameEnc) ?? '' : ''),
    },
    { key: 'city', header: 'Город', value: (r) => r.parentCity ?? '' },
    { key: 'childrenCount', header: 'Детей', value: (r) => r.childrenCount },
    { key: 'attemptsCount', header: 'Попыток', value: (r) => r.attemptsCount },
    { key: 'totpEnabled', header: '2FA', value: (r) => (r.user.totpEnabled ? 'да' : 'нет') },
    { key: 'fraudDisabled', header: 'Антифрод отключён', value: (r) => (r.user.fraudDisabled ? 'да' : 'нет') },
    { key: 'createdAt', header: 'Регистрация', value: (r) => r.user.createdAt.toISOString() },
    { key: 'lastLoginAt', header: 'Последний вход', value: (r) => r.user.lastLoginAt?.toISOString() ?? '' },
  ];

  return toCsv(rows, columns);
}

// ============================================================
// ATTEMPTS
// ============================================================

export async function exportAttemptsCsv(query: ExportQuery): Promise<string> {
  const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const range = buildDateRange(query);

  const conditions = [];
  if (range.from) conditions.push(gte(attempts.startedAt, range.from));
  if (range.to) conditions.push(lte(attempts.startedAt, range.to));

  const rows = await db
    .select({
      attempt: attempts,
      testTitle: tests.title,
      childNameEnc: children.fullNameEnc,
    })
    .from(attempts)
    .leftJoin(tests, eq(tests.id, attempts.testId))
    .leftJoin(children, eq(children.id, attempts.childId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(attempts.startedAt))
    .limit(limit);

  const columns: CsvColumn<typeof rows[number]>[] = [
    { key: 'id', header: 'ID попытки', value: (r) => r.attempt.id },
    { key: 'childId', header: 'ID ребёнка', value: (r) => r.attempt.childId },
    {
      key: 'childName',
      header: 'ФИО ребёнка',
      value: (r) => (r.childNameEnc ? decryptPII(r.childNameEnc) ?? '' : ''),
    },
    { key: 'testTitle', header: 'Тест', value: (r) => r.testTitle ?? '' },
    { key: 'status', header: 'Статус', value: (r) => r.attempt.status },
    { key: 'totalCount', header: 'Всего вопросов', value: (r) => r.attempt.totalCount },
    { key: 'correctCount', header: 'Правильных', value: (r) => r.attempt.correctCount },
    { key: 'wrongCount', header: 'Ошибок', value: (r) => r.attempt.wrongCount },
    { key: 'skippedCount', header: 'Пропущено', value: (r) => r.attempt.skippedCount },
    { key: 'percentCorrect', header: 'Процент', value: (r) => r.attempt.percentCorrect ?? '' },
    { key: 'scorePoints', header: 'Трудокоинов', value: (r) => r.attempt.scorePoints },
    { key: 'suspicionScore', header: 'Suspicion', value: (r) => r.attempt.suspicionScore },
    {
      key: 'fraudFlags',
      header: 'Флаги',
      value: (r) => (r.attempt.fraudFlags ?? []).join('|'),
    },
    { key: 'startedAt', header: 'Начало', value: (r) => r.attempt.startedAt.toISOString() },
    { key: 'finishedAt', header: 'Завершение', value: (r) => r.attempt.finishedAt?.toISOString() ?? '' },
    { key: 'ip', header: 'IP', value: (r) => r.attempt.ip ?? '' },
    { key: 'deviceFingerprint', header: 'Fingerprint', value: (r) => r.attempt.deviceFingerprint ?? '' },
  ];

  return toCsv(rows, columns);
}

// ============================================================
// PAYMENTS
// ============================================================

export async function exportPaymentsCsv(query: ExportQuery): Promise<string> {
  const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const range = buildDateRange(query);

  const conditions = [];
  if (range.from) conditions.push(gte(payments.createdAt, range.from));
  if (range.to) conditions.push(lte(payments.createdAt, range.to));

  const rows = await db
    .select()
    .from(payments)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(payments.createdAt))
    .limit(limit);

  const columns: CsvColumn<typeof rows[number]>[] = [
    { key: 'id', header: 'ID платежа', value: (r) => r.id },
    { key: 'parentId', header: 'ID родителя', value: (r) => r.parentId },
    { key: 'subscriptionId', header: 'ID подписки', value: (r) => r.subscriptionId ?? '' },
    { key: 'provider', header: 'Провайдер', value: (r) => r.provider },
    { key: 'providerPaymentId', header: 'ID у провайдера', value: (r) => r.providerPaymentId ?? '' },
    { key: 'amountRub', header: 'Сумма, ₽', value: (r) => r.amountRub },
    { key: 'currency', header: 'Валюта', value: (r) => r.currency },
    { key: 'status', header: 'Статус', value: (r) => r.status },
    { key: 'isRecurrent', header: 'Автоплатёж', value: (r) => (r.isRecurrent ? 'да' : 'нет') },
    { key: 'isTest', header: 'Тестовый', value: (r) => (r.isTest ? 'да' : 'нет') },
    { key: 'failureReason', header: 'Причина отказа', value: (r) => r.failureReason ?? '' },
    { key: 'paidAt', header: 'Оплачен', value: (r) => r.paidAt?.toISOString() ?? '' },
    { key: 'createdAt', header: 'Создан', value: (r) => r.createdAt.toISOString() },
  ];

  return toCsv(rows, columns);
}

// ============================================================
// REDEMPTIONS
// ============================================================

export async function exportRedemptionsCsv(query: ExportQuery): Promise<string> {
  const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const range = buildDateRange(query);

  const conditions = [];
  if (range.from) conditions.push(gte(redemptions.createdAt, range.from));
  if (range.to) conditions.push(lte(redemptions.createdAt, range.to));

  const rows = await db
    .select({
      redemption: redemptions,
      offerTitle: partnerOffers.title,
      partnerName: partners.name,
      childNameEnc: children.fullNameEnc,
    })
    .from(redemptions)
    .leftJoin(partnerOffers, eq(partnerOffers.id, redemptions.offerId))
    .leftJoin(partners, eq(partners.id, redemptions.partnerId))
    .leftJoin(children, eq(children.id, redemptions.childId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(redemptions.createdAt))
    .limit(limit);

  const columns: CsvColumn<typeof rows[number]>[] = [
    { key: 'id', header: 'ID', value: (r) => r.redemption.id },
    { key: 'childId', header: 'ID ребёнка', value: (r) => r.redemption.childId },
    {
      key: 'childName',
      header: 'Ребёнок (маскированно)',
      value: (r) => {
        const name = r.childNameEnc ? decryptPII(r.childNameEnc) ?? '' : '';
        return name.split(/\s+/).map((p) => (p[0] ?? '') + '***').join(' ');
      },
    },
    { key: 'offerTitle', header: 'Оффер', value: (r) => r.offerTitle ?? '' },
    { key: 'partnerName', header: 'Партнёр', value: (r) => r.partnerName ?? '' },
    { key: 'redemptionType', header: 'Тип', value: (r) => r.redemption.redemptionType },
    { key: 'status', header: 'Статус', value: (r) => r.redemption.status },
    { key: 'code', header: 'Код', value: (r) => r.redemption.code ?? '' },
    { key: 'pointsSpent', header: 'Трудокоинов списано', value: (r) => r.redemption.pointsSpent },
    { key: 'expiresAt', header: 'Действует до', value: (r) => r.redemption.expiresAt.toISOString() },
    { key: 'redeemedAt', header: 'Получен', value: (r) => r.redemption.redeemedAt?.toISOString() ?? '' },
    { key: 'createdAt', header: 'Создан', value: (r) => r.redemption.createdAt.toISOString() },
  ];

  return toCsv(rows, columns);
}

// ============================================================
// AUDIT
// ============================================================

export async function exportAuditCsv(query: ExportQuery): Promise<string> {
  const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const range = buildDateRange(query);

  const conditions = [];
  if (range.from) conditions.push(gte(auditLog.createdAt, range.from));
  if (range.to) conditions.push(lte(auditLog.createdAt, range.to));

  const rows = await db
    .select()
    .from(auditLog)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);

  const columns: CsvColumn<typeof rows[number]>[] = [
    { key: 'id', header: 'ID', value: (r) => r.id },
    { key: 'actorId', header: 'ID актора', value: (r) => r.actorId ?? '' },
    { key: 'actorRole', header: 'Роль', value: (r) => r.actorRole ?? '' },
    { key: 'action', header: 'Действие', value: (r) => r.action },
    { key: 'entity', header: 'Объект', value: (r) => r.entity },
    { key: 'entityId', header: 'ID объекта', value: (r) => r.entityId ?? '' },
    { key: 'before', header: 'До', value: (r) => (r.beforeJson ? JSON.stringify(r.beforeJson) : '') },
    { key: 'after', header: 'После', value: (r) => (r.afterJson ? JSON.stringify(r.afterJson) : '') },
    { key: 'ip', header: 'IP', value: (r) => r.ip ?? '' },
    { key: 'userAgent', header: 'User-Agent', value: (r) => r.userAgent ?? '' },
    { key: 'requestId', header: 'Request ID', value: (r) => r.requestId ?? '' },
    { key: 'createdAt', header: 'Время', value: (r) => r.createdAt.toISOString() },
  ];

  void maskPhone;
  return toCsv(rows, columns);
}