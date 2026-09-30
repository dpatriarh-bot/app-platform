// ============================================================
// charity/service.ts — благотворительность и донаты
// ============================================================

import { eq, and, desc, sql, count } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  charitySettings,
  donations,
  children,
  type CharitySettings,
  type Donation,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { writeAudit } from '../audit/service.js';
import { awardPoints } from '../points/service.js';
import { createNotification } from '../notifications/service.js';
import { link } from '../../lib/links.js';
import { getPaymentProvider } from '../payments/provider.js';
import { config } from '../../config.js';

const MIN_DONATION_RUB = 100;
const MAX_DONATION_RUB = 500000;

export async function getSettings(): Promise<CharitySettings> {
  const [row] = await db
    .select()
    .from(charitySettings)
    .where(eq(charitySettings.id, 1))
    .limit(1);

  if (!row) {
    throw new AppError('CHARITY_NOT_CONFIGURED', 'Настройки благотворительности не заданы', 500);
  }
  return row;
}

export interface DonationPublic {
  id: string;
  amountRub: number;
  cashbackRub: number;
  cashbackPoints: number;
  status: Donation['status'];
  provider: string;
  confirmationUrl: string | null;
  paidAt: Date | null;
  createdAt: Date;
}

export async function createDonation(
  parentId: string,
  amountRub: number,
  childId: string | null
): Promise<DonationPublic> {
  if (amountRub < MIN_DONATION_RUB || amountRub > MAX_DONATION_RUB) {
    throw new AppError(
      'INVALID_AMOUNT',
      `Сумма доната должна быть от ${MIN_DONATION_RUB} до ${MAX_DONATION_RUB} ₽`,
      400
    );
  }

  const settings = await getSettings();
  const cashbackRub = Math.floor((amountRub * settings.cashbackPercent) / 100);
  const cashbackPoints = cashbackRub;

  const provider = getPaymentProvider();
  const idempotencyKey = `donation:${parentId}:${Date.now()}`;

  const isStub = config.PAYMENT_PROVIDER === 'stub';
  const status: Donation['status'] = isStub ? 'succeeded' : 'pending';

  const [donation] = await db
    .insert(donations)
    .values({
      parentId,
      amountRub,
      cashbackRub,
      cashbackPoints,
      status,
      provider: provider.name,
      providerPaymentId: isStub ? `stub_don_${Date.now()}` : null,
      idempotencyKey,
      paidAt: isStub ? new Date() : null,
    })
    .returning();

  if (isStub && childId) {
    try {
      await awardPoints({
        childId,
        delta: cashbackPoints,
        reason: 'donation_cashback',
        description: `Кешбэк ${settings.cashbackPercent}% за благотворительный взнос`,
        idempotencyKey: `donation:${donation!.id}:cashback`,
      });

      const [child] = await db
        .select({ parentId: children.parentId })
        .from(children)
        .where(eq(children.id, childId))
        .limit(1);

      if (child) {
        await createNotification({
          userId: child.parentId,
          type: 'points_awarded',
          title: `Кешбэк за благотворительность`,
          body: `+${cashbackPoints} трудокоинов за донат ${amountRub} ₽`,
          link: link.catalog(),
        });
      }
    } catch (err) {
      logger.error({ err, donationId: donation!.id }, 'cashback failed');
    }
  }

  await writeAudit({
    actorId: parentId,
    action: 'charity.donate',
    entity: 'donation',
    entityId: donation!.id,
    after: { amountRub, cashbackRub, cashbackPoints, childId },
  });

  logger.info({ parentId, amountRub, donationId: donation!.id }, 'donation created');

  return {
    id: donation!.id,
    amountRub: donation!.amountRub,
    cashbackRub: donation!.cashbackRub,
    cashbackPoints: donation!.cashbackPoints,
    status: donation!.status,
    provider: donation!.provider,
    confirmationUrl: null,
    paidAt: donation!.paidAt,
    createdAt: donation!.createdAt,
  };
}

export async function listDonations(
  parentId: string,
  limit = 50,
  offset = 0
): Promise<{ items: DonationPublic[]; total: number }> {
  const [items, totalRow] = await Promise.all([
    db
      .select()
      .from(donations)
      .where(eq(donations.parentId, parentId))
      .orderBy(desc(donations.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ c: count() })
      .from(donations)
      .where(eq(donations.parentId, parentId)),
  ]);

  return {
    items: items.map((d) => ({
      id: d.id,
      amountRub: d.amountRub,
      cashbackRub: d.cashbackRub,
      cashbackPoints: d.cashbackPoints,
      status: d.status,
      provider: d.provider,
      confirmationUrl: null,
      paidAt: d.paidAt,
      createdAt: d.createdAt,
    })),
    total: Number(totalRow[0]?.c ?? 0),
  };
}

export interface CharityStats {
  totalDonationsRub: number;
  totalCashbackRub: number;
  donorsCount: number;
  sharePercent: number;
  cashbackPercent: number;
}

export async function getStats(): Promise<CharityStats> {
  const settings = await getSettings();

  const [sumRow] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${donations.amountRub}), 0)::int`,
      cashback: sql<number>`COALESCE(SUM(${donations.cashbackRub}), 0)::int`,
    })
    .from(donations)
    .where(eq(donations.status, 'succeeded'));

  const [donorsRow] = await db
    .select({ c: sql<number>`COUNT(DISTINCT ${donations.parentId})::int` })
    .from(donations)
    .where(eq(donations.status, 'succeeded'));

  return {
    totalDonationsRub: sumRow?.total ?? 0,
    totalCashbackRub: sumRow?.cashback ?? 0,
    donorsCount: donorsRow?.c ?? 0,
    sharePercent: settings.sharePercent,
    cashbackPercent: settings.cashbackPercent,
  };
}