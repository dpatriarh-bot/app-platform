// ============================================================
// pages/admin/checks.ts — очные проверки
// Kiosk-запуск через одноразовый токен.
// ============================================================

import { h, mount } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { router } from '../../lib/router.js';
import { adminLayout, setRoot } from '../../components/layout.js';
import { emptyState, loader, statusBadge, pillsTabs } from '../../components/ui.js';
import { openModal } from '../../lib/modal.js';
import { toastSuccess, toastError } from '../../lib/toast.js';
import { formatDateTime, formatDateShort } from '../../lib/format.js';

type Tab = 'candidates' | 'scheduled';

interface Candidate {
  childId: string;
  childName: string;
  parentId: string;
  flaggedCount: number;
  blockedCount: number;
  lastFlaggedAt: string | null;
  avgSuspicionScore: number;
}

interface SpotCheckItem {
  id: string;
  childId: string;
  childName: string;
  curatorId: string | null;
  curatorName: string | null;
  scheduledAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: string;
  verdict: string;
  timeLimitSec: number;
  correctCount: number;
  totalCount: number;
  scorePoints: number;
  notes: string | null;
  createdAt: string;
}

export async function renderAdminChecks(): Promise<void> {
  const currentTab = getTabFromUrl();

  const root = h('div');

  setRoot(adminLayout({
    active: 'checks',
    title: 'Очные проверки',
    content: root,
  }));

  mount(root, loader());

  try {
    const tabsEl = pillsTabs([
      {
        key: 'candidates',
        label: 'Кандидаты',
        active: currentTab === 'candidates',
        onClick: () => navigateTab('candidates'),
      },
      {
        key: 'scheduled',
        label: 'Назначенные',
        active: currentTab === 'scheduled',
        onClick: () => navigateTab('scheduled'),
      },
    ]);

    const contentHost = h('div', { class: 'anim-slide-up delay-1' });

    const renderTab = async (): Promise<void> => {
      mount(contentHost, loader());
      const tab = getTabFromUrl();
      if (tab === 'candidates') await renderCandidatesTab(contentHost);
      else await renderScheduledTab(contentHost);
    };

    const content = h('div', { class: 'stack-lg' },
      h('div', { style: 'display: flex; justify-content: center;' }, tabsEl),
      contentHost
    );

    mount(root, content);
    await renderTab();

    window.addEventListener('hashchange', () => void renderTab());
  } catch {
    mount(root, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить',
    }));
  }
}

function getTabFromUrl(): Tab {
  const hash = window.location.hash;
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return 'candidates';
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  return params.get('tab') === 'scheduled' ? 'scheduled' : 'candidates';
}

function navigateTab(tab: Tab): void {
  router.navigate(`/admin/checks?tab=${tab}`);
}

// ============================================================
// CANDIDATES
// ============================================================

async function renderCandidatesTab(host: HTMLElement): Promise<void> {
  try {
    const res = await api.get<{ items: Candidate[] }>(
      '/spot-checks/candidates?minFlagged=1&daysBack=60'
    );

    if (res.items.length === 0) {
      mount(host, emptyState({
        illustration: 'success',
        title: 'Кандидатов нет',
        description: 'Пока нет детей с подозрительными результатами.',
      }));
      return;
    }

    mount(host,
      h('div', { class: 'stack' },
        h('div', { class: 'alert alert-info' },
          icon('info', { size: 18, className: 'icon icon-sm alert-icon' }),
          h('div', null,
            h('div', { class: 'alert-title' }, 'Кандидаты на очную проверку'),
            'Дети с флагами фрода за последние 60 дней. Рекомендуем назначать проверку при 2+ флагах.'
          )
        ),
        h('div', { class: 'card' },
          h('div', { class: 'table-wrap', style: 'border: 0; border-radius: var(--r-lg);' },
            h('table', { class: 'table' },
              h('thead', null,
                h('tr', null,
                  h('th', null, 'Ребёнок'),
                  h('th', null, 'Флагов'),
                  h('th', null, 'Заблокировано'),
                  h('th', null, 'Ср. suspicion'),
                  h('th', null, 'Последний'),
                  h('th', null, '')
                )
              ),
              h('tbody', null,
                ...res.items.map((c) =>
                  h('tr', null,
                    h('td', { class: 'fw-600' }, c.childName || '—'),
                    h('td', null,
                      h('span', {
                        class: `badge ${c.flaggedCount >= 3 ? 'badge-danger' : 'badge-warning'}`,
                      }, String(c.flaggedCount))
                    ),
                    h('td', null,
                      c.blockedCount > 0
                        ? h('span', { class: 'badge badge-danger' }, String(c.blockedCount))
                        : h('span', { class: 'text-dim text-sm' }, '—')
                    ),
                    h('td', null,
                      h('div', { class: 'row gap-2' },
                        h('div', { class: 'suspicion-bar', style: 'width: 80px;' },
                          h('div', {
                            class: 'suspicion-bar-fill',
                            style: `width: ${Math.min(100, c.avgSuspicionScore)}%;`,
                          })
                        ),
                        h('span', { class: 'suspicion-value' }, String(c.avgSuspicionScore))
                      )
                    ),
                    h('td', { class: 'text-sm text-muted nowrap' },
                      c.lastFlaggedAt ? formatDateShort(c.lastFlaggedAt) : '—'
                    ),
                    h('td', null,
                      h('button', {
                        class: 'btn btn-sm',
                        type: 'button',
                        onclick: () => openScheduleModal(c, () => router.reload()),
                      },
                        icon('shield', { size: 14, className: 'icon icon-sm' }),
                        'Назначить'
                      )
                    )
                  )
                )
              )
            )
          )
        )
      )
    );
  } catch {
    mount(host, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить кандидатов',
    }));
  }
}

// ============================================================
// SCHEDULED
// ============================================================

async function renderScheduledTab(host: HTMLElement): Promise<void> {
  try {
    const res = await api.get<{ items: SpotCheckItem[]; total: number }>(
      '/spot-checks?limit=100'
    );

    if (res.items.length === 0) {
      mount(host, emptyState({
        illustration: 'empty',
        title: 'Проверок пока нет',
        description: 'Назначьте проверку из раздела «Кандидаты».',
      }));
      return;
    }

    mount(host,
      h('div', { class: 'stack stagger' },
        ...res.items.map((s) => renderCheckCard(s))
      )
    );
  } catch {
    mount(host, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить',
    }));
  }
}

function renderCheckCard(s: SpotCheckItem): HTMLElement {
  const actions = h('div', { class: 'row gap-2 row-wrap mt-4' });

  if (s.status === 'scheduled') {
    actions.appendChild(
      h('button', {
        class: 'btn btn-sm',
        type: 'button',
        onclick: () => void launchKiosk(s),
      },
        icon('play', { size: 14, className: 'icon icon-sm' }),
        'Запустить проверку'
      )
    );
  }

  if (s.status === 'completed' && s.verdict === 'pending') {
    actions.appendChild(
      h('button', {
        class: 'btn btn-success btn-sm',
        type: 'button',
        onclick: () => openVerdictModal(s, 'confirmed', () => router.reload()),
      }, 'Подтвердить')
    );
    actions.appendChild(
      h('button', {
        class: 'btn btn-danger btn-sm',
        type: 'button',
        onclick: () => openVerdictModal(s, 'rejected', () => router.reload()),
      }, 'Отклонить')
    );
    actions.appendChild(
      h('button', {
        class: 'btn btn-secondary btn-sm',
        type: 'button',
        onclick: () => openVerdictModal(s, 'partial', () => router.reload()),
      }, 'Частично')
    );
  }

  return h('div', { class: 'card card-pad stagger-item' },
    h('div', { class: 'row-between row-wrap gap-3' },
      h('div', { class: 'row gap-3', style: 'min-width: 0;' },
        h('div', {
          class: 'feature-icon',
          style: 'width: 44px; height: 44px; margin: 0; flex: 0 0 auto;',
        }, icon('shield', { size: 22 })),
        h('div', { style: 'min-width: 0;' },
          h('div', { class: 'fw-700' }, s.childName || '—'),
          h('div', { class: 'text-xs text-muted mt-1' },
            `Назначена: ${formatDateTime(s.scheduledAt)}`
          )
        )
      ),
      h('div', { class: 'row gap-2 row-wrap' },
        statusBadge(s.status),
        s.status === 'completed' ? statusBadge(s.verdict) : null
      )
    ),
    s.status === 'completed'
      ? h('div', { class: 'row row-wrap gap-3 mt-3' },
          chip('Результат', `${s.correctCount}/${s.totalCount}`),
          chip('Баллы', `+${s.scorePoints}`),
          s.finishedAt ? chip('Завершена', formatDateShort(s.finishedAt)) : null
        )
      : null,
    s.notes ? h('div', { class: 'text-sm text-muted mt-3' }, s.notes) : null,
    actions
  );
}

function chip(label: string, value: string): HTMLElement {
  return h('div', { style: 'min-width: 0;' },
    h('div', { class: 'text-xs text-muted' }, label),
    h('div', { class: 'fw-600 text-sm mt-1' }, value)
  );
}

// ============================================================
// LAUNCH KIOSK — через одноразовый токен
// ============================================================

async function launchKiosk(s: SpotCheckItem): Promise<void> {
  try {
    const res = await api.post<{ token: string }>(`/spot-checks/${s.id}/kiosk-token`, {});
    const url = `${window.location.origin}${window.location.pathname}#/app/check/${s.id}?token=${encodeURIComponent(res.token)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    toastSuccess('Открыто на новом устройстве');
  } catch (err) {
    toastError(isApiError(err) ? err.message : 'Не удалось получить токен');
  }
}

// ============================================================
// SCHEDULE MODAL
// ============================================================

function openScheduleModal(candidate: Candidate, onSuccess: () => void): void {
  const dateInput = h('input', {
    class: 'input',
    type: 'datetime-local',
  }) as HTMLInputElement;

  const now = new Date();
  now.setDate(now.getDate() + 1);
  now.setHours(15, 0, 0, 0);
  dateInput.value = toLocalISO(now);

  const timeLimitInput = h('input', {
    class: 'input',
    type: 'number',
    value: '1200',
    min: '300',
    max: '3600',
  }) as HTMLInputElement;

  const notesInput = h('textarea', {
    class: 'textarea',
    placeholder: 'Комментарий для куратора',
  }) as HTMLTextAreaElement;

  const body = h('div', { class: 'stack' },
    h('div', { class: 'card card-pad' },
      h('div', { class: 'fw-700' }, candidate.childName || 'Ребёнок'),
      h('div', { class: 'text-xs text-muted mt-1' },
        `Флагов: ${candidate.flaggedCount}, средний suspicion: ${candidate.avgSuspicionScore}`
      )
    ),
    h('div', { class: 'field' },
      h('label', { class: 'field-label' }, 'Дата и время проверки'),
      dateInput
    ),
    h('div', { class: 'field' },
      h('label', { class: 'field-label' }, 'Лимит времени (сек)'),
      timeLimitInput
    ),
    h('div', { class: 'field' },
      h('label', { class: 'field-label' }, 'Комментарий'),
      notesInput
    ),
    h('div', { class: 'alert alert-warning' },
      icon('alert-triangle', { size: 18, className: 'icon icon-sm alert-icon' }),
      'Родитель получит уведомление. Ребёнок должен прийти на проверку в центр.'
    )
  );

  openModal({
    title: 'Назначить очную проверку',
    body,
    size: 'md',
    actions: [
      { label: 'Отмена', variant: 'secondary' },
      {
        label: 'Назначить',
        variant: 'primary',
        onClick: async () => {
          try {
            await api.post('/spot-checks', {
              childId: candidate.childId,
              scheduledAt: new Date(dateInput.value).toISOString(),
              timeLimitSec: parseInt(timeLimitInput.value, 10),
              notes: notesInput.value.trim() || undefined,
            });
            toastSuccess('Проверка назначена');
            onSuccess();
            return true;
          } catch (err) {
            toastError(isApiError(err) ? err.message : 'Ошибка');
            return false;
          }
        },
      },
    ],
  });
}

function toLocalISO(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ============================================================
// VERDICT MODAL
// ============================================================

function openVerdictModal(
  s: SpotCheckItem,
  verdict: 'confirmed' | 'rejected' | 'partial',
  onSuccess: () => void
): void {
  const notesInput = h('textarea', {
    class: 'textarea',
    placeholder: 'Комментарий',
  }) as HTMLTextAreaElement;

  const body = h('div', { class: 'stack' },
    h('p', { class: 'text-sm text-muted' },
      verdict === 'confirmed'
        ? 'Все результаты подтверждены. Баллы за проверку будут начислены.'
        : verdict === 'rejected'
          ? 'Все баллы за связанные попытки будут аннулированы.'
          : 'Вердикт частичного подтверждения. Баллы не начисляются.'
    ),
    h('div', { class: 'field' },
      h('label', { class: 'field-label' }, 'Комментарий'),
      notesInput
    )
  );

  openModal({
    title:
      verdict === 'confirmed'
        ? 'Подтвердить результаты'
        : verdict === 'rejected'
          ? 'Отклонить результаты'
          : 'Частично подтвердить',
    body,
    size: 'md',
    actions: [
      { label: 'Отмена', variant: 'secondary' },
      {
        label: 'Подтвердить вердикт',
        variant: verdict === 'rejected' ? 'danger' : 'primary',
        onClick: async () => {
          try {
            await api.post(`/spot-checks/${s.id}/verdict`, {
              verdict,
              notes: notesInput.value.trim() || undefined,
            });
            toastSuccess('Вердикт установлен');
            onSuccess();
            return true;
          } catch (err) {
            toastError(isApiError(err) ? err.message : 'Ошибка');
            return false;
          }
        },
      },
    ],
  });
}