// ============================================================
// notifications/child-service.ts — уведомления для ребёнка
// ============================================================

import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { childNotifications } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';

export type ChildNotificationType =
  | 'points_awarded'
  | 'redemption_issued'
  | 'redemption_redeemed'
  | 'achievement_granted'
  | 'rank_up'
  | 'spot_check_scheduled'
  | 'system';

export interface CreateChildNotificationInput {
  childId: string;
  type: ChildNotificationType;
  title: string;
  body?: string;
  link?: string;
}

export async function createChildNotification(
  input: CreateChildNotificationInput
): Promise<string> {
  const [row] = await db
    .insert(childNotifications)
    .values({
      childId: input.childId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
    })
    .returning({ id: childNotifications.id });

  if (!row) throw new AppError('INTERNAL', 'Не удалось создать уведомление ребёнку', 500);
  return row.id;
}

export async function listChildNotifications(
  childId: string,
  options: { limit?: number; unreadOnly?: boolean } = {}
): Promise<Array<typeof childNotifications.$inferSelect>> {
  const limit = Math.min(options.limit ?? 30, 100);
  const conditions = [eq(childNotifications.childId, childId)];
  if (options.unreadOnly) conditions.push(eq(childNotifications.isRead, false));

  return db
    .select()
    .from(childNotifications)
    .where(and(...conditions))
    .orderBy(desc(childNotifications.createdAt))
    .limit(limit);
}

export async function countUnreadChild(childId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(childNotifications)
    .where(
      and(eq(childNotifications.childId, childId), eq(childNotifications.isRead, false))
    );
  return row?.count ?? 0;
}

export async function markChildAsRead(childId: string, notificationId: string): Promise<void> {
  const result = await db
    .update(childNotifications)
    .set({ isRead: true, readAt: new Date() })
    .where(
      and(
        eq(childNotifications.id, notificationId),
        eq(childNotifications.childId, childId)
      )
    )
    .returning({ id: childNotifications.id });

  if (result.length === 0) {
    throw new AppError('NOT_FOUND', 'Уведомление не найдено', 404);
  }
}

export async function markAllChildAsRead(childId: string): Promise<number> {
  const result = await db
    .update(childNotifications)
    .set({ isRead: true, readAt: new Date() })
    .where(
      and(eq(childNotifications.childId, childId), eq(childNotifications.isRead, false))
    )
    .returning({ id: childNotifications.id });
  return result.length;
}