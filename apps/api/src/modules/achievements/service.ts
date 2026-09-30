// ============================================================
// achievements/service.ts — ачивки и статусы детей
// ============================================================

import { eq, and, sql, desc, inArray, isNull, count } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  achievements,
  childAchievements,
  children,
  attempts,
  childBalances,
  type Achievement,
  type Child,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { awardPoints } from '../points/service.js';
import { createNotification } from '../notifications/service.js';
import { writeAudit } from '../audit/service.js';
import { link } from '../../lib/links.js';

export type ChildRank =
  | 'novice'
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'legend';

export interface RankInfo {
  code: ChildRank;
  title: string;
  icon: string;
  minScore: number;
  next?: { code: ChildRank; minScore: number; remaining: number };
}

const RANKS: Array<Omit<RankInfo, 'next'> & { minScore: number }> = [
  { code: 'novice', title: 'Новичок', icon: '🌱', minScore: 0 },
  { code: 'bronze', title: 'Бронза', icon: '🥉', minScore: 200 },
  { code: 'silver', title: 'Серебро', icon: '🥈', minScore: 700 },
  { code: 'gold', title: 'Золото', icon: '🥇', minScore: 2000 },
  { code: 'platinum', title: 'Платина', icon: '💎', minScore: 5000 },
  { code: 'legend', title: 'Легенда', icon: '👑', minScore: 12000 },
];

export function rankInfo(score: number): RankInfo {
  let current = RANKS[0]!;
  let next: RankInfo['next'];

  for (let i = 0; i < RANKS.length; i++) {
    const r = RANKS[i]!;
    if (score >= r.minScore) current = r;
    if (i + 1 < RANKS.length && score < RANKS[i + 1]!.minScore) {
      const n = RANKS[i + 1]!;
      next = { code: n.code, minScore: n.minScore, remaining: n.minScore - score };
      break;
    }
  }

  return {
    code: current.code,
    title: current.title,
    icon: current.icon,
    minScore: current.minScore,
    next,
  };
}

async function recomputeRankForChild(childId: string): Promise<ChildRank> {
  const [row] = await db
    .select({ earned: childBalances.lifetimeEarned })
    .from(childBalances)
    .where(eq(childBalances.childId, childId))
    .limit(1);

  const score = row?.earned ?? 0;
  const info = rankInfo(score);

  await db
    .update(children)
    .set({ rank: info.code, rankUpdatedAt: new Date(), updatedAt: new Date() })
    .where(eq(children.id, childId));

  return info.code;
}

export async function listAchievements(): Promise<Achievement[]> {
  return db
    .select()
    .from(achievements)
    .where(eq(achievements.isActive, true))
    .orderBy(achievements.sortOrder);
}

export interface ChildAchievementPublic {
  achievementId: string;
  code: string;
  kind: string;
  title: string;
  description: string | null;
  icon: string | null;
  rewardPoints: number;
  awardedAt: Date | null;
  rewardedAt: Date | null;
  pointsAwarded: number;
  awarded: boolean;
}

export async function listForChild(childId: string): Promise<ChildAchievementPublic[]> {
  const all = await listAchievements();

  const awarded = await db
    .select()
    .from(childAchievements)
    .where(eq(childAchievements.childId, childId));

  const awardedMap = new Map(awarded.map((a) => [a.achievementId, a]));

  return all.map((a) => {
    const ca = awardedMap.get(a.id);
    return {
      achievementId: a.id,
      code: a.code,
      kind: a.kind,
      title: a.title,
      description: a.description,
      icon: a.icon,
      rewardPoints: a.rewardPoints,
      awardedAt: ca?.awardedAt ?? null,
      rewardedAt: ca?.rewardedAt ?? null,
      pointsAwarded: ca?.pointsAwarded ?? 0,
      awarded: !!ca,
    };
  });
}

export async function grantAchievement(
  childId: string,
  code: string,
  meta?: Record<string, unknown>
): Promise<boolean> {
  const [ach] = await db
    .select()
    .from(achievements)
    .where(eq(achievements.code, code))
    .limit(1);

  if (!ach || !ach.isActive) return false;

  const [existing] = await db
    .select()
    .from(childAchievements)
    .where(
      and(
        eq(childAchievements.childId, childId),
        eq(childAchievements.achievementId, ach.id)
      )
    )
    .limit(1);

  if (existing) return false;

  let rewardPoints = ach.rewardPoints;
  let rewardedAt: Date | null = null;

  if (rewardPoints > 0) {
    try {
      await awardPoints({
        childId,
        delta: rewardPoints,
        reason: 'achievement_reward',
        description: `Ачивка: ${ach.title}`,
        idempotencyKey: `achievement:${ach.id}:${childId}`,
      });
      rewardedAt = new Date();
    } catch (err) {
      logger.error({ err, childId, code }, 'failed to award achievement points');
      rewardPoints = 0;
    }
  }

  await db.insert(childAchievements).values({
    childId,
    achievementId: ach.id,
    awardedAt: new Date(),
    rewardedAt,
    pointsAwarded: rewardPoints,
    meta: meta ?? null,
  });

  if (rewardedAt) {
    const [child] = await db
      .select({ parentId: children.parentId })
      .from(children)
      .where(eq(children.id, childId))
      .limit(1);

    if (child) {
      await createNotification({
        userId: child.parentId,
        type: 'points_awarded',
        title: `Новая ачивка: ${ach.title}`,
        body: `+${rewardPoints} трудокоинов`,
        link: link.catalog(),
      });
    }
  }

  await recomputeRankForChild(childId);

  logger.info({ childId, code, rewardPoints }, 'achievement granted');
  return true;
}

export async function checkMilestoneAchievements(childId: string): Promise<void> {
  const all = await db
    .select()
    .from(achievements)
    .where(and(eq(achievements.kind, 'milestone'), eq(achievements.isActive, true)));

  const awarded = await db
    .select({ achievementId: childAchievements.achievementId })
    .from(childAchievements)
    .where(eq(childAchievements.childId, childId));

  const awardedSet = new Set(awarded.map((a) => a.achievementId));

  for (const a of all) {
    if (awardedSet.has(a.id)) continue;

    const cond = a.condition as {
      type?: 'attempts_count' | 'correct_count' | 'perfect_score' | 'days_streak';
      value?: number;
    };

    if (!cond.type) continue;

    let triggered = false;

    if (cond.type === 'attempts_count') {
      const [row] = await db
        .select({ c: count() })
        .from(attempts)
        .where(and(eq(attempts.childId, childId), eq(attempts.status, 'finished')));
      triggered = (Number(row?.c ?? 0) >= (cond.value ?? 1));
    } else if (cond.type === 'correct_count') {
      const [row] = await db
        .select({ c: sql<number>`COALESCE(SUM(${attempts.correctCount}), 0)::int` })
        .from(attempts)
        .where(and(eq(attempts.childId, childId), eq(attempts.status, 'finished')));
      triggered = (Number(row?.c ?? 0) >= (cond.value ?? 1));
    } else if (cond.type === 'perfect_score') {
      const [row] = await db
        .select({ c: count() })
        .from(attempts)
        .where(
          and(
            eq(attempts.childId, childId),
            eq(attempts.status, 'finished'),
            sql`${attempts.percentCorrect} = 100`
          )
        );
      triggered = (Number(row?.c ?? 0) >= 1);
    }

    if (triggered) {
      await grantAchievement(childId, a.code);
    }
  }
}

export interface SocialLinkInput {
  platform: 'vk' | 'telegram' | 'youtube' | 'other';
  url?: string;
}

const SOCIAL_REWARDS: Record<SocialLinkInput['platform'], { code: string; points: number }> = {
  vk: { code: 'social_vk', points: 999 },
  telegram: { code: 'social_telegram', points: 499 },
  youtube: { code: 'social_youtube', points: 499 },
  other: { code: 'social_other', points: 99 },
};

export async function claimSocialAchievement(
  parentId: string,
  childId: string,
  input: SocialLinkInput
): Promise<{ granted: boolean; points: number; achievementCode: string }> {
  const [child] = await db
    .select()
    .from(children)
    .where(and(eq(children.id, childId), eq(children.parentId, parentId), isNull(children.deletedAt)))
    .limit(1);

  if (!child) throw new AppError('NOT_FOUND', 'Ребёнок не найден', 404);

  const reward = SOCIAL_REWARDS[input.platform];

  const [ach] = await db
    .select()
    .from(achievements)
    .where(eq(achievements.code, reward.code))
    .limit(1);

  if (!ach) {
    throw new AppError('ACHIEVEMENT_NOT_FOUND', 'Ачивка не настроена', 500);
  }

  const existing = await db
    .select()
    .from(childAchievements)
    .where(
      and(
        eq(childAchievements.childId, childId),
        eq(childAchievements.achievementId, ach.id)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return { granted: false, points: 0, achievementCode: reward.code };
  }

  const socialLinks = { ...(child.socialLinks ?? {}) };
  if (input.url) socialLinks[input.platform] = input.url;

  await db
    .update(children)
    .set({ socialLinks, updatedAt: new Date() })
    .where(eq(children.id, childId));

  await grantAchievement(childId, reward.code, { platform: input.platform, url: input.url });

  await writeAudit({
    actorId: parentId,
    action: 'achievement.social_claim',
    entity: 'child',
    entityId: childId,
    after: { platform: input.platform, url: input.url, points: reward.points },
  });

  return { granted: true, points: reward.points, achievementCode: reward.code };
}

export async function getRankForChild(childId: string): Promise<RankInfo> {
  const [row] = await db
    .select({ earned: childBalances.lifetimeEarned })
    .from(childBalances)
    .where(eq(childBalances.childId, childId))
    .limit(1);

  return rankInfo(row?.earned ?? 0);
}

export function allRanks(): RankInfo[] {
  return RANKS.map((r, i) => {
    const next = i + 1 < RANKS.length
      ? {
          code: RANKS[i + 1]!.code,
          minScore: RANKS[i + 1]!.minScore,
          remaining: RANKS[i + 1]!.minScore - r.minScore,
        }
      : undefined;
    return {
      code: r.code,
      title: r.title,
      icon: r.icon,
      minScore: r.minScore,
      next,
    };
  });
}
