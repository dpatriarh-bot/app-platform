// ============================================================
// pages/app/points.ts — история трудокоинов
// ============================================================

import { h, mount, clear } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { api } from '../../lib/api.js';
import { store } from '../../lib/store.js';
import { router } from '../../lib/router.js';
import { appLayout, setRoot } from '../../components/layout.js';
import { emptyState, loader } from '../../components/ui.js';
import { childSwitcher } from '../../components/child-switcher.js';
import { saveChildId } from '../../lib/bootstrap.js';
import { formatDateTime } from '../../lib/format.js';

interface LedgerEntry {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  description: string | null;
  attemptId: string | null;
  createdAt: string;
}

const REASON_LABELS: Record<string, string> = {
  attempt_reward: 'За тест',
  manual_adjust: 'Корректировка',
  redemption: 'Обмен на подарок',
  referral_bonus: 'Бонус за друга',
  spot_check_confirmed: 'Подтверждение',
  fraud_reversal: 'Аннулирование',
  signup_bonus: 'Бонус за регистрацию',
  achievement_reward: 'Ачивка',
  social_reward: 'Соцсети',
  donation_cashback: 'Кешбэк за донат',
};

export async function renderAppPoints(): Promise<void> {
  const root = h('div');
  setRoot(appLayout({
    active: 'points',
    title: 'История трудокоинов',
    subtitle: 'Все начисления и списания',
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

      let entries: LedgerEntry[] = [];
      try {
        const ledgerRes = await api.get<{ items: LedgerEntry[]; total: number }>(
          `/points/ledger?childId=${encodeURIComponent(child.id)}&limit=100`
        );
        entries = ledgerRes.items;
      } catch {
        entries = [];
      }

      contentHost.appendChild(h('div', { class: 'stack-lg' },
        h('div', { class: 'card card-pad anim-slide-up' },
          h('div', { class: 'row-between row-wrap gap-4' },
            h('div', { class: 'row gap-3 grow', style: 'min-width: 0;' },
              h('div', { class: 'avatar' }, initials(child.fullName)),
              h('div', { class: 'grow', style: 'min-width: 0;' },
                h('div', { class: 'fw-700 truncate' }, child.fullName),
                h('div', { class: 'text-xs text-muted mt-1' },
                  child.grade ? `${child.grade} класс` : 'Класс не указан'
                )
              )
            ),
            switcher
          ),
          h('div', { class: 'row-between mt-5 row-wrap gap-3' },
            h('div', null,
              h('div', { class: 'text-xs text-muted' }, 'Текущий баланс'),
              h('div', { class: 'balance-value-small' }, String(child.balance))
            ),
            h('a', { class: 'btn', href: '#/app/catalog' },
              icon('gift', { size: 18 }),
              'К подаркам'
            )
          )
        ),

        entries.length === 0
          ? emptyState({
              illustration: 'empty',
              title: 'Пока нет операций',
              description: 'Пройдите тест, чтобы заработать первые трудокоины.',
              action: h('a', { class: 'btn', href: '#/app/subjects' }, 'К тестам'),
            })
          : h('div', { class: 'ledger-list-mobile stagger' },
              ...entries.map((e) => renderRow(e))
            )
      ));
    };

    await renderContent();
    mount(root, contentHost);
  } catch {
    mount(root, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить историю',
      action: h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => router.reload(),
      }, 'Обновить'),
    }));
  }
}

function renderRow(e: LedgerEntry): HTMLElement {
  const isPositive = e.delta > 0;

  return h('div', { class: 'ledger-row-mobile stagger-item' },
    h('div', { class: 'row-between' },
      h('div', { class: 'grow', style: 'min-width: 0;' },
        h('div', { class: 'fw-600 truncate' }, REASON_LABELS[e.reason] ?? e.reason),
        e.description ? h('div', { class: 'text-xs text-muted mt-1' }, e.description) : null
      ),
      h('span', {
        class: `badge ${isPositive ? 'badge-success' : 'badge-danger'} nowrap`,
      }, `${isPositive ? '+' : ''}${e.delta}`)
    ),
    h('div', { class: 'row-between mt-2' },
      h('span', { class: 'text-xs text-muted' }, formatDateTime(e.createdAt)),
      h('span', { class: 'text-xs text-muted' }, `Баланс: ${e.balanceAfter}`)
    )
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}