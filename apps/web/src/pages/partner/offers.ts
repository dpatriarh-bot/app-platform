// ============================================================
// pages/partner/offers.ts — офферы партнёра
// Трудокоины.
// ============================================================

import { h, mount } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { router } from '../../lib/router.js';
import { partnerLayout, setRoot } from '../../components/layout.js';
import { emptyState, loader, pillsTabs, statusBadge } from '../../components/ui.js';
import { formatDate } from '../../lib/format.js';

type Tab = 'all' | 'published' | 'draft' | 'review' | 'archived';

interface OfferItem {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  costPoints: number;
  stock: number | null;
  terms: string | null;
  redemptionType: 'qr' | 'promo' | 'referral' | 'manual';
  status: string;
  validFrom: string | null;
  validUntil: string | null;
  totalRedeemed: number;
  createdAt: string;
}

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'published', label: 'Опубликованные' },
  { key: 'draft', label: 'Черновики' },
  { key: 'review', label: 'На модерации' },
  { key: 'archived', label: 'Архив' },
];

export async function renderPartnerOffers(): Promise<void> {
  const currentTab = getTabFromUrl();

  const root = h('div');
  setRoot(partnerLayout({
    active: 'offers',
    title: 'Офферы',
    subtitle: 'Подарки, которые дети могут получить за трудокоины',
    content: root,
  }));
  mount(root, loader());

  try {
    const tabsEl = pillsTabs(
      TABS.map((t) => ({
        key: t.key,
        label: t.label,
        active: currentTab === t.key,
        onClick: () => navigateTab(t.key),
      }))
    );

    const contentHost = h('div', { class: 'anim-slide-up delay-1' });

    const renderTab = async (): Promise<void> => {
      mount(contentHost, loader());
      const tab = getTabFromUrl();
      await loadOffers(contentHost, tab === 'all' ? null : tab);
    };

    const content = h('div', { class: 'stack-lg' },
      h('div', { style: 'display: flex; justify-content: center;' }, tabsEl),
      contentHost
    );

    mount(root, content);
    await renderTab();

    window.addEventListener('hashchange', () => void renderTab());
  } catch (err) {
    mount(root, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить офферы',
      description: isApiError(err) ? err.message : 'Попробуйте позже',
      action: h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => router.reload(),
      }, 'Обновить'),
    }));
  }
}

function getTabFromUrl(): Tab {
  const hash = window.location.hash;
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return 'all';
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  const tab = params.get('tab') as Tab | null;
  return tab && TABS.some((t) => t.key === tab) ? tab : 'all';
}

function navigateTab(tab: Tab): void {
  router.navigate(`/partner/offers?tab=${tab}`);
}

async function loadOffers(host: HTMLElement, status: string | null): Promise<void> {
  try {
    const qs = new URLSearchParams();
    qs.set('limit', '200');
    if (status) qs.set('status', status);

    const res = await api.get<{ items: OfferItem[]; total: number }>(
      `/partner/offers?${qs.toString()}`
    );

    if (res.items.length === 0) {
      mount(host, emptyState({
        illustration: 'empty',
        title: 'Офферов пока нет',
        description: 'Здесь появятся ваши подарки, когда администратор их добавит.',
      }));
      return;
    }

    mount(host, h('div', { class: 'partner-offers-grid stagger' },
      ...res.items.map((o) => renderOfferCard(o))
    ));
  } catch {
    mount(host, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить офферы',
    }));
  }
}

function renderOfferCard(o: OfferItem): HTMLElement {
  const stockLabel = o.stock !== null
    ? `Осталось: ${o.stock}`
    : 'Без ограничений';

  const typeLabel: Record<string, string> = {
    qr: 'QR-код',
    promo: 'Промокод',
    referral: 'Реферальная ссылка',
    manual: 'Вручную',
  };

  return h('div', { class: 'partner-offer-card stagger-item' },
    h('div', { class: 'partner-offer-image' },
      o.imageUrl
        ? h('img', { src: o.imageUrl, alt: '' })
        : h('div', { class: 'partner-offer-image-placeholder' }, icon('gift', { size: 32 }))
    ),
    h('div', { class: 'partner-offer-body' },
      h('div', { class: 'row-between row-wrap gap-2' },
        h('span', { class: 'badge badge-primary' }, typeLabel[o.redemptionType] ?? o.redemptionType),
        statusBadge(o.status)
      ),
      h('div', { class: 'partner-offer-title' }, o.title),
      o.description ? h('div', { class: 'partner-offer-desc' }, o.description) : null,
      h('div', { class: 'partner-offer-meta' },
        h('div', { class: 'partner-offer-meta-item' },
          icon('award', { size: 12, className: 'icon icon-sm' }),
          `${o.costPoints} трудокоинов`
        ),
        h('div', { class: 'partner-offer-meta-item' },
          icon('box', { size: 12, className: 'icon icon-sm' }),
          stockLabel
        )
      ),
      o.validUntil
        ? h('div', { class: 'text-xs text-muted mt-2' },
            `Действует до: ${formatDate(o.validUntil)}`
          )
        : null,
      h('div', { class: 'partner-offer-footer' },
        h('div', { class: 'text-xs text-dim' },
          `Обменов: ${o.totalRedeemed}`
        )
      )
    )
  );
}