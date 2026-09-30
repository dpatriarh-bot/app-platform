// ============================================================
// notifications/service.ts — уведомления в ЛК + очередь каналов
// createNotification пишет в БД и ставит job в очередь notifications.
// Воркер решает, отправлять ли email/push по типу.
// ============================================================

import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { notifications, users } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { notificationsQueue } from '../../lib/queues.js';

export type NotificationType =
  | 'attempt_finished'
  | 'attempt_flagged'
  | 'points_awarded'
  | 'points_deducted'
  | 'subscription_active'
  | 'subscription_expiring'
  | 'subscription_past_due'
  | 'redemption_issued'
  | 'redemption_redeemed'
  | 'spot_check_scheduled'
  | 'spot_check_verdict'
  | 'mailing'
  | 'system';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  /** Отправить email-дубликат (по умолчанию — по типу). */
  emailFallback?: boolean;
  /** Дополнительные переменные для шаблона. */
  meta?: Record<string, unknown>;
}

/** Типы, для которых email-дубликат отправляется по умолчанию. */
const EMAIL_BY_DEFAULT: ReadonlySet<NotificationType> = new Set([
  'subscription_active',
  'subscription_expiring',
  'subscription_past_due',
  'spot_check_scheduled',
  'spot_check_verdict',
  'redemption_issued',
  'attempt_flagged',
]);

export async function createNotification(
  input: CreateNotificationInput
): Promise<string> {
  const [row] = await db
    .insert(notifications)
    .values({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
    })
    .returning({ id: notifications.id });

  if (!row) {
    throw new AppError('INTERNAL', 'Не удалось создать уведомление', 500);
  }

  const shouldEmail = input.emailFallback ?? EMAIL_BY_DEFAULT.has(input.type);

  try {
    await notificationsQueue.add(
      'deliver',
      {
        notificationId: row.id,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        emailFallback: shouldEmail,
        meta: input.meta ?? {},
      },
      { jobId: `notif:${row.id}` }
    );
  } catch (err) {
    logger.warn({ err, notificationId: row.id }, 'failed to enqueue notification');
  }

  return row.id;
}

export async function listNotifications(
  userId: string,
  options: { limit?: number; unreadOnly?: boolean } = {}
): Promise<Array<typeof notifications.$inferSelect>> {
  const limit = Math.min(options.limit ?? 50, 100);

  const conditions = [eq(notifications.userId, userId)];
  if (options.unreadOnly) conditions.push(eq(notifications.isRead, false));

  return db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function countUnread(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));

  return row?.count ?? 0;
}

export interface UnreadByType {
  type: string;
  count: number;
}

export async function countUnreadByType(userId: string): Promise<UnreadByType[]> {
  const rows = await db
    .select({
      type: notifications.type,
      count: sql<number>`count(*)::int`,
    })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
    .groupBy(notifications.type);

  return rows;
}

export async function markAsRead(userId: string, notificationId: string): Promise<void> {
  const result = await db
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId),
        eq(notifications.isRead, false)
      )
    )
    .returning({ id: notifications.id });

  if (result.length === 0) {
    throw new AppError('NOT_FOUND', 'Уведомление не найдено', 404);
  }
}

export async function markAllAsRead(userId: string): Promise<number> {
  const result = await db
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
    .returning({ id: notifications.id });

  return result.length;
}

export async function deleteNotification(userId: string, notificationId: string): Promise<void> {
  await db
    .delete(notifications)
    .where(
      and(eq(notifications.id, notificationId), eq(notifications.userId, userId))
    );
}

export async function clearAll(userId: string): Promise<void> {
  await db.delete(notifications).where(eq(notifications.userId, userId));
}

/**
 * Утилита: уведомить всех пользователей с указанными ролями.
 */
export async function notifyRoles(
  roles: Array<'parent' | 'partner' | 'manager' | 'curator' | 'admin' | 'superadmin'>,
  input: Omit<CreateNotificationInput, 'userId'>
): Promise<number> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.role, roles), eq(users.status, 'active')));

  let sent = 0;
  for (const r of rows) {
    try {
      await createNotification({ ...input, userId: r.id });
      sent += 1;
    } catch (err) {
      logger.warn({ err, userId: r.id }, 'notifyRoles: failed for user');
    }
  }
  return sent;
}