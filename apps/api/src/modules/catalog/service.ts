// ============================================================
// catalog/service.ts — каталог подарков и обмен баллов
// Исправлено: синтаксис getOffer, race на promo_codes через
// FOR UPDATE SKIP LOCKED.
// ============================================================

import { eq, and, isNull, ilike, sql, desc, asc, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  partnerOffers,
  partners,
  redemptions,
  promoCodeBatches,
  promoCodes,
  children,
  childBalances,
  type PartnerOffer,
  type Redemption,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { redis } from '../../lib/redis.js';
import { randomToken } from '../../lib/crypto.js';
import { SignJWT } from 'jose';
import { config } from '../../config.js';
import { writeAudit } from '../audit/service.js';
import { createNotification } from '../notifications/service.js';
import { awardPoints } from '../points/service.js';
import { link } from '../../lib/links.js';
import type { RedeemInput, CatalogQuery, RedemptionsQuery } from './schemas.js';

const QR_TTL_SEC = 600;
const REDEMPTION_TTL_HOURS = 72;

// ============================================================
// Каталог
// ============================================================

export interface CatalogOffer {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  costPoints: number;
  stock: number | null;
  terms: string | null;
  redemptionType: PartnerOffer['redemptionType'];
  partnerId: string;
  partnerName: string;
  partnerSlug: string;
  partnerLogoUrl: string | null;
  totalRedeemed: number;
  validUntil: Date | null;
}

export async function listCatalog(query: CatalogQuery): Promise<CatalogOffer[]> {
  const conditions = [
    eq(partnerOffers.status, 'published'),
    eq(partners.status, 'active'),
  ];

  if (query.partnerId) conditions.push(eq(partnerOffers.partnerId, query.partnerId));
  if (query.q) conditions.push(ilike(partnerOffers.title, `%${query.q}%`));
  if (query.maxCost !== undefined) {
    conditions.push(sql`${partnerOffers.costPoints} <= ${query.maxCost}`);
  }

  const rows = await db
    .select({ offer: partnerOffers, partner: partners })
    .from(partnerOffers)
    .innerJoin(partners, eq(partners.id, partnerOffers.partnerId))
    .where(and(...conditions))
    .orderBy(asc(partnerOffers.costPoints), desc(partnerOffers.createdAt))
    .limit(query.limit)
    .offset(query.offset);

  return rows.map((r) => ({
    id: r.offer.id,
    title: r.offer.title,
    description: r.offer.description,
    imageUrl: r.offer.imageUrl,
    costPoints: r.offer.costPoints,
    stock: r.offer.stock,
    terms: r.offer.terms,
    redemptionType: r.offer.redemptionType,
    partnerId: r.partner.id,
    partnerName: r.partner.name,
    partnerSlug: r.partner.slug,
    partnerLogoUrl: r.partner.logoUrl,
    totalRedeemed: r.offer.totalRedeemed,
    validUntil: r.offer.validUntil,
  }));
}

export async function getOffer(id: string): Promise<CatalogOffer> {
  const [row] = await db
    .select({ offer: partnerOffers, partner: partners })
    .from(partnerOffers)
    .innerJoin(partners, eq(partners.id, partnerOffers.partnerId))
    .where(eq(partnerOffers.id, id))
    .limit(1);

  if (!row) throw new AppError('NOT_FOUND', 'Подарок не найден', 404);

  return {
    id: row.offer.id,
    title: row.offer.title,
    description: row.offer.description,
    imageUrl: row.offer.imageUrl,
    costPoints: row.offer.costPoints,
    stock: row.offer.stock,
    terms: row.offer.terms,
    redemptionType: row.offer.redemptionType,
    partnerId: row.partner.id,
    partnerName: row.partner.name,
    partnerSlug: row.partner.slug,
    partnerLogoUrl: row.partner.logoUrl,
    totalRedeemed: row.offer.totalRedeemed,
    validUntil: row.offer.validUntil,
  };
}

// ============================================================
// Обмен баллов
// ============================================================

export interface RedeemResult {
  redemptionId: string;
  status: Redemption['status'];
  redemptionType: Redemption['redemptionType'];
  code: string | null;
  qrToken: string | null;
  qrImageDataUrl: string | null;
  pointsSpent: number;
  balanceAfter: number;
  expiresAt: Date;
  offer: { id: string; title: string; partnerName: string };
}

export async function redeem(
  parentId: string,
  input: RedeemInput
): Promise<RedeemResult> {
  const [child] = await db
    .select()
    .from(children)
    .where(
      and(
        eq(children.id, input.childId),
        eq(children.parentId, parentId),
        isNull(children.deletedAt)
      )
    )
    .limit(1);

  if (!child) throw new AppError('NOT_FOUND', 'Ребёнок не найден', 404);

  const offer = await getOffer(input.offerId);
  if (offer.validUntil && offer.validUntil < new Date()) {
    throw new AppError('OFFER_EXPIRED', 'Подарок больше не доступен', 400);
  }
  if (offer.stock !== null && offer.stock <= 0) {
    throw new AppError('OUT_OF_STOCK', 'Подарок закончился', 400);
  }

  const [balanceRow] = await db
    .select()
    .from(childBalances)
    .where(eq(childBalances.childId, input.childId))
    .limit(1);

  const balance = balanceRow?.balance ?? 0;
  if (balance < offer.costPoints) {
    throw new AppError(
      'INSUFFICIENT_POINTS',
      `Не хватает ${offer.costPoints - balance} баллов`,
      400
    );
  }

  const redemptionType = input.redemptionType ?? offer.redemptionType;
  const idempotencyKey = `redeem:${input.childId}:${offer.id}:${Date.now()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REDEMPTION_TTL_HOURS * 3600 * 1000);

  let code: string | null = null;
  let qrNonce: string | null = null;

  const result = await db.transaction(async (tx) => {
    if (redemptionType === 'promo') {
      code = await reservePromoCode(tx, offer);
    } else if (redemptionType === 'qr') {
      qrNonce = randomToken(16);
    } else {
      code = generateHumanCode();
    }

    const [redemption] = await tx
      .insert(redemptions)
      .values({
        childId: input.childId,
        offerId: offer.id,
        partnerId: offer.partnerId,
        redemptionType,
        status: 'issued',
        code,
        qrToken: null,
        qrNonce,
        pointsSpent: offer.costPoints,
        idempotencyKey,
        expiresAt,
      })
      .returning();

    await tx
      .update(partnerOffers)
      .set({
        totalRedeemed: sql`${partnerOffers.totalRedeemed} + 1`,
        stock: offer.stock !== null ? sql`GREATEST(${partnerOffers.stock} - 1, 0)` : null,
        updatedAt: new Date(),
      })
      .where(eq(partnerOffers.id, offer.id));

    return redemption!;
  });

  let balanceAfter = balance;
  try {
    const awardResult = await awardPoints({
      childId: input.childId,
      delta: -offer.costPoints,
      reason: 'redemption',
      description: `Обмен на «${offer.title}» (${offer.partnerName})`,
      redemptionId: result.id,
      idempotencyKey: `redemption:${result.id}:spend`,
    });
    balanceAfter = awardResult.balanceAfter;
  } catch (err) {
    await db
      .update(redemptions)
      .set({ status: 'canceled', canceledAt: new Date(), cancelReason: 'spend_failed' })
      .where(eq(redemptions.id, result.id));
    if (err instanceof AppError) throw err;
    throw new AppError('INTERNAL', 'Не удалось списать баллы', 500);
  }

  let qrToken: string | null = null;
  let qrImageDataUrl: string | null = null;

  if (redemptionType === 'qr' && qrNonce) {
    qrToken = await signQrToken({
      redemptionId: result.id,
      childId: input.childId,
      offerId: offer.id,
      partnerId: offer.partnerId,
      nonce: qrNonce,
    });

    await db
      .update(redemptions)
      .set({ qrToken })
      .where(eq(redemptions.id, result.id));

    qrImageDataUrl = await buildQrDataUrl(qrToken);
  }

  await createNotification({
    userId: parentId,
    type: 'redemption_issued',
    title: `Подарок получен: ${offer.title}`,
    body: `Списано ${offer.costPoints} баллов. Покажите код сотруднику «${offer.partnerName}».`,
    link: link.catalogRedemptions(),
  });

  await redis.del(`balance:${input.childId}`);

  await writeAudit({
    actorId: parentId,
    action: 'catalog.redeem',
    entity: 'redemption',
    entityId: result.id,
    after: {
      offerId: offer.id,
      childId: input.childId,
      pointsSpent: offer.costPoints,
      redemptionType,
    },
  });

  logger.info(
    { redemptionId: result.id, childId: input.childId, offerId: offer.id },
    'redemption issued'
  );

  return {
    redemptionId: result.id,
    status: result.status,
    redemptionType,
    code,
    qrToken,
    qrImageDataUrl,
    pointsSpent: offer.costPoints,
    balanceAfter,
    expiresAt,
    offer: { id: offer.id, title: offer.title, partnerName: offer.partnerName },
  };
}

async function reservePromoCode(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  offer: CatalogOffer
): Promise<string> {
  const [batch] = await tx
    .select()
    .from(promoCodeBatches)
    .where(eq(promoCodeBatches.partnerId, offer.partnerId))
    .orderBy(desc(promoCodeBatches.createdAt))
    .limit(1);

  if (batch) {
    const rows = await tx.execute<{ id: string; code: string }>(sql`
      SELECT id, code FROM promo_codes
      WHERE batch_id = ${batch.id}
        AND used_at IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);

    const free = rows[0];
    if (free) {
      await tx
        .update(promoCodes)
        .set({ usedAt: new Date() })
        .where(eq(promoCodes.id, free.id));
      return free.code;
    }
  }

  return generateHumanCode();
}

// ============================================================
// История обменов
// ============================================================

export interface RedemptionPublic {
  id: string;
  status: Redemption['status'];
  redemptionType: Redemption['redemptionType'];
  code: string | null;
  pointsSpent: number;
  expiresAt: Date;
  redeemedAt: Date | null;
  createdAt: Date;
  offer: { id: string; title: string; imageUrl: string | null };
  partner: { id: string; name: string; slug: string };
}

export async function listRedemptions(
  parentId: string,
  query: RedemptionsQuery
): Promise<{ items: RedemptionPublic[]; total: number }> {
  const kids = await db
    .select({ id: children.id })
    .from(children)
    .where(and(eq(children.parentId, parentId), isNull(children.deletedAt)));

  if (kids.length === 0) return { items: [], total: 0 };

  const childIds = kids.map((k) => k.id);

  const conditions = [inArray(redemptions.childId, childIds)];
  if (query.childId) conditions.push(eq(redemptions.childId, query.childId));
  if (query.status) conditions.push(eq(redemptions.status, query.status));

  const where = and(...conditions);

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        redemption: redemptions,
        offer: partnerOffers,
        partner: partners,
      })
      .from(redemptions)
      .leftJoin(partnerOffers, eq(partnerOffers.id, redemptions.offerId))
      .leftJoin(partners, eq(partners.id, redemptions.partnerId))
      .where(where)
      .orderBy(desc(redemptions.createdAt))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(redemptions).where(where),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.redemption.id,
      status: r.redemption.status,
      redemptionType: r.redemption.redemptionType,
      code: r.redemption.code,
      pointsSpent: r.redemption.pointsSpent,
      expiresAt: r.redemption.expiresAt,
      redeemedAt: r.redemption.redeemedAt,
      createdAt: r.redemption.createdAt,
      offer: {
        id: r.offer?.id ?? '',
        title: r.offer?.title ?? '',
        imageUrl: r.offer?.imageUrl ?? null,
      },
      partner: {
        id: r.partner?.id ?? '',
        name: r.partner?.name ?? '',
        slug: r.partner?.slug ?? '',
      },
    })),
    total: totalRow[0]?.count ?? 0,
  };
}

export async function getRedemption(
  parentId: string,
  redemptionId: string
): Promise<RedemptionPublic & { qrImageDataUrl: string | null; qrExpiresAt: Date | null }> {
  const kids = await db    .select({ id: children.id })
    .from(children)
    .where(and(eq(children.parentId, parentId), isNull(children.deletedAt)));

  if (kids.length === 0) throw new AppError('NOT_FOUND', 'Обмен не найден', 404);

  const childIds = kids.map((k) => k.id);

  const [row] = await db
    .select({
      redemption: redemptions,
      offer: partnerOffers,
      partner: partners,
    })
    .from(redemptions)
    .leftJoin(partnerOffers, eq(partnerOffers.id, redemptions.offerId))
    .leftJoin(partners, eq(partners.id, redemptions.partnerId))
    .where(
      and(
        eq(redemptions.id, redemptionId),
        inArray(redemptions.childId, childIds)
      )
    )
    .limit(1);

  if (!row) throw new AppError('NOT_FOUND', 'Обмен не найден', 404);

  let qrImageDataUrl: string | null = null;
  let qrExpiresAt: Date | null = null;

  if (row.redemption.redemptionType === 'qr' && row.redemption.qrToken) {
    const ageSec = (Date.now() - row.redemption.createdAt.getTime()) / 1000;
    if (ageSec < QR_TTL_SEC) {
      qrImageDataUrl = await buildQrDataUrl(row.redemption.qrToken);
      qrExpiresAt = new Date(row.redemption.createdAt.getTime() + QR_TTL_SEC * 1000);
    }
  }

  return {
    id: row.redemption.id,
    status: row.redemption.status,
    redemptionType: row.redemption.redemptionType,
    code: row.redemption.code,
    pointsSpent: row.redemption.pointsSpent,
    expiresAt: row.redemption.expiresAt,
    redeemedAt: row.redemption.redeemedAt,
    createdAt: row.redemption.createdAt,
    offer: {
      id: row.offer?.id ?? '',
      title: row.offer?.title ?? '',
      imageUrl: row.offer?.imageUrl ?? null,
    },
    partner: {
      id: row.partner?.id ?? '',
      name: row.partner?.name ?? '',
      slug: row.partner?.slug ?? '',
    },
    qrImageDataUrl,
    qrExpiresAt,
  };
}

// ============================================================
// Helpers
// ============================================================

async function signQrToken(payload: {
  redemptionId: string;
  childId: string;
  offerId: string;
  partnerId: string;
  nonce: string;
}): Promise<string> {
  const key = new TextEncoder().encode(config.JWT_ACCESS_SECRET);

  return new SignJWT({
    typ: 'qr',
    redemptionId: payload.redemptionId,
    childId: payload.childId,
    offerId: payload.offerId,
    partnerId: payload.partnerId,
    nonce: payload.nonce,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer(config.JWT_ISSUER)
    .setAudience('ulybka-partners')
    .setExpirationTime(`${QR_TTL_SEC}s`)
    .sign(key);
}

async function buildQrDataUrl(text: string): Promise<string | null> {
  try {
    const QR = await import('qrcode');
    return await QR.toDataURL(text, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
      color: { dark: '#1F2A17', light: '#FFFFFF' },
    });
  } catch (err) {
    logger.error({ err }, 'failed to build QR');
    return null;
  }
}

function generateHumanCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const parts: string[] = [];
  for (let p = 0; p < 3; p++) {
    let chunk = '';
    for (let i = 0; i < 4; i++) {
      chunk += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    parts.push(chunk);
  }
  return parts.join('-');
}