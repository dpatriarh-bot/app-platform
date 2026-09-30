// ============================================================
// pages/admin/dashboard.ts — админ-дашборд
// Метрики, тренды (SVG-бары), топ-дисциплины, топ подозрительных.
// ============================================================

import { h, mount } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { router } from '../../lib/router.js';
import { adminLayout, setRoot } from '../../components/layout.js';
import { emptyState, loader, statCard } from '../../components/ui.js';
import { formatMoney, formatNumber, formatDateShort } from '../../lib/format.js';

interface DashboardData {
  period: { days: number; from: string; to: string };
  totals: {
    parents: number;
    children: number;
    attempts: number;
    activeSubscriptions: number;
    pastDueSubscriptions: number;
    revenueRub: number;
    flaggedAttempts: number;
    blockedAttempts: number;
    pendingSpotChecks: number;
  };
  trend: {
    registrations: Array<{ date: string; count: number }>;
    attempts: Array<{ date: string; count: number }>;
    revenue: Array<{ date: string; amountRub: number }>;
  };
  topSubjects: Array<{ subjectId: string; title: string; attempts: number }>;
  topSuspicious: Array<{
    childId: string;
    childName: string;
    flaggedCount: number;
    avgSuspicion: number;
  }>;
}

const PERIOD_OPTIONS = [7, 14, 30, 90];

export async function renderAdminDashboard(): Promise<void> {
  const days = getDaysFromUrl();

  const root = h('div');

  setRoot(adminLayout({
    active: 'dashboard',
    title: 'Дашборд',
    subtitle: `Период: последние ${days} дн.`,
    content: root,
  }));

  mount(root, loader());

  try {
    const res = await api.get<DashboardData>(`/admin/dashboard?days=${days}`);

    const periodSelector = h('div', { class: 'row gap-2 row-wrap' },
      ...PERIOD_OPTIONS.map((d) =>
        h('button', {
          class: `chip ${d === days ? 'is-active' : ''}`,
          type: 'button',
          onclick: () => navigateDays(d),
        }, `${d} дн.`)
      )
    );

    const totals = h('div', { class: 'stat-grid-admin stagger' },
      statCard({ label: 'Родители', value: formatNumber(res.totals.parents), icon: 'users' }),
      statCard({ label: 'Дети', value: formatNumber(res.totals.children), icon: 'user' }),
      statCard({ label: 'Попыток', value: formatNumber(res.totals.attempts), icon: 'activity' }),
      statCard({
        label: 'Выручка',
        value: formatMoney(res.totals.revenueRub),
        icon: 'dollar-sign',
        variant: 'success',
      }),
      statCard({
        label: 'Активных подписок',
        value: formatNumber(res.totals.activeSubscriptions),
        icon: 'credit-card',
      }),
      statCard({
        label: 'Просрочено',
        value: formatNumber(res.totals.pastDueSubscriptions),
        icon: 'alert-triangle',
        variant: 'warning',
      }),
      statCard({
        label: 'Флагов фрода',
        value: formatNumber(res.totals.flaggedAttempts),
        icon: 'flag',
        variant: 'warning',
      }),
      statCard({
        label: 'Заблокировано',
        value: formatNumber(res.totals.blockedAttempts),
        icon: 'shield-off',
        variant: 'danger',
      }),
      statCard({
        label: 'Очных проверок',
        value: formatNumber(res.totals.pendingSpotChecks),
        icon: 'shield',
        variant: 'info',
      })
    );

    const charts = h('div', { class: 'grid grid-auto-320 stagger' },
      chartCard('Регистрации', res.trend.registrations.map((r) => r.count), 'is-primary'),
      chartCard('Попытки', res.trend.attempts.map((r) => r.count), 'is-lav'),
      chartCard('Выручка', res.trend.revenue.map((r) => r.amountRub), 'is-success', true)
    );

    const topSubjects = h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('div', { class: 'card-title' }, 'Топ дисциплин'),
        h('a', { class: 'text-sm', href: '#/admin/subjects' }, 'Все →')
      ),
      res.topSubjects.length === 0
        ? h('div', { class: 'card-body text-muted text-sm' }, 'Пока нет данных')
        : h('div', { class: 'card-body top-list' },
            ...res.topSubjects.map((s) => {
              const max = Math.max(...res.topSubjects.map((x) => x.attempts), 1);
              const pct = (s.attempts / max) * 100;
              return h('div', { class: 'top-list-item' },
                h('div', { class: 'top-list-head' },
                  h('div', { class: 'top-list-name' }, s.title),
                  h('div', { class: 'top-list-value' }, formatNumber(s.attempts))
                ),
                h('div', { class: 'top-list-bar' },
                  h('div', { class: 'top-list-bar-fill', style: `width: ${pct}%;` })
                )
              );
            })
          )
    );

    const topSuspicious = h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('div', { class: 'card-title' }, 'Топ подозрительных'),
        h('a', { class: 'text-sm', href: '#/admin/checks' }, 'К проверкам →')
      ),
      res.topSuspicious.length === 0
        ? h('div', { class: 'card-body text-muted text-sm' }, 'Нет аномалий — отлично!')
        : h('div', { class: 'table-wrap' },
            h('table', { class: 'table' },
              h('thead', null,
                h('tr', null,
                  h('th', null, 'Ребёнок'),
                  h('th', null, 'Флагов'),
                  h('th', null, 'Ср. suspicion'),
                  h('th', null, '')
                )
              ),
              h('tbody', null,
                ...res.topSuspicious.map((s) =>
                  h('tr', null,
                    h('td', { class: 'fw-600' }, s.childName || '—'),
                    h('td', null,
                      h('span', {
                        class: `badge ${s.flaggedCount >= 3 ? 'badge-danger' : 'badge-warning'}`,
                      }, String(s.flaggedCount))
                    ),
                    h('td', null,
                      h('div', { class: 'row gap-2' },
                        h('div', { class: 'suspicion-bar', style: 'width: 80px;' },
                          h('div', {
                            class: 'suspicion-bar-fill',
                            style: `width: ${Math.min(100, s.avgSuspicion)}%;`,
                          })
                        ),
                        h('span', { class: 'suspicion-value' }, String(s.avgSuspicion))
                      )
                    ),
                    h('td', null,
                      h('a', {
                        class: 'btn btn-ghost btn-sm',
                        href: `#/admin/checks?candidate=${s.childId}`,
                      }, 'Проверить')
                    )
                  )
                )
              )
            )
          )
    );

    const content = h('div', { class: 'stack-lg' },
      h('div', { class: 'row-between row-wrap gap-3' },
        h('div', { class: 'text-sm text-muted' },
          `${formatDateShort(res.period.from)} — ${formatDateShort(res.period.to)}`
        ),
        periodSelector
      ),
      totals,
      charts,
      h('div', { class: 'grid grid-auto-320' }, topSubjects, topSuspicious)
    );

    mount(root, content);
  } catch (err) {
    mount(root, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить дашборд',
      description: isApiError(err) ? err.message : 'Попробуйте позже',
      action: h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => router.reload(),
      }, 'Обновить'),
    }));
  }
}

function getDaysFromUrl(): number {
  const hash = window.location.hash;
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return 30;
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  const d = parseInt(params.get('days') ?? '30', 10);
  return PERIOD_OPTIONS.includes(d) ? d : 30;
}

function navigateDays(days: number): void {
  router.navigate(`/admin?days=${days}`);
}

function chartCard(
  title: string,
  values: number[],
  modifier: string,
  isMoney = false
): HTMLElement {
  const max = Math.max(...values, 1);
  const total = values.reduce((s, v) => s + v, 0);

  return h('div', { class: 'chart-card stagger-item' },
    h('div', { class: 'chart-head' },
      h('div', { class: 'chart-title' }, title),
      h('div', { class: 'chart-total' },
        isMoney ? formatMoney(total) : formatNumber(total)
      )
    ),
    values.length === 0
      ? h('div', { class: 'chart-empty' }, 'Нет данных')
      : h('div', { class: 'chart-bars' },
          ...values.map((v) => {
            const heightPct = max > 0 ? (v / max) * 100 : 0;
            return h('div', {
              class: `chart-bar ${modifier}`,
              style: `height: ${Math.max(3, heightPct)}%;`,
              title: isMoney ? formatMoney(v) : String(v),
            });
          })
        )
  );
}