// ============================================================
// pages/app/notifications.ts — уведомления с группировкой
// ============================================================

import { h, mount, clear } from '../../lib/dom.js';
import { icon, type IconName } from '../../lib/icons.js';
import { api } from '../../lib/api.js';
import { store } from '../../lib/store.js';
import { router } from '../../lib/router.js';
import { appLayout, setRoot } from '../../components/layout.js';
import { emptyState, loader, pillsTabs } from '../../components/ui.js';
import { toastSuccess, toastError } from '../../lib/toast.js';
import { formatDateTime } from '../../lib/format.js';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

const ICON_MAP: Record<string, IconName> = {
  attempt_finished: 'check-circle',
  attempt_flagged: 'flag',
  points_awarded: 'award',
  points_deducted: 'minus',
  subscription_active: 'credit-card',
  subscription_expiring: 'clock',
  subscription_past_due: 'alert-triangle',
  redemption_issued: 'gift',
  redemption_redeemed: 'check-circle',
  spot_check_scheduled: 'shield',
  spot_check_verdict: 'shield-off',
  mailing: 'send',
  system: 'info',
};

const TYPE_LABELS: Record<string, string> = {
  attempt_finished: 'Результаты',
  attempt_flagged: 'Флаги',
  points_awarded: 'Начисления',
  points_deducted: 'Списания',
  subscription_active: 'Подписка',
  subscription_expiring: 'Подписка',
  subscription_past_due: 'Подписка',
  redemption_issued: 'Подарки',
  redemption_redeemed: 'Подарки',
  spot_check_scheduled: 'Проверки',
  spot_check_verdict: 'Проверки',
  mailing: 'Рассылки',
  system: 'Система',
};

type Tab = 'all' | 'unread';

export async function renderAppNotifications(): Promise<void> {
  const currentTab = getTabFromUrl();

  const root = h('div');
  setRoot(appLayout({
    active: 'notifications',
    title: 'Уведомления',
    subtitle: 'Результаты, начисления и напоминания',
    content: root,
  }));
  mount(root, loader());

  try {
    const res = await api.get<{
      items: NotificationItem[];
      unreadCount: number;
    }>('/notifications?limit=200');

    store.setState({ notificationsUnread: res.unreadCount });

    const tabsEl = pillsTabs([
      {
        key: 'all',
        label: `Все (${res.items.length})`,
        active: currentTab === 'all',
        onClick: () => navigateTab('all'),
      },
      {
        key: 'unread',
        label: `Непрочитанные (${res.unreadCount})`,
        active: currentTab === 'unread',
        onClick: () => navigateTab('unread'),
      },
    ]);

    const markAllBtn = res.unreadCount > 0
      ? h('button', {
          class: 'btn btn-secondary btn-sm',
          type: 'button',
          onclick: async () => {
            try {
              await api.post('/notifications/read-all', {});
              toastSuccess('Все прочитаны');
              store.setState({ notificationsUnread: 0 });
              router.reload();
            } catch {
              toastError('Не удалось отметить');
            }
          },
        },
          icon('check', { size: 16, className: 'icon icon-sm' }),
          'Прочитать все'
        )
      : null;

    const content = h('div', { class: 'stack-lg anim-slide-up' },
      h('div', { class: 'row-between row-wrap gap-3' },
        h('div', { class: 'text-sm text-muted' },
          res.unreadCount > 0 ? `${res.unreadCount} новых` : 'Все прочитаны'
        ),
        markAllBtn
      ),
      h('div', { style: 'display: flex; justify-content: center;' }, tabsEl),
      renderList(res.items, currentTab)
    );

    mount(root, content);
  } catch {
    mount(root, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить уведомления',
    }));
  }
}

function renderList(items: NotificationItem[], tab: Tab): HTMLElement {
  const filtered = tab === 'unread' ? items.filter((n) => !n.isRead) : items;

  if (filtered.length === 0) {
    return emptyState({
      illustration: 'no-notifications',
      title: tab === 'unread' ? 'Нет непрочитанных' : 'Пока нет уведомлений',
      description: 'Здесь появятся результаты тестов, начисления баллов и напоминания о подписке.',
    });
  }

  // Группировка по «категории типа»
  const groups = new Map<string, NotificationItem[]>();
  for (const n of filtered) {
    const key = TYPE_LABELS[n.type] ?? 'Прочее';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n);
  }

  const container = h('div', { class: 'stack-lg' });

  // Сортируем группы по максимальной дате
  const sortedGroups = [...groups.entries()].sort((a, b) => {
    const aMax = Math.max(...a[1].map((n) => new Date(n.createdAt).getTime()));
    const bMax = Math.max(...b[1].map((n) => new Date(n.createdAt).getTime()));
    return bMax - aMax;
  });

  for (const [groupName, groupItems] of sortedGroups) {
    const unreadInGroup = groupItems.filter((n) => !n.isRead).length;

    container.appendChild(
      h('div', { class: 'anim-slide-up' },
        h('div', { class: 'row-between row-wrap gap-3 mb-3' },
          h('div', { class: 'row gap-2' },
            h('h3', { style: 'font-size: var(--fz-lg);' }, groupName),
            unreadInGroup > 0
              ? h('span', { class: 'badge badge-primary' }, String(unreadInGroup))
              : null
          ),
          h('div', { class: 'text-xs text-muted' },
            `${groupItems.length} ${pluralItems(groupItems.length)}`
          )
        ),
        h('div', { class: 'card stagger' },
          ...groupItems.map((n) => renderItem(n))
        )
      )
    );
  }

  return container;
}

function renderItem(n: NotificationItem): HTMLElement {
  const handleClick = async (): Promise<void> => {
    if (n.link) {
      router.navigate(n.link.replace(/^#/, ''));
    }
    if (!n.isRead) {
      try {
        await api.post(`/notifications/${n.id}/read`, {});
        store.setState((s) => ({
          notificationsUnread: Math.max(0, s.notificationsUnread - 1),
        }));
      } catch {
        // ignore
      }
    }
  };

  return h('div', {
    class: `notification-item ${n.isRead ? '' : 'is-unread'} stagger-item`,
    style: 'cursor: pointer;',
    onclick: handleClick,
  },
    h('div', { class: 'notification-icon' },
      icon(ICON_MAP[n.type] ?? 'bell', { size: 18 })
    ),
    h('div', { class: 'notification-body' },
      h('div', { class: 'row-between' },
        h('div', { class: 'notification-title' }, n.title),
        !n.isRead ? h('span', { class: 'notification-dot' }) : null
      ),
      n.body ? h('div', { class: 'notification-text' }, n.body) : null,
      h('div', { class: 'notification-date' }, formatDateTime(n.createdAt))
    )
  );
}

function getTabFromUrl(): Tab {
  const hash = window.location.hash;
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return 'all';
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  return params.get('tab') === 'unread' ? 'unread' : 'all';
}

function navigateTab(tab: Tab): void {
  router.navigate(tab === 'unread' ? '/app/notifications?tab=unread' : '/app/notifications');
}

function pluralItems(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'уведомление';
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'уведомления';
  return 'уведомлений';
}

void clear;