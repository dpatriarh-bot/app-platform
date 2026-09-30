// ============================================================
// components/ui.ts — переиспользуемые UI-блоки
// ============================================================

import { h } from '../lib/dom.js';
import { icon, type IconName } from '../lib/icons.js';

// ============================================================
// EMPTY STATE
// ============================================================

export type IllustrationName =
  | 'empty'
  | 'search-empty'
  | 'no-tests'
  | 'no-gifts'
  | 'no-notifications'
  | 'not-found'
  | 'error'
  | 'success'
  | 'welcome';

export interface EmptyStateOptions {
  icon?: IconName;
  illustration?: IllustrationName;
  title: string;
  description?: string;
  action?: HTMLElement;
}

export function emptyState(options: EmptyStateOptions): HTMLElement {
  const visual = options.illustration
    ? illustration(options.illustration, 160)
    : h('div', { class: 'empty-icon' },
        icon(options.icon ?? 'info', { size: 48, className: 'icon icon-2xl' })
      );

  return h('div', { class: 'empty anim-fade-in' },
    visual,
    h('div', { class: 'empty-title' }, options.title),
    options.description
      ? h('p', { class: 'empty-description' }, options.description)
      : null,
    options.action ? h('div', { class: 'mt-5' }, options.action) : null
  );
}

// ============================================================
// ILLUSTRATION
// ============================================================

export function illustration(name: IllustrationName, size = 200): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'illustration');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 200 200');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `/illustrations.svg#${name}`);
  svg.appendChild(use);

  return svg;
}

// ============================================================
// LOADER
// ============================================================

export function loader(label = 'Загрузка...'): HTMLElement {
  return h('div', { class: 'center anim-fade-in', style: 'padding: 64px 0;' },
    h('div', { class: 'text-center' },
      h('div', { class: 'spinner', style: 'margin: 0 auto 16px;' }),
      h('div', { class: 'text-muted text-sm' }, label)
    )
  );
}

export function skeletonCard(): HTMLElement {
  return h('div', { class: 'card card-pad' },
    h('div', { class: 'skeleton skeleton-title' }),
    h('div', { class: 'skeleton skeleton-text', style: 'width: 90%;' }),
    h('div', { class: 'skeleton skeleton-text', style: 'width: 75%;' })
  );
}

// ============================================================
// BREADCRUMBS
// ============================================================

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function breadcrumbs(items: BreadcrumbItem[]): HTMLElement {
  return h('nav', { class: 'breadcrumbs', 'aria-label': 'Навигация' },
    ...items.flatMap((item, i) => {
      const nodes: HTMLElement[] = [];
      if (i > 0) {
        nodes.push(h('span', { class: 'breadcrumbs-sep' }, '/'));
      }
      nodes.push(
        item.href
          ? h('a', { href: item.href }, item.label)
          : h('span', { class: 'breadcrumbs-current' }, item.label)
      );
      return nodes;
    })
  );
}

// ============================================================
// STAT CARD
// ============================================================

export interface StatCardOptions {
  label: string;
  value: string | number;
  hint?: string;
  icon?: IconName;
  variant?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'lav';
}

export function statCard(options: StatCardOptions): HTMLElement {
  const variant = options.variant ?? 'primary';

  return h('div', { class: 'stat-card' },
    h('div', { class: 'stat-card-head' },
      h('div', { class: 'stat-label' }, options.label),
      options.icon
        ? h('div', { class: `stat-icon is-${variant}` },
            icon(options.icon, { size: 16, className: 'icon icon-sm' })
          )
        : null
    ),
    h('div', { class: 'stat-value' }, String(options.value)),
    options.hint ? h('div', { class: 'stat-hint' }, options.hint) : null
  );
}

// ============================================================
// TABS
// ============================================================

export interface TabItem {
  key: string;
  label: string;
  active?: boolean;
  onClick: () => void;
}

export function tabs(items: TabItem[]): HTMLElement {
  return h('div', { class: 'tabs' },
    ...items.map((item) =>
      h('button', {
        class: `tab ${item.active ? 'is-active' : ''}`,
        type: 'button',
        onclick: item.onClick,
      }, item.label)
    )
  );
}

export function pillsTabs(items: TabItem[]): HTMLElement {
  return h('div', { class: 'tabs tabs-pills' },
    ...items.map((item) =>
      h('button', {
        class: `tab ${item.active ? 'is-active' : ''}`,
        type: 'button',
        onclick: item.onClick,
      }, item.label)
    )
  );
}

// ============================================================
// PAGINATION
// ============================================================

export interface PaginationOptions {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}

export function pagination(options: PaginationOptions): HTMLElement {
  if (options.totalPages <= 1) return h('div');

  const pages: number[] = [];
  const { page, totalPages } = options;

  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push(-1);
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i);
    }
    if (page < totalPages - 2) pages.push(-1);
    pages.push(totalPages);
  }

  return h('div', { class: 'pagination' },
    h('button', {
      class: 'page-link',
      type: 'button',
      disabled: page === 1,
      onclick: () => options.onChange(page - 1),
      'aria-label': 'Предыдущая',
    }, icon('chevron-left', { size: 16, className: 'icon icon-sm' })),
    ...pages.map((p) =>
      p === -1
        ? h('span', { class: 'page-link', style: 'pointer-events: none;' }, '…')
        : h('button', {
            class: `page-link ${p === page ? 'is-active' : ''}`,
            type: 'button',
            onclick: () => options.onChange(p),
          }, String(p))
    ),
    h('button', {
      class: 'page-link',
      type: 'button',
      disabled: page === totalPages,
      onclick: () => options.onChange(page + 1),
      'aria-label': 'Следующая',
    }, icon('chevron-right', { size: 16, className: 'icon icon-sm' }))
  );
}

// ============================================================
// STATUS BADGE
// ============================================================

export function statusBadge(status: string): HTMLElement {
  const map: Record<string, { class: string; label: string }> = {
    active: { class: 'badge-success', label: 'Активна' },
    pending: { class: 'badge-warning', label: 'Ожидает' },
    past_due: { class: 'badge-danger', label: 'Просрочена' },
    canceled: { class: 'badge', label: 'Отменена' },
    expired: { class: 'badge', label: 'Истекла' },

    finished: { class: 'badge-success', label: 'Завершён' },
    in_progress: { class: 'badge-primary', label: 'В процессе' },
    flagged: { class: 'badge-warning', label: 'На проверке' },
    blocked: { class: 'badge-danger', label: 'Заблокирован' },
    abandoned: { class: 'badge', label: 'Прерван' },

    issued: { class: 'badge-primary', label: 'Выдан' },
    redeemed: { class: 'badge-success', label: 'Получен' },

    succeeded: { class: 'badge-success', label: 'Успешно' },
    failed: { class: 'badge-danger', label: 'Ошибка' },
    refunded: { class: 'badge', label: 'Возврат' },

    draft: { class: 'badge', label: 'Черновик' },
    review: { class: 'badge-warning', label: 'На проверке' },
    published: { class: 'badge-success', label: 'Опубликован' },
    archived: { class: 'badge', label: 'В архиве' },

    scheduled: { class: 'badge-primary', label: 'Запланирована' },
    completed: { class: 'badge-success', label: 'Завершена' },

    confirmed: { class: 'badge-success', label: 'Подтверждено' },
    rejected: { class: 'badge-danger', label: 'Отклонено' },
    partial: { class: 'badge-warning', label: 'Частично' },
  };

  const info = map[status] ?? { class: 'badge', label: status };
  return h('span', { class: `badge ${info.class}` }, info.label);
}

// ============================================================
// STAGGER LIST (каскадное появление)
// ============================================================

export function staggerList(children: HTMLElement[], className = 'stack'): HTMLElement {
  return h('div', { class: `${className} stagger` },
    ...children.map((child) => {
      child.classList.add('stagger-item');
      return child;
    })
  );
}

// ============================================================
// DIVIDER
// ============================================================

export function divider(text?: string): HTMLElement {
  return text
    ? h('div', { class: 'divider-text' }, text)
    : h('hr', { class: 'divider' });
}

// ============================================================
// TOOLTIP WRAPPER
// ============================================================

export function withTooltip(node: HTMLElement, tooltip: string): HTMLElement {
  const wrap = h('span', { class: 'tooltip', 'data-tooltip': tooltip }, node);
  return wrap;
}

// ============================================================
// STATUS DOT
// ============================================================

export function statusDot(
  status: 'active' | 'pending' | 'blocked' | 'inactive',
  label: string
): HTMLElement {
  return h('span', { class: `status-dot ${status}` }, label);
}