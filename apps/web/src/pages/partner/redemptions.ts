// ============================================================
// pages/partner/redemptions.ts — обмены партнёра
// Трудокоины.
// ============================================================

import { h, mount } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { router } from '../../lib/router.js';
import { partnerLayout, setRoot } from '../../components/layout.js';
import { emptyState, loader, pillsTabs, statusBadge } from '../../components/ui.js';
import { confirmModal } from '../../lib/modal.js';
import { toastSuccess, toastError } from '../../lib/toast.js';
import { formatDate, formatDateTime } from '../../lib/format.js';

type Tab = 'all' | 'issued' | 'redeemed' | 'expired' | 'canceled';

interface RedemptionItem {
  id: string;
  status: string;
  redemptionType: string;
  code: string | null;
  pointsSpent: number;
  expiresAt: string;
  redeemedAt: string | null;
  partnerAckAt: string | null;
  createdAt: string;
  childNameMasked: string;
  offer: { id: string; title: string; imageUrl: string | null };
}

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'issued', label: 'Ожидают' },
  { key: 'redeemed', label: 'Получены' },
  { key: 'expired', label: 'Истекли' },
  { key: 'canceled', label: 'Отменены' },
];

export async function renderPartnerRedemptions(): Promise<void> {
  const currentTab = getTabFromUrl();

  const root = h('div');
  setRoot(partnerLayout({
    active: 'redemptions',
    title: 'Обмены',
    subtitle: 'История подарков, которые получили дети',
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
      await loadRedemptions(contentHost, tab === 'all' ? null : tab);
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
      title: 'Не удалось загрузить обмены',
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
  router.navigate(`/partner/redemptions?tab=${tab}`);
}

async function loadRedemptions(host: HTMLElement, status: string | null): Promise<void> {
  try {
    const qs = new URLSearchParams();
    qs.set('limit', '200');
    if (status) qs.set('status', status);

    const res = await api.get<{ items: RedemptionItem[]; total: number }>(
      `/partner/redemptions?${qs.toString()}`
    );

    if (res.items.length === 0) {
      mount(host, emptyState({
        illustration: 'empty',
        title: 'Обменов нет',
        description: 'В этой категории пока ничего нет.',
      }));
      return;
    }

    mount(host, h('div', { class: 'partner-redemptions-list stagger' },
      ...res.items.map((r) => renderRedemptionCard(r))
    ));
  } catch {
    mount(host, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить обмены',
    }));
  }
}

function renderRedemptionCard(r: RedemptionItem): HTMLElement {
  const actions = h('div', { class: 'row gap-2 row-wrap mt-3' });

  if (r.status === 'issued') {
    actions.appendChild(
      h('button', {
        class: 'btn btn-success btn-sm',
        type: 'button',
        onclick: async () => {
          const ok = await confirmModal({
            title: 'Отметить как полученный?',
            message: `Подарок «${r.offer.title}» — подтверждаем выдачу.`,
            confirmLabel: 'Отметить',
          });
          if (!ok) return;
          try {
            await api.post(`/partner/redemptions/${r.id}/mark-redeemed`, {});
            toastSuccess('Отмечено');
            router.reload();
          } catch (err) {
            toastError(isApiError(err) ? err.message : 'Не удалось отметить');
          }
        },
      },
        icon('check', { size: 16, className: 'icon icon-sm' }),
        'Отметить полученным'
      )
    );
  }

  return h('div', { class: 'partner-redemption-card stagger-item' },
    h('div', { class: 'partner-redemption-head' },
      h('div', { class: 'partner-redemption-offer' },
        r.offer.imageUrl
          ? h('img', { class: 'partner-redemption-img', src: r.offer.imageUrl, alt: '' })
          : h('div', { class: 'partner-redemption-img is-placeholder' }, icon('gift', { size: 18 })),
        h('div', { style: 'min-width: 0;' },
          h('div', { class: 'partner-redemption-title truncate' }, r.offer.title),
          h('div', { class: 'text-xs text-muted mt-1' },
            `${r.childNameMasked || '—'} · ${r.pointsSpent} трудокоинов`
          )
        )
      ),
      statusBadge(r.status)
    ),
    h('div', { class: 'partner-redemption-meta' },
      h('div', { class: 'partner-redemption-meta-item' },
        h('div', { class: 'text-xs text-muted' }, 'Создан'),
        h('div', { class: 'text-sm fw-600 mt-1' }, formatDateTime(r.createdAt))
      ),
      r.code
        ? h('div', { class: 'partner-redemption-meta-item' },
            h('div', { class: 'text-xs text-muted' }, 'Код'),
            h('div', { class: 'text-sm fw-600 mt-1 mono' }, r.code)
          )
        : null,
      h('div', { class: 'partner-redemption-meta-item' },
        h('div', { class: 'text-xs text-muted' }, r.redeemedAt ? 'Получен' : 'Действует до'),
        h('div', { class: 'text-sm fw-600 mt-1' },
          formatDate(r.redeemedAt ?? r.expiresAt)
        )
      )
    ),
    actions.childElementCount > 0 ? actions : null
  );
}