// ============================================================
// modal.ts — модальные окна
// ============================================================

import { h, el } from './dom.js';
import { icon } from './icons.js';

export interface ModalOptions {
  title: string;
  body: HTMLElement | string;
  size?: 'sm' | 'md' | 'lg';
  actions?: Array<{
    label: string;
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    onClick?: () => void | boolean | Promise<void | boolean>;
    closeOnClick?: boolean;
  }>;
  onClose?: () => void;
}

export function openModal(options: ModalOptions): () => void {
  const root = document.getElementById('modal-root');
  if (!root) throw new Error('modal-root не найден');

  const sizeClass = options.size === 'lg' ? 'modal-lg' : options.size === 'sm' ? 'modal-sm' : '';

  const backdrop = h('div', { class: 'modal-backdrop is-open', role: 'dialog', 'aria-modal': 'true' });

  const body = el('div');
  body.className = 'modal-body';
  if (typeof options.body === 'string') {
    body.textContent = options.body;
  } else {
    body.appendChild(options.body);
  }

  const footer = options.actions && options.actions.length > 0
    ? h('div', { class: 'modal-foot' },
        ...options.actions.map((a) =>
          h('button', {
            class: `btn ${a.variant === 'danger' ? 'btn-danger' : a.variant === 'secondary' ? 'btn-secondary' : a.variant === 'ghost' ? 'btn-ghost' : ''}`,
            type: 'button',
            onclick: async () => {
              const result = a.onClick ? await a.onClick() : undefined;
              if (a.closeOnClick !== false && result !== false) {
                close();
              }
            },
          }, a.label)
        )
      )
    : null;

  const closeBtn = h('button', {
    class: 'modal-close',
    type: 'button',
    'aria-label': 'Закрыть',
    onclick: () => close(),
  }, icon('x', { size: 20 }));

  const modal = h('div', { class: `modal ${sizeClass}` },
    h('div', { class: 'modal-head' },
      h('div', { class: 'modal-title' }, options.title),
      closeBtn
    ),
    body,
    footer
  );

  backdrop.appendChild(modal);
  root.appendChild(backdrop);
  document.body.classList.add('no-scroll');

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  function close(): void {
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('no-scroll');
    backdrop.remove();
    options.onClose?.();
  }

  return close;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export function confirmModal(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (value: boolean): void => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const close = openModal({
      title: options.title,
      body: options.message,
      actions: [
        {
          label: options.cancelLabel ?? 'Отмена',
          variant: 'secondary',
          onClick: () => { done(false); return true; },
        },
        {
          label: options.confirmLabel ?? 'Подтвердить',
          variant: options.danger ? 'danger' : 'primary',
          onClick: () => { done(true); return true; },
        },
      ],
      onClose: () => done(false),
    });

    void close;
  });
}