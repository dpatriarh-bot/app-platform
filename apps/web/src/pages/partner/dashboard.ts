// ============================================================
// pages/partner/dashboard.ts — обзор кабинета партнёра
// Трудокоины.
// ============================================================

import { h, mount } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { router } from '../../lib/router.js';
import { partnerLayout, setRoot } from '../../components/layout.js';
import { emptyState, loader, statCard, statusBadge } from '../../components/ui.js';
import { formatDate, formatNumber } from '../../lib/format.js';

interface PartnerInfo {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: string;
}

interface PartnerStats {
  totalOffers: number;
  activeOffers: number;
  totalRedemptions: number;
  redeemedCount: number;
  pendingCount: number;
  last30d: number;
  pointsSpentTotal: number;
}

export async function renderPartnerDashboard(): Promise<void> {
  const root = h('div');
  setRoot(partnerLayout({
    active: 'dashboard',
    title: 'Обзор',
    subtitle: 'Статистика и последние обмены',
    content: root,
  }));
  mount(root, loader());

  try {
    const res = await api.get<{ partner: PartnerInfo; stats: PartnerStats }>('/partner/me');

    const partner = res.partner;
    const stats = res.stats;

    if (partner.status !== 'active') {
      mount(root,
        h('div', { class: 'stack-lg anim-slide-up' },
          h('div', { class: 'alert alert-warning' },
            icon('alert-triangle', { size: 18, className: 'icon icon-sm alert-icon' }),
            h('div', null,
              h('div', { class: 'alert-title' }, 'Партнёр не активирован'),
              `Статус: ${partner.status}. Обратитесь в центр «Улыбка ребёнка».`
            )
          )
        )
      );
      return;
    }

    const cards = h('div', { class: 'stat-grid-admin stagger' },
      statCard({ label: 'Всего офферов', value: formatNumber(stats.totalOffers), icon: 'gift' }),
      statCard({ label: 'Опубликовано', value: formatNumber(stats.activeOffers), icon: 'check-circle', variant: 'success' }),
      statCard({ label: 'Всего обменов', value: formatNumber(stats.totalRedemptions), icon: 'award' }),
      statCard({ label: 'Выдано подарков', value: formatNumber(stats.redeemedCount), icon: 'check', variant: 'success' }),
      statCard({ label: 'Ожидают получения', value: formatNumber(stats.pendingCount), icon: 'clock', variant: 'warning' }),
      statCard({ label: 'За 30 дней', value: formatNumber(stats.last30d), icon: 'trending-up', variant: 'info' }),
      statCard({ label: 'Списано трудокоинов', value: formatNumber(stats.pointsSpentTotal), icon: 'award', variant: 'lav' })
    );

    const recentHost = h('div');
    mount(recentHost, loader());

    const page = h('div', { class: 'stack-lg' },
      h('div', { class: 'partner-hero anim-slide-up' },
        partner.logoUrl
          ? h('img', { class: 'partner-hero-logo', src: partner.logoUrl, alt: '' })
          : h('div', { class: 'partner-hero-logo is-placeholder' }, icon('briefcase', { size: 32 })),
        h('div', { class: 'partner-hero-info' },
          h('div', { class: 'partner-hero-name' }, partner.name),
          partner.description ? h('div', { class: 'partner-hero-desc' }, partner.description) : null,
          h('div', { class: 'partner-hero-meta' },
            statusBadge(partner.status),
            h('span', { class: 'text-xs text-muted mono' }, `#${partner.slug}`)
          )
        )
      ),
      cards,
      h('div', { class: 'anim-slide-up delay-1' },
        h('div', { class: 'row-between row-wrap gap-3 mb-4' },
          h('h3', null, 'Последние обмены'),
          h('a', { class: 'btn btn-secondary btn-sm', href: '#/partner/redemptions' },
            'Все обмены',
            icon('arrow-right', { size: 14, className: 'icon icon-sm' })
          )
        ),
        recentHost
      )
    );

    mount(root, page);
    await loadRecentRedemptions(recentHost);
  } catch (err) {
    if (isApiError(err) && err.code === 'PARTNER_NOT_LINKED') {
      mount(root, emptyState({
        illustration: 'error',
        title: 'Аккаунт не привязан к партнёру',
        description: 'Обратитесь к администратору центра — ваш аккаунт должен быть привязан к партнёрской организации.',
      }));
      return;
    }
    mount(root, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить кабинет',
      description: isApiError(err) ? err.message : 'Попробуйте позже',
      action: h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => router.reload(),
      }, 'Обновить'),
    }));
  }
}

interface RedemptionShort {
  id: string;
  status: string;
  redemptionType: string;
  code: string | null;
  pointsSpent: number;
  expiresAt: string;
  redeemedAt: string | null;
  createdAt: string;
  childNameMasked: string;
  offer: { id: string; title: string; imageUrl: string | null };
}

async function loadRecentRedemptions(host: HTMLElement): Promise<void> {
  try {
    const res = await api.get<{ items: RedemptionShort[]; total: number }>(
      '/partner/redemptions?limit=5'
    );

    if (res.items.length === 0) {
      mount(host, emptyState({
        illustration: 'empty',
        title: 'Обменов пока нет',
        description: 'Когда дети начнут обменивать трудокоины на ваши офферы, они появятся здесь.',
      }));
      return;
    }

    mount(host, h('div', { class: 'partner-recents stagger' },
      ...res.items.map((r) => renderRedemptionRow(r))
    ));
  } catch {
    mount(host, h('div', { class: 'alert alert-danger' }, 'Не удалось загрузить обмены'));
  }
}

function renderRedemptionRow(r: RedemptionShort): HTMLElement {
  return h('div', { class: 'partner-recent stagger-item' },
    h('div', { class: 'partner-recent-icon' }, icon('award', { size: 18 })),
    h('div', { class: 'partner-recent-body' },
      h('div', { class: 'row-between row-wrap gap-2' },
        h('div', { class: 'partner-recent-title' }, r.offer.title),
        statusBadge(r.status)
      ),
      h('div', { class: 'partner-recent-meta' },
        h('span', { class: 'text-xs text-muted' }, r.childNameMasked || '—'),
        h('span', { class: 'text-xs text-dim' }, '·'),
        h('span', { class: 'text-xs text-muted' }, `${r.pointsSpent} трудокоинов`),
        h('span', { class: 'text-xs text-dim' }, '·'),
        h('span', { class: 'text-xs text-muted' }, formatDate(r.createdAt))
      )
    )
  );
}