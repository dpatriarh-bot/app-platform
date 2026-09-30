// ============================================================
// mailings/service.ts — шаблоны, сегменты, отправка рассылок
// Rate-limit и отмена в процессе.
// ============================================================

import { eq, and, isNull, sql, desc, inArray, gte, lte } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  mailTemplates,
  mailings,
  mailingRecipients,
  users,
  parents,
  children,
  subscriptions,
  type MailTemplate,
  type Mailing,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { writeAudit } from '../audit/service.js';
import { mailingsQueue } from '../../lib/queues.js';
import { decryptPII } from '../../lib/crypto.js';
import { sendMail } from '../../lib/mailer.js';
import type {
  CreateMailTemplateInput,
  UpdateMailTemplateInput,
  CreateMailingInput,
  ListMailingsQuery,
  PreviewSegmentInput,
} from './schemas.js';

const SEND_DELAY_MS = 60;
const SEND_BATCH_SIZE = 25;
const BATCH_PAUSE_MS = 2000;

type Segment = CreateMailingInput['segment'];

// ============================================================
// Шаблоны
// ============================================================

export interface MailTemplatePublic {
  id: string;
  code: string;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText: string | null;
  variables: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toTemplatePublic(t: MailTemplate): MailTemplatePublic {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    subject: t.subject,
    bodyHtml: t.bodyHtml,
    bodyText: t.bodyText,
    variables: t.variables ?? [],
    isActive: t.isActive,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export async function listTemplates(): Promise<MailTemplatePublic[]> {
  const rows = await db.select().from(mailTemplates).orderBy(mailTemplates.code);
  return rows.map(toTemplatePublic);
}

export async function createTemplate(
  input: CreateMailTemplateInput,
  actorId: string
): Promise<MailTemplatePublic> {
  const [dup] = await db
    .select({ id: mailTemplates.id })
    .from(mailTemplates)
    .where(eq(mailTemplates.code, input.code))
    .limit(1);

  if (dup) throw new AppError('CODE_TAKEN', 'Шаблон с таким кодом уже существует', 409);

  const [row] = await db
    .insert(mailTemplates)
    .values({
      code: input.code,
      name: input.name,
      subject: input.subject,
      bodyHtml: input.bodyHtml,
      bodyText: input.bodyText || null,
      variables: input.variables ?? [],
      isActive: input.isActive ?? true,
    })
    .returning();

  await writeAudit({
    actorId,
    action: 'mail_template.create',
    entity: 'mail_template',
    entityId: row!.id,
    after: { code: row!.code },
  });

  return toTemplatePublic(row!);
}

export async function updateTemplate(
  id: string,
  input: UpdateMailTemplateInput,
  actorId: string
): Promise<MailTemplatePublic> {
  const updates: Partial<typeof mailTemplates.$inferInsert> = { updatedAt: new Date() };

  if (input.name !== undefined) updates.name = input.name;
  if (input.subject !== undefined) updates.subject = input.subject;
  if (input.bodyHtml !== undefined) updates.bodyHtml = input.bodyHtml;
  if (input.bodyText !== undefined) updates.bodyText = input.bodyText || null;
  if (input.variables !== undefined) updates.variables = input.variables;
  if (input.isActive !== undefined) updates.isActive = input.isActive;

  await db.update(mailTemplates).set(updates).where(eq(mailTemplates.id, id));

  const [row] = await db.select().from(mailTemplates).where(eq(mailTemplates.id, id)).limit(1);
  if (!row) throw new AppError('NOT_FOUND', 'Шаблон не найден', 404);

  await writeAudit({
    actorId,
    action: 'mail_template.update',
    entity: 'mail_template',
    entityId: id,
  });

  return toTemplatePublic(row);
}

// ============================================================
// Сегменты
// ============================================================

interface Recipient {
  userId: string;
  email: string | null;
  phone: string;
  fullName: string;
  variables: Record<string, string>;
}

async function buildSegmentRecipients(segment: Segment): Promise<Recipient[]> {
  const conditions = [isNull(users.deletedAt)];

  if (segment.roles && segment.roles.length > 0) {
    conditions.push(inArray(users.role, segment.roles));
  } else {
    conditions.push(eq(users.role, 'parent'));
  }

  if (segment.statuses && segment.statuses.length > 0) {
    conditions.push(inArray(users.status, segment.statuses));
  } else {
    conditions.push(eq(users.status, 'active'));
  }

  if (segment.registeredAfter) {
    conditions.push(gte(users.createdAt, new Date(segment.registeredAfter)));
  }
  if (segment.registeredBefore) {
    conditions.push(lte(users.createdAt, new Date(segment.registeredBefore)));
  }

  const baseRows = await db
    .select({
      userId: users.id,
      email: users.email,
      phone: users.phone,
      fullNameEnc: parents.fullNameEnc,
    })
    .from(users)
    .leftJoin(parents, eq(parents.userId, users.id))
    .where(and(...conditions));

  let filtered = baseRows;

  if (segment.subscriptionStatuses && segment.subscriptionStatuses.length > 0) {
    const subsRows = await db
      .select({ parentId: subscriptions.parentId })
      .from(subscriptions)
      .where(inArray(subscriptions.status, segment.subscriptionStatuses));

    const allowed = new Set(subsRows.map((r) => r.parentId));
    filtered = filtered.filter((r) => allowed.has(r.userId));
  }

  if (
    segment.hasChildren !== undefined ||
    segment.childGradeMin !== undefined ||
    segment.childGradeMax !== undefined
  ) {
    const kidsRows = await db
      .select({ parentId: children.parentId, grade: children.grade })
      .from(children)
      .where(isNull(children.deletedAt));

    const byParent = new Map<string, number[]>();
    for (const k of kidsRows) {
      if (!byParent.has(k.parentId)) byParent.set(k.parentId, []);
      if (k.grade !== null) byParent.get(k.parentId)!.push(k.grade);
    }

    filtered = filtered.filter((r) => {
      const grades = byParent.get(r.userId) ?? [];
      if (segment.hasChildren === true && grades.length === 0) return false;
      if (segment.hasChildren === false && grades.length > 0) return false;

      if (segment.childGradeMin !== undefined) {
        if (!grades.some((g) => g >= segment.childGradeMin!)) return false;
      }
      if (segment.childGradeMax !== undefined) {
        if (!grades.some((g) => g <= segment.childGradeMax!)) return false;
      }
      return true;
    });
  }

  return filtered
    .filter((r) => r.email)
    .map((r) => {
      const fullName = r.fullNameEnc ? decryptPII(r.fullNameEnc) ?? '' : '';
      return {
        userId: r.userId,
        email: r.email,
        phone: r.phone,
        fullName,
        variables: {
          parentName: fullName || 'родитель',
          email: r.email ?? '',
          phone: r.phone,
        },
      };
    });
}

export async function previewSegment(
  input: PreviewSegmentInput
): Promise<{ total: number; sample: Array<{ userId: string; email: string; fullName: string }> }> {
  const recipients = await buildSegmentRecipients(input.segment);
  return {
    total: recipients.length,
    sample: recipients.slice(0, input.limit).map((r) => ({
      userId: r.userId,
      email: r.email ?? '',
      fullName: r.fullName,
    })),
  };
}

// ============================================================
// Рассылки
// ============================================================

export interface MailingPublic {
  id: string;
  name: string;
  channel: string;
  status: Mailing['status'];
  subject: string | null;
  templateId: string | null;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  scheduledAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

function toMailingPublic(m: Mailing): MailingPublic {
  return {
    id: m.id,
    name: m.name,
    channel: m.channel,
    status: m.status,
    subject: m.subject,
    templateId: m.templateId,
    totalRecipients: m.totalRecipients,
    sentCount: m.sentCount,
    failedCount: m.failedCount,
    scheduledAt: m.scheduledAt,
    startedAt: m.startedAt,
    finishedAt: m.finishedAt,
    createdAt: m.createdAt,
  };
}

export async function listMailings(
  query: ListMailingsQuery
): Promise<{ items: MailingPublic[]; total: number }> {
  const conditions = [];
  if (query.status) conditions.push(eq(mailings.status, query.status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalRow] = await Promise.all([
    db
      .select()
      .from(mailings)
      .where(where)
      .orderBy(desc(mailings.createdAt))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(mailings).where(where),
  ]);

  return {
    items: rows.map(toMailingPublic),
    total: totalRow[0]?.count ?? 0,
  };
}

export async function getMailing(id: string): Promise<MailingPublic> {
  const [row] = await db.select().from(mailings).where(eq(mailings.id, id)).limit(1);
  if (!row) throw new AppError('NOT_FOUND', 'Рассылка не найдена', 404);
  return toMailingPublic(row);
}

export async function createMailing(
  input: CreateMailingInput,
  actorId: string
): Promise<MailingPublic> {
  let subject = input.subject ?? null;
  let bodyHtml = input.bodyHtml ?? null;

  if (input.templateId) {
    const [tpl] = await db
      .select()
      .from(mailTemplates)
      .where(eq(mailTemplates.id, input.templateId))
      .limit(1);

    if (!tpl) throw new AppError('TEMPLATE_NOT_FOUND', 'Шаблон не найден', 404);
    subject = subject ?? tpl.subject;
    bodyHtml = bodyHtml ?? tpl.bodyHtml;
  }

  const recipients = await buildSegmentRecipients(input.segment);

  const [row] = await db
    .insert(mailings)
    .values({
      templateId: input.templateId ?? null,
      name: input.name,
      channel: input.channel ?? 'email',
      segment: input.segment as Record<string, unknown>,
      subject,
      bodyHtml,
      status: input.scheduledAt ? 'scheduled' : 'draft',
      totalRecipients: recipients.length,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      createdBy: actorId,
    })
    .returning();

  if (recipients.length > 0) {
    const chunks: Array<typeof mailingRecipients.$inferInsert> = recipients.map((r) => ({
      mailingId: row!.id,
      userId: r.userId,
      address: r.email ?? r.phone,
      status: 'pending',
    }));

    for (let i = 0; i < chunks.length; i += 500) {
      await db.insert(mailingRecipients).values(chunks.slice(i, i + 500));
    }
  }

  await writeAudit({
    actorId,
    action: 'mailing.create',
    entity: 'mailing',
    entityId: row!.id,
    after: { name: row!.name, recipients: recipients.length, channel: row!.channel },
  });

  logger.info(
    { mailingId: row!.id, recipients: recipients.length, channel: row!.channel },
    'mailing created'
  );

  return toMailingPublic(row!);
}

export async function sendMailing(id: string, actorId: string): Promise<MailingPublic> {
  const [row] = await db.select().from(mailings).where(eq(mailings.id, id)).limit(1);
  if (!row) throw new AppError('NOT_FOUND', 'Рассылка не найдена', 404);
  if (row.status === 'sending' || row.status === 'sent') {
    throw new AppError('MAILING_ALREADY_SENT', 'Рассылка уже отправлена или в процессе', 409);
  }

  await db
    .update(mailings)
    .set({ status: 'sending', startedAt: new Date(), updatedAt: new Date() })
    .where(eq(mailings.id, id));

  await mailingsQueue.add('send', { mailingId: id }, { jobId: `mailing:${id}` });

  await writeAudit({
    actorId,
    action: 'mailing.send',
    entity: 'mailing',
    entityId: id,
  });

  return getMailing(id);
}

export async function cancelMailing(id: string, actorId: string): Promise<MailingPublic> {
  const [row] = await db.select().from(mailings).where(eq(mailings.id, id)).limit(1);
  if (!row) throw new AppError('NOT_FOUND', 'Рассылка не найдена', 404);
  if (row.status === 'sent') {
    throw new AppError('MAILING_ALREADY_SENT', 'Рассылка уже отправлена', 409);
  }

  await db
    .update(mailings)
    .set({ status: 'canceled', updatedAt: new Date() })
    .where(eq(mailings.id, id));

  await writeAudit({
    actorId,
    action: 'mailing.cancel',
    entity: 'mailing',
    entityId: id,
  });

  return getMailing(id);
}

// ============================================================
// Обработчик воркера (с rate-limit и проверкой отмены)
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function processMailing(
  mailingId: string
): Promise<{ sent: number; failed: number }> {
  const [mailing] = await db
    .select()
    .from(mailings)
    .where(eq(mailings.id, mailingId))
    .limit(1);

  if (!mailing) throw new AppError('NOT_FOUND', 'Рассылка не найдена', 404);
  if (mailing.status !== 'sending') {
    logger.warn({ mailingId, status: mailing.status }, 'mailing: wrong status');
    return { sent: 0, failed: 0 };
  }

  const recipients = await db
    .select()
    .from(mailingRecipients)
    .where(
      and(
        eq(mailingRecipients.mailingId, mailingId),
        eq(mailingRecipients.status, 'pending')
      )
    );

  let sent = 0;
  let failed = 0;
  let processed = 0;

  for (const r of recipients) {
    // Проверяем, не отменена ли рассылка
    const [current] = await db
      .select({ status: mailings.status })
      .from(mailings)
      .where(eq(mailings.id, mailingId))
      .limit(1);

    if (!current || current.status === 'canceled') {
      logger.info({ mailingId, processed, sent, failed }, 'mailing canceled mid-flight');
      break;
    }

    try {
      await sendMail({
        to: r.address,
        subject: mailing.subject ?? '(без темы)',
        html: mailing.bodyHtml ?? '',
        text: undefined,
      });

      await db
        .update(mailingRecipients)
        .set({ status: 'sent', sentAt: new Date() })
        .where(eq(mailingRecipients.id, r.id));

      sent += 1;
    } catch (err) {
      await db
        .update(mailingRecipients)
        .set({
          status: 'failed',
          error: err instanceof Error ? err.message : 'unknown',
        })
        .where(eq(mailingRecipients.id, r.id));

      failed += 1;
    }

    processed += 1;

    if (processed % SEND_BATCH_SIZE === 0) {
      await sleep(BATCH_PAUSE_MS);
    } else {
      await sleep(SEND_DELAY_MS);
    }
  }

  const [current] = await db
    .select({ status: mailings.status })
    .from(mailings)
    .where(eq(mailings.id, mailingId))
    .limit(1);

  const finalStatus = current?.status === 'canceled'
    ? 'canceled'
    : failed === recipients.length && recipients.length > 0
      ? 'failed'
      : 'sent';

  await db
    .update(mailings)
    .set({
      status: finalStatus,
      sentCount: sent,
      failedCount: failed,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(mailings.id, mailingId));

  logger.info({ mailingId, sent, failed, status: finalStatus }, 'mailing processed');

  return { sent, failed };
}