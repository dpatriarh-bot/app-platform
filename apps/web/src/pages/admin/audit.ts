// ============================================================
// pages/admin/audit.ts — журнал действий (superadmin)
// + экспорт CSV.
// ============================================================

import { h, mount } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { router } from '../../lib/router.js';
import { adminLayout, setRoot } from '../../components/layout.js';
import { emptyState, loader, pagination } from '../../components/ui.js';
import { openModal } from '../../lib/modal.js';
import { formatDateTime } from '../../lib/format.js';
import { toastSuccess, toastError } from '../../lib/toast.js';

interface AuditItem {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
}

const PAGE_SIZE = 50;

export async function renderAdminAudit(): Promise<void> {
  const params = getQueryParams();
  const page = parseInt(params.get('page') ?? '1', 10) || 1;
  const action = params.get('action') ?? '';
  const entity = params.get('entity') ?? '';

  const root = h('div');

  setRoot(adminLayout({
    active: 'audit',
    title: 'Аудит',
    subtitle: 'Журнал действий (только superadmin)',
    actions: [
      h('button', {
        class: 'btn btn-secondary',
        type: 'button',
        onclick: () => openExportModal(),
      },
        icon('download', { size: 18 }),
        'Экспорт'
      ),
    ],
    content: root,
  }));

  mount(root, loader());

  try {
    const qs = new URLSearchParams();
    qs.set('limit', String(PAGE_SIZE));
    qs.set('offset', String((page - 1) * PAGE_SIZE));
    if (action) qs.set('action', action);
    if (entity) qs.set('entity', entity);

    const res = await api.get<{ items: AuditItem[]; total: number }>(`/admin/audit?${qs}`);

    const totalPages = Math.max(1, Math.ceil(res.total / PAGE_SIZE));

    const actionInput = h('input', {
      class: 'input',
      placeholder: 'action (например, auth.login)',
      value: action,
      style: 'max-width: 280px;',
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter') navigateWithFilters({ action: actionInput.value, page: 1 });
      },
    }) as HTMLInputElement;

    const entityInput = h('input', {
      class: 'input',
      placeholder: 'entity (например, user)',
      value: entity,
      style: 'max-width: 220px;',
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter') navigateWithFilters({ entity: entityInput.value, page: 1 });
      },
    }) as HTMLInputElement;

    const content = h('div', { class: 'stack-lg' },
      h('div', { class: 'row gap-3 row-wrap anim-slide-up' },
        actionInput,
        entityInput,
        h('button', {
          class: 'btn btn-secondary btn-sm',
          type: 'button',
          onclick: () => navigateWithFilters({ action: '', entity: '', page: 1 }),
        }, 'Сбросить')
      ),

      h('div', { class: 'text-sm text-muted' }, `Записей: ${res.total}`),

      res.items.length === 0
        ? emptyState({
            illustration: 'search-empty',
            title: 'Записей не найдено',
            description: 'Измените фильтры или загляните позже.',
          })
        : h('div', { class: 'card anim-slide-up delay-1' },
            h('div', { class: 'table-wrap', style: 'border: 0; border-radius: var(--r-lg);' },
              h('table', { class: 'table' },
                h('thead', null,
                  h('tr', null,
                    h('th', null, 'Время'),
                    h('th', null, 'Актор'),
                    h('th', null, 'Действие'),
                    h('th', null, 'Объект'),
                    h('th', null, 'IP'),
                    h('th', null, '')
                  )
                ),
                h('tbody', null,
                  ...res.items.map((a) => renderRow(a))
                )
              )
            )
          ),

      res.total > PAGE_SIZE
        ? pagination({
            page,
            totalPages,
            onChange: (p) => navigateWithFilters({ page: p }),
          })
        : null
    );

    mount(root, content);
  } catch (err) {
    mount(root, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить журнал',
      description: isApiError(err) ? err.message : 'Попробуйте позже',
    }));
  }
}

function renderRow(a: AuditItem): HTMLElement {
  const actorCell = h('div', null,
    h('div', { class: 'text-xs mono' }, a.actorId ? a.actorId.slice(0, 8) : '—'),
    a.actorRole ? h('div', { class: 'text-xs text-muted mt-1' }, a.actorRole) : null
  );

  const entityCell = h('div', null,
    h('div', { class: 'text-sm' }, a.entity),
    a.entityId ? h('div', { class: 'text-xs text-muted mt-1 mono' }, a.entityId.slice(0, 8)) : null
  );

  return h('tr', null,
    h('td', { 'data-label-role': 'title' },
      h('div', { class: 'row-between row-wrap gap-2' },
        h('div', { class: 'text-sm text-muted nowrap' }, formatDateTime(a.createdAt))
      )
    ),
    h('td', { 'data-label': 'Актор' }, actorCell),
    h('td', { 'data-label': 'Действие' }, h('span', { class: 'badge badge-primary' }, a.action)),
    h('td', { 'data-label': 'Объект' }, entityCell),
    h('td', { 'data-label': 'IP', class: 'text-xs mono' }, a.ip ?? '—'),
    h('td', { 'data-label-role': 'actions' },
      h('button', {
        class: 'btn btn-ghost btn-sm',
        type: 'button',
        onclick: () => openDetailModal(a),
      }, 'Детали')
    )
  );
}

function openDetailModal(a: AuditItem): void {
  const body = h('div', { class: 'stack' },
    h('div', { class: 'info-grid' },
      info('Actor ID', a.actorId ?? '—'),
      info('Роль', a.actorRole ?? '—'),
      info('Действие', a.action),
      info('Объект', a.entity),
      info('Entity ID', a.entityId ?? '—'),
      info('IP', a.ip ?? '—'),
      info('Request ID', a.requestId ?? '—'),
      info('Время', formatDateTime(a.createdAt))
    ),
    a.userAgent
      ? h('div', { class: 'field' },
          h('label', { class: 'field-label' }, 'User-Agent'),
          h('div', { class: 'diff-block' }, a.userAgent)
        )
      : null,
    a.before
      ? h('div', { class: 'field' },
          h('label', { class: 'field-label' }, 'До'),
          h('div', { class: 'diff-block is-before' }, JSON.stringify(a.before, null, 2))
        )
      : null,
    a.after
      ? h('div', { class: 'field' },
          h('label', { class: 'field-label' }, 'После'),
          h('div', { class: 'diff-block is-after' }, JSON.stringify(a.after, null, 2))
        )
      : null
  );

  openModal({
    title: 'Детали записи',
    body,
    size: 'lg',
    actions: [{ label: 'Закрыть', variant: 'secondary' }],
  });
}

function info(label: string, value: string): HTMLElement {
  return h('div', { class: 'info-block' },
    h('div', { class: 'info-block-label' }, label),
    h('div', { class: 'info-block-value mono text-sm' }, value)
  );
}

function openExportModal(): void {
  const fromInput = h('input', { class: 'input', type: 'datetime-local' }) as HTMLInputElement;
  const toInput = h('input', { class: 'input', type: 'datetime-local' }) as HTMLInputElement;

  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  fromInput.value = toLocalISO(monthAgo);
  toInput.value = toLocalISO(now);

  const body = h('div', { class: 'stack' },
    h('div', { class: 'field' },
      h('label', { class: 'field-label' }, 'От'),
      fromInput
    ),
    h('div', { class: 'field' },
      h('label', { class: 'field-label' }, 'До'),
      toInput
    ),
    h('div', { class: 'text-xs text-muted' },
      'CSV-файл с BOM для корректного открытия в Excel'
    )
  );

  openModal({
    title: 'Экспорт аудита',
    body,
    size: 'md',
    actions: [
      { label: 'Отмена', variant: 'secondary' },
      {
        label: 'Скачать CSV',
        variant: 'primary',
        closeOnClick: false,
        onClick: async () => {
          try {
            const from = new Date(fromInput.value).toISOString();
            const to = new Date(toInput.value).toISOString();

            const url = `/api/v1/admin/audit/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=50000`;

            const res = await fetch(url, { credentials: 'include' });
            if (!res.ok) throw new Error('Ошибка');

            const blob = await res.blob();
            const objUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objUrl;
            a.download = `audit-${from.slice(0, 10)}_${to.slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(objUrl);

            toastSuccess('Файл скачан');
          } catch {
            toastError('Не удалось скачать');
          }
          return true;
        },
      },
    ],
  });
}

function toLocalISO(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getQueryParams(): URLSearchParams {
  const hash = window.location.hash;
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return new URLSearchParams();
  return new URLSearchParams(hash.slice(qIdx + 1));
}

function navigateWithFilters(patch: Record<string, string | number>): void {
  const current = getQueryParams();
  const next = new URLSearchParams(current);
  for (const [k, v] of Object.entries(patch)) {
    if (v === '' || v === undefined || v === null) next.delete(k);
    else next.set(k, String(v));
  }
  const qs = next.toString();
  router.navigate(qs ? `/admin/audit?${qs}` : '/admin/audit');
}