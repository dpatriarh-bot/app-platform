// ============================================================
// components/paywall.ts — плашка «оформите подписку»
// Цена — 190 ₽ или из store.subscription.
// ============================================================

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { formatMoney } from '../lib/format.js';
import { store } from '../lib/store.js';

export const DEFAULT_PRICE_RUB = 190;

export function currentPriceRub(): number {
  const sub = store.getState().subscription;
  if (sub?.priceRub) return sub.priceRub;
  return DEFAULT_PRICE_RUB;
}

export interface PaywallOptions {
  reason?: string;
  priceRub?: number;
}

export function paywall(options: PaywallOptions = {}): HTMLElement {
  const price = options.priceRub ?? currentPriceRub();

  return h('div', {
    class: 'card card-pad-lg',
    style: 'text-align:center;background:linear-gradient(135deg,var(--c-primary-100),var(--c-surface));border-color:var(--c-primary);',
  },
    h('div', {
      class: 'feature-icon',
      style: 'margin:0 auto 16px;width:56px;height:56px;',
    }, icon('credit-card', { size: 24 })),
    h('h3', null, 'Оформите подписку'),
    h('p', { class: 'text-muted mt-2', style: 'max-width:420px;margin-left:auto;margin-right:auto;' },
      options.reason ?? 'Оформите подписку, чтобы ребёнок получил доступ ко всем тестам и мог копить трудокоины.'
    ),
    h('div', { class: 'mt-4', style: 'font-size:24px;font-weight:800;' },
      `${formatMoney(price)} / месяц`
    ),
    h('div', {
      class: 'alert alert-info mt-4',
      style: 'font-size: 13px; text-align: left;',
    },
      icon('heart', { size: 16, className: 'icon icon-sm alert-icon' }),
      h('div', null, '80% от каждой оплаты идёт в благотворительный фонд')
    ),
    h('div', { class: 'mt-4' },
      h('a', { class: 'btn btn-lg', href: '#/app/payments' },
        icon('credit-card', { size: 20 }),
        'Оформить подписку'
      )
    ),
    h('div', { class: 'text-xs text-dim mt-3' },
      `Первое списание — ${formatMoney(price)}. Отключить автопродление можно в любой момент.`
    )
  );
}