// ============================================================
// pages/admin/anomalies.ts — аномалии по IP/устройствам
// ============================================================

import { h, mount } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { router } from '../../lib/router.js';
import { adminLayout, setRoot } from '../../components/layout.js';
import { emptyState, loader } from '../../components/ui.js';

interface AnomaliesData {
  sharedIps: Array<{ ip: string; usersCount: number; userIds: string[] }>;
  sharedFingerprints: Array<{ fingerprint: string; attemptsCount: number; childIds: string[] }>;
  burstRegistrations: Array<{ date: string; count: number }>;
}

export async function renderAdminAnomalies(): Promise<void> {
  const root = h('div');

  setRoot(adminLayout({
    active: 'anomalies',
    title: 'Аномалии',
    subtitle: 'Общие IP, fingerprints и всплески регистраций',
    content: root,
  }));

  mount(root, loader());

  try {
    const res = await api.get<AnomaliesData>('/admin/anomalies?days=14');

    const content = h('div', { class: 'stack-lg' },
      card('Общие IP', 'users', res.sharedIps.length === 0
        ? 'Общих IP не обнаружено'
        : null,
        res.sharedIps.map((r) =>
          h('div', { class: 'anomaly-item' },
            h('div', { class: 'anomaly-head' },
              h('div', { class: 'anomaly-key' }, r.ip),
              h('span', { class: 'badge badge-warning' }, `${r.usersCount} пользователей`)
            ),
            h('div', { class: 'anomaly-meta' },
              r.userIds.join(', ')
            )
          )
        )
      ),

      card('Общие fingerprints', 'activity',
        res.sharedFingerprints.length === 0
          ? 'Общих fingerprints не обнаружено'
          : null,
        res.sharedFingerprints.map((r) =>
          h('div', { class: 'anomaly-item' },
            h('div', { class: 'anomaly-head' },
              h('div', { class: 'anomaly-key' }, r.fingerprint),
              h('span', { class: 'badge badge-warning' }, `${r.attemptsCount} попыток`)
            ),
            h('div', { class: 'anomaly-meta' },
              r.childIds.join(', ')
            )
          )
        )
      ),

      card('Всплески регистраций', 'trending-up',
        res.burstRegistrations.length === 0
          ? 'Аномалий не обнаружено'
          : null,
        res.burstRegistrations.map((r) =>
          h('div', { class: 'anomaly-item row-between' },
            h('div', { class: 'fw-600' }, r.date),
            h('span', { class: 'badge badge-danger' }, `${r.count} регистраций`)
          )
        )
      )
    );

    mount(root, content);
  } catch (err) {
    mount(root, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить',
      action: h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => router.reload(),
      }, 'Обновить'),
    }));
  }
}

function card(
  title: string,
  iconName: string,
  emptyMessage: string | null,
  items: HTMLElement[]
): HTMLElement {
  return h('div', { class: 'anim-slide-up' },
    h('h3', { class: 'row gap-2', style: 'margin-bottom: var(--sp-5);' },
      icon(iconName as never, { size: 20 }),
      title
    ),
    items.length === 0
      ? h('div', { class: 'card card-pad text-muted text-sm' }, emptyMessage ?? 'Пусто')
      : h('div', { class: 'stack-sm' }, ...items)
  );
}