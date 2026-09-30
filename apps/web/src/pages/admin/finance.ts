// ============================================================
// pages/admin/finance.ts — финансовая статистика
// ============================================================

import { h, mount } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { router } from '../../lib/router.js';
import { adminLayout, setRoot } from '../../components/layout.js';
import { emptyState, loader, statCard, statusBadge } from '../../components/ui.js';
import { formatDate, formatMoney, formatNumber } from '../../lib/format.js';

interface FinanceStats {
  totalRevenueRub: number;
  activeSubscriptions: number;
  pastDueSubscriptions: number;
  mrrRub: number;
  paymentsLast30d: number;
  revenueLast30d: number;
}

interface PaymentItem {
  id: string;
  amountRub: number;
  currency: string;
  status: string;
  isRecurrent: boolean;
  isTest: boolean;
  receiptUrl: string | null;
  failureReason: string | null;
  paidAt: string | null;
  createdAt: string;
}

export async function renderAdminFinance(): Promise<void> {
  const root = h('div');

  setRoot(adminLayout({
    active: 'finance',
    title: 'Финансы',
    content: root,
  }));

  mount(root, loader());

  try {
    const [statsRes, paymentsRes] = await Promise.all([
      api.get<{ stats: FinanceStats }>('/payments/admin/stats'),
      api.get<{ items: PaymentItem[]; total: number }>('/payments/history?limit=100').catch(() => ({ items: [], total: 0 })),
    ]);

    const stats = statsRes.stats;

    const content = h('div', { class: 'stack-lg' },
      h('div', { class: 'stat-grid-admin stagger' },
        statCard({
          label: 'Выручка всего',
          value: formatMoney(stats.totalRevenueRub),
          icon: 'dollar-sign',
          variant: 'success',
        }),
        statCard({
          label: 'MRR (прогноз)',
          value: formatMoney(stats.mrrRub),
          icon: 'trending-up',
          variant: 'primary',
        }),
        statCard({
          label: 'Активных подписок',
          value: formatNumber(stats.activeSubscriptions),
          icon: 'credit-card',
          variant: 'info',
        }),
        statCard({
          label: 'Просрочено',
          value: formatNumber(stats.pastDueSubscriptions),
          icon: 'alert-triangle',
          variant: 'warning',
        }),
        statCard({
          label: 'Платежей за 30 дн.',
          value: formatNumber(stats.paymentsLast30d),
          icon: 'activity',
          variant: 'lav',
        }),
        statCard({
          label: 'Выручка за 30 дн.',
          value: formatMoney(stats.revenueLast30d),
          icon: 'bar-chart-2',
          variant: 'success',
        })
      ),

      h('div', { class: 'anim-slide-up delay-1' },
        h('h3', { style: 'margin-bottom: var(--sp-5);' }, 'Последние платежи'),
        paymentsRes.items.length === 0
          ? emptyState({
              illustration: 'empty',
              title: 'Платежей нет',
              description: 'Когда появятся первые платежи, они будут показаны здесь.',
            })
          : h('div', { class: 'card' },
              h('div', { class: 'table-wrap', style: 'border: 0; border-radius: var(--r-lg);' },
                h('table', { class: 'table' },
                  h('thead', null,
                    h('tr', null,
                      h('th', null, 'Дата'),
                      h('th', null, 'Сумма'),
                      h('th', null, 'Тип'),
                      h('th', null, 'Статус'),
                      h('th', null, 'Чек')
                    )
                  ),
                  h('tbody', null,
                    ...paymentsRes.items.map((p) =>
                      h('tr', null,
                        h('td', { class: 'text-sm text-muted nowrap' },
                          formatDate(p.paidAt ?? p.createdAt)
                        ),
                        h('td', { class: 'fw-700 nowrap' }, formatMoney(p.amountRub)),
                        h('td', null,
                          h('span', { class: 'badge' },
                            p.isRecurrent ? 'Авто' : 'Первый',
                            p.isTest ? ' · тест' : ''
                          )
                        ),
                        h('td', null, statusBadge(p.status)),
                        h('td', null,
                          p.receiptUrl
                            ? h('a', {
                                class: 'btn btn-ghost btn-sm',
                                href: p.receiptUrl,
                                target: '_blank',
                                rel: 'noopener',
                              },
                                icon('file-text', { size: 14, className: 'icon icon-sm' }),
                                'Чек'
                              )
                            : h('span', { class: 'text-dim text-sm' }, '—')
                        )
                      )
                    )
                  )
                )
              )
            )
      )
    );

    mount(root, content);
  } catch (err) {
    mount(root, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить статистику',
      description: isApiError(err) ? err.message : 'Попробуйте позже',
      action: h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => router.reload(),
      }, 'Обновить'),
    }));
  }
}