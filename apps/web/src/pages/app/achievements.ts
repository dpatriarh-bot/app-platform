// ============================================================
// pages/app/achievements.ts — достижения, статусы и награды
// Hero-карточка статуса, анимированные карточки достижений,
// стилизованное вознаграждение, социальные награды.
// ============================================================

import { h, mount, clear } from '../../lib/dom.js';
import { icon, type IconName } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { store } from '../../lib/store.js';
import { router } from '../../lib/router.js';
import { appLayout, setRoot } from '../../components/layout.js';
import { emptyState, loader } from '../../components/ui.js';
import { childSwitcher } from '../../components/child-switcher.js';
import { saveChildId } from '../../lib/bootstrap.js';
import { toastSuccess, toastError } from '../../lib/toast.js';
import { formatDateShort } from '../../lib/format.js';

interface RankInfo {
  code: string;
  title: string;
  icon: string;
  minScore: number;
  next?: { code: string; minScore: number; remaining: number };
}

interface AchievementItem {
  achievementId: string;
  code: string;
  kind: string;
  title: string;
  description: string | null;
  icon: string | null;
  rewardPoints: number;
  awardedAt: string | null;
  rewardedAt: string | null;
  pointsAwarded: number;
  awarded: boolean;
}

const SOCIAL_LINKS: Array<{
  platform: 'vk' | 'telegram' | 'youtube';
  label: string;
  url: string;
  code: string;
  points: number;
  icon: IconName;
  color: string;
}> = [
  {
    platform: 'vk',
    label: 'ВКонтакте',
    url: 'https://vk.com/ulybka_rebenka',
    code: 'social_vk',
    points: 999,
    icon: 'users',
    color: '#4C75A3',
  },
  {
    platform: 'telegram',
    label: 'Telegram',
    url: 'https://t.me/ulybka_rebenka',
    code: 'social_telegram',
    points: 499,
    icon: 'send',
    color: '#0088CC',
  },
  {
    platform: 'youtube',
    label: 'YouTube',
    url: 'https://youtube.com/@ulybka_rebenka',
    code: 'social_youtube',
    points: 499,
    icon: 'play',
    color: '#FF0000',
  },
];

export async function renderAppAchievements(): Promise<void> {
  const root = h('div');
  setRoot(appLayout({
    active: 'achievements',
    title: 'Достижения',
    subtitle: 'Достижения, статус и награды за активность',
    content: root,
  }));
  mount(root, loader());

  try {
    const childrenRes = await api.get<{
      children: Array<{ id: string; fullName: string; grade: number | null; balance: number }>;
    }>('/me/children');

    const children = childrenRes.children;

    const saved = localStorage.getItem('ulybka:currentChildId');
    const stateBefore = store.getState();
    let currentId: string | null = null;

    if (stateBefore.currentChildId && children.some((c) => c.id === stateBefore.currentChildId)) {
      currentId = stateBefore.currentChildId;
    } else if (saved && children.some((c) => c.id === saved)) {
      currentId = saved;
    } else {
      currentId = children[0]?.id ?? null;
    }

    store.setState({ children, currentChildId: currentId });
    if (currentId) saveChildId(currentId);

    if (children.length === 0) {
      mount(root, emptyState({
        illustration: 'welcome',
        title: 'Сначала добавьте ребёнка',
        action: h('a', { class: 'btn', href: '#/app/profile?tab=children' }, 'Добавить ребёнка'),
      }));
      return;
    }

    const contentHost = h('div', { class: 'stack-lg' });

    const renderContent = async (): Promise<void> => {
      clear(contentHost);

      const state = store.getState();
      const child = state.children.find((c) => c.id === state.currentChildId) ?? null;
      if (!child) {
        mount(contentHost, emptyState({ illustration: 'empty', title: 'Выберите ребёнка' }));
        return;
      }

      const switcher = childSwitcher({
        children: state.children,
        currentChildId: state.currentChildId,
        onChange: (id) => {
          store.setState({ currentChildId: id });
          saveChildId(id);
          void renderContent();
        },
      });

      let achievements: AchievementItem[] = [];
      let rank: RankInfo | null = null;

      try {
        const res = await api.get<{ items: AchievementItem[]; rank: RankInfo }>(
          `/achievements/for-child/${encodeURIComponent(child.id)}`
        );
        achievements = res.items;
        rank = res.rank;
      } catch {
        // ignore
      }

      contentHost.appendChild(
        h('div', { class: 'stack-lg achievements-page' },
          h('div', { class: 'card card-pad anim-slide-up achievements-child-card' },
            h('div', { class: 'row-between row-wrap gap-4' },
              h('div', { class: 'row gap-3 grow', style: 'min-width: 0;' },
                h('div', { class: 'avatar' }, initials(child.fullName)),
                h('div', { class: 'grow', style: 'min-width: 0;' },
                  h('div', { class: 'fw-700 truncate' }, child.fullName),
                  h('div', { class: 'text-xs text-muted mt-1' },
                    `${child.balance} трудокоинов`
                  )
                )
              ),
              switcher
            )
          ),

          rank ? renderRankCard(rank) : null,

          renderAchievementsSection(achievements),

          renderSocialSection(child.id, achievements, renderContent)
        )
      );
    };

    await renderContent();
    mount(root, contentHost);
  } catch (err) {
    mount(root, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить достижения',
      description: isApiError(err) ? err.message : 'Попробуйте позже',
      action: h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => router.reload(),
      }, 'Обновить'),
    }));
  }
}

function renderRankCard(rank: RankInfo): HTMLElement {
  const nextText = rank.next
    ? `До «${rankTitle(rank.next.code)}» — ${rank.next.remaining} трудокоинов`
    : 'Максимальный статус достигнут';

  const progressPct = rank.next
    ? Math.min(
        100,
        Math.max(
          0,
          Math.round(
            ((rank.next.minScore - rank.next.remaining - rank.minScore) /
              (rank.next.minScore - rank.minScore)) *
              100
          )
        )
      )
    : 100;

  const current = rank.next
    ? rank.next.minScore - rank.next.remaining
    : rank.minScore;

  return h('div', { class: 'achievements-hero anim-slide-up' },
    h('div', { class: 'achievements-hero-top' },
      h('div', { class: 'achievements-hero-icon-wrap' },
        h('span', { class: 'achievements-hero-icon' }, rank.icon)
      ),
      h('div', { class: 'achievements-hero-info' },
        h('div', { class: 'achievements-hero-eyebrow' }, 'Текущий статус'),
        h('div', { class: 'achievements-hero-title' }, rank.title),
        h('div', { class: 'achievements-hero-sub' }, nextText)
      )
    ),

    rank.next
      ? h('div', { class: 'achievements-hero-progress' },
          h('div', { class: 'achievements-hero-progress-bar' },
            h('div', {
              class: 'achievements-hero-progress-fill',
              style: `width: ${progressPct}%;`,
            })
          ),
          h('div', { class: 'achievements-hero-progress-meta' },
            h('span', null, 'Прогресс: ',
              h('strong', null, `${progressPct}%`)
            ),
            h('span', null,
              h('strong', null, String(current)),
              ' / ',
              String(rank.next.minScore)
            )
          )
        )
      : h('div', { class: 'achievements-hero-progress' },
          h('div', { class: 'achievements-hero-progress-bar' },
            h('div', {
              class: 'achievements-hero-progress-fill',
              style: 'width: 100%;',
            })
          ),
          h('div', { class: 'achievements-hero-progress-meta' },
            h('span', null, h('strong', null, 'Максимум достигнут')),
            h('span', null, h('strong', null, String(current)))
          )
        )
  );
}

function rankTitle(code: string): string {
  const map: Record<string, string> = {
    novice: 'Новичок',
    bronze: 'Бронза',
    silver: 'Серебро',
    gold: 'Золото',
    platinum: 'Платина',
    legend: 'Легенда',
  };
  return map[code] ?? code;
}

function renderAchievementsSection(items: AchievementItem[]): HTMLElement {
  const milestones = items.filter((a) => a.kind === 'milestone');

  return h('div', { class: 'anim-slide-up delay-1' },
    h('div', { class: 'dashboard-section-head' },
      h('h2', { class: 'section-title-mobile' }, 'Достижения'),
      h('span', { class: 'text-sm text-muted' },
        `${milestones.filter((m) => m.awarded).length} / ${milestones.length}`
      )
    ),

    milestones.length === 0
      ? emptyState({ illustration: 'empty', title: 'Достижений пока нет' })
      : h('div', { class: 'grid grid-auto-280 stagger achievements-grid' },
          ...milestones.map((a) => renderAchievementCard(a))
        )
  );
}

function renderAchievementCard(a: AchievementItem): HTMLElement {
  const classes = ['card', 'card-pad', 'stagger-item', 'achievements-card'];
  classes.push(a.awarded ? 'is-awarded' : 'is-locked');

  return h('div', { class: classes.join(' ') },
    a.awarded
      ? h('div', { class: 'achievements-card-badge' },
          icon('check', { size: 12, className: 'icon icon-sm' }),
          'Получено'
        )
      : null,

    h('div', { class: 'achievements-card-icon-wrap' },
      h('span', { class: 'achievements-card-icon' }, a.icon ?? '🏆')
    ),

    h('div', { class: 'achievements-card-title' }, a.title),

    a.description
      ? h('div', { class: 'achievements-card-desc' }, a.description)
      : null,

    a.rewardPoints > 0
      ? h('div', { class: 'achievements-reward' },
          icon('award', { size: 14, className: 'icon icon-sm' }),
          `+${a.rewardPoints} трудокоинов`
        )
      : null,

    a.awardedAt
      ? h('div', { class: 'achievements-card-date' },
          formatDateShort(a.awardedAt)
        )
      : null
  );
}

function renderSocialSection(
  childId: string,
  allAchievements: AchievementItem[],
  rerender: () => Promise<void>
): HTMLElement {
  const awardedCodes = new Set(
    allAchievements.filter((a) => a.awarded).map((a) => a.code)
  );

  return h('div', { class: 'anim-slide-up delay-2 achievements-social-section' },
    h('div', { class: 'dashboard-section-head' },
      h('h2', { class: 'section-title-mobile' }, 'Подпишитесь и получите награду'),
      h('span', { class: 'text-sm text-muted' }, 'До 999 трудокоинов')
    ),

    h('div', { class: 'grid grid-auto-280 stagger achievements-social-grid' },
      ...SOCIAL_LINKS.map((s) => {
        const awarded = awardedCodes.has(s.code);

        return h('div', {
          class: 'card card-pad stagger-item achievements-social-card',
          style: 'text-align: center;',
        },
          h('div', {
            class: 'achievements-social-icon',
            style: `background: ${s.color};`,
          }, icon(s.icon, { size: 28 })),

          h('div', { class: 'fw-700 mt-4' }, s.label),
          h('div', { class: 'text-xs text-muted mt-1' },
            `Подпишитесь и получите ${s.points} трудокоинов`
          ),

          awarded
            ? h('div', {
                class: 'mt-4 badge badge-success achievements-social-awarded',
              },
                icon('check', { size: 12, className: 'icon icon-sm' }),
                'Уже получено'
              )
            : h('div', { class: 'stack achievements-social-actions', style: 'margin-top: 16px;' },
                h('a', {
                  class: 'btn btn-secondary btn-sm',
                  href: s.url,
                  target: '_blank',
                  rel: 'noopener',
                  onclick: () => {
                    setTimeout(() => {
                      void claimSocial(s.platform, childId, s.url, rerender);
                    }, 800);
                  },
                },
                  icon('external-link', { size: 14, className: 'icon icon-sm' }),
                  'Перейти'
                ),
                h('button', {
                  class: 'btn btn-sm',
                  type: 'button',
                  onclick: () => void claimSocial(s.platform, childId, s.url, rerender),
                },
                  `Получить +${s.points}`
                )
              )
        );
      })
    )
  );
}

async function claimSocial(
  platform: 'vk' | 'telegram' | 'youtube',
  childId: string,
  url: string,
  rerender: () => Promise<void>
): Promise<void> {
  try {
    const res = await api.post<{ granted: boolean; points: number }>(
      '/achievements/social/claim',
      { childId, platform, url }
    );

    if (res.granted) {
      toastSuccess(`+${res.points} трудокоинов!`);
      await rerender();
    } else {
      toastError('Уже получено');
    }
  } catch (err) {
    toastError(isApiError(err) ? err.message : 'Не удалось получить награду');
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}