// ============================================================
// pages/app/catalog.ts — каталог подарков
// Трудокоины, обновление шапки и карточек после обмена.
// ============================================================

import { h, mount, clear } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { store } from '../../lib/store.js';
import { router } from '../../lib/router.js';
import { appLayout, setRoot } from '../../components/layout.js';
import { emptyState, loader, pillsTabs, statusBadge } from '../../components/ui.js';
import { childSwitcher } from '../../components/child-switcher.js';
import { saveChildId } from '../../lib/bootstrap.js';
import { openModal, confirmModal } from '../../lib/modal.js';
import { toastSuccess, toastError } from '../../lib/toast.js';
import { formatDate } from '../../lib/format.js';

type Tab = 'catalog' | 'redemptions';

interface OfferItem {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  costPoints: number;
  stock: number | null;
  terms: string | null;
  redemptionType: 'qr' | 'promo' | 'referral' | 'manual';
  partnerId: string;
  partnerName: string;
  partnerSlug: string;
  partnerLogoUrl: string | null;
  totalRedeemed: number;
  validUntil: string | null;
}

interface RedemptionItem {
  id: string;
  status: string;
  redemptionType: string;
  code: string | null;
  pointsSpent: number;
  expiresAt: string;
  redeemedAt: string | null;
  createdAt: string;
  offer: { id: string; title: string; imageUrl: string | null };
  partner: { id: string; name: string; slug: string };
}

export async function renderAppCatalog(): Promise<void> {
  let currentTab = getTabFromUrl();

  const root = h('div');
  setRoot(appLayout({ active: 'catalog', title: 'Подарки', content: root }));
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

    const rerender = async (): Promise<void> => {
      clear(contentHost);

      const state = store.getState();
      const child = state.children.find((c) => c.id === state.currentChildId) ?? null;
      if (!child) {
        mount(contentHost, emptyState({ illustration: 'empty', title: 'Выберите ребёнка' }));
        return;
      }

      const tabsEl = pillsTabs([
        {
          key: 'catalog',
          label: 'Каталог',
          active: currentTab === 'catalog',
          onClick: () => navigateTab('catalog'),
        },
        {
          key: 'redemptions',
          label: 'Мои подарки',
          active: currentTab === 'redemptions',
          onClick: () => navigateTab('redemptions'),
        },
      ]);

      const switcher = childSwitcher({
        children: state.children,
        currentChildId: state.currentChildId,
        onChange: (id) => {
          store.setState({ currentChildId: id });
          saveChildId(id);
          void rerender();
        },
      });

      const bodyHost = h('div', { class: 'anim-slide-up delay-1' });

      contentHost.appendChild(h('div', { class: 'stack-lg' },
        h('div', { class: 'card card-pad anim-slide-up' },
          h('div', { class: 'row-between row-wrap gap-4' },
            h('div', { class: 'row gap-3 grow', style: 'min-width: 0;' },
              h('div', { class: 'avatar' }, initials(child.fullName)),
              h('div', { class: 'grow', style: 'min-width: 0;' },
                h('div', { class: 'fw-700 truncate' }, child.fullName),
                h('div', { class: 'text-xs text-muted mt-1' },
                  `${child.balance} трудокоинов доступно`
                )
              )
            ),
            switcher
          )
        ),
        h('div', { style: 'display: flex; justify-content: center;' }, tabsEl),
        bodyHost
      ));

      if (currentTab === 'catalog') {
        await renderCatalogTab(bodyHost, child.id, child.balance, rerender);
      } else {
        await renderRedemptionsTab(bodyHost, child.id, rerender);
      }
    };

    window.addEventListener('hashchange', () => {
      currentTab = getTabFromUrl();
      void rerender();
    });

    await rerender();
    mount(root, contentHost);
  } catch {
    mount(root, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить каталог',
    }));
  }
}

function getTabFromUrl(): Tab {
  const hash = window.location.hash;
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return 'catalog';
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  return params.get('tab') === 'redemptions' ? 'redemptions' : 'catalog';
}

function navigateTab(tab: Tab): void {
  router.navigate(`/app/catalog?tab=${tab}`);
}

async function renderCatalogTab(
  host: HTMLElement,
  childId: string,
  balance: number,
  rerender: () => Promise<void>
): Promise<void> {
  mount(host, loader());
  try {
    const res = await api.get<{ items: OfferItem[] }>('/catalog?limit=100');

    if (res.items.length === 0) {
      mount(host, emptyState({
        illustration: 'no-gifts',
        title: 'Каталог пока пуст',
        description: 'Совсем скоро появятся новые подарки от партнёров.',
      }));
      return;
    }

    mount(host, h('div', { class: 'offer-grid stagger' },
      ...res.items.map((offer) => renderOfferCard(offer, childId, balance, rerender))
    ));
  } catch (err) {
    mount(host, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить каталог',
      description: isApiError(err) ? err.message : 'Попробуйте позже',
    }));
  }
}

function renderOfferCard(
  offer: OfferItem,
  childId: string,
  balance: number,
  rerender: () => Promise<void>
): HTMLElement {
  const canAfford = balance >= offer.costPoints;
  const outOfStock = offer.stock !== null && offer.stock <= 0;
  const canRedeem = canAfford && !outOfStock;

  const image = offer.imageUrl
    ? h('img', { src: offer.imageUrl, alt: '' })
    : icon('gift', { size: 56, className: 'icon icon-2xl' });

  return h('div', { class: 'offer-card stagger-item' },
    h('div', { class: 'offer-image' }, image),
    h('div', { class: 'offer-body' },
      h('div', { class: 'offer-partner' }, offer.partnerName),
      h('div', { class: 'offer-title' }, offer.title),
      offer.description ? h('div', { class: 'offer-description' }, offer.description) : null,
      h('div', { class: 'offer-footer' },
        h('span', { class: 'offer-cost' },
          icon('award', { size: 14, className: 'icon icon-sm' }),
          `${offer.costPoints} трудокоинов`
        ),
        offer.stock !== null
          ? h('span', { class: 'offer-stock' }, `Осталось: ${offer.stock}`)
          : null
      ),
      h('button', {
        class: `btn btn-block mt-2 ${canRedeem ? '' : 'btn-secondary'}`,
        type: 'button',
        disabled: !canRedeem,
        onclick: () => void openRedeemModal(offer, childId, balance, rerender),
      },
        !canAfford
          ? `Не хватает ${offer.costPoints - balance} трудокоинов`
          : outOfStock
            ? 'Нет в наличии'
            : 'Получить подарок'
      )
    )
  );
}

async function openRedeemModal(
  offer: OfferItem,
  childId: string,
  balance: number,
  rerender: () => Promise<void>
): Promise<void> {
  const ok = await confirmModal({
    title: `Обменять на «${offer.title}»?`,
    message: `Будет списано ${offer.costPoints} трудокоинов. Остаток: ${balance - offer.costPoints}. Подарок от «${offer.partnerName}».`,
    confirmLabel: 'Обменять',
  });
  if (!ok) return;

  try {
    const res = await api.post<{
      redemptionId: string;
      code: string | null;
      qrToken: string | null;
      qrImageDataUrl: string | null;
      pointsSpent: number;
      balanceAfter: number;
      expiresAt: string;
      offer: { id: string; title: string; partnerName: string };
    }>('/catalog/redeem', {
      offerId: offer.id,
      childId,
      redemptionType: offer.redemptionType,
    });

    toastSuccess('Подарок получен!');

    const content = h('div', { class: 'stack' },
      h('p', { class: 'text-muted text-sm' },
        `Покажите код сотруднику «${res.offer.partnerName}» при получении подарка.`
      ),
      res.qrImageDataUrl
        ? h('div', { class: 'qr-wrap' },
            h('img', { src: res.qrImageDataUrl, alt: 'QR' }),
            h('div', { class: 'mt-4 text-xs text-dim text-center' },
              'Действует 10 минут.'
            )
          )
        : null,
      res.code
        ? h('div', null,
            h('div', { class: 'text-xs text-muted mb-2', style: 'text-align: center;' }, 'Код для получения'),
            h('div', { class: 'code-display' }, res.code)
          )
        : null,
      h('div', { class: 'alert alert-warning' },
        icon('clock', { size: 18, className: 'icon icon-sm alert-icon' }),
        h('div', null,
          h('div', { class: 'alert-title' }, 'Срок действия'),
          `До ${formatDate(res.expiresAt)}`
        )
      )
    );

    openModal({
      title: 'Подарок получен',
      body: content,
      actions: [
        {
          label: 'К моим подаркам',
          variant: 'secondary',
          onClick: () => navigateTab('redemptions'),
        },
        { label: 'Готово', variant: 'primary' },
      ],
      size: 'md',
    });

    store.setState((s) => ({
      children: s.children.map((c) =>
        c.id === childId ? { ...c, balance: res.balanceAfter } : c
      ),
    }));

    await rerender();
  } catch (err) {
    if (isApiError(err)) {
      if (err.code === 'INSUFFICIENT_POINTS') toastError('Недостаточно трудокоинов');
      else toastError(err.message);
    } else {
      toastError('Не удалось получить подарок');
    }
  }
}

async function renderRedemptionsTab(
  host: HTMLElement,
  childId: string,
  _rerender: () => Promise<void>
): Promise<void> {
  mount(host, loader());
  try {
    const res = await api.get<{ items: RedemptionItem[]; total: number }>(
      `/catalog/redemptions?childId=${encodeURIComponent(childId)}`
    );

    if (res.items.length === 0) {
      mount(host, emptyState({
        illustration: 'no-gifts',
        title: 'Пока нет подарков',
        description: 'Обменяйте трудокоины на подарки в каталоге.',
        action: h('button', {
          class: 'btn',
          type: 'button',
          onclick: () => navigateTab('catalog'),
        }, 'В каталог'),
      }));
      return;
    }

    mount(host, h('div', { class: 'stack stagger' },
      ...res.items.map((r) => renderRedemptionCard(r))
    ));
  } catch {
    mount(host, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить подарки',
    }));
  }
}

function renderRedemptionCard(r: RedemptionItem): HTMLElement {
  const isActive = r.status === 'issued';

  return h('div', { class: 'redemption-card stagger-item' },
    h('div', { class: 'redemption-icon' }, icon('gift', { size: 22 })),
    h('div', { class: 'redemption-body' },
      h('div', { class: 'row-between mb-2 row-wrap gap-2' },
        h('div', { class: 'grow', style: 'min-width: 0;' },
          h('div', { class: 'redemption-title truncate' }, r.offer.title),
          h('div', { class: 'redemption-partner' }, r.partner.name)
        ),
        statusBadge(r.status)
      ),
      h('div', { class: 'row-between mt-3 row-wrap gap-2' },
        h('div', { class: 'text-sm' },
          h('span', { class: 'text-muted' }, 'Списано: '),
          h('span', { class: 'fw-600' }, `${r.pointsSpent} трудокоинов`)
        ),
        isActive
          ? h('button', {
              class: 'btn btn-sm',
              type: 'button',
              onclick: () => void openRedemptionDetail(r),
            },
              icon('eye', { size: 14, className: 'icon icon-sm' }),
              'Показать'
            )
          : h('div', { class: 'text-xs text-dim' },
              formatDate(r.redeemedAt ?? r.createdAt)
            )
      )
    )
  );
}

interface RedemptionDetail {
  redemption: RedemptionItem & {
    qrImageDataUrl: string | null;
    qrExpiresAt: string | null;
  };
}

async function openRedemptionDetail(r: RedemptionItem): Promise<void> {
  try {
    const detail = await api.get<RedemptionDetail>(`/catalog/redemptions/${r.id}`);
    const d = detail.redemption;

    const body = h('div', { class: 'stack' });

    const renderQr = (): void => {
      clear(body);

      if (d.qrImageDataUrl) {
        body.appendChild(
          h('div', { class: 'qr-wrap' },
            h('img', { src: d.qrImageDataUrl, alt: 'QR' }),
            d.qrExpiresAt
              ? h('div', { class: 'mt-3 text-xs text-dim text-center' },
                  `Действует до ${formatDate(d.qrExpiresAt)}`
                )
              : null
          )
        );
      } else if (d.redemptionType === 'qr') {
        body.appendChild(
          h('div', { class: 'alert alert-warning' },
            icon('alert-triangle', { size: 18, className: 'icon icon-sm alert-icon' }),
            h('div', null,
              h('div', { class: 'alert-title' }, 'QR-код истёк'),
              'Обновите — мы сгенерируем новый.'
            )
          )
        );
      }

      if (d.code) {
        body.appendChild(
          h('div', null,
            h('div', { class: 'text-xs text-muted mb-2', style: 'text-align: center;' }, 'Код'),
            h('div', { class: 'code-display' }, d.code)
          )
        );
      }

      body.appendChild(
        h('div', { class: 'text-xs text-dim text-center' },
          `Действует до ${formatDate(d.expiresAt)}`
        )
      );

      if (d.redemptionType === 'qr') {
        body.appendChild(
          h('button', {
            class: 'btn btn-secondary btn-block mt-3',
            type: 'button',
            onclick: async () => {
              try {
                const refreshed = await api.get<RedemptionDetail>(
                  `/catalog/redemptions/${r.id}`
                );
                d.qrImageDataUrl = refreshed.redemption.qrImageDataUrl;
                d.qrExpiresAt = refreshed.redemption.qrExpiresAt;
                renderQr();
                toastSuccess('QR обновлён');
              } catch {
                toastError('Не удалось обновить QR');
              }
            },
          },
            icon('refresh-cw', { size: 16, className: 'icon icon-sm' }),
            'Обновить QR'
          )
        );
      }
    };

    renderQr();

    openModal({
      title: 'Ваш подарок',
      body,
      actions: [{ label: 'Закрыть', variant: 'secondary' }],
      size: 'md',
    });
  } catch {
    toastError('Не удалось открыть подарок');
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}