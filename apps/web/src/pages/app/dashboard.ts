// ============================================================
// pages/app/dashboard.ts — главная ЛК
// Карточка статуса ребёнка, раздельные баннеры подписки.
// ============================================================

import { h, mount, clear } from '../../lib/dom.js';
import { icon, type IconName } from '../../lib/icons.js';
import { api } from '../../lib/api.js';
import { store } from '../../lib/store.js';
import { router } from '../../lib/router.js';
import { appLayout, setRoot } from '../../components/layout.js';
import { emptyState, loader, statusBadge } from '../../components/ui.js';
import { childSwitcher, pickDefaultChild } from '../../components/child-switcher.js';
import { saveChildId } from '../../lib/bootstrap.js';
import { formatDateShort, formatMoney } from '../../lib/format.js';
import { toastError } from '../../lib/toast.js';

interface RankInfo {
  code: string;
  title: string;
  icon: string;
  minScore: number;
  next?: { code: string; minScore: number; remaining: number };
}

interface SubjectItem {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  testsCount: number;
}

interface AttemptItem {
  id: string;
  testTitle: string;
  status: string;
  scorePoints: number;
  correctCount: number;
  totalCount: number;
  percentCorrect: number;
  finishedAt: string | null;
  startedAt: string;
}

interface SubscriptionInfo {
  status: string;
  planName: string;
  priceRub: number;
  daysLeft: number | null;
  autoRenew: boolean;
  currentPeriodEnd: string | null;
}

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  isRead: boolean;
  createdAt: string;
}

export async function renderAppDashboard(): Promise<void> {
  const root = h('div');
  setRoot(appLayout({ active: 'home', title: 'Личный кабинет', content: root }));
  mount(root, loader('Загружаем данные...'));

  try {
    const user = store.getState().user;
    const isStaff =
      user !== null && ['manager', 'curator', 'admin', 'superadmin'].includes(user.role);

    const [childrenRes, subscriptionRes, notificationsRes] = await Promise.allSettled([
      api.get<{
        children: Array<{
          id: string;
          fullName: string;
          grade: number | null;
          balance: number;
          age: number;
          birthDate: string;
        }>;
      }>('/me/children'),
      api.get<{ subscription: SubscriptionInfo | null }>('/payments/subscription'),
      api.get<{ items: NotificationItem[]; unreadCount: number }>('/notifications?limit=20'),
    ]);

    const children = childrenRes.status === 'fulfilled' ? childrenRes.value.children : [];
    const subscription = subscriptionRes.status === 'fulfilled' ? subscriptionRes.value.subscription : null;
    const notifications = notificationsRes.status === 'fulfilled' ? notificationsRes.value.items : [];
    const unreadCount = notificationsRes.status === 'fulfilled' ? notificationsRes.value.unreadCount : 0;

    const saved = localStorage.getItem('ulybka:currentChildId');
    const stateBefore = store.getState();
    let currentId: string | null = null;

    if (stateBefore.currentChildId && children.some((c) => c.id === stateBefore.currentChildId)) {
      currentId = stateBefore.currentChildId;
    } else if (saved && children.some((c) => c.id === saved)) {
      currentId = saved;
    } else {
      currentId = pickDefaultChild(children);
    }

    store.setState({
      children,
      subscription,
      notificationsUnread: unreadCount,
      currentChildId: currentId,
    });
    if (currentId) saveChildId(currentId);

    if (children.length === 0 && !isStaff) {
      mount(root, h('div', { class: 'stack-lg' },
        isStaff && user ? staffBanner(user) : null,
        emptyState({
          illustration: 'welcome',
          title: 'Добавьте ребёнка',
          description: 'Чтобы начать заниматься, добавьте ребёнка в профиль. Это займёт минуту.',
          action: h('a', { class: 'btn btn-lg', href: '#/app/profile?tab=children' },
            icon('user-plus', { size: 18 }),
            'Добавить ребёнка'
          ),
        })
      ));
      return;
    }

    const contentHost = h('div', { class: 'dashboard-stack' });

    const renderContent = async (): Promise<void> => {
      clear(contentHost);

      const state = store.getState();
      const current = state.children.find((c) => c.id === state.currentChildId) ?? null;

      const switcher = current && state.children.length > 0
        ? childSwitcher({
            children: state.children,
            currentChildId: state.currentChildId,
            onChange: (id) => {
              store.setState({ currentChildId: id });
              saveChildId(id);
              void renderContent();
            },
          })
        : null;

      if (isStaff && user) {
        contentHost.appendChild(staffBanner(user));
      }

      if (!isStaff) {
        const sub = state.subscription;
        if (!sub) {
          contentHost.appendChild(subscriptionMissingBanner());
        } else if (sub.status === 'past_due') {
          contentHost.appendChild(subscriptionPastDueBanner());
        } else if (sub.status !== 'active') {
          contentHost.appendChild(subscriptionInactiveBanner(sub));
        }
      }

      if (current) {
        contentHost.appendChild(renderBalanceCard(current, switcher));
      }

      contentHost.appendChild(renderSubscriptionCard(state.subscription));

      if (current) {
        const rankHost = h('div', { class: 'anim-slide-up delay-1' });
        contentHost.appendChild(rankHost);
        void loadRank(rankHost, current.id);
      }

      contentHost.appendChild(renderSubjectsSection(current?.id ?? null));

      contentHost.appendChild(renderAttemptsSection(current?.id ?? null));

      const notif = renderNotifications(notifications);
      if (notif) contentHost.appendChild(notif);
    };

    await renderContent();
    mount(root, contentHost);
  } catch {
    toastError('Не удалось загрузить данные');
    mount(root, emptyState({
      illustration: 'error',
      title: 'Ошибка загрузки',
      description: 'Обновите страницу или попробуйте позже.',
      action: h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => router.reload(),
      }, 'Обновить'),
    }));
  }
}

async function loadRank(host: HTMLElement, childId: string): Promise<void> {
  try {
    const res = await api.get<{ items: unknown[]; rank: RankInfo }>(
      `/achievements/for-child/${encodeURIComponent(childId)}`
    );
    mount(host, renderRankCard(res.rank));
  } catch {
    clear(host);
  }
}

function renderRankCard(rank: RankInfo): HTMLElement {
  const nextText = rank.next
    ? `До «${rankTitle(rank.next.code)}» — ${rank.next.remaining}`
    : 'Максимальный статус';

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

  return h('div', {
    class: 'card card-pad anim-slide-up',
    style: 'background: linear-gradient(135deg, var(--c-primary-50) 0%, var(--c-surface) 100%); border-color: var(--c-primary);',
  },
    h('div', { class: 'row gap-4 row-wrap', style: 'align-items: center;' },
      h('div', {
        style: 'font-size: 44px; line-height: 1; flex: 0 0 auto;',
      }, rank.icon),
      h('div', { class: 'grow', style: 'min-width: 0;' },
        h('div', { class: 'text-xs text-muted uppercase tracking-wide' }, 'Статус'),
        h('div', { class: 'fw-800 mt-1', style: 'font-size: var(--fz-xl);' }, rank.title),
        h('div', { class: 'text-xs text-muted mt-1' }, nextText)
      ),
      h('a', {
        class: 'btn btn-secondary btn-sm',
        href: '#/app/achievements',
      }, 'Достижения')
    ),
    rank.next
      ? h('div', { class: 'progress progress-thin mt-4' },
          h('div', { class: 'progress-bar', style: `width: ${progressPct}%;` })
        )
      : null
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

function staffBanner(user: { role: string }): HTMLElement {
  return h('div', {
    class: 'card card-pad anim-slide-up',
    style: 'background: linear-gradient(135deg, var(--c-primary-50) 0%, var(--c-surface) 100%); border-color: var(--c-primary);',
  },
    h('div', { class: 'banner-inner' },
      h('div', { class: 'banner-body' },
        h('div', {
          class: 'feature-icon',
          style: 'margin: 0; width: 48px; height: 48px; flex: 0 0 auto;',
        }, icon('settings', { size: 22 })),
        h('div', { class: 'banner-text' },
          h('div', { class: 'fw-700' }, 'Вы вошли как сотрудник'),
          h('div', { class: 'text-sm text-muted mt-1' }, `Роль: ${user.role}`)
        )
      ),
      h('a', { class: 'btn banner-btn', href: '#/admin' },
        icon('arrow-right', { size: 16, className: 'icon icon-sm' }),
        'В админку'
      )
    )
  );
}

function subscriptionMissingBanner(): HTMLElement {
  return h('div', {
    class: 'card card-pad anim-slide-up',
    style: 'background: linear-gradient(135deg, var(--c-warning-bg) 0%, var(--c-surface) 100%); border-color: var(--c-warning);',
  },
    h('div', { class: 'banner-inner' },
      h('div', { class: 'banner-body' },
        h('div', {
          class: 'feature-icon',
          style: 'margin: 0; width: 48px; height: 48px; flex: 0 0 auto; background: var(--c-warning-bg); color: var(--c-peach-700);',
        }, icon('credit-card', { size: 22 })),
        h('div', { class: 'banner-text' },
          h('div', { class: 'fw-700' }, 'Подписка не оформлена'),
          h('div', { class: 'text-sm text-muted mt-1' }, 'Оформите за 141 ₽ / месяц')
        )
      ),
      h('a', { class: 'btn banner-btn', href: '#/app/payments' },
        icon('credit-card', { size: 16, className: 'icon icon-sm' }),
        'Оформить'
      )
    )
  );
}

function subscriptionPastDueBanner(): HTMLElement {
  return h('div', {
    class: 'card card-pad anim-slide-up',
    style: 'background: linear-gradient(135deg, var(--c-danger-bg) 0%, var(--c-surface) 100%); border-color: var(--c-danger);',
  },
    h('div', { class: 'banner-inner' },
      h('div', { class: 'banner-body' },
        h('div', {
          class: 'feature-icon',
          style: 'margin: 0; width: 48px; height: 48px; flex: 0 0 auto; background: var(--c-danger-bg); color: var(--c-coral-700);',
        }, icon('alert-triangle', { size: 22 })),
        h('div', { class: 'banner-text' },
          h('div', { class: 'fw-700' }, 'Оплата не прошла'),
          h('div', { class: 'text-sm text-muted mt-1' }, 'Проверьте карту и попробуйте снова')
        )
      ),
      h('a', { class: 'btn banner-btn btn-danger', href: '#/app/payments' },
        icon('credit-card', { size: 16, className: 'icon icon-sm' }),
        'Оплатить'
      )
    )
  );
}

function subscriptionInactiveBanner(sub: SubscriptionInfo): HTMLElement {
  return h('div', {
    class: 'card card-pad anim-slide-up',
    style: 'background: linear-gradient(135deg, var(--c-warning-bg) 0%, var(--c-surface) 100%); border-color: var(--c-warning);',
  },
    h('div', { class: 'banner-inner' },
      h('div', { class: 'banner-body' },
        h('div', {
          class: 'feature-icon',
          style: 'margin: 0; width: 48px; height: 48px; flex: 0 0 auto; background: var(--c-warning-bg); color: var(--c-peach-700);',
        }, icon('credit-card', { size: 22 })),
        h('div', { class: 'banner-text' },
          h('div', { class: 'fw-700' },
            `Подписка ${sub.status === 'canceled' ? 'отменена' : 'неактивна'}`
          ),
          h('div', { class: 'text-sm text-muted mt-1' }, 'Оформите заново, чтобы продолжить')
        )
      ),
      h('a', { class: 'btn banner-btn', href: '#/app/payments' },
        icon('credit-card', { size: 16, className: 'icon icon-sm' }),
        'Оформить'
      )
    )
  );
}

function renderBalanceCard(
  child: { id: string; fullName: string; grade: number | null; balance: number },
  switcher: HTMLElement | null
): HTMLElement {
  return h('div', { class: 'balance-card anim-slide-up' },
    h('div', { class: 'balance-top' },
      h('div', { class: 'balance-top-text' },
        h('div', { class: 'balance-label' }, 'Трудокоины'),
        h('div', { class: 'balance-value' }, String(child.balance))
      ),
      h('div', { class: 'balance-icon' }, icon('award', { size: 28 }))
    ),
    h('div', { class: 'balance-footer' },
      h('div', { class: 'balance-child-info' },
        h('div', { class: 'balance-child-name truncate' }, child.fullName),
        h('div', { class: 'balance-child-meta' },
          child.grade ? `${child.grade} класс` : 'Класс не указан'
        )
      ),
      h('div', { class: 'balance-actions' },
        switcher ? h('div', { class: 'balance-action-item balance-action-switcher' }, switcher) : null,
        h('a', {
          class: 'btn btn-sm balance-action-btn',
          href: '#/app/points',
        },
          icon('award', { size: 16, className: 'icon icon-sm' }),
          'История'
        ),
        h('a', {
          class: 'btn btn-sm balance-action-btn',
          href: '#/app/subjects',
        },
          icon('book-open', { size: 16, className: 'icon icon-sm' }),
          'К тестам'
        )
      )
    )
  );
}

function renderSubscriptionCard(sub: SubscriptionInfo | null): HTMLElement {
  if (sub) {
    return h('div', { class: 'card card-pad anim-slide-up delay-1' },
      h('div', { class: 'row-between mb-4 row-wrap gap-2' },
        h('div', { class: 'grow', style: 'min-width: 0;' },
          h('div', { class: 'text-xs text-muted' }, 'Подписка'),
          h('div', { class: 'fw-700 mt-1 truncate', style: 'font-size: var(--fz-lg);' }, sub.planName)
        ),
        statusBadge(sub.status)
      ),
      h('div', { class: 'info-grid-mobile' },
        renderInfoBlock('Стоимость', formatMoney(sub.priceRub)),
        renderInfoBlock('Автопродление', sub.autoRenew ? 'Включено' : 'Отключено'),
        sub.daysLeft !== null
          ? renderInfoBlock('Осталось', `${sub.daysLeft} дн.`)
          : null
      ),
      h('div', {
        class: 'alert alert-info mt-4',
        style: 'font-size: 13px;',
      },
        icon('heart', { size: 16, className: 'icon icon-sm alert-icon' }),
        h('div', null, '80% от каждой оплаты идёт в благотворительный фонд')
      ),
      h('a', {
        class: 'btn btn-secondary btn-sm btn-block mt-3',
        href: '#/app/payments',
      }, 'Управление подпиской')
    );
  }

  return h('div', { class: 'card card-pad anim-slide-up delay-1' },
    h('div', { class: 'row-between mb-4' },
      h('div', null,
        h('div', { class: 'text-xs text-muted' }, 'Подписка'),
        h('div', { class: 'fw-700 mt-1', style: 'font-size: var(--fz-lg);' }, 'Не оформлена')
      ),
      h('span', { class: 'badge badge-warning' }, 'Не оплачена')
    ),
    h('p', { class: 'text-sm text-muted mb-4' },
      'Оформите подписку, чтобы открыть все тесты и каталог подарков.'
    ),
    h('a', {
      class: 'btn btn-block',
      href: '#/app/payments',
    },
      icon('credit-card', { size: 18 }),
      'Оформить от 141 ₽'
    )
  );
}

function renderInfoBlock(label: string, value: string): HTMLElement {
  return h('div', { class: 'info-block-mobile' },
    h('div', { class: 'text-xs text-muted' }, label),
    h('div', { class: 'fw-600 mt-1' }, value)
  );
}

function renderSubjectsSection(childId: string | null): HTMLElement {
  const host = h('div');
  mount(host, loader());

  if (!childId) {
    mount(host, emptyState({ illustration: 'empty', title: 'Выберите ребёнка' }));
    return h('div', { class: 'dashboard-section' },
      h('div', { class: 'dashboard-section-head' },
        h('h2', { class: 'section-title-mobile' }, 'Дисциплины')
      ),
      host
    );
  }

  void loadSubjects(host, childId);

  return h('div', { class: 'dashboard-section anim-slide-up delay-2' },
    h('div', { class: 'dashboard-section-head' },
      h('h2', { class: 'section-title-mobile' }, 'Дисциплины'),
      h('a', { class: 'text-sm', href: '#/app/subjects' }, 'Все →')
    ),
    host
  );
}

async function loadSubjects(host: HTMLElement, childId: string): Promise<void> {
  try {
    const res = await api.get<{ items: SubjectItem[] }>(
      `/subjects?forChildId=${encodeURIComponent(childId)}`
    );

    if (res.items.length === 0) {
      mount(host, emptyState({
        illustration: 'no-tests',
        title: 'Пока нет доступных дисциплин',
        description: 'Для вашего ребёнка ещё не опубликованы тесты.',
      }));
      return;
    }

    mount(host, h('div', { class: 'subject-grid' },
      ...res.items.slice(0, 6).map((s) => renderSubjectCard(s))
    ));
  } catch {
    mount(host, emptyState({ illustration: 'error', title: 'Не удалось загрузить дисциплины' }));
  }
}

function renderSubjectCard(s: SubjectItem): HTMLElement {
  return h('a', {
    class: 'subject-card stagger-item',
    href: `#/app/tests?subject=${s.slug}`,
  },
    h('div', {
      class: 'subject-card-icon',
      style: `background: ${s.color ?? 'var(--c-primary)'};`,
    }, icon((s.icon as IconName) ?? 'book-open', { size: 24 })),
    h('div', { class: 'subject-card-title' }, s.title),
    s.description ? h('div', { class: 'subject-card-description' }, s.description) : null,
    h('div', { class: 'subject-card-footer' },
      h('span', { class: 'subject-card-count' },
        `${s.testsCount} ${pluralTests(s.testsCount)}`
      ),
      h('span', { class: 'subject-card-arrow' }, icon('arrow-right', { size: 18 }))
    )
  );
}

function pluralTests(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'тест';
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'теста';
  return 'тестов';
}

function renderAttemptsSection(childId: string | null): HTMLElement {
  const host = h('div');
  mount(host, loader());

  if (!childId) {
    return h('div', { class: 'dashboard-section' },
      h('div', { class: 'dashboard-section-head' },
        h('h2', { class: 'section-title-mobile' }, 'Последние результаты')
      ),
      emptyState({ illustration: 'empty', title: 'Выберите ребёнка' })
    );
  }

  void loadAttempts(host, childId);

  return h('div', { class: 'dashboard-section anim-slide-up delay-3' },
    h('div', { class: 'dashboard-section-head' },
      h('h2', { class: 'section-title-mobile' }, 'Последние результаты')
    ),
    host
  );
}

async function loadAttempts(host: HTMLElement, childId: string): Promise<void> {
  try {
    const res = await api.get<{ items: AttemptItem[]; total: number }>(
      `/attempts?childId=${encodeURIComponent(childId)}&limit=5`
    );

    if (res.items.length === 0) {
      mount(host, emptyState({
        illustration: 'no-tests',
        title: 'Пока нет результатов',
        description: 'Пройдите первый тест, чтобы увидеть результаты здесь.',
        action: h('a', { class: 'btn', href: '#/app/subjects' }, 'Выбрать тест'),
      }));
      return;
    }

    mount(host, h('div', { class: 'attempts-list-mobile' },
      ...res.items.map((a) => renderAttemptRow(a))
    ));
  } catch {
    mount(host, emptyState({ illustration: 'error', title: 'Не удалось загрузить историю' }));
  }
}

function renderAttemptRow(a: AttemptItem): HTMLElement {
  return h('div', { class: 'attempt-row-mobile' },
    h('div', { class: 'attempt-row-head' },
      h('div', { class: 'fw-600 truncate' }, a.testTitle ?? '—'),
      statusBadge(a.status)
    ),
    h('div', { class: 'attempt-row-meta' },
      h('span', { class: 'text-xs text-muted' }, formatDateShort(a.startedAt)),
      h('span', { class: 'text-xs' },
        `${a.correctCount}/${a.totalCount} · ${Math.round(a.percentCorrect)}%`
      ),
      h('span', { class: 'badge badge-primary' }, `+${a.scorePoints}`)
    ),
    h('a', {
      class: 'btn btn-secondary btn-sm btn-block mt-3',
      href: `#/app/result/${a.id}`,
    }, 'Открыть результат')
  );
}

function renderNotifications(items: NotificationItem[]): HTMLElement | null {
  if (items.length === 0) return null;

  return h('div', { class: 'card anim-slide-up delay-4' },
    h('div', { class: 'card-head' },
      h('div', { class: 'card-title' }, 'Последние уведомления'),
      h('a', { class: 'text-sm', href: '#/app/notifications' }, 'Все →')
    ),
    ...items.slice(0, 3).map((n) =>
      h('div', { class: `notification-item ${n.isRead ? '' : 'is-unread'}` },
        h('div', { class: 'notification-icon' }, icon('bell', { size: 18 })),
        h('div', { class: 'notification-body' },
          h('div', { class: 'notification-title' }, n.title),
          n.body ? h('div', { class: 'notification-text' }, n.body) : null,
          h('div', { class: 'notification-date' }, formatDateShort(n.createdAt))
        )
      )
    )
  );
}