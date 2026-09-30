// ============================================================
// worker.ts — BullMQ воркеры + scheduler (repeatable jobs)
// fraud, mailings, reminders, payments, notifications, scheduler.
// ============================================================

import { Worker, type Job } from 'bullmq';
import { eq, and, lt, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  attempts,
  subscriptions,
  plans,
  redemptions,
  passwordResets,
  users,
} from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';
import { computeAttemptFraudScore } from '../modules/attempts/fraud.js';
import { isFraudDisabledForChild } from '../modules/attempts/service.js';
import { createNotification } from '../modules/notifications/service.js';
import { processMailing } from '../modules/mailings/service.js';
import { chargeRecurrent } from '../modules/payments/service.js';
import { sendMail } from '../lib/mailer.js';
import { link } from '../lib/links.js';
import { schedulerQueue } from '../lib/queues.js';

const connection = {
  host: new URL(config.REDIS_URL).hostname,
  port: parseInt(new URL(config.REDIS_URL).port || '6379', 10),
  password: new URL(config.REDIS_URL).password || undefined,
};

const prefix = `${config.REDIS_PREFIX}bull`;

// ============================================================
// FRAUD
// ============================================================

const fraudWorker = new Worker(
  'fraud',
  async (job: Job) => {
    const { attemptId } = job.data as { attemptId: string };
    logger.info({ attemptId, jobId: job.id }, 'fraud worker: processing');

    const [attempt] = await db
      .select({ id: attempts.id, childId: attempts.childId })
      .from(attempts)
      .where(eq(attempts.id, attemptId))
      .limit(1);

    if (!attempt) {
      logger.warn({ attemptId }, 'fraud worker: attempt not found');
      return { score: 0, flags: [] };
    }

    const disabled = await isFraudDisabledForChild(attempt.childId);
    if (disabled) {
      logger.info({ attemptId }, 'fraud worker: disabled for child, skipping');
      await db
        .update(attempts)
        .set({ suspicionScore: 0, fraudFlags: [], updatedAt: new Date() })
        .where(eq(attempts.id, attemptId));
      return { score: 0, flags: [] };
    }

    const result = await computeAttemptFraudScore(attemptId);

    await db
      .update(attempts)
      .set({
        suspicionScore: result.score,
        fraudFlags: result.flags,
        updatedAt: new Date(),
      })
      .where(eq(attempts.id, attemptId));

    if (result.score >= config.FRAUD_BLOCK_THRESHOLD) {
      await db.update(attempts).set({ status: 'blocked' }).where(eq(attempts.id, attemptId));
    } else if (result.score >= config.FRAUD_FLAG_THRESHOLD) {
      await db.update(attempts).set({ status: 'flagged' }).where(eq(attempts.id, attemptId));
    }

    return { score: result.score, flags: result.flags };
  },
  { connection, prefix, concurrency: 5 }
);

fraudWorker.on('completed', (job, result) => {
  logger.info({ jobId: job.id, result }, 'fraud job completed');
});
fraudWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'fraud job failed');
});

// ============================================================
// MAILINGS
// ============================================================

const mailingsWorker = new Worker(
  'mailings',
  async (job: Job) => {
    const { mailingId } = job.data as { mailingId: string };
    logger.info({ mailingId, jobId: job.id }, 'mailings worker: processing');
    return processMailing(mailingId);
  },
  { connection, prefix, concurrency: 2 }
);

mailingsWorker.on('completed', (job, result) => {
  logger.info({ jobId: job.id, result }, 'mailing job completed');
});
mailingsWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'mailing job failed');
});

// ============================================================
// REMINDERS
// ============================================================

const remindersWorker = new Worker(
  'reminders',
  async (job: Job) => {
    const { subscriptionId } = job.data as { subscriptionId: string };

    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId))
      .limit(1);

    if (!sub || sub.status !== 'active' || !sub.autoRenew) return;
    if (!sub.currentPeriodEnd) return;

    const [plan] = await db.select().from(plans).where(eq(plans.id, sub.planId)).limit(1);

    const daysLeft = Math.ceil(
      (sub.currentPeriodEnd.getTime() - Date.now()) / (24 * 3600 * 1000)
    );
    if (daysLeft > 3 || daysLeft < 0) return;

    await createNotification({
      userId: sub.parentId,
      type: 'subscription_expiring',
      title: `Списание ${plan?.priceRub ?? 190} ₽ через ${daysLeft} дн.`,
      body: 'Проверьте, что карта активна. Отключить автопродление можно в личном кабинете.',
      link: link.payments(),
    });

    logger.info({ subscriptionId, daysLeft }, 'reminder sent');
  },
  { connection, prefix, concurrency: 5 }
);

remindersWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'reminder job failed');
});

// ============================================================
// PAYMENTS
// ============================================================

const paymentsWorker = new Worker(
  'payments',
  async (job: Job) => {
    const { subscriptionId } = job.data as { subscriptionId: string };
    logger.info(
      { subscriptionId, jobId: job.id, name: job.name },
      'payments worker: processing'
    );

    try {
      const payment = await chargeRecurrent(subscriptionId);
      return { paymentId: payment.id, status: payment.status };
    } catch (err) {
      logger.error({ err, subscriptionId }, 'recurrent charge failed');
      throw err;
    }
  },
  { connection, prefix, concurrency: 3 }
);

paymentsWorker.on('completed', (job, result) => {
  logger.info({ jobId: job.id, result }, 'recurrent charge completed');
});
paymentsWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'recurrent charge job failed');
});

// ============================================================
// NOTIFICATIONS — доставка email по типу
// ============================================================

interface NotificationJobData {
  notificationId: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  emailFallback: boolean;
  meta: Record<string, unknown>;
}

const notificationsWorker = new Worker(
  'notifications',
  async (job: Job) => {
    const data = job.data as NotificationJobData;
    if (!data.emailFallback) return { delivered: false, reason: 'no_email_requested' };

    const [user] = await db
      .select({ id: users.id, email: users.email, status: users.status })
      .from(users)
      .where(eq(users.id, data.userId))
      .limit(1);

    if (!user || user.status !== 'active' || !user.email) {
      return { delivered: false, reason: 'no_email' };
    }

    try {
      await sendMail({
        to: user.email,
        subject: data.title,
        html: renderNotificationEmail(data),
      });
      return { delivered: true };
    } catch (err) {
      logger.error({ err, userId: data.userId, type: data.type }, 'notification email failed');
      throw err;
    }
  },
  { connection, prefix, concurrency: 5 }
);

notificationsWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'notification job failed');
});

function renderNotificationEmail(data: NotificationJobData): string {
  const linkHtml = data.link
    ? `<p><a href="${escapeHtml(data.link)}">Открыть в личном кабинете</a></p>`
    : '';
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #1F2A17;">${escapeHtml(data.title)}</h2>
      ${data.body ? `<p style="color: #4A5840; line-height: 1.6;">${escapeHtml(data.body)}</p>` : ''}
      ${linkHtml}
      <hr style="border: 0; border-top: 1px solid #E5DCC5; margin: 24px 0;" />
      <p style="font-size: 12px; color: #8A9682;">
        Вы получили это письмо, потому что зарегистрированы на платформе «Улыбка ребёнка».
      </p>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// SCHEDULER — repeatable jobs для обслуживания БД
// ============================================================

interface SchedulerJob {
  name: string;
  every: number;
  handler: () => Promise<{ processed: number }>;
}

const schedulerJobs: SchedulerJob[] = [
  {
    name: 'abandon-stale-attempts',
    every: 5 * 60 * 1000,
    handler: async () => {
      const cutoff = new Date(Date.now() - 30 * 60 * 1000);
      const result = await db
        .update(attempts)
        .set({
          status: 'abandoned',
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(eq(attempts.status, 'in_progress'), lt(attempts.startedAt, cutoff))
        )
        .returning({ id: attempts.id });

      if (result.length > 0) {
        logger.info({ count: result.length }, 'scheduler: abandoned stale attempts');
      }
      return { processed: result.length };
    },
  },
  {
    name: 'expire-redemptions',
    every: 10 * 60 * 1000,
    handler: async () => {
      const result = await db
        .update(redemptions)
        .set({ status: 'expired' })
        .where(
          and(
            eq(redemptions.status, 'issued'),
            lt(redemptions.expiresAt, new Date())
          )
        )
        .returning({ id: redemptions.id });

      if (result.length > 0) {
        logger.info({ count: result.length }, 'scheduler: expired redemptions');
      }
      return { processed: result.length };
    },
  },
  {
    name: 'past-due-subscriptions',
    every: 30 * 60 * 1000,
    handler: async () => {
      const now = new Date();
      const result = await db
        .update(subscriptions)
        .set({ status: 'past_due', updatedAt: now })
        .where(
          and(
            eq(subscriptions.status, 'active'),
            eq(subscriptions.autoRenew, true),
            lt(subscriptions.currentPeriodEnd, now)
          )
        )
        .returning({ id: subscriptions.id, parentId: subscriptions.parentId });

      for (const sub of result) {
        await createNotification({
          userId: sub.parentId,
          type: 'subscription_past_due',
          title: 'Подписка просрочена',
          body: 'Проверьте карту и попробуйте снова.',
          link: link.payments(),
        });
      }

      if (result.length > 0) {
        logger.info({ count: result.length }, 'scheduler: marked past_due');
      }
      return { processed: result.length };
    },
  },
  {
    name: 'cleanup-password-resets',
    every: 60 * 60 * 1000,
    handler: async () => {
      const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
      const result = await db
        .delete(passwordResets)
        .where(
          and(
            lt(passwordResets.expiresAt, cutoff),
            sql`${passwordResets.usedAt} IS NOT NULL`
          )
        )
        .returning({ id: passwordResets.id });

      return { processed: result.length };
    },
  },
];

const schedulerWorker = new Worker(
  'scheduler',
  async (job: Job) => {
    const name = job.name;
    const found = schedulerJobs.find((j) => j.name === name);
    if (!found) {
      logger.warn({ name }, 'scheduler: unknown job');
      return { processed: 0 };
    }
    logger.info({ name }, 'scheduler: running');
    return found.handler();
  },
  { connection, prefix, concurrency: 1 }
);

schedulerWorker.on('completed', (job, result) => {
  if (result && (result as { processed: number }).processed > 0) {
    logger.info({ jobId: job.id, result }, 'scheduler job completed');
  }
});
schedulerWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'scheduler job failed');
});

async function registerSchedulerJobs(): Promise<void> {
  for (const job of schedulerJobs) {
    await schedulerQueue.add(job.name, {}, {
      repeat: { every: job.every },
      jobId: `repeat:${job.name}`,
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }
  logger.info({ count: schedulerJobs.length }, 'scheduler jobs registered');
}

// ============================================================
// SHUTDOWN
// ============================================================

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'worker shutdown');
  await Promise.all([
    fraudWorker.close(),
    mailingsWorker.close(),
    remindersWorker.close(),
    paymentsWorker.close(),
    notificationsWorker.close(),
    schedulerWorker.close(),
  ]);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

void registerSchedulerJobs().catch((err) =>
  logger.error({ err }, 'failed to register scheduler jobs')
);

logger.info('workers started');

void inArray;