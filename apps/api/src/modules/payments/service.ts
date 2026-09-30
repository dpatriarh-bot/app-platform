// ============================================================
// payments/service.ts — подписки, рекуррентные платежи, вебхуки
// hasActiveAccess не даёт доступ в проде при stub.
// chargeRecurrent ставит retry-job при past_due.
// ============================================================

import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  plans,
  subscriptions,
  payments,
  paymentWebhookEvents,
  type Subscription,
  type Payment,
  type Plan,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { redis } from '../../lib/redis.js';
import { writeAudit } from '../audit/service.js';
import { createNotification } from '../notifications/service.js';
import { getPaymentProvider } from './provider.js';
import { remindersQueue, paymentsQueue } from '../../lib/queues.js';
import { config } from '../../config.js';
import { link } from '../../lib/links.js';
import type {
  SubscribeInput,
  CancelSubscriptionInput,
  PaymentsHistoryQuery,
} from './schemas.js';

const DEFAULT_PRICE_RUB = 190;
const RETRY_DELAY_MS = 24 * 3600 * 1000;

const SUBSCRIPTION_CACHE_KEY = (parentId: string): string =>
  `subscription:parent:${parentId}`;

export async function getDefaultPlan(): Promise<Plan> {
  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.isDefault, true), eq(plans.isActive, true)))
    .limit(1);

  if (!plan) throw new AppError('NO_PLAN', 'Нет активного тарифа', 500);
  return plan;
}

export async function getPlanByCode(code: string): Promise<Plan> {
  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.code, code), eq(plans.isActive, true)))
    .limit(1);

  if (!plan) throw new AppError('NO_PLAN', 'Тариф не найден', 404);
  return plan;
}

export async function listPlans(): Promise<Plan[]> {
  return db.select().from(plans).where(eq(plans.isActive, true)).orderBy(plans.priceRub);
}

export interface SubscriptionPublic {
  id: string;
  status: Subscription['status'];
  provider: Subscription['provider'];
  planCode: string;
  planName: string;
  priceRub: number;
  periodDays: number;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  autoRenew: boolean;
  canceledAt: Date | null;
  nextChargeAt: Date | null;
  daysLeft: number | null;
}

export async function getCurrentSubscription(
  parentId: string
): Promise<SubscriptionPublic | null> {
  const cached = await redis.get(SUBSCRIPTION_CACHE_KEY(parentId));
  if (cached) return JSON.parse(cached) as SubscriptionPublic;

  const [row] = await db
    .select({ sub: subscriptions, plan: plans })
    .from(subscriptions)
    .leftJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.parentId, parentId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  if (!row) return null;

  const daysLeft = row.sub.currentPeriodEnd
    ? Math.max(
        0,
        Math.ceil((row.sub.currentPeriodEnd.getTime() - Date.now()) / (24 * 3600 * 1000))
      )
    : null;

  const result: SubscriptionPublic = {
    id: row.sub.id,
    status: row.sub.status,
    provider: row.sub.provider,
    planCode: row.plan?.code ?? 'monthly',
    planName: row.plan?.name ?? 'Месячная подписка',
    priceRub: row.plan?.priceRub ?? DEFAULT_PRICE_RUB,
    periodDays: row.plan?.periodDays ?? 30,
    currentPeriodStart: row.sub.currentPeriodStart,
    currentPeriodEnd: row.sub.currentPeriodEnd,
    autoRenew: row.sub.autoRenew,
    canceledAt: row.sub.canceledAt,
    nextChargeAt: row.sub.nextChargeAt,
    daysLeft,
  };

  await redis.setex(SUBSCRIPTION_CACHE_KEY(parentId), 30, JSON.stringify(result));
  return result;
}

async function invalidateSubscriptionCache(parentId: string): Promise<void> {
  await redis.del(SUBSCRIPTION_CACHE_KEY(parentId));
}

export async function hasActiveAccess(parentId: string): Promise<boolean> {
  if (config.PAYMENT_PROVIDER === 'stub') {
    if (config.isProd) {
      logger.error('PAYMENT_PROVIDER=stub in production — access denied');
      return false;
    }
    return true;
  }

  const sub = await getCurrentSubscription(parentId);
  if (!sub) return false;
  if (sub.status !== 'active') return false;
  if (!sub.currentPeriodEnd) return false;
  return sub.currentPeriodEnd > new Date();
}

export interface SubscribeResult {
  subscription: SubscriptionPublic;
  payment: {
    id: string;
    amountRub: number;
    status: Payment['status'];
    confirmationUrl: string | null;
  };
}

export async function subscribe(
  parentId: string,
  input: SubscribeInput,
  meta: { ip: string; userAgent: string }
): Promise<SubscribeResult> {
  const plan = input.planCode ? await getPlanByCode(input.planCode) : await getDefaultPlan();
  const provider = getPaymentProvider();

  const existing = await getCurrentSubscription(parentId);
  if (existing && existing.status === 'active') {
    const daysLeft = existing.daysLeft ?? 0;
    if (daysLeft > 0) {
      throw new AppError(
        'ALREADY_SUBSCRIBED',
        `Подписка уже активна. Осталось ${daysLeft} дн.`,
        409
      );
    }
  }

  const idempotencyKey = `sub:${parentId}:${Date.now()}`;

  const providerResult = await provider.createSubscription({
    parentId,
    amountRub: plan.priceRub,
    periodDays: plan.periodDays,
    description: `Подписка «${plan.name}» на ${plan.periodDays} дн.`,
    returnUrl: input.returnUrl ?? `${config.APP_URL}/app/payments`,
    idempotencyKey,
    metadata: { parentId, planCode: plan.code },
  });

  const now = new Date();
  const periodEnd = new Date(now.getTime() + plan.periodDays * 24 * 3600 * 1000);
  const isSuccess = providerResult.status === 'succeeded';
  const isStub = config.PAYMENT_PROVIDER === 'stub';

  const result = await db.transaction(async (tx) => {
    const [sub] = await tx
      .insert(subscriptions)
      .values({
        parentId,
        planId: plan.id,
        status: isSuccess ? 'active' : 'pending',
        provider: provider.name,
        providerSubscriptionId: providerResult.providerSubscriptionId,
        paymentMethodId: providerResult.paymentMethodId,
        currentPeriodStart: isSuccess ? now : null,
        currentPeriodEnd: isSuccess ? periodEnd : null,
        autoRenew: true,
        nextChargeAt: isSuccess ? periodEnd : null,
        reminderSentAt: null,
      })
      .returning();

    const [payment] = await tx
      .insert(payments)
      .values({
        subscriptionId: sub!.id,
        parentId,
        provider: provider.name,
        providerPaymentId: providerResult.providerPaymentId,
        amountRub: plan.priceRub,
        currency: 'RUB',
        status: isSuccess ? 'succeeded' : 'pending',
        isRecurrent: false,
        isTest: isStub,
        rawPayload: providerResult.rawPayload,
        idempotencyKey,
        paidAt: isSuccess ? now : null,
      })
      .returning();

    return { sub: sub!, payment: payment! };
  });

  await invalidateSubscriptionCache(parentId);

  if (isSuccess) {
    await createNotification({
      userId: parentId,
      type: 'subscription_active',
      title: 'Подписка оформлена',
      body: `${plan.name}, ${plan.priceRub} ₽ / ${plan.periodDays} дн.`,
      link: link.payments(),
    });

    await scheduleRenewalReminder(result.sub.id, periodEnd);
  }

  await writeAudit({
    actorId: parentId,
    action: 'payment.subscribe',
    entity: 'subscription',
    entityId: result.sub.id,
    after: { planCode: plan.code, amountRub: plan.priceRub, provider: provider.name },
  });

  logger.info(
    { parentId, subscriptionId: result.sub.id, plan: plan.code, provider: provider.name },
    'subscription created'
  );

  const subscriptionPublic = await getCurrentSubscription(parentId);
  if (!subscriptionPublic) {
    throw new AppError('INTERNAL', 'Не удалось создать подписку', 500);
  }

  return {
    subscription: subscriptionPublic,
    payment: {
      id: result.payment.id,
      amountRub: result.payment.amountRub,
      status: result.payment.status,
      confirmationUrl: providerResult.confirmationUrl,
    },
  };
}

export async function chargeRecurrent(subscriptionId: string): Promise<Payment> {
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId))
    .limit(1);

  if (!sub) throw new AppError('NOT_FOUND', 'Подписка не найдена', 404);

  if (sub.status !== 'active' && sub.status !== 'past_due') {
    throw new AppError('SUBSCRIPTION_NOT_ACTIVE', 'Подписка неактивна', 400);
  }
  if (!sub.autoRenew) {
    throw new AppError('AUTORENEW_DISABLED', 'Автопродление отключено', 400);
  }

  const [plan] = await db.select().from(plans).where(eq(plans.id, sub.planId)).limit(1);
  if (!plan) throw new AppError('NO_PLAN', 'Тариф не найден', 500);

  const provider = getPaymentProvider();
  const idempotencyKey = `charge:${sub.id}:${sub.currentPeriodEnd?.toISOString() ?? Date.now()}`;

  const charge = await provider.chargeRecurrent(
    sub.providerSubscriptionId ?? '',
    plan.priceRub,
    idempotencyKey
  );

  const now = new Date();
  const periodEnd = new Date(now.getTime() + plan.periodDays * 24 * 3600 * 1000);

  const [payment] = await db
    .insert(payments)
    .values({
      subscriptionId: sub.id,
      parentId: sub.parentId,
      provider: provider.name,
      providerPaymentId: charge.providerPaymentId,
      amountRub: plan.priceRub,
      currency: 'RUB',
      status: charge.status,
      isRecurrent: true,
      isTest: provider.name === 'stub',
      rawPayload: charge.rawPayload,
      idempotencyKey,
      failureReason: charge.failureReason ?? null,
      paidAt: charge.status === 'succeeded' ? now : null,
    })
    .returning();

  if (charge.status === 'succeeded') {
    await db
      .update(subscriptions)
      .set({
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        nextChargeAt: periodEnd,
        reminderSentAt: null,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, sub.id));

    await scheduleRenewalReminder(sub.id, periodEnd);

    await createNotification({
      userId: sub.parentId,
      type: 'subscription_active',
      title: `Подписка продлена на ${plan.periodDays} дн.`,
      body: `Списано ${plan.priceRub} ₽`,
      link: link.payments(),
    });
  } else {
    await db
      .update(subscriptions)
      .set({ status: 'past_due', updatedAt: now })
      .where(eq(subscriptions.id, sub.id));

    await createNotification({
      userId: sub.parentId,
      type: 'subscription_past_due',
      title: 'Не удалось списать оплату',
      body: charge.failureReason ?? 'Проверьте карту и попробуйте снова',
      link: link.payments(),
    });

    // Планируем retry на 24 часа
    await paymentsQueue.add(
      'retry-charge',
      { subscriptionId: sub.id },
      {
        delay: RETRY_DELAY_MS,
        jobId: `retry:${sub.id}:${Date.now()}`,
      }
    );
  }

  await invalidateSubscriptionCache(sub.parentId);

  logger.info(
    { subscriptionId: sub.id, status: charge.status, amount: plan.priceRub },
    'recurrent charge processed'
  );

  return payment!;
}

async function scheduleRenewalReminder(
  subscriptionId: string,
  periodEnd: Date
): Promise<void> {
  const reminderAt = new Date(periodEnd.getTime() - 3 * 24 * 3600 * 1000);
  const delay = Math.max(0, reminderAt.getTime() - Date.now());

  await remindersQueue.add(
    'subscription-reminder',
    { subscriptionId },
    {
      delay,
      jobId: `reminder:${subscriptionId}:${periodEnd.toISOString()}`,
    }
  );
}

export async function cancelAutoRenew(
  parentId: string,
  input: CancelSubscriptionInput
): Promise<SubscriptionPublic> {
  const sub = await getCurrentSubscription(parentId);
  if (!sub) throw new AppError('NOT_FOUND', 'Подписка не найдена', 404);
  if (!sub.autoRenew) {
    throw new AppError('ALREADY_CANCELED', 'Автопродление уже отключено', 400);
  }

  await db
    .update(subscriptions)
    .set({
      autoRenew: false,
      canceledAt: new Date(),
      cancelReason: input.reason ?? null,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, sub.id));

  await invalidateSubscriptionCache(parentId);

  await writeAudit({
    actorId: parentId,
    action: 'subscription.cancel_autorenew',
    entity: 'subscription',
    entityId: sub.id,
    after: { reason: input.reason ?? null },
  });

  const updated = await getCurrentSubscription(parentId);
  if (!updated) throw new AppError('INTERNAL', 'Ошибка обновления', 500);
  return updated;
}

export async function resumeAutoRenew(parentId: string): Promise<SubscriptionPublic> {
  const sub = await getCurrentSubscription(parentId);
  if (!sub) throw new AppError('NOT_FOUND', 'Подписка не найдена', 404);

  await db
    .update(subscriptions)
    .set({
      autoRenew: true,
      canceledAt: null,
      cancelReason: null,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, sub.id));

  await invalidateSubscriptionCache(parentId);

  await writeAudit({
    actorId: parentId,
    action: 'subscription.resume_autorenew',
    entity: 'subscription',
    entityId: sub.id,
  });

  const updated = await getCurrentSubscription(parentId);
  if (!updated) throw new AppError('INTERNAL', 'Ошибка обновления', 500);
  return updated;
}

export interface PaymentPublic {
  id: string;
  amountRub: number;
  currency: string;
  status: Payment['status'];
  isRecurrent: boolean;
  isTest: boolean;
  receiptUrl: string | null;
  failureReason: string | null;
  paidAt: Date | null;
  createdAt: Date;
}

export async function getPaymentsHistory(
  parentId: string,
  query: PaymentsHistoryQuery
): Promise<{ items: PaymentPublic[]; total: number }> {
  const conditions = [eq(payments.parentId, parentId)];
  if (query.status) conditions.push(eq(payments.status, query.status));

  const where = and(...conditions);

  const [items, totalRow] = await Promise.all([
    db
      .select()
      .from(payments)
      .where(where)
      .orderBy(desc(payments.createdAt))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(payments).where(where),
  ]);

  return {
    items: items.map((p) => ({
      id: p.id,
      amountRub: p.amountRub,
      currency: p.currency,
      status: p.status,
      isRecurrent: p.isRecurrent,
      isTest: p.isTest,
      receiptUrl: p.receiptUrl,
      failureReason: p.failureReason,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
    })),
    total: totalRow[0]?.count ?? 0,
  };
}

export async function handleWebhook(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>
): Promise<{ ok: boolean; message?: string }> {
  const provider = getPaymentProvider();
  const event = await provider.parseWebhook(rawBody, headers);

  if (!event) {
    logger.warn('webhook: failed to parse');
    return { ok: false, message: 'invalid_payload' };
  }

  if (!event.signatureValid) {
    logger.warn({ externalId: event.externalId }, 'webhook: invalid signature');
    return { ok: false, message: 'invalid_signature' };
  }

  const existing = await db
    .select({ id: paymentWebhookEvents.id, processedAt: paymentWebhookEvents.processedAt })
    .from(paymentWebhookEvents)
    .where(
      and(
        eq(paymentWebhookEvents.provider, provider.name),
        eq(paymentWebhookEvents.externalId, event.externalId)
      )
    )
    .limit(1);

  if (existing.length > 0 && existing[0]!.processedAt) {
    logger.info({ externalId: event.externalId }, 'webhook: already processed');
    return { ok: true, message: 'already_processed' };
  }

  const [record] = await db
    .insert(paymentWebhookEvents)
    .values({
      provider: provider.name,
      externalId: event.externalId,
      eventType: event.type,
      payload: event.payload,
      signatureValid: true,
    })
    .onConflictDoNothing()
    .returning();

  try {
    await processWebhookEvent(event.type, event.payload);

    if (record) {
      await db
        .update(paymentWebhookEvents)
        .set({ processedAt: new Date() })
        .where(eq(paymentWebhookEvents.id, record.id));
    }

    return { ok: true };
  } catch (err) {
    logger.error({ err, eventType: event.type }, 'webhook processing failed');

    if (record) {
      await db
        .update(paymentWebhookEvents)
        .set({ processingError: err instanceof Error ? err.message : 'unknown' })
        .where(eq(paymentWebhookEvents.id, record.id));
    }

    return { ok: false, message: 'processing_failed' };
  }
}

async function processWebhookEvent(
  type: string,
  payload: Record<string, unknown>
): Promise<void> {
  const providerPaymentId = String(payload.providerPaymentId ?? payload.id ?? '');

  if (!providerPaymentId) {
    logger.warn({ type }, 'webhook without providerPaymentId');
    return;
  }

  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.providerPaymentId, providerPaymentId))
    .limit(1);

  if (!payment) {
    logger.warn({ providerPaymentId }, 'webhook: payment not found');
    return;
  }

  if (type.includes('succeeded') || type === 'payment.succeeded') {
    await db
      .update(payments)
      .set({ status: 'succeeded', paidAt: new Date() })
      .where(eq(payments.id, payment.id));

    if (payment.subscriptionId) {
      const [sub] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, payment.subscriptionId))
        .limit(1);

      if (sub) {
        const [plan] = await db.select().from(plans).where(eq(plans.id, sub.planId)).limit(1);
        const now = new Date();
        const periodEnd = new Date(
          now.getTime() + (plan?.periodDays ?? 30) * 24 * 3600 * 1000
        );

        await db
          .update(subscriptions)
          .set({
            status: 'active',
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            nextChargeAt: periodEnd,
            updatedAt: now,
          })
          .where(eq(subscriptions.id, sub.id));

        await invalidateSubscriptionCache(sub.parentId);
      }
    }
  } else if (type.includes('canceled') || type === 'payment.canceled') {
    await db
      .update(payments)
      .set({ status: 'failed', failureReason: 'canceled' })
      .where(eq(payments.id, payment.id));
  }
}

export interface FinanceStats {
  totalRevenueRub: number;
  activeSubscriptions: number;
  pastDueSubscriptions: number;
  mrrRub: number;
  paymentsLast30d: number;
  revenueLast30d: number;
}

export async function getFinanceStats(): Promise<FinanceStats> {
  const [revenueRow, activeRow, pastDueRow, last30Row] = await Promise.all([
    db.execute<{ total: number }>(
      sql`SELECT COALESCE(SUM(amount_rub), 0)::int AS total
          FROM payments WHERE status = 'succeeded'`
    ),
    db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM subscriptions WHERE status = 'active'`
    ),
    db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM subscriptions WHERE status = 'past_due'`
    ),
    db.execute<{ count: number; revenue: number }>(
      sql`SELECT COUNT(*)::int AS count, COALESCE(SUM(amount_rub), 0)::int AS revenue
          FROM payments
          WHERE status = 'succeeded'
            AND paid_at >= NOW() - INTERVAL '30 days'`
    ),
  ]);

  const activeCount = activeRow[0]?.count ?? 0;
  const [plan] = await db
    .select()
    .from(plans)
    .where(eq(plans.isDefault, true))
    .limit(1);

  return {
    totalRevenueRub: revenueRow[0]?.total ?? 0,
    activeSubscriptions: activeCount,
    pastDueSubscriptions: pastDueRow[0]?.count ?? 0,
    mrrRub: activeCount * (plan?.priceRub ?? DEFAULT_PRICE_RUB),
    paymentsLast30d: last30Row[0]?.count ?? 0,
    revenueLast30d: last30Row[0]?.revenue ?? 0,
  };
}