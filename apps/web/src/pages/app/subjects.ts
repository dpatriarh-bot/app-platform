// ============================================================
// pages/app/subjects.ts — выбор дисциплины
// Трудокоины.
// ============================================================

import { h, mount, clear } from '../../lib/dom.js';
import { icon, type IconName } from '../../lib/icons.js';
import { api } from '../../lib/api.js';
import { store } from '../../lib/store.js';
import { router } from '../../lib/router.js';
import { appLayout, setRoot } from '../../components/layout.js';
import { emptyState, loader } from '../../components/ui.js';
import { childSwitcher } from '../../components/child-switcher.js';
import { saveChildId } from '../../lib/bootstrap.js';
import { toastError } from '../../lib/toast.js';

interface SubjectItem {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  testsCount: number;
}

interface SubscriptionInfo {
  status: string;
  planName: string;
  priceRub: number;
  daysLeft: number | null;
  autoRenew: boolean;
}

export async function renderAppSubjects(): Promise<void> {
  const root = h('div');
  setRoot(appLayout({
    active: 'subjects',
    title: 'Дисциплины',
    subtitle: 'Выберите предмет, чтобы начать заниматься',
    content: root,
  }));
  mount(root, loader());

  try {
    const [childrenRes, subscriptionRes] = await Promise.all([
      api.get<{
        children: Array<{ id: string; fullName: string; grade: number | null; balance: number }>;
      }>('/me/children'),
      api.get<{ subscription: SubscriptionInfo | null }>('/payments/subscription').catch(() => ({
        subscription: null,
      })),
    ]);

    const children = childrenRes.children;
    const subscription = subscriptionRes.subscription;

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

    store.setState({ children, subscription, currentChildId: currentId });
    if (currentId) saveChildId(currentId);

    if (children.length === 0) {
      mount(root, emptyState({
        illustration: 'welcome',
        title: 'Сначала добавьте ребёнка',
        description: 'Чтобы начать заниматься, добавьте ребёнка в профиль.',
        action: h('a', {
          class: 'btn btn-lg',
          href: '#/app/profile?tab=children',
        },
          icon('user-plus', { size: 18 }),
          'Добавить ребёнка'
        ),
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

      const hasActiveSubscription = state.subscription?.status === 'active';

      const switcher = childSwitcher({
        children: state.children,
        currentChildId: state.currentChildId,
        onChange: (id) => {
          store.setState({ currentChildId: id });
          saveChildId(id);
          void renderContent();
        },
      });

      let subjects: SubjectItem[] = [];
      try {
        const subjectsRes = await api.get<{ items: SubjectItem[] }>(
          `/subjects?forChildId=${encodeURIComponent(child.id)}`
        );
        subjects = subjectsRes.items;
      } catch {
        subjects = [];
      }

      const searchInput = h('input', {
        class: 'input',
        type: 'search',
        placeholder: 'Поиск дисциплины...',
        oninput: () => rerenderGrid(searchInput.value.trim().toLowerCase()),
      }) as HTMLInputElement;

      const gridHost = h('div', { class: 'stagger' });

      const rerenderGrid = (q: string): void => {
        const filtered = q
          ? subjects.filter((s) => s.title.toLowerCase().includes(q))
          : subjects;

        if (filtered.length === 0) {
          mount(gridHost, emptyState({
            illustration: 'search-empty',
            title: 'Ничего не найдено',
            description: 'Попробуйте изменить запрос.',
          }));
          return;
        }

        mount(gridHost, h('div', { class: 'subject-grid' },
          ...filtered.map((s) => renderSubjectCard(s))
        ));
      };

      contentHost.appendChild(h('div', { class: 'stack-lg' },
        !hasActiveSubscription
          ? h('div', {
              class: 'card card-pad anim-slide-up',
              style: 'background: linear-gradient(135deg, var(--c-warning-bg) 0%, var(--c-surface) 100%); border-color: var(--c-warning);',
            },
              h('div', { class: 'row-between row-wrap gap-3' },
                h('div', { class: 'row gap-3' },
                  h('div', {
                    class: 'feature-icon',
                    style: 'margin: 0; width: 48px; height: 48px; background: var(--c-warning-bg); color: var(--c-peach-700);',
                  }, icon('credit-card', { size: 22 })),
                  h('div', null,
                    h('div', { class: 'fw-700' }, 'Подписка не оформлена'),
                    h('div', { class: 'text-sm text-muted mt-1' },
                      'Оформите от 141 ₽ / месяц, чтобы открыть тесты'
                    )
                  )
                ),
                h('a', {
                  class: 'btn',
                  href: '#/app/payments',
                },
                  icon('arrow-right', { size: 16, className: 'icon icon-sm' }),
                  `Оформить`
                )
              )
            )
          : null,

        h('div', { class: 'card card-pad anim-slide-up' },
          h('div', { class: 'row-between row-wrap gap-4' },
            h('div', { class: 'row gap-3 grow', style: 'min-width: 0;' },
              h('div', { class: 'avatar' }, initials(child.fullName)),
              h('div', { class: 'grow', style: 'min-width: 0;' },
                h('div', { class: 'fw-700 truncate' }, child.fullName),
                h('div', { class: 'text-xs text-muted mt-1' },
                  child.grade ? `${child.grade} класс` : 'Класс не указан',
                  ' · ',
                  `${child.balance} трудокоинов`
                )
              )
            ),
            switcher
          )
        ),

        h('div', { class: 'row-between row-wrap gap-3 anim-slide-up delay-1' },
          h('div', { class: 'grow', style: 'max-width: 360px;' }, searchInput),
          h('div', { class: 'text-sm text-muted nowrap' },
            `Найдено: ${subjects.length}`
          )
        ),

        gridHost
      ));

      rerenderGrid('');
    };

    await renderContent();
    mount(root, contentHost);
  } catch {
    toastError('Не удалось загрузить дисциплины');
    mount(root, emptyState({
      illustration: 'error',
      title: 'Ошибка загрузки',
      action: h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => router.reload(),
      }, 'Обновить'),
    }));
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}