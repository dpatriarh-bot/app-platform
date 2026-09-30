// ============================================================
// partners/partner-portal.ts — роуты кабинета партнёра
// Префикс: /api/v1/partner
// Доступно только пользователям с ролью role='partner'.
// Показывает офферы партнёра, обмены, статистику.
// ============================================================

import type { FastifyInstance } from 'fastify';
import { eq, and, desc, sql, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  partners,
  partnerOffers,
  redemptions,
  children,
  type Partner,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { decryptPII } from '../../lib/crypto.js';

export default async function partnerPortalRoutes(app: FastifyInstance): Promise<void> {
  // Все роуты требуют роль partner
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireRole('partner'));

  // -------- Профиль партнёра + статистика --------
  app.get('/me', async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    const partner = await loadPartnerForUser(req.user.partnerId);
    if (!partner) {
      throw new AppError(
        'PARTNER_NOT_LINKED',
        'Аккаунт партнёра не привязан к партнёрской организации',
        400
      );
    }

    const stats = await getPartnerStats(partner.id);

    return reply.send({
      partner: {
        id: partner.id,
        slug: partner.slug,
        name: partner.name,
        description: partner.description,
        logoUrl: partner.logoUrl,
        websiteUrl: partner.websiteUrl,
        contactName: partner.contactName,
        contactEmail: partner.contactEmail,
        contactPhone: partner.contactPhone,
        status: partner.status,
      },
      stats,
    });
  });

  // -------- Офферы партнёра --------
  app.get('/offers', async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    const partner = await loadPartnerForUser(req.user.partnerId);
    if (!partner) {
      throw new AppError('PARTNER_NOT_LINKED', 'Партнёр не привязан', 400);
    }

    const q = req.query as { status?: string; limit?: string; offset?: string };
    const limit = Math.min(parseInt(q.limit ?? '100', 10) || 100, 200);
    const offset = parseInt(q.offset ?? '0', 10) || 0;

    const conditions = [eq(partnerOffers.partnerId, partner.id)];
    if (q.status) {
      conditions.push(eq(partnerOffers.status, q.status as never));
    }

    const items = await db
      .select()
      .from(partnerOffers)
      .where(and(...conditions))
      .orderBy(desc(partnerOffers.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(partnerOffers)
      .where(and(...conditions));

    return reply.send({
      items: items.map((o) => ({
        id: o.id,
        title: o.title,
        description: o.description,
        imageUrl: o.imageUrl,
        costPoints: o.costPoints,
        stock: o.stock,
        terms: o.terms,
        redemptionType: o.redemptionType,
        status: o.status,
        validFrom: o.validFrom,
        validUntil: o.validUntil,
        totalRedeemed: o.totalRedeemed,
        createdAt: o.createdAt,
      })),
      total: totalRow?.count ?? 0,
    });
  });

  // -------- Обмены партнёра --------
  app.get('/redemptions', async (req, reply) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

    const partner = await loadPartnerForUser(req.user.partnerId);
    if (!partner) {
      throw new AppError('PARTNER_NOT_LINKED', 'Партнёр не привязан', 400);
    }

    const q = req.query as { status?: string; limit?: string; offset?: string };
    const limit = Math.min(parseInt(q.limit ?? '100', 10) || 100, 200);
    const offset = parseInt(q.offset ?? '0', 10) || 0;

    const conditions = [eq(redemptions.partnerId, partner.id)];
    if (q.status) {
      conditions.push(eq(redemptions.status, q.status as never));
    }

    const rows = await db
      .select({
        redemption: redemptions,
        offer: partnerOffers,
        childNameEnc: children.fullNameEnc,
      })
      .from(redemptions)
      .leftJoin(partnerOffers, eq(partnerOffers.id, redemptions.offerId))
      .leftJoin(children, eq(children.id, redemptions.childId))
      .where(and(...conditions))
      .orderBy(desc(redemptions.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(redemptions)
      .where(and(...conditions));

    return reply.send({
      items: rows.map((r) => {
        const fullName = r.childNameEnc ? decryptPII(r.childNameEnc) ?? '' : '';
        return {
          id: r.redemption.id,
          status: r.redemption.status,
          redemptionType: r.redemption.redemptionType,
          code: r.redemption.code,
          pointsSpent: r.redemption.pointsSpent,
          expiresAt: r.redemption.expiresAt,
          redeemedAt: r.redemption.redeemedAt,
          partnerAckAt: r.redemption.partnerAckAt,
          createdAt: r.redemption.createdAt,
          childNameMasked: maskName(fullName),
          offer: {
            id: r.offer?.id ?? '',
            title: r.offer?.title ?? '—',
            imageUrl: r.offer?.imageUrl ?? null,
          },
        };
      }),
      total: totalRow?.count ?? 0,
    });
  });

  // -------- Отметить обмен как полученный --------
  app.post<{ Params: { redemptionId: string } }>(
    '/redemptions/:redemptionId/mark-redeemed',
    async (req, reply) => {
      if (!req.user) throw new AppError('UNAUTHORIZED', 'Требуется авторизация', 401);

      const partner = await loadPartnerForUser(req.user.partnerId);
      if (!partner) throw new AppError('PARTNER_NOT_LINKED', 'Партнёр не привязан', 400);

      const [redemption] = await db
        .select()
        .from(redemptions)
        .where(eq(redemptions.id, req.params.redemptionId))
        .limit(1);

      if (!redemption) throw new AppError('NOT_FOUND', 'Обмен не найден', 404);
      if (redemption.partnerId !== partner.id) {
        throw new AppError('FORBIDDEN', 'Обмен относится к другому партнёру', 403);
      }
      if (redemption.status === 'redeemed') {
        throw new AppError('ALREADY_REDEEMED', 'Подарок уже отмечен полученным', 409);
      }
      if (redemption.status !== 'issued') {
        throw new AppError('INVALID_STATUS', 'Обмен неактивен', 400);
      }

      await db
        .update(redemptions)
        .set({
          status: 'redeemed',
          redeemedAt: new Date(),
          partnerAckAt: new Date(),
        })
        .where(eq(redemptions.id, redemption.id));

      return reply.send({ ok: true });
    }
  );
}

// ============================================================
// Хелперы
// ============================================================

async function loadPartnerForUser(partnerId: string | null): Promise<Partner | null> {
  if (!partnerId) return null;
  const [p] = await db
    .select()
    .from(partners)
    .where(eq(partners.id, partnerId))
    .limit(1);
  return p ?? null;
}

export interface PartnerStatsPublic {
  totalOffers: number;
  activeOffers: number;
  totalRedemptions: number;
  redeemedCount: number;
  pendingCount: number;
  last30d: number;
  pointsSpentTotal: number;
}

async function getPartnerStats(partnerId: string): Promise<PartnerStatsPublic> {
  const [offersRow, redemptionsRow, last30Row, pointsRow] = await Promise.all([
    db.execute<{ total: number; active: number }>(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'published')::int AS active
      FROM partner_offers WHERE partner_id = ${partnerId}
    `),
    db.execute<{ total: number; redeemed: number; pending: number }>(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'redeemed')::int AS redeemed,
        COUNT(*) FILTER (WHERE status = 'issued')::int AS pending
      FROM redemptions WHERE partner_id = ${partnerId}
    `),
    db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count FROM redemptions
      WHERE partner_id = ${partnerId}
        AND created_at >= NOW() - INTERVAL '30 days'
    `),
    db.execute<{ total: number }>(sql`
      SELECT COALESCE(SUM(points_spent), 0)::int AS total
      FROM redemptions WHERE partner_id = ${partnerId}
    `),
  ]);

  return {
    totalOffers: offersRow[0]?.total ?? 0,
    activeOffers: offersRow[0]?.active ?? 0,
    totalRedemptions: redemptionsRow[0]?.total ?? 0,
    redeemedCount: redemptionsRow[0]?.redeemed ?? 0,
    pendingCount: redemptionsRow[0]?.pending ?? 0,
    last30d: last30Row[0]?.count ?? 0,
    pointsSpentTotal: pointsRow[0]?.total ?? 0,
  };
}

function maskName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts
    .map((p) => (p.length > 0 ? p[0] + '***' : ''))
    .join(' ');
}

// подавляем неиспользуемый импорт
void isNull;